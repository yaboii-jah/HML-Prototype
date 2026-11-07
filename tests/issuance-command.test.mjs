import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const bytes = Buffer.from('%PDF-synthetic transport fixture');
const calls = [], reads = [];
let role = 'Procurement', receipt = null, problem = '', failure = null;
const command = type => ({ type, requestId: randomUUID(), mrfId: randomUUID(), targetId: randomUUID(), expectedVersion: '1', expectedDemand: '1',
  expectedPoVersion: '1', expectedProjectVersion: '1', expectedFamily: '1', expectedMrfArchive: randomUUID(), reason: '' });
const proof = { approvalId: randomUUID(), mrfArchiveId: randomUUID(), poArchiveId: randomUUID(), files: [1, 2, 3].map(n => ({ id: 'owned-' + n,
  size: String(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex'), tags: { hmlKind: 'kind-' + n }, ...(n === 3 ? { parent: 'owned-parent' } : {}) })) };
class RpcError extends Error { constructor(code) { super('RPC failed'); this.code = code; } }
globalThis.__issuance = {
  RpcError,
  quotationActor: async () => ({ activeRole: role }),
  serviceRpc: async (name, args) => {
    calls.push({ name, args });
    if (failure) throw new RpcError(failure);
    if (name === 'issuance_receipt') return receipt ? { targetId: args.command.targetId, changed: true } : null;
    if (name === 'issuance_prepare_files') return proof;
    if (name === 'issuance_command') return { targetId: args.command.targetId, changed: true };
    throw Error('Unexpected RPC');
  },
  validateSupportingPdf: async body => assert.deepEqual(body, bytes),
  documentDrive: () => ({
    get: async id => {
      reads.push(id);
      if (problem === 'offline') throw Error('Provider unavailable');
      const f = proof.files.find(f => f.id === id);
      return { id: problem === 'identity' ? 'wrong-id' : id, trashed: problem === 'trashed', mimeType: 'application/pdf', size: f.size, parents: ['owned-parent'], properties: f.tags };
    },
    bytes: async () => problem === 'hash' ? Buffer.from('tampered') : bytes,
  }),
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  const names = {
    '@/src/server/quotations/drafts': ['quotationActor'], '@/src/server/auth/service-rpc': ['serviceRpc'],
    '@/src/server/documents/config': ['documentDrive'], '../documents/pdf-validation.ts': ['validateSupportingPdf'],
  }[specifier];
  if (names) return { url: 'data:text/javascript,' + names.map(n => `export const ${n}=(...a)=>globalThis.__issuance.${n}(...a);`).join('')
    + (specifier.includes('service-rpc') ? 'export const ServiceCommandError=globalThis.__issuance.RpcError;' : ''), shortCircuit: true };
  if (specifier.startsWith('@/src/domain/')) return next(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return next(specifier, context);
} });
const { runIssuanceCommand } = await import('../src/server/purchasing/issuance.ts');
const reset = () => { calls.length = 0; reads.length = 0; role = 'Procurement'; receipt = null; problem = ''; failure = null; };

test('unauthorized roles and client proof never reach the provider or database', async () => {
  reset(); role = 'Accounting';
  assert.equal((await runIssuanceCommand(command('prepareSend'))).ok, false);
  role = 'Procurement';
  assert.equal((await runIssuanceCommand({ ...command('prepareSend'), proof })).ok, false);
  assert.equal(calls.length, 0); assert.equal(reads.length, 0);
});
test('preparation verifies all exact files then supplies only server proof to checked SQL', async () => {
  reset(); const c = command('prepareSend');
  assert.equal((await runIssuanceCommand(c)).ok, true);
  assert.equal(reads.length, 3);
  assert.deepEqual(calls.map(c => c.name), ['issuance_receipt', 'issuance_prepare_files', 'issuance_command']);
  assert.deepEqual(calls[2].args, { actor: { activeRole: 'Procurement' }, command: c, proof });
});
test('missing, trashed, wrong-identity or changed bytes do not prepare the PO', async () => {
  for (const fault of ['offline', 'trashed', 'identity', 'hash']) {
    reset(); problem = fault;
    const result = await runIssuanceCommand(command('prepareSend'));
    assert.equal(result.ok, false); assert.equal(result.uncertain, undefined);
    assert.match(result.message, /Nothing was prepared/);
    assert.equal(calls.some(c => c.name === 'issuance_command'), false);
  }
});
test('receipt replay succeeds during provider failure without re-running live gates', async () => {
  reset(); receipt = true; problem = 'offline';
  assert.equal((await runIssuanceCommand(command('prepareSend'))).ok, true);
  assert.equal(reads.length, 0); assert.deepEqual(calls.map(c => c.name), ['issuance_receipt']);
});
test('Confirm sent needs no provider call and stale/access failures stay definite', async () => {
  reset(); problem = 'offline';
  const c = { ...command('confirmSent'), preparationId: randomUUID(), details: { channel: 'email', recipient: 'Supplier', sentAt: '2026-11-08T01:00:00Z', notes: '', other: '' } };
  assert.equal((await runIssuanceCommand(c)).ok, true);
  assert.equal(reads.length, 0); assert.equal(calls.at(-1).args.proof, null);
  failure = '40001'; assert.equal((await runIssuanceCommand(c)).conflict, true);
  failure = '42501'; assert.equal((await runIssuanceCommand(c)).uncertain, undefined);
});
