import { readFile, writeFile } from 'node:fs/promises';
const names=['quotation-editor','quotation-worksheet','supplier-upload','quotation-financial-review','quotation-extraction','quotation-confirmations'];
const openReview=`await run("[...document.querySelectorAll('.procurement-steps button')].find(b=>b.textContent.includes('Upload & review')).click();return true;");await sleep(160);`;
for(const name of names){
  let source=await readFile(`scripts/${name}-smoke.mjs`,'utf8');
  source=source.replaceAll('"../src/','"../../src/').replaceAll("'../src/","'../../src/").replaceAll('"../tests/','"../../tests/').replaceAll("'../tests/","'../../tests/");
  source=source.replaceAll("await navigate('/requests/m1/quotes');",`await navigate('/requests/m1/quotes');${openReview}`).replaceAll('await navigate("/requests/m1/quotes");',`await navigate('/requests/m1/quotes');${openReview}`);
  if(['quotation-editor','quotation-financial-review'].includes(name))source=source.replaceAll("await call('Page.reload',{ignoreCache:true});",`await call('Page.reload',{ignoreCache:true});await wait("return !!document.querySelector('.procurement-steps');");${openReview}`);
  if(name==='quotation-extraction')source=source.replace("await call('Page.navigate',{url:base+'/requests/m1/quotes'});",`await call('Page.navigate',{url:base+'/requests/m1/quotes'});await wait("return !!document.querySelector('.procurement-steps');");${openReview}`);
  if(name==='quotation-confirmations')source=source.replaceAll('Retry Drive archive','Retry archive');
  await writeFile(`artifacts/app-audit/adapted-${name}.mjs`,`// Audit-only copy: relative imports adjusted; explicitly open Upload & review after route entry. Original suite unchanged.\n${source}`);
}
console.log('Created audit-only copies:',names.join(', '));
for(const name of ['user-management','project-folder']){
  let source=await readFile(`scripts/${name}-smoke.mjs`,'utf8');
  source=source.replaceAll('"../src/','"../../src/').replaceAll("'../src/","'../../src/");
  source=source.replaceAll("await fill('.admin-add-project input[name=location]','Pasig');","await fill('.admin-add-project input[name=documentCode]','AUD-'+name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,16));await fill('.admin-add-project input[name=location]','Pasig');");
  source=source.replaceAll("await navigate('/admin/maintenance');","await navigate('/admin');").replaceAll("await press('Drive folder');","await press('Documents');");
  await writeFile(`artifacts/app-audit/adapted-${name}.mjs`,`// Audit-only copy: imports adjusted and required project code filled. Original suite unchanged.\n${source}`);
}
{
  let source=await readFile('scripts/material-rows-smoke.mjs','utf8');
  source=source.replaceAll('"../src/','"../../src/').replaceAll("'../src/","'../../src/");
  const stale="localStorage.setItem('hml-constructsync-session-v2',${JSON.stringify(JSON.stringify({email:user.email,role}))});";
  const current="const d=JSON.parse(localStorage.getItem('hml-constructsync-users-v1'));for(const a of d.users.filter(a=>a.role==='Site Personnel'))a.siteIds=${JSON.stringify(data.sites.map(s=>s.id))};localStorage.setItem('hml-constructsync-users-v1',JSON.stringify(d));const a=d.users.find(a=>a.email===${JSON.stringify(user.email)});localStorage.setItem('hml-constructsync-session-v2',JSON.stringify({email:a.email,role:a.role,userId:a.id,revision:a.revision}));";
  source=source.replace(stale,current);
  source=source.replace('await sleep(250);\r\n  };',`await sleep(250);if(route.endsWith('/quotes')){${openReview}}\r\n  };`).replace('await sleep(250);\n  };',`await sleep(250);if(route.endsWith('/quotes')){${openReview}}\n  };`);
  await writeFile('artifacts/app-audit/adapted-material-rows.mjs',`// Audit-only copy: imports, active account revision, fixture assignments and explicit review step. Original suite unchanged.\n${source}`);
}
