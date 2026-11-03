// Child test processes may contact only the isolated local application/CDP server.
const originalFetch = globalThis.fetch;
export function controlledFetch(fetchImplementation, input, init) {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unexpected external request in controlled verification: ' + url.origin);
  }
  // A permitted local response cannot redirect the process to a hosted service.
  // Manual responses (including Drive's 308 offset acknowledgement) never follow
  // a Location. Keep automatic redirects forbidden, including caller 'follow'.
  return fetchImplementation(input, { ...init, redirect: init?.redirect === 'manual' ? 'manual' : 'error' });
}
globalThis.fetch = (input, init) => controlledFetch(originalFetch, input, init);
