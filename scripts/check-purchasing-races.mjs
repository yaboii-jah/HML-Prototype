import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function checkPurchasingRaces({ sql, database, environment }) {
  const definition = (
    await readFile("supabase/checks/purchasing.sql", "utf8")
  ).split("-- Assertions (the concurrency runner")[0];
  const json = (value) =>
    "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const fixture = async () =>
    JSON.parse(
      (
        await sql(definition + "select pg_temp.purchasing_fixture(); commit;")
      ).output
        .split("\n")
        .find((line) => line.startsWith("{")),
    );
  const snapshot = async (f) =>
    JSON.parse(
      (
        await sql(`select private.demand_snapshot('${f.request}');`)
      ).output.trim(),
    );
  const purchase = (
    f,
    kind,
    target,
    version,
    demandVersion,
    extra = {},
    operation = randomUUID(),
  ) =>
    `select public.purchasing_command(${json(f.actor)},${json({ type: kind, requestId: operation, mrfId: f.request, targetId: target, expectedVersion: version, expectedDemand: demandVersion, quoteId: f.quote, expectedFamily: "2", body: f.body, ...extra })});`;
  // Family creation advances its version. Read the actual value into each fixture.
  const fresh = async () => {
    const f = await fixture();
    f.familyVersion = (
      await sql(
        `select version::text from private.quotation_families where id='${f.family}';`,
      )
    ).output.trim();
    return f;
  };
  const buying = (f, ...args) =>
    purchase(f, ...args).replace(
      '"expectedFamily":"2"',
      '"expectedFamily":"' + f.familyVersion + '"',
    );
  const hold = (f, expected, amount) =>
    `select private.demand_apply(${json(f.actor)},'${randomUUID()}','${f.request}','${expected}',${json([{ claimId: randomUUID(), itemId: f.item, ownerKind: "suitability", ownerId: randomUUID(), ownerLineId: randomUUID(), quantity: amount }])},'Synthetic suitability owning transaction');`;
  async function race(first, second, isolation) {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        database,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { env: environment, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      diagnostics = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk;
    });
    const finished = new Promise((done, reject) => {
      child.on("error", reject);
      child.on("close", (code) => done(code));
    });
    let competing;
    try {
      child.stdin.write(
        `begin isolation level ${isolation}; ${first} select 'purchasing-ready';\n`,
      );
      for (let i = 0; i < 200 && !output.includes("purchasing-ready"); i++)
        await delay(25);
      assert.ok(output.includes("purchasing-ready"), diagnostics);
      const name = "purchasing-race-" + randomUUID();
      competing = sql(
        `set application_name='${name}'; begin isolation level ${isolation}; ${second} commit;`,
        { allowFailure: true },
      );
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked =
          (
            await sql(
              `select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`,
            )
          ).output.trim() === "t";
        if (!blocked) await delay(25);
      }
      assert.ok(
        blocked,
        "Purchasing competitor demonstrably waits on its predecessor",
      );
      child.stdin.end("commit;\n");
      assert.equal(await finished, 0, diagnostics);
      return await competing;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end("rollback;\n");
      await Promise.allSettled([finished, competing]);
    }
  }
  for (const isolation of ["read committed", "repeatable read"]) {
    let f = await fresh(),
      award = randomUUID();
    let result = await race(
      buying(f, "saveAward", award, "0", "0"),
      buying(f, "saveAward", randomUUID(), "0", "0"),
      isolation,
    );
    assert.notEqual(result.code, 0);
    assert.match(
      result.diagnostics,
      /Purchasing or demand changed|could not serialize/,
    );
    assert.equal((await snapshot(f)).requirements[0].awarded, "6");
    for (const purchasingFirst of [true, false]) {
      f = await fresh();
      award = randomUUID();
      const acquisition = buying(f, "saveAward", award, "0", "0"),
        suitability = hold(f, "0", "13");
      result = await race(
        purchasingFirst ? acquisition : suitability,
        purchasingFirst ? suitability : acquisition,
        isolation,
      );
      assert.notEqual(result.code, 0);
      assert.match(result.diagnostics, /changed|could not serialize/);
      const excess = await sql(
        purchasingFirst
          ? hold(f, "1", "13")
          : buying(f, "saveAward", award, "0", "1"),
        { allowFailure: true },
      );
      assert.notEqual(excess.code, 0);
      assert.match(excess.diagnostics, /exceed requested/);
    }
    f = await fresh();
    award = randomUUID();
    const operation = randomUUID(),
      command = buying(f, "saveAward", award, "0", "0", {}, operation);
    result = await race(command, command, isolation);
    if (result.code !== 0)
      assert.match(result.diagnostics, /could not serialize/);
    await sql(command);
    assert.equal(
      (
        await sql(
          `select count(*) from private.audit_events where request_id='${operation}';`,
        )
      ).output.trim(),
      "1",
    );
    result = await race(
      buying(f, "convert", award, "1", "1"),
      hold(f, "1", "13"),
      isolation,
    );
    assert.notEqual(result.code, 0);
    assert.match(result.diagnostics, /changed|could not serialize/);
    assert.equal((await snapshot(f)).requirements[0].ordered, "6");
    assert.equal((await snapshot(f)).requirements[0].awarded, "0");
    assert.equal(
      (
        await sql(
          `select last_value from private.document_counters where project_id=(select project_id from public.material_requests where id='${f.request}') and series='PO';`,
        )
      ).output.trim(),
      "1",
    );
    for (const loss of ["supplier", "withdrawal", "profile", "session"])
      for (const lossFirst of [true, false]) {
        f = await fresh();
        award = randomUUID();
        const change =
          loss === "session"
            ? `delete from auth.sessions where id='${f.actor.sessionId}';`
            : `update private.account_guard set revision=revision+1 where id; ` +
              (loss === "supplier"
                ? `update private.suppliers set is_active=false where id='${f.supplier}';`
                : loss === "profile"
                  ? `update public.profiles set is_active=false where user_id='${f.actor.userId}';`
                  : `insert into private.quotation_revision_events(revision_id,kind,actor,reason) values('${f.revision}','withdraw',${json(f.actor)},'Supplier withdrew current offer');`);
        const acquisition = buying(f, "saveAward", award, "0", "0");
        result = await race(
          lossFirst ? change : acquisition,
          lossFirst ? acquisition : change,
          isolation,
        );
        if (lossFirst) {
          assert.notEqual(result.code, 0);
          assert.match(
            result.diagnostics,
            /eligible|access|session|could not serialize/i,
          );
          assert.equal((await snapshot(f)).version, "0");
        } else {
          if (result.code !== 0) {
            assert.match(result.diagnostics, /could not serialize/);
            await sql(change);
          }
          assert.equal(
            (await snapshot(f)).requirements[0].awarded,
            "6",
            "Loss never frees an admitted claim",
          );
        }
      }
  }
}
