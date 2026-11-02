import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';

const userId = randomUUID(), sessionId = randomUUID();
let current = null, down = false, renewals = 0;
const token = { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 300 };
globalThis.__foundation = {
  readSession: async () => { if (down) throw Error('Unavailable'); return current; },
  cookieAuthClient: async () => ({ auth: {
    getSession: async () => ({ data: { session: token }, error: null }),
    refreshSession: async () => { renewals++; return { data: { session: { ...token, expires_at: Math.floor(Date.now()/1000)+300 } }, error: null }; },
    getClaims: async () => ({ data: { claims: { sub: userId, session_id: sessionId } }, error: null }),
  } }),
  projectDirectory: async () => ({ projects: [], history: [], role: current.activeRole }),
  projectDetail: async () => ({ project: null, history: [], role: current.activeRole }),
  accountDirectory: async () => ({ users: [], projects: [], pending: [], history: [], actorId: userId, emailEnabled: false }),
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  const exports = {
    '@/src/server/auth/session': ['readSession'],
    '@/src/server/auth/clients': ['cookieAuthClient'],
    '@/src/server/projects/projects': ['projectDirectory', 'projectDetail'],
    '@/src/server/accounts/accounts': ['accountDirectory'],
  }[specifier];
  if (exports) return { url: 'data:text/javascript,' + exports.map(name => `export const ${name}=(...args)=>globalThis.__foundation.${name}(...args);`).join(''), shortCircuit: true };
  if (specifier === '@/src/domain/auth/session') return nextResolve(new URL('../src/domain/auth/session.ts', import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { foundationResponse } = await import('../src/server/realtime/foundation.ts');
const request = (query = 'view=projects', headers = {}) => new Request('http://127.0.0.1:3000/api/foundation/view?' + query, { headers });
const signedIn = role => ({ sessionId, activeRole: role, context: { userId, displayName: 'Fixture', email: 'fixture@example.invalid', revision: '2', roles: [role], projectIds: [] } });
test('foundation reads distinguish missing sessions, temporary failures, roles and invalid targets', async () => {
  current = null;
  assert.equal((await foundationResponse(request())).status, 401);
  down = true;
  assert.equal((await foundationResponse(request())).status, 503);
  down = false; current = signedIn('Site Personnel');
  assert.equal((await foundationResponse(request('view=accounts'))).status, 403);
  assert.equal((await foundationResponse(request('view=project&projectId=invalid'))).status, 400);
  assert.equal((await foundationResponse(request('view=unknown'))).status, 400);
  const missing = await foundationResponse(request('view=project&projectId=' + randomUUID()));
  assert.equal((await missing.json()).view.data.project, null);
  assert.equal((await foundationResponse(request('view=projects', { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await foundationResponse(request('view=projects', { origin: 'https://attacker.invalid' }))).status, 403);
});
test('credential bootstrap is uncached, exact-session scoped and never returns renewal credentials', async () => {
  current = signedIn('Administrator');
  const response = await foundationResponse(request(), true);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('vary'), 'Cookie');
  const body = await response.json();
  assert.equal(body.topic, `foundation:${userId}:2:${sessionId}`);
  assert.equal(body.accessToken, token.access_token);
  assert.equal(JSON.stringify(body).includes('refresh_token'), false);
  token.expires_at = Math.floor(Date.now()/1000) + 20;
  assert.equal((await foundationResponse(request(), true)).status, 200);
  assert.equal(renewals, 1, 'Near-expiry renewal stays on the server');
});
