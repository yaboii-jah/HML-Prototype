import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { purchasingFixture } from './helpers/purchasing.mjs';
import { calculatePo } from '../src/domain/purchasing/pricing.ts';

const fixture = purchasingFixture();
const po = { id: randomUUID(), kind: 'po', mrfId: fixture.q.mrfId, quoteId: fixture.q.id, version: '3',
  body: fixture.order, calculation: calculatePo(fixture.q, fixture.order) };
fixture.view.records = [po];
let role = 'Accounting', interrupted = false;
const calls = [];
class RpcError extends Error { constructor(code) { super('RPC failed'); this.code = code; } }
globalThis.__accountingCommand = {
  RpcError,
  quotationActor: async () => ({ userId: randomUUID(), sessionId: randomUUID(), revision: '1', activeRole: role }),
  purchasingView: async () => fixture.view,
  dispatchApprovedPoArchives: async () => {},
  serviceRpc: async (name, args) => {
    assert.equal(name, 'accounting_command');
    calls.push(args);
    if (interrupted) throw Error('Lost response after possible commit');
    return { targetId: po.id, changed: true };
  },
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  const names = {
    '@/src/server/quotations/drafts': ['quotationActor'], '@/src/server/auth/service-rpc': ['serviceRpc'],
    './purchasing': ['purchasingView'], './approval-archives': ['dispatchApprovedPoArchives'],
  }[specifier];
  if (names) return { url: 'data:text/javascript,' + names.map(name => `export const ${name}=(...args)=>globalThis.__accountingCommand.${name}(...args);`).join('')
    + (specifier.includes('service-rpc') ? 'export const ServiceCommandError=globalThis.__accountingCommand.RpcError;' : ''), shortCircuit: true };
  if (specifier.startsWith('@/src/domain/')) return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { runAccountingCommand } = await import('../src/server/purchasing/accounting.ts');
const command = (type) => ({ type, requestId: randomUUID(), mrfId: po.mrfId, targetId: po.id,
  expectedVersion: fixture.view.version, expectedDemand: fixture.view.demandVersion, expectedPoVersion: po.version,
  expectedProjectVersion: '1', expectedFamily: '1', expectedMrfArchive: fixture.q.family.currentMrfArchiveId, reason: '' });

test('Accounting transport denies crossed roles and client snapshots before any write', async () => {
  calls.length = 0;
  role = 'Procurement';
  assert.equal((await runAccountingCommand(command('approvePo'))).ok, false);
  role = 'Accounting';
  assert.equal((await runAccountingCommand(command('submitPo'))).ok, false);
  assert.equal((await runAccountingCommand({ ...command('approvePo'), snapshot: {} })).ok, false);
  assert.equal(calls.length, 0);
});

test('Procurement submission constructs its immutable render basis from saved server data', async () => {
  calls.length = 0; role = 'Procurement'; interrupted = false;
  const input = command('submitPo');
  assert.equal((await runAccountingCommand({ ...input, gross: '0.01' })).ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].command, input);
  assert.equal(calls[0].snapshot.po.calculation.gross, po.calculation.gross);
  assert.deepEqual(calls[0].snapshot.view.records, [po]);
});

test('uncertain approval replays the same request after live gates change and reports its historical outcome', async () => {
  calls.length = 0; role = 'Accounting'; interrupted = true;
  const input = command('approvePo');
  const uncertain = await runAccountingCommand(input);
  assert.equal(uncertain.uncertain, true);
  fixture.view.version = '99';
  fixture.view.quotations.request.procurementReady = false;
  fixture.q.revision.eligible = false;
  po.version = '100';
  interrupted = false;
  const replay = await runAccountingCommand(input);
  assert.equal(replay.ok, true);
  assert.match(replay.message, /original action was recorded/i);
  assert.deepEqual(calls[0].command, calls[1].command);
  assert.equal(calls[1].snapshot, null);
});
