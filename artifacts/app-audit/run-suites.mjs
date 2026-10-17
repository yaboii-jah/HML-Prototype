import { spawn } from 'node:child_process';
import { mkdir, writeFile, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'artifacts/app-audit');
await mkdir(path.join(output, 'logs'), { recursive: true });
const names = process.argv.slice(2);
const results = [];
for (const name of names) {
  const started = Date.now();
  const script=name.startsWith('adapted-')?`artifacts/app-audit/${name}.mjs`:`scripts/${name}-smoke.mjs`;
  const child = spawn(process.execPath, ['--experimental-strip-types', script, 'http://127.0.0.1:3100'], { cwd: root, windowsHide: true });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const limit = name === 'browser' ? 420000 : 210000;
  const timer = setTimeout(() => {
    log += '\nAUDIT: suite exceeded its time budget.\n';
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }, limit);
  const code = await new Promise(resolve => { child.on('error', error => { log += String(error); resolve(-1); }); child.on('close', resolve); });
  clearTimeout(timer);
  await writeFile(path.join(output, 'logs', `${name}.log`), log);
  const profiles = [...new Set(log.match(/[A-Z]:\\Users\\[^\r\n]+?\\(?:constructsync|hml-quote|hml-constructsync)[^\r\n]*?(?=\.png|\r|\n|$)/g) || [])];
  for (const entry of profiles) {
    const profile = path.extname(entry) ? path.dirname(entry) : entry;
    try {
      const shots = (await readdir(profile)).filter(file => file.endsWith('.png')).slice(0, 12);
      for (const shot of shots) await copyFile(path.join(profile, shot), path.join(output, 'screenshots', `${name}-${shot}`));
    } catch { /* Some suites report an individual screenshot path instead of their profile. */ }
  }
  const result = { name, code, durationMs: Date.now() - started, log: `logs/${name}.log`, tail: log.trim().split('\n').slice(-12).join('\n') };
  results.push(result);
  await writeFile(path.join(output, `suites-${names[0]}.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(result));
}
