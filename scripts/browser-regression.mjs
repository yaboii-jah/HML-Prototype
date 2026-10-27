import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSuites } from './browser-suites.mjs';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const names = process.argv.length > 3 ? process.argv.slice(3) : browserSuites;
if (names.some(name => !browserSuites.includes(name))) throw new Error('Select a controlled suite from scripts/browser-suites.mjs. Use test:live for provider checks.');
const output = path.resolve('.verification/browser'); await mkdir(output, {recursive:true});
const results = [];
const queue = [...names];
const workerCount = process.env.CI === 'true' ? 1 : 2;
const startedAt = new Date().toISOString();
let summaryWrites = Promise.resolve();
function writeSummary(complete = false) {
  const summary = JSON.stringify({ base, startedAt, at: new Date().toISOString(), complete, workerCount, selected: names, results: [...results] }, null, 2);
  summaryWrites = summaryWrites.then(() => writeFile(path.join(output, 'verification.json'), summary));
  return summaryWrites;
}
// Replace stale results immediately and preserve completed checks if a run is interrupted.
await writeSummary();
async function worker() {
  while (queue.length) {
    const name = queue.shift();
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid suite name');
    const start = Date.now();
    const child = spawn(process.execPath, ['--experimental-strip-types', `scripts/${name}-smoke.mjs`, base], {windowsHide:true});
    let log = '', timedOut = false;
    child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'});
      else child.kill('SIGTERM');
    }, name === 'browser' ? 900000 : 300000);
    const code = await new Promise(resolve => { child.on('error', error => {log += String(error);resolve(-1);}); child.on('close', resolve); });
    clearTimeout(timer); await writeFile(path.join(output, `${name}.log`), log);
    const result = {name,code,timedOut,durationMs:Date.now()-start,log:`${name}.log`,tail:log.trim().split('\n').slice(-12).join('\n')};
    results.push(result); console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name} (${Math.round(result.durationMs/1000)}s)`);
    await writeSummary();
    if (code !== 0) console.log(result.tail);
  }
}
console.log(`Running browser checks with ${workerCount} worker${workerCount === 1 ? '' : 's'}.`);
await Promise.all(Array.from({ length: workerCount }, () => worker()));
await writeSummary(true);
const failures = results.filter(r => r.code !== 0);
console.log(`${results.length-failures.length}/${results.length} browser suites passed. Logs: ${output}`);
if (failures.length) process.exitCode = 1;
