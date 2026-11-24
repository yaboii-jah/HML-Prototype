import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { operationalAcceptanceSql } from './helpers/operational-acceptance-check.mjs';
import { transferJson as json, transferRace, transferResult } from './check-transfer-races.mjs';

export async function checkOperationalAcceptanceRaces(context) {
  const { sql } = context;
  const race = transferRace(context);
  const definitions = await operationalAcceptanceSql({ definitionsOnly: true });
  const read = query => transferResult(sql, query);
  for (const isolation of ['read committed', 'repeatable read']) {
    for (const awardFirst of [true, false]) {
      const f = await read(definitions + 'select pg_temp.acceptance_source(pg_temp.purchasing_fixture()); commit;');
      const awardId = randomUUID();
      const family = (await sql(`select version from private.quotation_families where id='${f.family}';`)).output.trim();
      const award = (version = '0') => `select public.purchasing_command(${json(f.actor)},${json({
        type: 'saveAward', requestId: randomUUID(), mrfId: f.request, targetId: awardId,
        expectedVersion: '0', expectedDemand: version, quoteId: f.quote, expectedFamily: family, body: f.body,
      })});`;
      const transfer = async () => {
        const input = await read(definitions + `select pg_temp.transfer_input(${json(f)},'submit',null,
          jsonb_build_object('selections',jsonb_build_array(pg_temp.transfer_selection(${json(f)},'direct','13')))); rollback;`);
        return `select public.transfer_command(${json(f.actor)},${json(input)});`;
      };
      const firstAward = award(), firstTransfer = await transfer();
      await race(awardFirst ? firstAward : firstTransfer, awardFirst ? firstTransfer : firstAward, isolation);
      const result = await sql(awardFirst ? await transfer() : award('1'), { allowFailure: true });
      assert.notEqual(result.code, 0, 'A refreshed command cannot claim the remaining quantity twice');
      assert.match(result.diagnostics, /exceed requested|quantity|unassigned/i);
      const committed = await read(`select jsonb_build_object(
        'claims',(select sum(quantity) from private.demand_claims where request_id='${f.request}'),
        'reserved',private.stock_snapshot(array['${f.direct}'::uuid])->0->>'reserved',
        'awards',(select count(*) from private.purchasing_records where request_id='${f.request}' and kind='award'),
        'transfers',(select count(*) from private.transfers where request_id='${f.request}'));`);
      assert.deepEqual(committed, awardFirst
        ? { claims: 6, reserved: '0', awards: 1, transfers: 0 }
        : { claims: 13, reserved: '13', awards: 0, transfers: 1 });
    }
  }
}
