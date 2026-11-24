import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';

class ServiceCommandError extends Error {
  constructor(code) {
    super('Private database diagnostic');
    this.code = code;
  }
}

const projectId = randomUUID();
const userId = randomUUID();
const sessionId = randomUUID();
const origin = 'http://127.0.0.1:3198';
const rpcCalls = [];
let role = null;
let folder = { folderId: 'stored-drive-folder' };
const directory = [{ id: projectId, name: 'Test project', code: null, folderId: 'private-provider-id' }];
globalThis.__projectDriveShortcut = {
  ServiceCommandError,
  readSession: async () => role && { context: { userId, revision: '1', roles: [role] }, activeRole: role, sessionId },
  serviceRpc: async (...args) => {
    rpcCalls.push(args);
    if (args[0] === 'project_drive_directory') return directory;
    if (folder instanceof Error) throw folder;
    return folder;
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
    if (specifier === '@/src/server/auth/session') return { url: 'data:text/javascript,export const readSession=globalThis.__projectDriveShortcut.readSession', shortCircuit: true };
    if (specifier === '@/src/server/auth/service-rpc') return { url: 'data:text/javascript,export const {serviceRpc,ServiceCommandError}=globalThis.__projectDriveShortcut', shortCircuit: true };
    if (specifier === './dispatch' && context.parentURL?.endsWith('/src/server/documents/access.ts')) {
      return { url: 'data:text/javascript,export function dispatchDocumentJobs(){throw Error("Shortcut attempted to dispatch document jobs")}', shortCircuit: true };
    }
    if (specifier.startsWith('@/')) return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

const { GET } = await import('../app/api/projects/[projectId]/drive-folder/route.ts');
const { projectDriveDirectory } = await import('../src/server/documents/access.ts');
const openFolder = (headers = {}, target = projectId) => GET(
  new Request(origin + '/api/projects/' + target + '/drive-folder', { headers }),
  { params: Promise.resolve({ projectId: target }) },
);

test('folder shortcut resolves only fresh authorized mappings and returns recoverable errors', async () => {
  assert.equal((await openFolder()).status, 401);
  role = 'Site Personnel';
  assert.equal((await openFolder()).status, 403);
  await assert.rejects(projectDriveDirectory(), { status: 403 });
  role = 'Administrator';
  assert.equal((await openFolder({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await openFolder({}, 'invalid')).status, 404);
  assert.equal(rpcCalls.length, 0, 'Rejected requests do not look up mappings');

  for (const activeRole of ['Administrator', 'Project Manager', 'Procurement', 'Accounting', 'Finance', 'Logistics']) {
    role = activeRole;
    const response = await openFolder({ 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), 'https://drive.google.com/drive/folders/stored-drive-folder');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual(rpcCalls.at(-1), ['project_document_folder_open', {
      actor: { userId, sessionId, revision: '1', activeRole },
      target_project: projectId,
    }]);
    assert.deepEqual(await projectDriveDirectory(), [{ id: projectId, name: 'Test project', code: null }]);
  }

  folder = { folderId: 'replacement-drive-folder' };
  assert.equal((await openFolder()).headers.get('location'), 'https://drive.google.com/drive/folders/replacement-drive-folder');
  folder = { folderId: null };
  const unmapped = await openFolder();
  assert.equal(unmapped.status, 404);
  assert.match(await unmapped.text(), /no confirmed Drive folder/);
  folder = new ServiceCommandError('42501');
  const denied = await openFolder();
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.has('location'), false);
  assert.doesNotMatch(await denied.text(), /Private database diagnostic/);
  folder = { folderId: '../?next=https://example.invalid' };
  const invalid = await openFolder();
  assert.equal(invalid.status, 503);
  assert.equal(invalid.headers.has('location'), false);
  assert.match(await invalid.text(), /Return to Google Drive/);
});
