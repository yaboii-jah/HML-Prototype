# AI Workflow Rules

## Approach

Develop incrementally against agreed requirements. Follow [AGENTS.md](../AGENTS.md): always read repository instructions and the tracker's current state, then select relevant overview, architecture, standards and milestone sections for the task. Full-document rereading is not a prerequisite. Inspect affected implementation before changing it; follow the installed Next.js guidance when writing framework code.

For foundation/migration work, read the relevant [checklist](checklist.md) step and the current unit's scope, dependencies and acceptance criteria in the [tracker](progress-tracker.md). Later units require scoped planning and authorization. Reconcile Git, current goal and the latest user instruction before starting.

Reuse unchanged context in the same session. After resumption or document changes, refresh current status and only missing/affected sections. Search headings first; request bounded excerpts rather than dumping files. Keep successful tool output to a result summary, with detailed logs in ignored verification artifacts; inspect failures only as needed. Do not load raw evidence trees when their summaries suffice.

Distinguish the intended production architecture from capabilities already implemented. Use the code to establish current behavior and the agreed documents to establish the target. Surface consequential conflicts rather than silently changing the product or claiming that planned capabilities already exist.

For substantial changes, present a brief plan covering the intended behavior, affected boundaries and verification. Once the user authorizes the scope, carry it through to completion without repeatedly asking for approval. A new decision is needed when consequential ambiguity remains or the required work extends beyond that authorization.

## Scoping Rules

- Work on one coherent feature or migration unit at a time, with an observable outcome and a defined verification method.
- Prefer small, complete increments over speculative infrastructure or unrelated cleanup.
- Keep coordinated UI, server and data changes together when they are required for the same behavior. Folder boundaries alone do not define separate units.
- Preserve unrelated user changes and existing behavior outside the agreed scope. Fix task-caused failures. Diagnose an unrelated failure once to identify its cause and acceptance impact; report a blocker and obtain scope expansion before substantial unrelated repairs. A blocked gate remains incomplete.
- Perform commits, pushes, merges, deployments, migrations and changes to external services only when covered by the user's authorization. Existing authorization carries through the work it covers.

## When to Split Work

Split a proposed implementation step when it combines:

- Independent features, unrelated workflows or API changes with separate acceptance criteria.
- A broad styling conversion and an authentication or persistence migration that can be delivered and verified separately.
- A settled requirement and a consequential product decision that still needs an answer.
- More behavior than can be verified as a bounded unit with a clear result and failure path.

Each resulting unit must have a useful outcome and evidence of correctness. A foundational migration unit may be verified at its own boundary before the complete user-facing workflow is available; state that limit explicitly.

## Handling Missing Requirements

- Investigate repository facts before asking the user. Read relevant code, configuration, tests and documentation rather than asking for information already available there.
- Ask with a recommended answer when uncertainty changes feature scope, access rights, workflow, financial rules, data handling or another consequential product decision.
- Resolve routine implementation details using existing conventions and judgment within the authorized scope.
- Continue independent work while a decision is pending; wait for the answer before implementing behavior that depends on it.
- Record agreed requirement changes in the relevant context document before implementing the affected behavior. Treat unconfirmed company accounting rules as open questions rather than established policy.

## Protected Files

- Manage third-party dependencies through the package manager and update the corresponding lockfile when dependencies change. Keep library internals in `node_modules/` untouched.
- Generate build artifacts and derived files through their owning tools rather than hand-editing `.next/`, build outputs or generated Next.js type files.
- Preserve the managed Next.js block in `AGENTS.md`. Put project-specific instructions outside its markers.
- Change private configuration and company branding, fonts or document templates only when the authorized task requires it. Keep secret values out of source control, documentation and verification output; use `.env.example` for configuration guidance.
- Treat maintained source code, custom UI components, tests and verification scripts as editable within the task's scope. Their folder names do not make them generated or protected assets.

## Keeping Docs in Sync

Before completing a task, explicitly review its documentation impact. Update affected documents in the same change; keep unaffected documents unchanged. In the completion report, identify which documents were updated or briefly explain why no documentation update was necessary.

Update the relevant document in the same change when agreed behavior or implementation decisions change:

- Product goals, feature scope, user responsibilities or core workflows belong in the [project overview](project-overview.md).
- System boundaries, storage, authentication/access and invariants belong in [architecture context](architecture.md).
- Implementation conventions and code-quality expectations belong in [code standards](code-standards.md).
- Ordered milestones, completion conditions and checked status belong in the [production checklist](checklist.md).
- Development process and verification expectations belong in this document; update other relevant maintained documentation when its claims would otherwise become inaccurate.

Document both the target and remaining implementation gaps accurately. A completed unit does not establish that the entire production migration is complete.

Maintain the five core context documents and production checklist. Architecture owns system decisions. The checklist owns milestone completion. The tracker owns the unit sequence, current acceptance criteria, authorization, blockers, next actions and verification evidence. Link to the owning document for each decision or result. Additional milestone companions require an agreed documentation scope. Retire completed companions after preserving their durable contracts and evidence.

Update the [progress tracker](progress-tracker.md) after each meaningful implementation or documentation change and consequential decision. Record completed units, actual work in progress, next units, open questions and verification evidence. Distinguish local completion from publication and production readiness; planned work is not work in progress. Keep one concise final entry per completed unit: date, source revision, outcome, final evidence links and acceptance boundary. Replace superseded status instead of appending transcripts. Preserve lasting decisions in their owning document; delete recoverable intermediate history rather than creating routine archive documents. Never discard unique uncommitted requirements or evidence.

For milestone checkpoints, name the active or next unit, its remaining dependency or blocker and the exact next action in the tracker. Record completion only after its agreed verification passes, and link to the evidence. Other documents link to the tracker rather than repeating acceptance logs. Documentation edits update only affected claims; they do not require touching every core file.

When milestone progress changes, update the checklist and the tracker's current state in the same change. Check a step only after its completion condition passes, with a completion date and brief evidence note; keep detailed verification and blockers in the tracker. Add future steps when agreed rather than maintaining a second milestone table here or in the tracker.

## Before Moving to the Next Unit

1. Verify the unit's intended behavior within its defined boundary, including relevant failure paths. State any remaining dependency on later units.
2. Check the architecture invariants and advance the agreed target without introducing new violations. Keep existing production gaps visible; changes to the target require an agreed decision.
3. Run focused checks while iterating. Add or update tests when they protect meaningful behavior or a regression. When a code change is complete, run `npm run verify`, which includes lint, type generation, type checking, unit/API tests and the production build. Run focused `npm run verify:browser -- <suite names>` checks when UI behavior changes.
4. For documentation-only changes, check headings, links, formatting and consistency with the relevant specifications. Application tests and builds are not required solely for prose changes.
5. Complete the documentation-impact review described above and update the tracker after meaningful changes or decisions. Report what changed, which documents were updated (or why none needed changes), which checks ran, their results and any remaining blockers, without claiming unrun or incomplete checks passed.

Use the repository's isolated verification paths by default. Run live integration checks only when the user's authorization covers their provider usage and external effects. Preserve existing company data, confine test data and cleanup to the run's own resources, and report cleanup failures. Full milestone acceptance remains required. Broaden or repeat verification only when relevant changes, failures or unresolved concerns justify it. Reuse existing evidence only when the owning runner confirms matching source/migration scope and completeness; never relabel stale, failed or unrun checks as passes. Documentation-only changes do not invalidate unchanged implementation evidence.

### Verification Profiles

The executable [acceptance scenario mapping](../scripts/helpers/foundation-acceptance.mjs) and [acceptance runner](../scripts/verify-foundation-acceptance.mjs) own the required scenarios and evidence. Completed unit outcomes and evidence links are in the [tracker](progress-tracker.md#completed).

| Profile | Boundary and additional acceptance |
| --- | --- |
| MRF drafts/documents/review (4.1–4.3) | Shared drafts/numbering, current access and lifecycle, immutable approval/archive pairs, corrections, conflicts and recovery. Retain QA records/files. |
| Suppliers (4.4) | Maintenance, non-Site reads/Site denial, status/history, duplicates and conflicts. |
| Quotation capture/finalization (4.5a/b) | Exact confirmed-company calculations, source-bound review, originals, immutable revisions, applicability/activation and archives. Keep each unit's three human groups separate. |
| Internal demand/stock (4.6/4.7) | Exact claims/ledger/reservations, atomic conversions, source deduplication and contention at both isolation levels. Scoped demand/stock acceptance requires local/four-job CI/full disposable/types/staging evidence; no new staff/provider attestation. Preserve inherited provenance; later owning workflows need their own acceptance, including the 4.14 source-review adapter. |
| Purchasing/Accounting (4.8/4.9) | Exact partial orders, demand ownership, comparisons/PDF/XLSX, immutable approvals, preparer/submitter exclusions, gross commitments, terms and applicability. Three new human groups per unit. |
| Supplier issuance (4.10) | Exact live-file preparation, time/Credit bounds, permanent sending locks, colleague handoff, corrections and recovery. Three new human groups. |
| Payments/clearance (4.11) | Exact installments/proportional spending, no-cash/reversals, identity separation, proof/replacement/duplicates, recovery and non-reviving clearance. Three new human groups; dispatch remains 4.12. |
| Purchased dispatch (4.12) | Exact shared PO-line delivery capacity, retained reservations/cancellation/history, atomic current clearance, bounded departure times, operational Site projections and lost-response recovery. Three new human groups; receiving/forwarding/stock remain 4.13. |

Each staff unit retains its required real-session application/Realtime/Workflow/private-document/access checks, observed-lock races at both isolation levels, desktop/mobile and document inspection where applicable, standard/four-job/disposable/types, scoped live-Drive and retained-state-safe staging checks, and explicit new human acceptance. Earlier attestations keep their dates/provenance and cannot substitute for new behavior. Whole-milestone acceptance remains stricter than internal-demand/stock profiles. Keep the scenario mapping current when behavior changes; passing legacy prototype tests is not current acceptance.

Before applying migrations to staging, download passing `database-ci.json` evidence into ignored `.verification/`; the staging tool verifies the exact migration hash and successful type check. Hosted application never resets staging. Both hosted read-only catalog introspection and disposable CI use pinned `@supabase/postgrest-typegen` 0.6.0 rather than mixing generator versions. Keep generated types consistent with the committed file. Auth configuration keeps root public signup disabled while the email provider remains enabled for existing-user sign-in; invitation/recovery email delivery remains separately gated.

- **Standard code checks:** `npm run verify` checks the active toolchain, then produces lint, type generation, TypeScript, unit/API and build logs plus a summary under ignored `.verification/`. Keep Node 26.12.1 locally and npm 11.20.0 as declared in the package metadata; production targets Node 24.x, with 24.22.1 as the CI baseline. Later stable releases within the declared engine ranges are accepted. `npm ci` also checks the toolchain. Vercel installation and `npm run build:deployment` require Node 24 explicitly; the latter intentionally fails on local Node 26.
- **Foundation acceptance evidence:** standard, public-browser, disposable-database and authenticated-browser reports carry the tested implementation revision, full checkout revision, normalized source digest, migration digest and runtime environment. The implementation revision is the most recent commit affecting the hashed source/configuration paths; documentation-only checkpoints retain that revision. `npm run verify:foundation -- local|standard|database|milestone` requires the relevant complete reports from that implementation; partial, failed or stale reports cannot pass. Standard CI retains its four-job matrix; authenticated browser/SQL/Realtime acceptance remains in disposable Ubuntu/Node 24 CI. Whole-milestone evidence additionally requires staging parity and explicit user confirmation of targeted manual review when behavior changes. Generated reports stay ignored; the tracker records dated outcomes and links.
- **Browser checks:** `npm run verify:browser` starts an isolated production server with live credentials disabled and runs the maintained suites. The unit 3.2 foundation checks use a shared Windows Edge/Linux Chrome launcher; real-account checks run against disposable Supabase CI. Select suites when appropriate. Hosted CI (`CI=true`) runs browser suites serially to bound competing Edge workloads; local runs retain two workers. The selected worker count is recorded in the browser summary. CI is configured for standard checks and the existing high-severity dependency audit on Linux/Windows with both Node baselines; both Windows jobs additionally run the full browser suite. Pull requests, pushes to `main`/`staging` and manual dispatch trigger the workflow, with separate artifacts per OS/runtime. Verify hosted results rather than assuming local success proves CI or deployment success.
- **Live integrations:** Required MRF documents use `npm run test:drive` within authorized live integration work and the explicit staging/server configuration in [architecture context](architecture.md#google-drive-and-ai-configuration). This gateway smoke creates a unique owned child under the configured root, uploads a synthetic PDF and verifies identity, exact bytes/hash, readable PDF and streaming/Range behavior. Ownership-checked cleanup trashes only that smoke folder and verifies its state; failures fail the command and retain the ownership journal for follow-up. It creates no retained MRF references. Manual QA MRFs and their files stay together and are excluded from smoke cleanup. The prototype-wide `npm run test:live` includes unmigrated AI/provider routes and is not current acceptance evidence; restore that broader profile with the relevant later workflows.

Disposable Supabase CI runs on Ubuntu/Node 24. The database workflow runs migration replay, rollback SQL checks, observed-lock concurrency cases, real Auth/PostgREST, Mailpit/account-flow browser checks, Realtime checks and generated-type consistency. It requires no hosted credentials and cleans only its own stack/network. Local development uses hosted staging without requiring Docker. Automated Auth/Data/Realtime endpoints must be validated loopback services before building test bundles; Node-fetch isolation alone does not isolate browser HTTP or WebSocket traffic. Hosted staging checks explicitly validate their target and preserve retained state; production is excluded. Port supported screen checks as each workflow migrates, and record deferred suites, reasons and restoration milestones in the tracker. Deferred cases and historical prototype passes are not current acceptance evidence.

The required document gateway result is recorded in ignored `.verification/document-drive-live.json` (historical prototype-wide results use `.verification/live.json`); browser results are under `.verification/browser/`. Logs are local evidence and may not exist in another checkout. Keep dated, scoped outcomes in the tracker, without credentials, raw provider responses or company documents. A live pass verifies the credentials and permissions used at that time, not future availability or readiness for company operations.

Browser checks set explicit focus and normal-motion defaults; accessibility cases separately exercise reduced motion. Wait for animated loading visuals to reach their asserted state within a bounded timeout; a fixed Node timer does not prove that the browser's animation clock has advanced. When a full navigation is required, wait for the new document and the relevant page content instead of accepting an existing heading or URL change as readiness. All maintained suites use the shared `browserCallTimeout` helper for the bounded full-navigation allowance while retaining their existing ordinary-call limits, content assertions and overall suite deadlines. Keep permission, session-reset and storage-failure assertions strict, and check the settled destination after account switching. Ticket-tampering tests must change actual decoded bytes rather than replacing a character with a value it may already contain.
