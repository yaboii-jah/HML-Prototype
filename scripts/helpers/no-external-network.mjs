// Child test processes may contact only the isolated local application/CDP server.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Unexpected external request in controlled verification: ' + url.origin);
  return originalFetch(input, init);
};
