import { authBrowser } from './helpers/auth-browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('.verification', { recursive: true });
const results = [];
if (process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true') {
  // A stopped real Chrome process gives deterministic cold-readiness delay.
  // The previous ten-second allowance fails; the bounded default must succeed.
  const delayed = async startupTimeoutMs => {
    let child;
    let resume;
    try {
      return await authBrowser('http://127.0.0.1:3198', { startupTimeoutMs, onLaunch(browserProcess) {
        child = browserProcess;
        assert.ok(child.kill('SIGSTOP'), 'Pause only the run-owned browser process');
        resume = setTimeout(() => child.kill('SIGCONT'), 11000);
      } });
    } finally { clearTimeout(resume); child?.kill('SIGCONT'); }
  };
  await assert.rejects(delayed(10000), /Isolated browser started/, 'Ten-second control catches delayed Chrome readiness');
  const recovered = await delayed(30000);
  try {
    assert.ok(recovered.discoveryMs >= 11000 && recovered.discoveryMs < 30000);
    results.push({ delayedStartup: true, previousDeadlineRejected: true, discoveryMs: recovered.discoveryMs });
    console.log('Delayed Chrome readiness: ten-second control rejected; thirty-second deadline passed.');
  } finally { await recovered.close(); }
}
for (let attempt = 1; attempt <= 3; attempt++) {
  const browsers = [];
  const started = Date.now();
  try {
    browsers.push(await authBrowser('http://127.0.0.1:3198'));
    browsers.push(await authBrowser('http://127.0.0.1:3198'));
    for (const browser of browsers) browser.assertIsolated();
    results.push({ attempt, passed: true, durationMs: Date.now() - started, discoveryMs: browsers.map(browser => browser.discoveryMs) });
    console.log(`Isolated browser startup pair ${attempt}: passed in ${Date.now() - started}ms`);
  } finally {
    const cleanup = await Promise.allSettled(browsers.map(browser => browser.close()));
    await writeFile('.verification/browser-startup.json', JSON.stringify(results, null, 2));
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
  }
}
