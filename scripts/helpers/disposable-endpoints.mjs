import { requireLoopback } from './supabase-target.mjs';

export function disposableHttpOrigin(value) {
  const url = requireLoopback(value);
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || !url.port) {
    throw Error('Disposable HTTP services require an explicit loopback HTTP origin and port.');
  }
  return url.origin;
}

export function browserRequestAllowed(address, appOrigin, apiOrigin) {
  const url = new URL(address);
  if (url.username || url.password) return false;
  return url.origin === appOrigin || (url.origin === apiOrigin && url.pathname.startsWith('/realtime/v1/'))
    || ['data:', 'about:'].includes(url.protocol);
}

export function realtimeSocketAllowed(address, expected) {
  const url = new URL(address), allowed = expected && new URL(expected);
  return !!allowed && url.origin === allowed.origin && url.pathname === allowed.pathname && !url.username && !url.password && !url.hash;
}
