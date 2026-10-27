# Production readiness — HML ConstructSync

Reviewed 27 October 2026 for HML Technologies and Services Inc. The intended production release will be the company's main operational system, starting with fresh data. This change prepares the codebase and verification process; backend conversion and deployment remain separate work.

## Current verification

| Check | Result |
| --- | --- |
| Unit/API tests | Passed: 357 tests |
| ESLint and TypeScript | Passed, including fresh route type generation |
| Production build | Passed after the final compatibility and browser-title fixes |
| Browser regression | Passed: all 28 suites against the final production build, including title recovery after a forced late metadata overwrite |
| Live MRF extraction | Passed using a generated synthetic PDF |
| Live quotation extraction | Passed, including expected material, quantity and unit price |
| Live Drive integration | Passed project creation, resumable upload initialization/status, upload and SHA-256 download comparison |
| Live cleanup | Run-owned test folder trashed; trashed state verified |
| Dependency audit | No known advisories reported by `npm audit` across production and development dependencies |
| Source secret check | No matching Google API keys, private-key blocks or GitHub token patterns across 385 current source/documentation files, including new files; ignored local configuration was excluded |
| Documentation links | No missing local Markdown link targets in retained documentation |
| Hosted CI | Workflow added; a GitHub-hosted run has not been triggered |

Generated logs and machine-readable results are ignored under `.verification/`. Browser summaries mark incomplete runs and checkpoint each completed suite, so interruption cannot leave an earlier result looking current. This report records outcomes rather than committing screenshots, provider responses or credentials. Live checks validate the configured credentials at test time, not future availability or production account authorization. The first live run exposed an incorrect MRF response assertion in the new runner; the assertion was corrected and the complete rerun passed. Both runs cleaned up their own folders.

## Cleanup and retained behavior

- Removed 1,022 historical files (210,252,737 bytes) from the artifact, thesis and sample-data collections, plus retired capture/packaging/sample scripts and obsolete audit documents. Git history was preserved.
- Replaced the large runtime-adjacent showcase builder with a one-request local-archive test fixture. Reusable linked test records now belong to tests; runtime startup remains empty.
- Preserved company branding, PDF templates/fonts, source workflow documentation and the existing uncommitted stock work.
- Shared browser document storage, SHA-256 hashing, resumable upload/recovery, server upload-ticket encryption and ordinary document chunk handling. Purpose-specific validators, the MRF's paired completion, document identities, receipt versions and command acknowledgements remain distinct.
- Shared Gemini transport while retaining MRF/quotation prompts and validation. Quotations now propagate cancellation, combine non-thought response text and reject incomplete model output consistently.
- Fixed late layout metadata replacing the browser's current record title, and updated the credit-payment regression to use the existing Finance queue interface.
- Preserved snapshot version 12, route/response contracts, financial calculations, department rules, approval paths and document formats. No database/provider migration or central business-command rewrite was introduced.

## Blockers before HML relies on production

| Priority | Existing gap | Required production outcome |
| --- | --- | --- |
| P0 | Account directory, credentials and sessions are browser-local; signed-in users can switch department identities | Real server authentication, controlled provisioning/recovery, revocation and company-approved account ownership |
| P0 | Drive/document/AI routes rely on origin/configuration checks and client-supplied business records | Server authorization for each record, project and operation; authoritative server reads; protection for costly provider calls |
| P0 | Operational records live in localStorage and files in IndexedDB | Shared durable storage, authoritative validation and tested multi-device access |
| P0 | Stock, budgets, payments and document numbering commit only within a local snapshot | Database transactions, concurrency control and idempotency verified with simultaneous requests |
| P0 | Initialization can clear earlier browser records once; Administrator can clear operational records | Replace prototype initialization/reset behavior for production. HML chose a fresh start; no current-data migration is included |
| P0 | Historical audit attribution is enforced only by browser commands and editable local records | Server-generated actor attribution and protected audit history |
| P0 | No implemented shared-data backup/restore or recovery procedure | Backups, a demonstrated restore, and HML-approved recovery targets and responsibility |
| P1 | No demonstrated production monitoring, incident handling or credential-rotation process | Error/availability visibility, provider-failure handling, alert ownership and tested credential renewal |
| P1 | Automated tests exercise prototype permissions and simulated staff identities | Department-owner acceptance of the shared production workflows and a successful protected staging rehearsal |

Passing these cleanup checks does not clear the P0 blockers. Keep live-enabled prototype deployments protected until production authentication, authorization and persistence exist.

## Repeatable checks

Use Node 26.12.1 and npm 11.20.0. Run `npm ci`, `npm run verify`, then `npm run verify:browser`. The browser command owns an isolated local server, blanks provider credentials and disables live integrations. Selected suites may be passed as arguments. The explicit manifest includes stock-transfer forwarding.

Run `npm run test:live` separately with the server's Drive/Gemini configuration. It creates a unique child beneath the configured root and restricts its separate application process to that child. Synthetic documents are used throughout. Cleanup verifies the run identifier, parent and folder name before trashing; cleanup failure fails the command and records the remaining folder ID. There is no application deletion endpoint.

Pull-request CI installs the locked dependencies, audits them, runs standard verification and then the browser suite on Windows/Edge. It receives no live credentials. The hosted workflow and deployment-platform/runtime compatibility have not been exercised. Provider failure/expiry checks, load testing and production recovery drills remain part of the later production conversion.
