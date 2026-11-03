# Step 4 Implementation Guide

Agreed 2026-11-03. This active companion owns the operational migration sequence, unit scope and completion criteria. The [progress tracker](progress-tracker.md#current-goal) owns current work, blockers, next actions and verification evidence. The [production checklist](checklist.md) owns milestone completion.

## Purpose and Resume Procedure

Read the five core documents required by [AGENTS.md](../AGENTS.md), the checklist and this guide before planning, implementing, reviewing or resuming step 4.

1. Reconcile Git status, the tracker and the actual implementation. Preserve unrelated pending work and the completed foundation planning retirement.
2. Check the user's latest instruction before starting a unit. **Current authorization includes 4.2 implementation under the approved 2026-11-03 interview plan. Later units, merging and production remain separate.**
3. Use the sequence below as the roadmap. Units 4.1 and 4.2 have detailed scopes; later units require scoped planning and acceptance criteria before implementation.
4. Verify a unit within its boundary, record actual results in the tracker, then check its completion box. A documentation checkpoint does not complete an operational workflow or checklist step 4.
5. Retire this companion after the milestone is complete, preserving durable contracts in the core documents and completion evidence in the tracker.

## Agreed Boundary

Step 4 migrates operational workflows to shared authoritative records. Each implementation unit includes current authorization, transactional changes, safe retries, immutable audit attribution, private realtime refreshes, the supported UI and its verification. Realtime/security/testing are part of each unit rather than deferred to final acceptance.

- Preserve the verified account/project foundation, current styling and intended workflows. Keep useful prototype rules and isolated fixtures; browser snapshots and the global demo dispatcher do not establish authority.
- Bring protected upload/archive capabilities forward with the workflows that require them. This includes required project-folder operations and retryable processing. Optional AI and broader document capabilities remain in step 5; Tailwind remains step 6 and release rehearsal remains step 7.
- Never fabricate an archived state or bypass a required document gate. Unsupported dependent actions stay explicitly unavailable until their prerequisites are verified.
- Establish one shared demand-allocation contract for purchases, suitability holds and transfers, and one stock ledger/reservation contract for transfers and usage, before enabling competing writes.
- Company VAT, adjustment, rounding, budget-charging and correction policy remains subject to the [open decisions](progress-tracker.md#company-accounting-policy). Confirm applicable policy before enabling dependent financial calculations, quotation finalization or approvals. Prototype formulas are not company approval; early MRF work can proceed independently.
- Retain role-safe reads, permanent actor identity, expected versions, stable retry identities, atomic audit/state changes and draft-preserving conflicts from the [architecture](architecture.md). Permanent submitter identity, rather than a printed name or active role, governs later self-approval prevention.

## Ordered Roadmap

The listed order is the default. Record any agreed scope/order revision here and its reason in the tracker before implementing it. Every later unit needs a detailed scope before starting; the summaries below do not authorize implementing all of step 4 at once.

| Unit | Verified | Outcome and key prerequisite |
| --- | --- | --- |
| **4.0 Record the plan** | [x] | Record this roadmap, the 4.1 specification, ownership/reading pointers and the current stop before implementation. |
| **4.1 Shared MRF drafts** | [x] | Restore register, draft editor and detail views with authoritative storage and transactional numbering; depends on the completed foundation and 4.0. |
| **4.2 Required MRF documents** | [ ] | Protected supporting-PDF handling, required project-folder operations and retryable archive processing for migrated MRFs. |
| **4.3 MRF submission and review** | [ ] | Submission, PM approval/return/rejection, corrections and permanent-identity self-approval prevention; requires verified document gates from 4.2. |
| **4.4 Supplier directory** | [ ] | Shared supplier records and authorized maintenance. |
| **4.5 Manual quotations** | [ ] | Capture, review, version and archive supplier quotations; financial finalization requires applicable policy confirmation and supplier-original archives. |
| **4.6 Shared demand allocation** | [ ] | One authoritative demand limit shared by purchases, suitability holds and transfer allocations; based on approved MRF requirements. |
| **4.7 Stock ledger and reservations** | [ ] | Shared stock availability and reservation rules before enabling competing inventory consumers. |
| **4.8 Awards and PO drafts** | [ ] | Supplier awards, split purchasing and PO preparation using verified quotation archives and the shared demand rules. |
| **4.9 Accounting approval and commitments** | [ ] | PO review/returns, payment terms and transactional budget commitments under confirmed company policy. |
| **4.10 Supplier issuance** | [ ] | Protected issuance after approval and completion of the required MRF/PO archives. |
| **4.11 Payment coordination and verification** | [ ] | Finance coordination, Accounting proof-backed verification, credit balances and delivery clearance; retain these as separate milestones. |
| **4.12 Purchased delivery dispatch** | [ ] | Supplier/site/warehouse delivery planning, scheduling and dispatch under the applicable clearance rules. |
| **4.13 Purchased receiving and stock posting** | [ ] | Partial receiving, shortages/damage, required evidence, warehouse forwarding and exactly-once stock posting using 4.7. |
| **4.14 Transfer approval and reservation** | [ ] | Matching, suitability review, source approval and reservation using 4.6/4.7; no supplier payment or budget charge. |
| **4.15 Transfer trips and dispatch** | [ ] | Trip planning, partial dispatch and exactly-once source-stock debit after source approval. |
| **4.16 Transfer receiving and posting** | [ ] | Destination receiving, evidence, shortages and exactly-once destination-stock credit. |
| **4.17 Usage and stock corrections** | [ ] | Immutable usage entries and authorized adjustments respecting reservations, reasons and history. |
| **4.18 Operational monitoring** | [ ] | Lifecycle views, departmental actions, dashboards, consumption reconciliation and reports from the migrated authoritative records. |
| **4.19 Operational acceptance** | [ ] | Cross-workflow/concurrency/recovery/confidentiality checks, retirement of migrated prototype authority and restoration of applicable deferred coverage. |

## 4.0 Record the Plan

**Scope:** documentation only. Create this active guide, synchronize affected core documents/checklist/README/agent pointers, preserve the completed step 3 guide retirement and record the user's instruction to defer 4.1. No application, schema, dependency, CI or provider changes belong to this checkpoint.

**Done when:** documentation links/anchors, formatting, scope consistency and whitespace pass; the managed Next.js block remains unchanged; step 3 stays checked; step 4 and every operational unit remain unchecked. Record verification in the tracker before checking 4.0.

Completed 2026-11-03: documentation verification passed and evidence is recorded in the tracker. At that checkpoint 4.1 was deferred; the subsequent implementation authorization supersedes that stop.

## 4.1 Shared MRF Drafts — Complete

**User outcome:** assigned Site Personnel can create, save, reopen and collaboratively edit shared MRF drafts across sessions and devices. Implementation was authorized on 2026-11-03 after the grilling interview. Verified complete on 2026-11-03 after all required automated and user-confirmed manual acceptance passed.

### Screens and Access

- Restore the request register, new-draft, detail and edit routes using the existing styling and draft fields. Retain search, filters and material-row interactions.
- Only Site Personnel currently assigned to the project may create/edit drafts. Drafts are project-shared, not creator-private. Other roles receive permitted read-only views; Site Personnel receive assigned-project data without financial fields.
- Preserve the absence of MRF deletion. Submission, approvals, files, AI and downstream operational panels remain explicitly unavailable until their respective units. Do not show invented zero balances or success states.

### Draft Data and Numbering

- Require a valid assigned project and configured document code. Scope is optional; a supplied scope must belong to that project. Drafts may lack submission-required general information, materials or documents, and may use a scope that is not yet funded. Validate supplied values without imposing submission completeness.
- Allocate `${projectCode}-MRF-${sequence}` on the first successful save, including Save draft. Pad to at least four digits, continue beyond four digits, never reset annually and never reuse issued numbers. Any editor preview is nonbinding.
- Allocate the number, lock the project code, save the draft/items, audit and store the retry outcome atomically. A failed transaction or logical retry must not consume another committed number. A saved numbered MRF cannot change projects.
- Retain stable material-row identities and verified creator/update attribution. Printed signatory fields grant no authority; later submission must capture its own permanent submitter identity separately from the creator/latest editor.
- Add database reference restrictions preventing deletion of projects/scopes referenced by MRFs, including drafts. Use lock ordering consistent with existing foundation commands; do not cascade away operational records.

### Interfaces, Persistence and Realtime

- Use grouped request domain/server/feature modules within the existing layers. Provide role-safe register/detail/editor queries and explicit create/save-draft commands; keep page/action adapters thin.
- Derive identity, active role, assignment and current authority on the server. Updates carry expected opaque versions; logical writes carry stable retry identities. Return the affected record/result rather than a global workspace snapshot. Unchanged saves skip record/audit effects.
- Extend the protected private invalidation/refetch mechanism to migrated request views. Preserve drafts and filters during refreshes, require explicit review before overwriting newer versions, and clear protected state after confirmed access loss.

### Acceptance and Rollout

- Verify draft permissiveness, role/project access, foreign-scope rejection, stable numbering, no-op saves, retries, immutable attribution and direct API/RPC denial.
- Verify simultaneous creation, competing edits, code changes and project/scope deletion races. Failed transactions must not advance committed numbering; retries must not duplicate records, numbers or audit effects.
- Exercise two-session realtime delivery, missed-event recovery, ordinary draft preservation, repeated conflict review and immediate denial after assignment/session revocation.
- Run local standard/public-browser checks, the existing four-job CI matrix and disposable SQL/Auth/browser integration checks. Keep synthetic audited workflows in disposable CI; hosted checks use rollback-only fixtures and preserve retained data.
- Apply the reviewed migration only to staging after matching CI evidence passes. Obtain targeted manual acceptance and record actual evidence before checking 4.1 complete. A future unit branch may be published for CI and handed off as a draft PR into staging; merging and production deployment remain separate actions.

**Done when:** independent authorized sessions share saved drafts; retries allocate no duplicate record, number or audit effect; conflicts preserve input; revocation immediately denies access; project/scope deletion races preserve integrity; required local/CI/staging/manual evidence passes.

Completing 4.1 does not make MRF submission, approval or procurement available. Detail 4.2 and subsequent units through their own scoped planning before implementation.

### 4.1 Interview Decisions (2026-11-03)

Retain the flexible Details / Materials / Review draft wizard and explicit Save draft, opening detail after success. Allow zero and partial material rows; supplied quantities are positive decimals, dates valid. New rows start blank; request date defaults to the Philippine date. Unsaved input remains only in the open editor, with leave-page warnings. Conflicts preserve input and require explicit review of saved differences before whole-draft replacement; another intervening save requires another review. Show creator/latest-editor attribution, not a history browser. Before first save show Assigned on save. Manual acceptance uses a retained staging QA project and two assigned Site test accounts; automated audited workflows remain disposable.

### Targeted Manual Review

Automated local, four-job standard CI, disposable SQL/Auth/browser/Realtime/type/concurrency checks and staging parity pass at `43f7f80`. The staging migration is applied and retained-state preservation is verified. The user explicitly confirmed that all three manual checks below passed. Source-bound combined acceptance passed on 2026-11-03; 4.1 is complete. Step 4 remains open.

Use a clearly named retained staging QA project (for example, `4.1 Manual QA`, code `QA-41`) and two separately provisioned Site Personnel accounts assigned to it. Configure these through the Administrator screens; do not repurpose the retained Administrator, impersonate its session or reset staging. Manually saved QA drafts and their audits remain retained because MRF deletion is unavailable.

1. As Site A, save an incomplete draft, including a partially filled material row. Reopen it in a separate session as Site B; verify the number, saved fields and creator/latest-editor attribution.
2. Open the same draft for editing in both sessions. Save in A while B has unsaved input. Verify B keeps its input, sees the saved differences and must review before saving. Repeat an intervening save to confirm review is required again.
3. As Administrator, remove B's assignment while its editor is open. Verify its protected state clears, saving is denied and a fresh sign-in cannot read that project's MRFs.

Completed 2026-11-03: explicit confirmation for `mrf-shared-drafts`, `mrf-conflict-review` and `mrf-revocation` is recorded in the source-bound manual evidence. The original foundation recovery attestation is preserved with its original date and provenance; its reviewed file hash remains byte-identical. The combined acceptance report passes. Detailed evidence is in the tracker.

## 4.2 Required MRF Documents

**User outcome:** authorized staff share a private supporting PDF on a saved numbered MRF, with visible upload/recovery state and protected preview/download. Build and verify the retryable archive foundation now; submission/approval and its official archive trigger remain unavailable until 4.3.

- Save the MRF first. File Upload/Replace/Remove actions save independently of Details/Materials. Keep a separate attachment revision; provider progress does not conflict with text edits. Keep the old current file until a replacement validates and commits. A late stale upload cannot overwrite a newer selection.
- Accept one structurally readable, unencrypted PDF up to **50 MiB**. Verify exact bytes/hash/size and provider identity before making it current; staff remain responsible for reviewing its contents. Preview the supporting PDF only through authorized private no-store streaming/Range routes. Never expose provider session URLs or use raw Drive IDs as authorization.
- Persist metadata history, upload sessions, operation receipts, folder mapping history and durable jobs in Postgres. Google Drive owns file bytes. Use raw approximately 3 MiB chunks, current record/session authorization on every operation, confirmed provider offsets and matching local-file reselection after reload; retain no browser file bytes.
- Automatically enqueue folder setup after a new project's first successful save; existing projects get explicit setup. Admin/PM can create/link/retry folders. Each project has its own writable descendant of the configured root, never the root itself or a folder already assigned to another project. Mapping changes affect future operations only; existing locations/running destinations stay frozen. Explicit failed-job retries may select the corrected mapping.
- Assigned Site Personnel retry draft file work; Admin/PM retry folder work. Preserve original actor identity and separately record retries. Pause when required current authority is revoked; ordinary logout does not cancel admitted background work.
- Retain all approved archive versions. Obsolete unapproved file bytes may be asynchronously trashed after reference checks; retain metadata. Cleanup failures are visible and cannot invalidate the current file. Never delete a broad folder or a file still referenced by a retained MRF/archive.
- Integrate a compatible pinned Workflow SDK with durable database intent before dispatch and reconciliation for uncertain starts. Keep payloads small and provider calls outside transactions. Stable IDs, claims and acknowledgement checks prevent duplicate files, jobs and effects across process restarts/lost responses.
- Archive from an immutable approved snapshot containing exact quantity strings, frozen project/request fields, source document hash/revision and verified approval attribution. Generate the company MRF and preserve the verified supporting PDF as a pair; mark complete only after both provider confirmations and atomic database acknowledgement. No public operation may manufacture an approval snapshot in 4.2.

**Verification:** cover file/header concurrency, cross-record access, revoked sessions/assignments, matching-file resume, corrupt/encrypted rejection, replacements/removal, expiry/restarts/lost acknowledgements, folder validation/remapping, role-specific retries, cleanup safety and archive pair integrity. Exercise the real Workflow runtime with disposable Supabase and loopback fake Drive; preserve browser HTTP/WebSocket/server isolation. Run standard local checks, the four-job CI matrix and disposable SQL/Auth/browser/type/race checks. Apply only reviewed CI-verified migrations to staging, preserving retained state. Run isolated owned real-Drive gateway smoke with verified cleanup; retain manual QA MRFs and their files together. Obtain targeted manual acceptance before checking 4.2. Company-owned service promotion and hosted release rehearsal remain later work.

## Milestone Completion and Documentation Ownership

Keep permanent product responsibilities in the [overview](project-overview.md), system contracts in [architecture](architecture.md), conventions in [code standards](code-standards.md) and execution/verification policy in [workflow rules](ai-workflow-rules.md). Keep current work, dependencies, dated evidence and deferred-suite restoration in the tracker rather than duplicating logs here.

Check checklist step 4 only after all required operational units and whole-operational acceptance pass. Captured email, foundation acceptance or a documentation checkpoint does not establish production readiness. Optional AI/broader document work, styling conversion, company-owned services, verified real email and release rehearsal retain their agreed later boundaries.
