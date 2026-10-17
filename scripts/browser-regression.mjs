import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const audit = JSON.parse(await readFile('artifacts/app-audit/verification-summary.json', 'utf8'));
const original = Array.isArray(audit.originalSuites) ? audit.originalSuites : audit.originalSuites.results;
const names = process.argv.length > 3 ? process.argv.slice(3) : [...new Set([...original.map(s => s.name), 'usage-entries', 'next-iteration'])];
const output = path.resolve('artifacts/iteration-2'); await mkdir(output, {recursive:true});
const results = [];
const queue = [...names];
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
    if (code !== 0) console.log(result.tail);
  }
}
await Promise.all([worker(), worker()]);
await writeFile(path.join(output,'verification.json'), JSON.stringify({base,at:new Date().toISOString(),results},null,2));
const failures = results.filter(r => r.code !== 0);
console.log(`${results.length-failures.length}/${results.length} browser suites passed. Logs: ${output}`);
if (failures.length) process.exitCode = 1;
