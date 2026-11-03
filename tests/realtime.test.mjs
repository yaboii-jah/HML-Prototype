import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseRealtimeSession, parseFoundationView, foundationViewQuery } from '../src/domain/realtime/foundation.ts';

const userId = randomUUID(), sessionId = randomUUID(), projectId = randomUUID();
const session = { userId, displayName: 'Staff', email: 'staff@example.invalid', revision: '4', roles: ['Site Personnel'], projectIds: [projectId], activeRole: 'Site Personnel' };
const credentials = { session, sessionId, topic: `foundation:${userId}:4:${sessionId}`, accessToken: 'opaque-test-token', expiresAt: 2000000000 };
test('realtime bootstrap binds the exact user, access revision, session and granted role', () => {
  assert.deepEqual(parseRealtimeSession(credentials), credentials);
  for (const change of [{ topic: `foundation:${userId}:3:${sessionId}` }, { sessionId: randomUUID() }, { session: { ...session, activeRole: 'Administrator' } }, { accessToken: null }, { expiresAt: Infinity }]) {
    assert.equal(parseRealtimeSession({ ...credentials, ...change }), null);
  }
});
test('only migrated routes request foundation view data', () => {
  assert.equal(foundationViewQuery('/projects'), 'view=projects');
  assert.equal(foundationViewQuery('/admin'), 'view=accounts');
  assert.equal(foundationViewQuery('/projects/' + projectId), 'view=project&projectId=' + projectId);
  assert.equal(foundationViewQuery('/requests'), 'view=requests');
  assert.equal(foundationViewQuery('/requests/new'), 'view=requests');
  assert.equal(foundationViewQuery('/requests/' + projectId + '/edit'), 'view=requests&requestId=' + projectId);
  for (const route of ['/dashboard', '/requests/invalid', '/sign-in', '/projects/invalid', '//projects', '/projects/' + projectId + '/edit']) assert.equal(foundationViewQuery(route), null);
});
test('refreshed Site views reject financial payloads and support a deleted target', () => {
  const project = { id: projectId, name: 'Site', location: 'Location', code: 'SITE', codeLocked: false, version: '2', scopeCount: 0, scopes: [] };
  const data = { role: 'Site Personnel', history: [], project };
  assert.ok(parseFoundationView({ kind: 'project', data }));
  assert.equal(parseFoundationView({ kind: 'project', data: { ...data, project: { ...project, financial: { budget: '100', allocated: '0', unallocated: '100' } } } }), null);
  assert.deepEqual(parseFoundationView({ kind: 'project', data: { ...data, project: null } }).data.project, null);
  assert.equal(parseFoundationView({ kind: 'project', data: { ...data, history: [{}] } }), null);
});
