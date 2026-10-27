import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** Full navigation may wait for a cold server response; other calls keep their existing limits. */
export function browserCallTimeout(method, ordinaryTimeout) {
  return method === 'Page.navigate' ? 60000 : ordinaryTimeout;
}

/** Keep test defaults independent of the runner's desktop accessibility settings. */
export async function configureBrowserChecks(call) {
  await call('Page.enable');
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
}

/** Wait for a new, fully loaded document before inspecting route-specific content. */
export async function navigateDocument(call, url) {
  const marker = randomUUID();
  const { identifier } = await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__constructsyncTestNavigation = ${JSON.stringify(marker)};`,
  });
  try {
    const navigation = await call('Page.navigate', { url });
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const result = await call('Runtime.evaluate', {
          expression: `window.__constructsyncTestNavigation === ${JSON.stringify(marker)} && document.readyState === 'complete'`,
          returnByValue: true,
        });
        if (result.result?.value === true) return;
      } catch (error) {
        if (!/Execution context was destroyed|Cannot find (?:default execution )?context|Inspected target navigated/i.test(String(error))) throw error;
      }
      await delay(50);
    }
    throw new Error(`A new document did not finish loading: ${url}`);
  } finally {
    await call('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}
