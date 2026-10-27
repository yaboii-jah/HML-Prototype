import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { verificationEnvironment } from './helpers/verification-environment.mjs';

await mkdir('.verification', { recursive: true });
const checks = [
  ['toolchain', ['scripts/check-toolchain.mjs']],
  ['lint', ['node_modules/eslint/bin/eslint.js', '.']],
  ['typegen', ['node_modules/next/dist/bin/next', 'typegen']],
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']],
  ['unit', ['--experimental-strip-types', '--test', ...(await readdir('tests')).filter(name => name.endsWith('.test.mjs')).map(name => 'tests/' + name)]],
  ['build', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
];
const results = [];
for (const [name, args] of checks) {
  const start = Date.now();
  const child = spawn(process.execPath, args, { windowsHide: true, env: verificationEnvironment(name === 'unit') });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data; process.stdout.write(data); });
  const code = await new Promise(resolve => { child.on('error', error => { log += String(error); resolve(-1); }); child.on('close', resolve); });
  await writeFile(`.verification/${name}.log`, log);
  results.push({ name, code, durationMs: Date.now() - start });
  if (code !== 0) { process.exitCode = 1; break; }
}
await writeFile('.verification/checks.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
