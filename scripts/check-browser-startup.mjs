import { authBrowser } from './helpers/auth-browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.verification', { recursive: true });
const results = [];
for (let attempt = 1; attempt <= 3; attempt++) {
  const browsers = [];
  const started = Date.now();
  try {
    browsers.push(await authBrowser('http://127.0.0.1:3198'));
    browsers.push(await authBrowser('http://127.0.0.1:3198'));
    for (const browser of browsers) browser.assertIsolated();
    results.push({ attempt, passed: true, durationMs: Date.now() - started });
    console.log(`Isolated browser startup pair ${attempt}: passed in ${Date.now() - started}ms`);
  } finally {
    const cleanup = await Promise.allSettled(browsers.map(browser => browser.close()));
    await writeFile('.verification/browser-startup.json', JSON.stringify(results, null, 2));
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
  }
}
