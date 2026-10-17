import { readFile, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const report=await readFile('docs/qa/FULL_APP_AUDIT.md','utf8');
const findings=[...report.matchAll(/^### (AUD-\d+) · (P\d)/gm)].map(match=>({id:match[1],priority:match[2]}));
assert.equal(findings.length,14);assert.equal(new Set(findings.map(row=>row.id)).size,14);
assert.deepEqual(Object.fromEntries(['P0','P1','P2','P3'].map(priority=>[priority,findings.filter(row=>row.priority===priority).length])),{P0:0,P1:1,P2:10,P3:3});
const targets=['docs/qa/FULL_APP_AUDIT.md','docs/qa/APP_AUDIT_COVERAGE.md','artifacts/app-audit/README.md'];
const missing=[];
for(const file of targets){
  const text=await readFile(file,'utf8');
  for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
    const href=match[1].split('#')[0];if(!href||/^[a-z]+:\/\//i.test(href))continue;
    try{await access(path.resolve(path.dirname(file),decodeURIComponent(href)));}catch{missing.push({file,href});}
  }
}
assert.deepEqual(missing,[]);
const summary=JSON.parse(await readFile('artifacts/app-audit/verification-summary.json','utf8'));
assert.equal(summary.originalSuites.results.length,25);assert.equal(summary.auditCopies.results.length,9);
assert.equal(summary.browser.responsive,264);assert.equal(summary.browser.visits,95);assert.equal(summary.browser.harnessFailure,null);
assert.equal(summary.originalSuites.failed,16);assert.equal(summary.auditCopies.passed,6);
const result={passed:true,findings,linkedArtifactsChecked:true,suites:25,auditCopies:9,visits:95,responsive:264};
await writeFile('artifacts/app-audit/document-validation.json',JSON.stringify(result,null,2));
console.log('Audit documents and evidence links validated: 14 findings, 25 original suites, 9 audit copies, 95 visits, 264 layouts.');
