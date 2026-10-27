import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { verificationEnvironment } from './helpers/verification-environment.mjs';

const port = process.env.VERIFICATION_PORT || '3199';
const base = `http://127.0.0.1:${port}`;
// Refuse an occupied port so checks cannot use an unrelated or live application.
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(Number(port), '127.0.0.1', resolve); });
await new Promise(resolve => probe.close(resolve));
const environment = verificationEnvironment(true);
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { windowsHide: true, stdio: 'inherit', env: environment });
let startupError;
const stopped = new Promise(resolve => { server.once('close', resolve); server.once('error', error => { startupError = error; resolve(); }); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (startupError || server.exitCode !== null) throw new Error('Verification server exited before becoming ready.');
    try { if ((await fetch(base + '/sign-in')).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error('Verification server did not become ready.');
  const runner = spawn(process.execPath, ['scripts/browser-regression.mjs', base, ...process.argv.slice(2)], { windowsHide: true, stdio: 'inherit', env: environment });
  process.exitCode = await new Promise(resolve => { runner.on('error', () => resolve(1)); runner.on('close', code => resolve(code ?? 1)); });
} finally {
  server.kill();
  await stopped;
}
