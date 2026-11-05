import { authBrowser } from './helpers/auth-browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('.verification', { recursive: true });
const results = [];
const args = process.argv.slice(2);
if (args.length > 1 || args.length === 1 && args[0] !== '--delayed') throw Error('Use only the optional --delayed startup control.');
if (args[0] === '--delayed' || process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true') {
  // Delay discovery of a real Chrome endpoint without stopping one process in
  // Chrome's multi-process startup. Preserve the ten/ thirty-second deadlines.
  const delayed = async startupTimeoutMs => {
    let readyAt;
    return authBrowser('http://127.0.0.1:3198', { startupTimeoutMs,
      onLaunch() { readyAt = Date.now() + 11000; },
      discoveryReady: () => Date.now() >= readyAt,
    });
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
