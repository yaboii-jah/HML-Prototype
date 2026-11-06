import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function checkQuotationFinalizationRaces({
  sql,
  database,
  environment,
  fixture,
}) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "Owned disposable finalization races",
  );
  const actor = { ...fixture.actor, sessionId: randomUUID() };
  const json = (value) =>
    "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const value = async (statement) =>
    JSON.parse((await sql(statement)).output.trim().split("\n").at(-1));
  const view = (quote) => value(`select private.quotation_view('${quote}');`);
  async function bind() {
    await sql(`insert into auth.sessions(id,user_id,created_at,updated_at) values('${actor.sessionId}','${actor.userId}',now(),now()) on conflict do nothing;
      delete from private.session_bindings where session_id='${actor.sessionId}';
      select private.bind_session('${actor.userId}','${actor.sessionId}',private.login_preflight((select email from auth.users where id='${actor.userId}'))->>'revision',private.login_preflight((select email from auth.users where id='${actor.userId}'))->>'credential');`);
    actor.revision = (
      await sql(
        `select access_revision::text from public.profiles where user_id='${actor.userId}';`,
      )
    ).output.trim();
  }
  await bind();
  async function financial(quote, type, extra = {}, calculation = null) {
    const q = await view(quote);
    const command = {
      type,
      quoteId: quote,
      requestId: randomUUID(),
      expectedVersion: q.version,
      expectedFiles: q.fileVersion,
      expectedFinancial: q.financial.version,
      expectedFamily: q.family.version,
      ...extra,
    };
    return {
      command,
      statement: `select public.quotation_financial_command(${json(actor)},${json(command)},${json(calculation)});`,
    };
  }
  const capture = async (quote, type, extra = {}) => {
    const q = await view(quote);
    return value(
      `select public.quotation_command(${json(actor)},${json({ type, requestId: randomUUID(), quoteId: quote, expectedVersion: q.version, expectedFiles: q.fileVersion, ...extra })});`,
    );
  };
  async function race(
    firstSql,
    secondSql,
    isolation,
    secondMaySucceed = false,
  ) {
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
    const first = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, diagnostics }));
    });
    let second;
    try {
      child.stdin.write(
        `begin isolation level ${isolation}; ${firstSql} select 'finalization-ready';\n`,
      );
      for (let i = 0; i < 200 && !output.includes("finalization-ready"); i++)
        await delay(25);
      assert.ok(
        output.includes("finalization-ready"),
        "First financial transaction reached its held lock: " + diagnostics,
      );
      const name = "finalization-race-" + randomUUID();
      second = sql(
        `set application_name='${name}'; begin isolation level ${isolation}; ${secondSql} commit;`,
        { allowFailure: true },
      );
      let blocked = false;
      for (let i = 0; i < 120 && !blocked; i++) {
        blocked =
          (
            await sql(
              `select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`,
            )
          ).output.trim() === "t";
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, "Competing finalization action demonstrably waited");
      child.stdin.end("commit;\n");
      const [one, two] = await Promise.all([first, second]);
      assert.equal(one.code, 0, one.diagnostics);
      if (!secondMaySucceed)
        assert.notEqual(
          two.code,
          0,
          "Both conflicting financial actions cannot succeed",
        );
      if (two.code !== 0)
        assert.match(
          two.diagnostics,
          /review|Review|changed|serialize|draft|replacement|immutable|eligibility/i,
        );
      return two;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end("rollback;\n");
      await Promise.allSettled([first, second]);
    }
  }
  async function ready(quote, freshFile = false) {
    if (freshFile) {
      const q = await view(quote);
      const group = await value(
        `select public.quotation_files_command(${json(actor)},${json({ type: "beginGroup", requestId: randomUUID(), quoteId: quote, expectedFiles: q.fileVersion, keep: [], uploads: [{ name: "race-original.pdf", mime: "application/pdf", size: 10, sha256: "b".repeat(64) }] })});`,
      );
      const file = (
        await sql(
          `select id from private.quotation_files where group_id='${group.groupId}';`,
        )
      ).output.trim();
      const transfer = await value(
        `select public.quotation_transfer(${json(actor)},'${file}','claim');`,
      );
      await sql(`select public.quotation_transfer(${json(actor)},'${file}','checkpoint','${transfer.lease}','{"driveFileId":"owned-race-original-${file}"}');
        select public.quotation_transfer(${json(actor)},'${file}','finish','${transfer.lease}');`);
      const job = (
        await sql(
          `select id from private.quotation_jobs where file_id='${file}' and kind='validate';`,
        )
      ).output.trim();
      const worker = await value(
        `select public.quotation_worker('${job}','claim');`,
      );
      await sql(
        `select public.quotation_worker('${job}','checkpoint','${worker.lease}','{"verified":true}');select public.quotation_worker('${job}','complete','${worker.lease}');`,
      );
    }
    let q = await view(quote);
    for (const row of q.financial.review.rows.filter(
      (row) => row.role === "material",
    ))
      if (q.body.lines.find((line) => line.id === row.id)?.requestItemId)
        await capture(quote, "confirmMatch", { lineId: row.id });
    await capture(quote, "checkSource");
    q = await view(quote);
    await sql(
      (
        await financial(
          quote,
          "saveFinancial",
          { review: q.financial.review },
          q.financial.calculation,
        )
      ).statement,
    );
    await sql((await financial(quote, "checkFinancial")).statement);
    return view(quote);
  }
  async function revision(base, freshFile = false) {
    const draft = await value(
      (
        await financial(base, "startRevision", {
          reason: "Owned finalization concurrency fixture",
        })
      ).statement,
    );
    await ready(draft.quoteId, freshFile);
    return draft.quoteId;
  }
  async function archiveProof(quote) {
    const q = await view(quote),
      revision = q.revision.id;
    const id = (
      await sql(
        `select id from private.quotation_archive_jobs where revision_id='${revision}';`,
      )
    ).output.trim();
    const worker = await value(
      `select public.quotation_archive_worker('${id}','claim');`,
    );
    assert.ok(worker?.lease, "Archive worker acquired its checked lease");
    const manifest = q.files.map((file) => ({
      id: file.id,
      size: file.size,
      sha256: file.sha256,
    }));
    await sql(
      `select public.quotation_archive_worker('${id}','checkpoint','${worker.lease}',${json({ pdfFileId: "owned-race-review-" + revision, pdfSha256: "c".repeat(64), pdfSize: 100, manifest, verified: true })});`,
    );
    return {
      id,
      lease: worker.lease,
      complete: `select public.quotation_archive_worker('${id}','complete','${worker.lease}');`,
    };
  }
  let base = fixture.previous,
    pending = fixture.quote;
  for (const isolation of ["read committed", "repeatable read"]) {
    if (isolation === "repeatable read") pending = await revision(base);
    const q = await view(pending),
      first = await financial(pending, "finalize", {}, q.financial.calculation),
      second = await financial(
        pending,
        "finalize",
        {},
        q.financial.calculation,
      );
    await race(first.statement, second.statement, isolation);
    assert.equal(
      (
        await sql(
          `select count(*) from private.quotation_revisions where quote_id='${pending}';`,
        )
      ).output.trim(),
      "1",
    );
    const receipt = await value(
      `select result from private.quotation_operations where id='${first.command.requestId}';`,
    );
    assert.deepEqual(
      await value(first.statement),
      receipt,
      "Lost-response retry returns the exact frozen outcome",
    );
    assert.equal(
      (
        await sql(
          `select count(*) from private.audit_events where entity_id='${pending}' and action='quotation.finalize';`,
        )
      ).output.trim(),
      "1",
    );
    const job = await archiveProof(pending),
      withdraw = await financial(pending, "withdraw", {
        reason: "Withdraw before archive acknowledgement",
      });
    const ack = await race(withdraw.statement, job.complete, isolation, true);
    if (ack.code !== 0) await sql(job.complete);
    assert.equal((await view(pending)).revision.withdrawn, true);
    assert.equal((await view(pending)).revision.eligible, false);
    assert.equal(
      (
        await sql(
          `select count(*) from private.quotation_archives where revision_id='${receipt.quote.revision.id}';`,
        )
      ).output.trim(),
      "1",
    );
    // Two users cannot start separate replacements from the same reviewed family.
    const start = await financial(pending, "startRevision", {
      reason: "First replacement wins",
    });
    const competingStart = await financial(pending, "startRevision", {
      reason: "Competing replacement",
    });
    await race(start.statement, competingStart.statement, isolation);
    const created = await value(
      `select result from private.quotation_operations where id='${start.command.requestId}';`,
    );
    const next = created.quoteId;
    await ready(next);
    await sql(
      (
        await financial(
          next,
          "finalize",
          {},
          (await view(next)).financial.calculation,
        )
      ).statement,
    );
    const completed = await archiveProof(next),
      staleWithdrawal = await financial(next, "withdraw", {
        reason: "Withdrawal based on pre-activation state",
      });
    await race(completed.complete, staleWithdrawal.statement, isolation);
    assert.equal(
      (await view(next)).revision.eligible,
      true,
      "A stale withdrawal cannot overwrite a newly activated head",
    );
    await sql(
      (
        await financial(next, "withdraw", {
          reason: "Reviewed withdrawal after activation",
        })
      ).statement,
    );
    base = next;

    // Replacement/removal wins first: the stale finalization must never retain a
    // file that cleanup already admitted. Reverse order must retain that file.
    const replace = await revision(base, true),
      before = await view(replace),
      oldFile = before.files[0].id;
    const finalize = await financial(
      replace,
      "finalize",
      {},
      before.financial.calculation,
    );
    const remove = `select public.quotation_files_command(${json(actor)},${json({ type: "beginGroup", requestId: randomUUID(), quoteId: replace, expectedFiles: before.fileVersion, keep: [], uploads: [] })});
      select public.quotation_worker((select id from private.quotation_jobs where file_id='${oldFile}' and kind='cleanup'),'claim');`;
    await race(remove, finalize.statement, isolation);
    assert.equal((await view(replace)).state, "draft");
    assert.equal(
      (
        await sql(
          `select retained from private.quotation_files where id='${oldFile}';`,
        )
      ).output.trim(),
      "f",
    );
    await capture(replace, "status", {
      state: "cancelled",
      reason: "Close obsolete file concurrency fixture",
    });
    const protectedQuote = await revision(base, true),
      protectedView = await view(protectedQuote);
    const protectedFinalize = await financial(
      protectedQuote,
      "finalize",
      {},
      protectedView.financial.calculation,
    );
    const removeAfter = `select public.quotation_files_command(${json(actor)},${json({ type: "beginGroup", requestId: randomUUID(), quoteId: protectedQuote, expectedFiles: protectedView.fileVersion, keep: [], uploads: [] })});`;
    await race(protectedFinalize.statement, removeAfter, isolation);
    assert.equal((await view(protectedQuote)).state, "finalized");
    assert.equal(
      (
        await sql(
          `select retained from private.quotation_files where id='${protectedView.files[0].id}';`,
        )
      ).output.trim(),
      "t",
    );
    await sql(
      (
        await financial(protectedQuote, "withdraw", {
          reason: "Close retained file concurrency fixture",
        })
      ).statement,
    );
    base = protectedQuote;
  }
  // Current authority is rechecked at acknowledgement, independently of leases.
  const admitted = await revision(base);
  await sql(
    (
      await financial(
        admitted,
        "finalize",
        {},
        (await view(admitted)).financial.calculation,
      )
    ).statement,
  );
  const job = await archiveProof(admitted);
  await race(
    `update private.account_guard set revision=revision+1 where id;update public.profiles set is_active=false where user_id='${actor.userId}';`,
    job.complete,
    "read committed",
    true,
  );
  assert.equal(
    (
      await sql(
        `select state from private.quotation_archive_jobs where id='${job.id}';`,
      )
    ).output.trim(),
    "paused",
  );
  assert.equal((await view(admitted)).revision.eligible, false);
  await sql(
    `update public.profiles set is_active=true where user_id='${actor.userId}';`,
  );
  await bind();
  await sql((await financial(admitted, "retryArchive")).statement);
  const resumed = await archiveProof(admitted);
  await race(
    resumed.complete,
    `update private.account_guard set revision=revision+1 where id;update public.profiles set is_active=false where user_id='${actor.userId}';`,
    "read committed",
    true,
  );
  assert.equal(
    (
      await sql(
        `select state from private.quotation_archive_jobs where id='${job.id}';`,
      )
    ).output.trim(),
    "complete",
  );
  assert.equal(
    (await view(admitted)).revision.eligible,
    true,
    "Later actor revocation does not rewrite a completed historical archive",
  );
  await sql(
    `update public.profiles set is_active=true where user_id='${actor.userId}';`,
  );
  await bind();
  console.log(
    "Observed finalization/retry/replacement/activation/withdrawal/file-retention races passed at both isolation levels; archive acknowledgement/revocation passed in both orders.",
  );
}
