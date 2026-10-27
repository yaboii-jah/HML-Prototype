# Progress Tracker

Update this file after every meaningful implementation or documentation change and consequential decision. Keep completed work, active work and plans distinct. **Last reviewed: 2026-10-27.**

## Current Phase

- Production preparation: five core context documents and a production checklist companion are committed in `a26983a`. Runtime/toolchain changes are implemented and verified locally; hosted CI remains pending. Production identity and shared-data implementation have not started.
- Local checks demonstrate the current prototype baseline; production authentication, shared persistence and operational readiness remain pending.

## Current Goal

- Verify the hosted runtime/toolchain matrix with Node 26 locally, Node 24 on Vercel and the same npm version in both environments, followed by identity and shared-data foundations. Follow the [production checklist](checklist.md); implementation of each unit requires its own agreed scope.

## Completed

- **Committed baseline:** Cleanup and verification tooling in `104640a`, included in the current staging baseline. Historical artifact/sample collections were removed, reusable fixtures isolated under tests, document/upload/AI helpers shared, and CI plus repeatable verification introduced. This did not implement the production backend.
- **Committed in `a26983a`:** Accounting is the canonical role across the app, permissions, fixtures and tests. Compatibility handling preserves existing browser accounts, sessions, permanent IDs and records; tests cover identity checks and blocked storage writes.
- **Committed in `a26983a`:** Five-document context set, including this tracker, with README/agent pointers and active progress-maintenance rules. Actionable legacy requirements, integration setup, open decisions and dated evidence were consolidated; 15 superseded Markdown files and two empty subfolders were removed. The documents distinguish production targets from current implementation and establish proportionate verification.
- **Committed in `a26983a`:** Agent instructions require reading all five context documents before planning or changing the project, including when resuming without current context. Task completion includes an explicit documentation-impact review, updates to affected documents and a report of what changed or why no update was needed. `CLAUDE.md` inherits the requirement through `AGENTS.md`.
- **Committed in `a26983a`:** Simple production checklist companion with seven steps, completion conditions and update rules. The checklist owns ordered milestones and checked status; this tracker retains active work, blockers, open questions and detailed evidence. Agents read and update the companion during milestone work.
- **Completed 2026-10-27:** Reviewed and committed the documentation and Accounting changes in checkpoint `a26983a`. The checklist records this checkpoint; consult Git for the current branch publication and merge status.
- **Implemented and verified locally:** Local Node 26.12.1/npm 11.20.0 is retained, supported package ranges admit patched Node 24/26, and dependency-free checks reject incorrect Node/npm versions during installation and verification. Vercel installation/build commands require Node 24 explicitly. Node types now follow version 24. CI is configured for both runtimes on Linux/Windows, full browser checks on both Windows jobs, and separate artifacts; hosted results are not yet verified.
- **Verified locally:** Next.js and its lint configuration are updated from 16.3.6 to 16.4.3; Sharp 0.35.5, source-map-js 1.2.2 and Zod 4.6.7 resolve the audit's high/critical findings. Development, standard verification and deployment use the supported Webpack build option after Windows Application Control blocked the updated native compiler. Clean installation, lint, type generation, TypeScript, 364 tests, the production build and all 28 browser suites passed. The startup browser check now waits for Administration content before clicking Add project; application source and fixtures are unchanged.
- **Existing product baseline:** Material requests, quotations/awards, POs, external payment coordination/verification, delivery, stock transfers, usage, document archives and operational monitoring exist in the prototype. PHP-only quotation checks, themed scrollbars, clearer material labels, scope selection, inventory filters and comparison previews are implemented improvements rather than new backlog items. Their presence does not establish server authorization or shared storage.

## In Progress

- No local implementation or verification is running. The runtime milestone awaits hosted Node 24/26 checks on Linux/Windows; all local checks pass. Keep checklist step 2 unchecked until all four hosted results pass.

## Next Up

Use the [production checklist](checklist.md#steps) for the ordered milestones and their completion conditions.

- Run the four CI combinations when authorized, using a pull request or the workflow dispatch once available on the default branch. A push to this documentation branch alone is not a configured CI trigger. Local Node remains 26.12.1; Vercel targets Node 24.x, with 24.22.1 as the CI baseline and npm 11.20.0 shared across environments. Hosted deployment verification belongs to the later protected rehearsal.
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

- **Resume context:** Branch `docs/restructure-project-documentation` is based on staging commit `aead301`; `abcbc5e` is the saved documentation checkpoint after `a26983a`. Runtime/toolchain implementation and local verification are recorded in this change. Consult Git for its commit, publication and merge status; the checkpoint does not deploy the application.
- **Dependency follow-up:** The unchanged `npm audit --audit-level=high` gate passes with two moderate findings through ExcelJS 4.4.0's UUID 8.3.2 dependency. The suggested forced fix downgrades ExcelJS to 3.4.0 across a major version; it was not applied. Assess a compatible upstream fix or scoped spreadsheet-library change separately; do not report zero vulnerabilities.
- **Read before the next unit:** [Project overview](project-overview.md), [architecture](architecture.md), [AI workflow rules](ai-workflow-rules.md) and [code standards](code-standards.md), plus the companion [checklist](checklist.md) for milestone work. Finish runtime/toolchain verification first; do not mark identity, storage, workflows or Tailwind complete because their target design is documented.

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

Ignored `.verification/` logs and summaries are local evidence and may be absent in another checkout. Preserve dated, scoped outcomes here rather than linking to assumed permanent artifacts or copying provider responses. Hosted CI, actual Node 24 execution and deployment remain unverified. Remaining load, multi-user, provider-expiry, restore and department-acceptance checks belong to the production milestones above.
