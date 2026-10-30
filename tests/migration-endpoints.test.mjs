import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readdir } from 'node:fs/promises';

let current = null;
let unavailable = false;
globalThis.__migrationSession = async () => { if (unavailable) throw Error('Database offline'); return current; };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  if (specifier === './session' && context.parentURL?.endsWith('/src/server/auth/unavailable.ts')) return { url: 'data:text/javascript,export const readSession=()=>globalThis.__migrationSession()', shortCircuit: true };
  if (specifier.includes('/server/drive') || specifier.includes('structured-extraction')) throw Error('Disabled route imported a provider');
  if (specifier.startsWith('@/')) return nextResolve(new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
async function routes(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) files.push(...await routes(path));
    else if (entry.name === 'route.ts') files.push(path);
  }
  return files;
}
test('every disabled endpoint denies forged snapshots without reading bodies or importing providers', async () => {
  let bodyReads = 0;
  const request = { json() { bodyReads++; throw Error('Read forged snapshot'); }, formData() { bodyReads++; throw Error('Read upload'); } };
  for (const file of await routes('app/api')) {
    const handlers = await import(new URL('../' + file, import.meta.url));
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      if (typeof handlers[method] !== 'function') continue;
      current = null;
      assert.equal((await handlers[method](request)).status, 401, file + ' anonymous');
      current = { context: { roles: ['Administrator'] }, activeRole: 'Administrator' };
      assert.equal((await handlers[method](request)).status, 503, file + ' authenticated unavailable');
      unavailable = true;
      assert.equal((await handlers[method](request)).status, 503, file + ' failed authorization');
      unavailable = false;
    }
  }
  assert.equal(bodyReads, 0);
});
