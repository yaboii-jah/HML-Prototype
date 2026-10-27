import { LocalUserDirectory, USER_STORAGE_KEY } from '../../src/app-state/user-directory.ts';
import { seedDemo } from '../../tests/fixtures/workspace.ts';
import { blankWorkspace } from '../../src/mock/blank-workspace.ts';
import { configureBrowserChecks } from './browser-environment.mjs';

/** Legacy workflow suites use an explicit fixture; showcase-smoke owns empty-workspace initialization coverage. */
export async function prepareFixtureBrowser(call, base, options = {}) {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const fixture = options.empty ? blankWorkspace() : seedDemo();
  let directoryScript = '';
  if (options.accounts !== false) {
    await new LocalUserDirectory(() => storage).load();
    const directory = JSON.parse(storage.getItem(USER_STORAGE_KEY));
    for (const user of directory.users.filter(u => u.role === 'Site Personnel')) user.siteIds = fixture.sites.map(s => s.id);
    directoryScript = `localStorage.setItem(${JSON.stringify(USER_STORAGE_KEY)},${JSON.stringify(JSON.stringify(directory))});`;
  }
  const source = `if(location.origin===${JSON.stringify(new URL(base).origin)}&&!sessionStorage.getItem('workflow-fixture-ready')){localStorage.setItem('hml-constructsync-empty-workspace-v1','1');localStorage.setItem('hml-constructsync-demo-v12',${JSON.stringify(JSON.stringify(fixture))});${directoryScript}sessionStorage.setItem('workflow-fixture-ready','true');}`;
  await configureBrowserChecks(call);
  const initializer = await call('Page.addScriptToEvaluateOnNewDocument', {source});
  if (options.navigate !== false) {
    await call('Page.navigate', {url:base});
    let initialized = false;
    for (let i = 0; i < 100 && !initialized; i++) {
      try { initialized = (await call('Runtime.evaluate', {expression:"sessionStorage.getItem('workflow-fixture-ready') === 'true'",returnByValue:true})).result.value === true; } catch {}
      if (!initialized) await new Promise(resolve => setTimeout(resolve,50));
    }
    if (!initialized) throw new Error('Browser fixture did not initialize before application startup');
    await call('Page.removeScriptToEvaluateOnNewDocument', {identifier:initializer.identifier});
  }
}

/** Browser fixture setup always uses the active account revision from the saved directory. */
export function workspaceFixtureScript(snapshot, role) {
  return `const fixture=${JSON.stringify(snapshot)};localStorage.setItem('hml-constructsync-demo-v12',JSON.stringify(fixture));
    const key='hml-constructsync-users-v1',directory=JSON.parse(localStorage.getItem(key));
    for(const user of directory.users.filter(u=>u.active&&u.role==='Site Personnel'))user.siteIds=fixture.sites.map(s=>s.id);
    localStorage.setItem(key,JSON.stringify(directory));
    const prior=JSON.parse(localStorage.getItem('hml-constructsync-session-v2')||'null');
    const account=directory.users.find(u=>u.active&&(${role ? `u.role===${JSON.stringify(role)}` : 'u.id===prior?.userId||u.email===prior?.email'}));
    if(account)localStorage.setItem('hml-constructsync-session-v2',JSON.stringify({email:account.email,role:account.role,userId:account.id,revision:account.revision}));return true;`;
}

export const openQuotationReview = `const tab=[...document.querySelectorAll('.procurement-steps button')].find(b=>b.textContent.includes('Upload & review'));if(!tab)throw new Error('Quotation workflow is not ready');tab.click();return true;`;
