import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('artifacts/app-audit');
const browser=JSON.parse(await readFile(path.join(output,'browser-audit.json'),'utf8'));
const files=await readdir(output);
const batches=await Promise.all(files.filter(name=>/^suites-.*\.json$/.test(name)).map(async name=>({name,modified:(await stat(path.join(output,name))).mtimeMs,results:JSON.parse(await readFile(path.join(output,name),'utf8'))})));
const latest=new Map();
for(const batch of batches.sort((a,b)=>a.modified-b.modified))for(const row of batch.results)latest.set(row.name,row);
const original=[...latest.values()].filter(row=>!row.name.startsWith('adapted-'));
const adapted=[...latest.values()].filter(row=>row.name.startsWith('adapted-'));
const routes=[];
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())await walk(target);else if(['page.tsx','route.ts'].includes(entry.name))routes.push(path.relative(process.cwd(),target).replaceAll('\\','/'));}}
await walk('app');
const timings=browser.visits.map(row=>row.durationMs).sort((a,b)=>a-b);
const summary={
  generatedAt:new Date().toISOString(),head:(await readFile(path.join(output,'head.txt'),'utf8')).replace(/^\uFEFF/,'').trim(),
  baseline:[{command:'npm test',result:'passed',tests:295,evidence:'Initial non-mutating planning checks in the conversation; no test source changed by audit.'},{command:'npm run lint',result:'passed',evidence:'Initial checks and a final run after audit scripts were added (exec exit 0).'},{command:'npx tsc --noEmit --incremental false',result:'passed',evidence:'Initial planning checks; production build also completed TypeScript.'},{command:'npm run build',result:'passed after network retry',log:'logs/build-network-retry.log',initialFailure:'Sandbox could not fetch Google Fonts; see logs/build.log.'}],
  browser:{visits:browser.visits.length,roleListChecks:77,additionalRouteChecks:18,responsive:browser.responsive.length,widths:[320,375,414,768,1280,1440],themes:['light','dark'],overflowFailures:browser.responsive.filter(row=>row.overflow>1).length,unnamedControlCandidates:browser.responsive.filter(row=>row.unlabelled.length).length,uncaughtExceptions:browser.exceptions,navigationMs:{minimum:timings[0],median:timings[Math.floor(timings.length/2)],p95:timings[Math.floor(timings.length*.95)],maximum:timings.at(-1),mean:Math.round(timings.reduce((a,b)=>a+b,0)/timings.length)},harnessFailure:browser.failure||null},
  originalSuites:{passed:original.filter(row=>row.code===0).length,failed:original.filter(row=>row.code!==0).length,results:original},
  auditCopies:{passed:adapted.filter(row=>row.code===0).length,failed:adapted.filter(row=>row.code!==0).length,results:adapted},
  routes,findings:{P0:0,P1:1,P2:10,P3:3},screenshots:(await readdir(path.join(output,'screenshots'))).filter(file=>file.endsWith('.png')).length
};
await writeFile(path.join(output,'verification-summary.json'),JSON.stringify(summary,null,2));
const roles=['Site Personnel','Project Manager','Procurement','Finance','Logistics','Accounting / Auditing','Administrator'];
const lists=['/dashboard','/projects','/requests','/suppliers','/purchase-orders','/accounting','/finance','/deliveries','/inventory','/reports','/admin'];
const matrix=lists.map(route=>`| ${route} | ${roles.map(role=>{const visit=browser.visits.find(row=>row.path===route&&row.role===role);return visit?(visit.h1==='Access unavailable'?'Denied':'Viewed'):'Blocked';}).join(' | ')} |`).join('\n');
const reasons={browser:'Obsolete hard-coded Site Personnel account revision stops the suite before later workflow assertions.',quotation:'Old quotation field selectors; the current worksheet edits materials inline/in dialogs.',register:'Missing expected action selector after its earlier table checks; complete suite aborts.', 'user-management':'Original helper omits required project code. Full audit copy passed after updating that input and the retired maintenance destination.','site-stock-transfers':'Queries a user row without selecting the Users tab/current assignment setup; the detailed browser journey aborts.','delivery-documents':'Legacy fixture project IDs are not assigned to the populated Site Personnel account.','quotation-editor':'Assumes review editor is the initial quotation step; audit copy explicitly opens review/reopens it after reload.','quotation-worksheet':'Assumes source preview exists before opening the review step. Audit copy passed.','supplier-upload':'Queries upload controls while the initial stock step is selected. Audit copy passed.','quotation-financial-review':'Assumes initial/reloaded quotation step is review. Audit copy passed.','quotation-extraction':'Initial stock step and later reload assumptions; audit copy still stops at an editor wait after reload.','quotation-confirmations':'Obsolete step/action selectors and retry wording; audit copy still stops on a later selector.','project-folder':'Original required project-code omission; audit copy reaches later validation controls then stops on another obsolete selector.','document-numbering':'Later form selector no longer exists.','material-rows':'Stale session identity/revision and assignment fixtures; audit copy passed.','qa-fixes':'Legacy Site Personnel session shape/revision redirects to sign-in during a later form check.'};
const suiteRows=original.map(row=>`| ${row.name} | ${row.code===0?'Passed':'Failed'} | ${(row.durationMs/1000).toFixed(1)} s | ${row.code===0?'All assertions reached by this suite passed.':reasons[row.name]||'See retained exception in log.'} | [Log](../../artifacts/app-audit/${row.log}) |`).join('\n');
const copyRows=adapted.map(row=>`| ${row.name.replace('adapted-','')} | ${row.code===0?'Passed':'Failed / remaining assertions blocked'} | [Log](../../artifacts/app-audit/${row.log}) |`).join('\n');
const details=browser.visits.filter(row=>!lists.includes(row.path)).map(row=>`| ${row.path} | ${row.h1||'No heading'} | ${row.role} |`).join('\n');
const pageInventory=routes.filter(route=>route.endsWith('page.tsx')).map(route=>`- \`${route}\``).join('\n');
const apiInventory=routes.filter(route=>route.endsWith('route.ts')).map(route=>`- \`${route}\``).join('\n');
const coverage=`# ConstructSync audit coverage

Date: 16 October 2026. Read with [the findings](FULL_APP_AUDIT.md) and [verification summary](../../artifacts/app-audit/verification-summary.json).

## Environment and method

- Current working tree, starting HEAD \`${summary.head}\`; existing changes were retained. Node 24.19.0, Next 16.3.6, React 19.2.8, Windows headless Microsoft Edge.
- Production build/server on \`http://127.0.0.1:3100\`. Disposable browser profiles; each suite owns its storage. The independent sweep prevented external Drive and extraction calls. Other suites use their existing mocks; the live MRF import script was excluded.
- Initial 295 tests, ESLint and TypeScript passed. The production build passed after retrying Google Fonts downloads with network access. The final ESLint run also passed with the audit helpers present.
- Browser state was varied only in disposable profiles. Original app files and regression scripts were not edited. Audit-only copies live under the evidence directory, with their adaptations documented in \`adapt-suites.mjs\`.
- Results below distinguish **Passed**, **Failed**, and **Blocked**. A failed script does not establish that every feature it intended to cover is broken. Later unexecuted assertions are blocked until its setup/selector failures are repaired.

## Workflow and module outcomes

| Area/scenario | Outcome | Evidence and practical limit |
| --- | --- | --- |
| Populated workspace, first install, saved edits and replacement backup | Passed | Original showcase suite: generated local PDF/XLSX, persisted edits, interrupted-install recovery, storage failure, explicit clearing without reseeding. |
| Sign-in, department switching, remembered access and user revisions | Passed for exercised scenarios; broad suite failed | Showcase/shell/site-visibility suites and adapted user management passed. Broad smoke stops on obsolete revision 1. Wrong credentials/session rules also have domain tests. |
| User add/edit/reset/deactivate/reactivate and session invalidation | Passed in audit copy | Adapted user-management suite reaches its final assertions, including cross-tab account invalidation. Original suite remains failed. |
| Project creation, project code, budget/scopes and role restrictions | Passed for exercised scenarios | Adapted user-management suite and domain project/numbering tests. Original numbering/project-folder scripts still fail on obsolete selectors. |
| MRF form, material edit/view, review and modal focus | Passed in audit copy | Adapted material-row suite reaches its final assertions; independent mobile form rendering. Complete submit/return/resubmit branches are protected by domain tests; their original broad browser run is blocked. |
| MRF approval and local archive | Passed | Showcase UI approval creates real local archived copies and survives refresh. Core-flow commands cover the linked transition. |
| MRF AI import and input validation | Passed mocked/unit checks; live blocked | Existing extraction tests verify limits, malformed results, same-origin and signatures. Real provider accuracy/cost was not tested. |
| Quotation upload queue, supplier groups and worksheet | Passed in audit copies | Supplier-upload and worksheet suites complete; source preview, missing-file behavior, keyboard interactions and confirmation exclusions are exercised. |
| Large quotation editor and financial review | Passed in audit copies | 25 suppliers/100 lines, pagination, issue navigation, readonly records and saved/reloaded fields. Financial-review suite completes arithmetic/review controls. |
| Quotation extraction route | Failed | Cross-origin acceptance, forged MIME and malformed-body exceptions reproduced with a stubbed provider (AUD-01/02). |
| Quotation extraction-dialog and complete confirmation suites | Failed; remaining assertions blocked | Audit copies progress beyond the initial stock-step mismatch but still stop on reload/selector expectations. No passing claim for their full cancellation/reanalysis sequences. |
| Supplier comparison, split awards and PO creation | Passed for exercised cases | Original compare-allocate suite: 100 materials/five suppliers, quantities, bulk gap retention, atomic save, stale awards and explicit generation. Core command flow also creates/reviews orders. |
| PO review, supplier issuance, upfront proof, payment and separate clearance | Passed for exercised cases | Original full-disbursement and showcase suites; failed/retried archives and confirmation cancellation included. Date defaults fail a separate boundary probe. |
| Credit installments, unpaid delivery clearance, voids and Finance coordination | Passed | Original credit-terms suite, showcase and domain tests, with persistence and responsive controls. |
| Direct/warehouse delivery, forwarding limits and stock posting | Passed domain/command and selected browser checks | 77-command core walkthrough covers receipt/warehouse forwarding/posting; adapted material-row suite covers delivery inputs/dialogs. Full original delivery-document suite blocked by assignment fixture. |
| Cross-project transfer lifecycle | Passed command assertions; detailed browser journey blocked | Core walkthrough validates source release, dispatch, destination receipt/posting and Accounting evidence. Original transfer browser suite aborts in user setup; showcase retries a real local receipt archive. |
| Inventory filters and pooled balances | Passed | Original suggestions suite and domain tests cover search/scope/unit/stock filters and project reset. Accounting default action fails its independent probe (AUD-08). |
| Reports, totals and date boundaries | Failed | Rendering and role restrictions pass; Philippine midnight filter excludes an expected request (AUD-04). Financial values are checked against app rules, not a real company ledger. |
| Local documents, PDFs/XLSX, previews and downloads | Passed for sampled rendering/bytes; failed identity usability and source-link origin | Original showcase/document-gallery/suggestions suites pass. Project archive duplicates ambiguous MRF names (AUD-06). A real HTTP/XLSX check finds localhost links in a 127.0.0.1 download (AUD-14). |
| Network/error/retry/loading and cancellation | Passed for exercised suites; installation UX failed | Skeleton, full-disbursement, credit, gallery and worksheet scenarios pass. Temporary comparison-generation failure exposes workspace-clearing recovery (AUD-05). |
| Navigation, notifications, sidebar/drawer and themes | Passed for tested interactions; visibility usability failed | Original shell suite passes including short windows, keyboard labels and notification bounds. Restricted destinations remain offered to some roles (AUD-12). |
| Documentation and visible copy | Failed | Obsolete startup/reset instructions, missing setup reference and literal encoding artifacts (AUD-10/13). |

## Route and role review

The independent sweep recorded **77 main-route role visits**. “Viewed” means the page rendered for that role; it does not grant every mutation on the page. “Denied” is an observed access-unavailable screen and is expected for these restricted combinations. Sidebar visibility is a separate AUD-12 issue.

| Route | Site | PM | Procurement | Finance | Logistics | Accounting | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
${matrix}

Additional routes were inspected primarily as Administrator, including expected missing-record and edit restrictions. The maintenance URL resolved to \`/admin\`, so it is recorded as an additional Administration visit rather than a separate route below. Working-role form interactions are documented in the module table and responsive matrix.

| Resolved route | Observed heading | Role |
| --- | --- | --- |
${details}

Root/legacy-link handling and route permissions have passing domain tests. A complete independent browser run of every legacy-link branch was **blocked** by the original broad suite's earlier failure. Framework 404 handling was build-checked; arbitrary unknown URL keyboard behavior was not separately exercised.

## Browser suites

Original suites: **${summary.originalSuites.passed} passed / ${summary.originalSuites.failed} failed**. These are suite counts, not individual assertion counts. Failed suites may contain earlier passing assertions.

| Suite | Result | Duration | Interpretation | Evidence |
| --- | --- | --- | --- | --- |
${suiteRows}

Audit-only copies: **${summary.auditCopies.passed} passed / ${summary.auditCopies.failed} failed** after the latest adaptations. Their success does not change the original-suite result. Import paths, explicit quotation step selection/reselection, project codes, labels/redirects and current fixture sessions/assignments are the only adaptations; product behavior was not patched.

| Audit copy | Result | Evidence |
| --- | --- | --- |
${copyRows}

The connected in-memory walkthrough independently asserts 77 command transitions and 36 checkpoints. It verifies 20 upfront units received, five used, a fully settled two-installment credit order, ten stock units deducted from the source and ten posted at destination, and complete Accounting document review. [Probe summary](../../artifacts/app-audit/domain-probes.json). It is a command-level check, not 77 browser interactions.

## UI, accessibility and performance

- **Passed:** 22 page families × 6 widths × 2 themes = 264 rendering combinations. Widths: 320, 375, 414, 768, 1280 and 1440. Desktop matrix height 720, narrow matrix height 812. Seven role screenshots additionally use the desktop profile.
- **Passed:** zero detected page-root overflow cases, zero unnamed visible-control candidates under the helper's basic label algorithm, and zero uncaught page exceptions in the independent sweep.
- **Passed for sampled checks:** CSS viewport reflow equivalent to 200% zoom at 1280px; reduced-motion media emulation with animation reduced to 0.00001 seconds; project-dialog Escape and focus restoration; native modal and keyboard interactions in passing suites.
- **Passed for measured targets:** adapted quotation worksheet warning text has minimum 4.60:1 contrast. This does not establish all-screen text, focus or state contrast. Source tokens and focus styles were inspected; full contrast measurement remains **blocked/not comprehensively tested**.
- **Failed usability:** large mobile metric stack, Accounting's disabled selected action, ambiguous archive rows, repeated page titles, restricted navigation destinations and corrupted quotation copy; see findings.
- **Recorded, not automatically failed:** links below 24px in height. The evidence contains candidates; sufficient row/neighbor spacing and full-row actions require contextual judgment.
- Warmed-server sampled navigation: mean ${summary.browser.navigationMs.mean} ms, median ${summary.browser.navigationMs.median} ms, p95 ${summary.browser.navigationMs.p95} ms, range ${summary.browser.navigationMs.minimum}–${summary.browser.navigationMs.maximum} ms. Includes deliberate settling waits and concurrent audit load; no network throttling, user performance target, cold-start or production capacity claim.
- Native browser-toolbar zoom, actual phone hardware, Safari/Firefox engines, screen-reader announcements and full keyboard traversals through every state are **blocked/not tested** in this Windows Edge audit.

## Server and integration coverage

| Surface | Outcome | Evidence / limitation |
| --- | --- | --- |
| MRF/PO document preview generation | Passed for exercised fixtures | Production startup, real local generated copies, PDF template/domain tests and gallery/preview suites. |
| Comparison XLSX/PDF generation | Passed generation; failed downloaded source-link origin | Fresh workspace makes actual files; showcase opens XLSX and renders local PDFs; bid/comparison tests validate frozen versions. Exact-origin check fails for 127.0.0.1 download links (AUD-14). |
| MRF extraction | Passed route/unit validation | Existing tests plus explicit foreign-Origin and forged-signature comparisons; upstream is stubbed. |
| Quotation extraction | Failed | [Direct handler probes](../../artifacts/app-audit/api-probes.json). Provider stub only; no live provider access. |
| Drive project/folder validation and creation | Passed exercised mocked cases; full suite blocked | Adapted user-management passes setup; original project-folder suite and remaining audit-copy selectors block additional cases. |
| Drive MRF/quotation/PO archive and upload chunks | Passed automated/mocked checks for exercised cases | Domain/upload routes and successful payment/quotation scenarios. No real company uploads or token-expiry tests. |
| Accounting/payment proof archives and downloads | Passed automated/mocked checks for exercised cases | Route/domain tests; full-disbursement/credit browser suites exercise retry, proof association and payment gates. |
| Delivery and transfer receipt/evidence routes | Passed automated/command checks; full browser sequences blocked | Existing route tests/core commands; detailed original suites fail earlier fixtures. Showcase verifies local transfer-receipt retry. |
| Deployment protection and real external services | Blocked / not exercised | No hosted target selected. No live Drive permission validation, OCR accuracy study, AI cost/rate-limit verification, company payment or supplier integration. |

Source route inventory (${routes.filter(route=>route.endsWith('page.tsx')).length} page adapters, ${routes.filter(route=>route.endsWith('route.ts')).length} API handlers):

${pageInventory}

${apiInventory}

## Reproduction and completion

Start the built app on loopback port 3100. Reproduce original suite results using \`node --experimental-strip-types scripts/<name>-smoke.mjs http://127.0.0.1:3100\`. \`run-suites.mjs\` captures exit codes, timing and logs; it is an audit collector and does not return aggregate failure for an individual failed child suite. Read \`verification-summary.json\` for the authoritative results.

Run the independent sweep with \`node --no-warnings --experimental-strip-types artifacts/app-audit/browser-audit.mjs\`. It uses fresh profiles and blocks external integrations. Add \`--resume\` after an interrupted role sweep; \`--resume --finish\` reruns focused checks while preserving the earlier matrix. The initially written harness needed an Accounting label correction and a role correction before its focus check; those harness errors are not application findings. Earlier logs are retained.

Run \`node --no-warnings --experimental-strip-types artifacts/app-audit/api-probes.mjs\` for stubbed extraction probes and \`domain-probes.mjs\` for clock/document/command evidence. Both operate on synthetic data and restore temporary globals/environment state. \`adapt-suites.mjs\` rebuilds the clearly labelled audit copies from untouched original scripts.

The audit is complete as a review with explicit failed/blocked outcomes. It does **not** claim that all browser regressions pass or that the app is production-ready. Remaining blocked cases have identified fixture/selector or environment limits; recommended product corrections and original-suite repairs are separate follow-up work.
`;
await writeFile('docs/qa/APP_AUDIT_COVERAGE.md',coverage);
const screenshots=(await readdir(path.join(output,'screenshots'))).filter(name=>name.endsWith('.png'));
const index=`# Application audit evidence

Date: 16 October 2026. These artifacts use fictional records and disposable browser profiles.

- [Findings](../../docs/qa/FULL_APP_AUDIT.md)
- [Coverage](../../docs/qa/APP_AUDIT_COVERAGE.md)
- [Verification summary](verification-summary.json) — latest original/audit-copy suite outcomes, route inventory and measured counts.
- [Browser sweep and focused checks](browser-audit.json) — 95 route visits, 264 responsive/theme records and reproduced UI/calendar/recovery behavior.
- [API probes](api-probes.json) — direct extraction handlers with a dummy key and a stubbed provider; no live AI calls.
- [Domain probes](domain-probes.json) — Philippine date inconsistency, local document labels and connected command assertions.
- [Origin/link probe](origin-link-probe.json) — real local HTTP/XLSX generation at both loopback hostnames; mismatched source-link origins at 127.0.0.1.
- [Production build log](logs/build-network-retry.log); [initial sandbox font-fetch failure](logs/build.log).
- [Before status](status-before.txt), [after status](status-after.txt), [starting HEAD](head.txt). No application source was edited by the audit.

\`logs/\` retains original failures and audit-copy results. \`suites-*.json\` are batch snapshots; duplicate adapted names reflect earlier attempts. \`verification-summary.json\` selects the latest outcome per name. Pipeline logs containing PowerShell NativeCommandError around Node's MODULE_TYPELESS warning can report wrapper exit 1 even after the script writes successful evidence; inspect the JSON/final script message. Original suite results were collected directly from child exit codes.

The audit helpers are executable investigation artifacts, not added production code or a replacement maintained test suite. The independent browser script blocks remote Drive/extraction operations. Native/live integrations remain unverified as described in coverage.

## Screenshots (${screenshots.length})

${screenshots.map(name=>`- [${name}](screenshots/${name})`).join('\n')}
`;
await writeFile(path.join(output,'README.md'),index);
console.log(JSON.stringify({original:{passed:summary.originalSuites.passed,failed:summary.originalSuites.failed},adapted:{passed:summary.auditCopies.passed,failed:summary.auditCopies.failed},visits:summary.browser.visits,responsive:summary.browser.responsive,screenshots:summary.screenshots,routes:routes.length},null,2));
