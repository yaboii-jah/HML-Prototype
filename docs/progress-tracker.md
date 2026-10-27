# Progress Tracker

Update this file after every meaningful implementation or documentation change and consequential decision. Keep completed work, active work and plans distinct. **Last reviewed: 2026-10-27.**

## Current Phase

- Production preparation: runtime/toolchain milestone 2 is complete. Published revision `79772a6` passed all four Linux/Windows CI jobs with Node 24/26. Production identity and shared-data implementation have not started.
- Local checks demonstrate the current prototype baseline; production authentication, shared persistence and operational readiness remain pending.

## Current Goal

- Scope the next unit for individual identity, permissions and shared data under checklist step 3. Node 26 development and the Node 24 deployment baseline now pass the hosted matrix with the same npm version. Follow the [production checklist](checklist.md); implementation of each unit requires its own agreed scope.

## Completed

- **Committed baseline:** Cleanup and verification tooling in `104640a`, included in the current staging baseline. Historical artifact/sample collections were removed, reusable fixtures isolated under tests, document/upload/AI helpers shared, and CI plus repeatable verification introduced. This did not implement the production backend.
- **Committed in `a26983a`:** Accounting is the canonical role across the app, permissions, fixtures and tests. Compatibility handling preserves existing browser accounts, sessions, permanent IDs and records; tests cover identity checks and blocked storage writes.
- **Committed in `a26983a`:** Five-document context set, including this tracker, with README/agent pointers and active progress-maintenance rules. Actionable legacy requirements, integration setup, open decisions and dated evidence were consolidated; 15 superseded Markdown files and two empty subfolders were removed. The documents distinguish production targets from current implementation and establish proportionate verification.
- **Committed in `a26983a`:** Agent instructions require reading all five context documents before planning or changing the project, including when resuming without current context. Task completion includes an explicit documentation-impact review, updates to affected documents and a report of what changed or why no update was needed. `CLAUDE.md` inherits the requirement through `AGENTS.md`.
- **Committed in `a26983a`:** Simple production checklist companion with seven steps, completion conditions and update rules. The checklist owns ordered milestones and checked status; this tracker retains active work, blockers, open questions and detailed evidence. Agents read and update the companion during milestone work.
- **Completed 2026-10-27:** Reviewed and committed the documentation and Accounting changes in checkpoint `a26983a`. The checklist records this checkpoint; consult Git for the current branch publication and merge status.
- **Implemented and verified locally and in CI:** Local Node 26.12.1/npm 11.20.0 is retained, supported package ranges admit patched Node 24/26, and dependency-free checks reject incorrect Node/npm versions during installation and verification. Vercel installation/build commands require Node 24 explicitly. Node types now follow version 24. CI verifies both runtimes on Linux/Windows, with full browser checks on both Windows jobs and separate artifacts.
- **Runtime checkpoint `aa14273`, verified locally:** Next.js and its lint configuration are updated from 16.3.6 to 16.4.3; Sharp 0.35.5, source-map-js 1.2.2 and Zod 4.6.7 resolve the audit's high/critical findings. Development, standard verification and deployment use the supported Webpack build option after Windows Application Control blocked the updated native compiler. Clean installation, lint, type generation, TypeScript, 364 tests, the production build and all 28 browser suites passed. The startup browser check waits for Administration content before clicking Add project; that checkpoint preserved application source and fixtures.
- **CI findings fixed in `80b9c8b`:** The transfer-ticket assertion sometimes replaced `x` with `x`; it now flips a decoded byte. A session-read regression reproduced a cleared/replaced identity being written back; canonical reads no longer write, and compatibility normalization checks the current stored value before persisting. Browser checks control motion/focus settings, wait for a fresh document during navigation and verify the settled dashboard handoff before testing direct/reloaded Reports denial. Standard verification passes with 365 tests; reset/sidebar/Reports stress replays pass under CPU throttling. All 28 browser suites pass with host-level reduced motion forced, including the explicit reduced-motion accessibility cases.
- **Navigation follow-up in `79772a6`, verified locally and in CI:** Document-numbering/material-row suites now allow 60 seconds for full navigation while retaining 15 seconds for other protocol calls, fresh-document checks and all existing workflow assertions. Both suites passed with a controlled 19-second initial response; final standard verification passed lint, types, 365 tests and build. All four hosted jobs passed, including all 28 browser suites on both Windows runtimes. The other browser suites and application source are unchanged from `80b9c8b`.
- **Completed 2026-10-27:** Checklist step 2 is verified by [run 40523568579](https://github.com/yaboii-jah/HML-Prototype/actions/runs/40523568579) at `79772a6`: Linux and Windows passed on Node 24.22.1 and 26.12.1. This completes runtime/CI preparation; hosted deployment and the remaining production foundations are still pending.
- **Existing product baseline:** Material requests, quotations/awards, POs, external payment coordination/verification, delivery, stock transfers, usage, document archives and operational monitoring exist in the prototype. PHP-only quotation checks, themed scrollbars, clearer material labels, scope selection, inventory filters and comparison previews are implemented improvements rather than new backlog items. Their presence does not establish server authorization or shared storage.

## In Progress

- No implementation unit is active. The runtime/CI fixes are published on [PR #25](https://github.com/yaboii-jah/HML-Prototype/pull/25), and checklist step 2 is complete. Step 3 has not started.

## Next Up

Use the [production checklist](checklist.md#steps) for the ordered milestones and their completion conditions.

- Agree a bounded first unit for checklist step 3: individual identity, current server-checked grants and shared authoritative records. Preserve the existing access and self-approval rules during migration.
- Retain local Node 26.12.1, the Vercel Node 24.x target, CI baseline 24.22.1 and npm 11.20.0 across environments. Hosted deployment verification belongs to the later protected rehearsal.
- Work foundations first: individual identity, shared records and server authorization before business-workflow migration. Tailwind remains a separate track.
- Keep the active unit and blockers here rather than duplicating the checklist. Future milestones do not authorize starting unrelated work or publishing changes.

**Release blockers:** Real server authentication and record/provider authorization, shared authoritative records, transactional stock/budget/payment/numbering updates, protected audits, removal of prototype reset/demo paths, and demonstrated backup/restore are required before operational reliance. Monitoring/incident handling, department acceptance and a successful protected deployment rehearsal also remain unverified. A clean structure or successful build does not clear these requirements.

## Open Questions

### Company Accounting Policy

The legacy company discussion records **goods and services EWT computations as confirmed**. The remaining policies below await company confirmation; implemented formulas are not evidence of approval.

| Topic | Decision or evidence still needed |
| --- | --- |
| VAT | Whether prices are inclusive/exclusive, permitted variations and applicable rates. |
| Charges | Fixed/percentage bases for delivery, freight, handling, installation and other fees; which receive VAT. |
| Discounts | Line versus whole-document discounts, percentage bases and ordering relative to VAT. |
| Multiple adjustments | Independent versus sequential application of discounts/charges and their calculation order. |
| Partial orders | Whether discounts and delivery/service charges are retained, prorated, recalculated or requoted. |
| Rounding | Line/tax/final-total rounding, precision, method and treatment of small differences. |
| Budget charging | Gross purchase value, net supplier payment after EWT or another basis; treatment of VAT and withheld tax. The current app uses net payable after EWT for project/scope commitments and spending and does not separately track EWT remittance as a tax liability. This is unconfirmed company policy. |
| Settlement | Reconciliation among PO, invoice, supplier payment and withholding; other deductions, retention or previous advances. |
| Corrections | Effects of shortages, rejection, returns and credit notes on payable amounts and project budgets, including approvals and supporting records. |

Request one worked company transaction covering material amounts, each discount/charge, VAT, confirmed goods/services EWT, other deductions, final supplier payment and project/scope budget charge. Obtain supporting quotation, approved PO, invoice, payment proof, computation sheet and relevant withholding/credit-note references. Record the confirming person/role, date, exceptions and rules approved for implementation; keep sensitive supporting documents in their controlled record/archive location.

### Operational Ownership

- Agree recovery objectives, database/file backup coverage, restore responsibility and how a successful restore will be demonstrated.
- Identify monitoring/alert and incident owners, credential-renewal responsibility, and company ownership/provisioning details for Drive, the email sender and deployment services.
- Identify department acceptance owners and who signs off the protected staging rehearsal and operational release. The service choices are settled; these ownership and acceptance details are not.

## Architecture Decisions

The [architecture document](architecture.md) is the detailed source of truth. Keep this summary focused on the reason behind settled choices.

| Decision | Reason |
| --- | --- |
| One HML company, fresh operational records | Keeps the production scope focused; prototype browser-record import and a public multi-company service are excluded. |
| Supabase Auth/Postgres with server-checked grants | Provides individual identity and shared authoritative records instead of browser-selected authority. Permanent identities support self-approval prevention and protected audit responsibility. |
| Google Drive for permanent files; database references/status | Keeps company documents in their controlled archive without treating browser caches as completion or duplicating permanent storage in Supabase Storage. My Drive OAuth is for testing; company operations require company-owned Shared Drive access. |
| Durable jobs and reviewed AI results | Allows bounded retries and visible partial failure while retaining accountable actors and human business decisions. |
| Independent transfers, purchases and workflow milestones | Avoids fictional financial obligations for owned stock and allows split sourcing and credit-payment/delivery independence. |
| Next.js/Vercel target, Node 26 locally and Node 24 for deployment | Retains the user's development runtime while testing both supported runtimes and enforcing the production version. Tailwind remains an independently verifiable conversion. |

## Session Notes

- **Resume context:** Branch `docs/restructure-project-documentation` is based on staging commit `aead301`; runtime/toolchain checkpoint `aa14273` follows documentation checkpoint `abcbc5e`. [PR #25](https://github.com/yaboii-jah/HML-Prototype/pull/25) contains the migration preparation. Fixes `80b9c8b` and `79772a6` are published, and the latter passed the complete hosted matrix. Consult Git for the current publication and merge status. This work does not deploy the application.
- **Dependency follow-up:** The unchanged `npm audit --audit-level=high` gate passes with two moderate findings through ExcelJS 4.4.0's UUID 8.3.2 dependency. The suggested forced fix downgrades ExcelJS to 3.4.0 across a major version; it was not applied. Assess a compatible upstream fix or scoped spreadsheet-library change separately; do not report zero vulnerabilities.
- **Read before the next unit:** [Project overview](project-overview.md), [architecture](architecture.md), [AI workflow rules](ai-workflow-rules.md) and [code standards](code-standards.md), plus the companion [checklist](checklist.md) for milestone work. Runtime/toolchain verification is complete; do not mark identity, storage, workflows or Tailwind complete because their target design is documented.

| Date | Verification scope | Recorded result and limit |
| --- | --- | --- |
| 2026-10-27 | Earlier cleanup baseline | 357 unit/API tests, lint/type generation/TypeScript/build, all 28 browser suites, plus recorded dependency/secret/link checks passed. These are historical baseline results, not a fresh run for later changes. |
| 2026-10-27 | Earlier live integration check | Synthetic MRF/quotation extraction and Drive project/upload/download integrity passed; the run-owned folder was trashed and its state verified. No newer live check is claimed. |
| 2026-10-27 | Accounting rename | 360 unit/API tests, lint, type generation/TypeScript and production build passed. Exactly four selected browser suites passed: user-management, shell-controls, full-disbursement and credit-terms. This was not a rerun of all 28 suites. |
| 2026-10-27 | Five-document consolidation | Five-file inventory, template headings, 42 local links/anchors, retained requirements/open questions/evidence, whitespace and obsolete-reference checks passed. The managed Next.js block and all 57 pending application files were preserved. No application, browser or live checks were rerun for this documentation-only unit. |
| 2026-10-27 | Required agent documentation reading and updates | Verified all five mandatory reading links, matching start/completion instructions, local links/anchors, whitespace and the unchanged managed Next.js block. Unrelated pending files were preserved. Documentation-only validation; no new application, browser or live checks are claimed. |
| 2026-10-27 | Production checklist companion | Verified six document files, seven unchecked steps with completion conditions, the five-core reading list and conditional companion instruction, tracker/checklist ownership, local links/anchors and whitespace. The managed Next.js block and unrelated pending files were preserved. No migration, Git checkpoint or application verification was performed by this documentation task. |
| 2026-10-27 | Git checkpoint `a26983a` | Reviewed the changes; staged whitespace and 50 documentation links/anchors passed. Scanned 65 added/modified files for common credential patterns and private environment files without finding matches. Application files matched the previously verified 360-test/four-browser-suite version; those tests were not rerun for this checkpoint. |
| 2026-10-27 | Runtime/toolchain, local Node 26.12.1/npm 11.20.0 | Clean `npm ci`, installation/runtime checks, lint, type generation, TypeScript, 364 unit/API tests and the Webpack production build passed. The initial browser run passed 27/28 suites; after fixing the startup readiness wait, final standard verification and all 28 browser suites passed. Four regression tests cover supported/unsupported Node, npm mismatch and explicit/automatic deployment enforcement; both configured Vercel commands also refused local Node 26 before installation/build. The high-severity audit gate passed with two moderate ExcelJS/UUID findings retained. CI YAML, four configured combinations, Windows browser conditions, unique artifacts, npm bootstrap quoting, Vercel commands, package/lockfile agreement, 50 documentation links/anchors and whitespace were checked. App source, fixtures, agent instructions and the local runtime pin were preserved. Hosted CI, actual Node 24 execution and deployment remain unverified; no live provider checks were run for this unit. |
| 2026-10-27 | Initial hosted CI, revision `aa14273` | [Run 40507330970](https://github.com/yaboii-jah/HML-Prototype/actions/runs/40507330970): Linux Node 24/26 passed installation, audit, lint, types, 364 tests and build. Windows Node 24 passed 363/364 tests, failing the intermittent ticket assertion before build/browser checks. Windows Node 26 passed standard checks/build and 23/28 browser suites; reset/session, sidebar, skeleton animation, sign-in playback and Reports handoff checks failed. This verifies actual Node 24 execution on Linux, not completion of the four-job milestone. |
| 2026-10-27 | Windows CI compatibility fixes, local Node 26.12.1/npm 11.20.0 | Reproduced the original ticket failure locally (1/24 runs) and proved that the old edit can leave the ticket unchanged; real byte corruption is rejected. A new session-clear/replacement regression failed before the fix and passed afterward. The existing skeleton suite reproduced the CI assertion under forced reduced motion. Final `npm run verify` passed lint, route types, TypeScript, 365 tests and build; all 28 browser suites passed with forced host-level reduced motion. Reset, sidebar and Reports replays also passed with 4x CPU throttling, including blocked storage and direct/reloaded access denial. No access gates or assertions were removed. Corrected hosted results remain pending; no live provider checks were run. |
| 2026-10-27 | Hosted CI for session/browser fixes, revision `80b9c8b` | [Run 40519247830](https://github.com/yaboii-jah/HML-Prototype/actions/runs/40519247830): both Linux jobs passed, and Windows Node 26 passed 365 tests/build plus all 28 browser suites. Windows Node 24 passed 365 tests/build and 26/28 browser suites; document-numbering/material-row calls hit their 15-second `Page.navigate` deadline. A valid 19-second initial-response replay reproduced that error before the follow-up and both complete workflows passed afterward with the bounded navigation allowance. This run does not complete the four-job milestone. |
| 2026-10-27 | Completed runtime/CI milestone, revision `79772a6` | [Run 40523568579](https://github.com/yaboii-jah/HML-Prototype/actions/runs/40523568579): all four Linux/Windows jobs passed on Node 24.22.1 and 26.12.1 with npm 11.20.0, installation/runtime checks, the high-severity audit gate, lint, route types, TypeScript, 365 unit/API tests per job and production builds. Both Windows jobs passed all 28 browser suites. Two moderate ExcelJS/UUID findings remain. Checklist step 2 is complete; no hosted deployment or live provider check is claimed. |

Ignored `.verification/` logs and summaries are local evidence and may be absent in another checkout. Preserve dated, scoped outcomes here rather than linking to assumed permanent artifacts or copying provider responses. Hosted CI verifies actual Node 24/26 execution on Linux and Windows; hosted deployment remains unverified. Remaining load, multi-user, provider-expiry, restore and department-acceptance checks belong to the production milestones above.
