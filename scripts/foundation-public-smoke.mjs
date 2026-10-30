import assert from 'node:assert/strict';
import { authBrowser } from './helpers/auth-browser.mjs';

const base = process.argv[2] || 'http://127.0.0.1:3199';
const browser = await authBrowser(base);
try {
  await browser.navigate('/sign-in');
  await browser.wait("return !!document.querySelector('#signin-email')");
  assert.equal(await browser.run("return document.querySelector('.signin-submit').disabled"), true, 'Missing configuration fails closed');
  assert.equal(await browser.run("return Object.keys(localStorage).some(k=>/hml-constructsync-(demo|users|session)/.test(k))"), false, 'No demo initialization');
  await browser.run("localStorage.setItem('hml-constructsync-session-v1',JSON.stringify({role:'Administrator'}));");
  await browser.navigate('/projects');
  assert.equal(await browser.run('return location.pathname'), '/sign-in', 'Forged browser identity cannot enter');
  for (const route of ['/requests/new', '/admin/maintenance', '/demo-files/forged', '/reports']) {
    await browser.navigate(route);
    assert.equal(await browser.run('return location.pathname'), '/sign-in', 'Direct protected route denied');
  }
  await browser.navigate('/auth/confirm?type=signup&token_hash=invalid');
  assert.match(await browser.run('return document.body.innerText'), /Link unavailable/);
  await browser.navigate('/auth/confirm?type=recovery&token_hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&next=https://evil.example');
  assert.match(await browser.run('return document.body.innerText'), /Link unavailable/);
  await browser.navigate('/sign-in');
  for (const width of [375, 1440]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 700 });
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth+2'), true, 'Responsive sign-in');
  }
  await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.wait("return document.querySelector('.signin-story-playback').disabled");
  for (const endpoint of ['/api/drive/projects', '/api/requests/extract', '/api/documents/preview']) {
    const result = await browser.run(`const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'Administrator',snapshot:{}})});return {status:r.status,body:await r.json()}`);
    assert.equal(result.status, 401);
    assert.equal(typeof result.body.error, 'string');
  }
  browser.assertIsolated();
  console.log('Public foundation, direct-route denial, absent demo setup, redirect and accessibility checks passed.');
} finally { await browser.close(); }
