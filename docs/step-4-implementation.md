# Step 4 Implementation Guide

Agreed 2026-11-03. This active companion owns the operational migration sequence, unit scope and completion criteria. The [progress tracker](progress-tracker.md#current-goal) owns current work, blockers, next actions and verification evidence. The [production checklist](checklist.md) owns milestone completion.

## Purpose and Resume Procedure

Read the five core documents required by [AGENTS.md](../AGENTS.md), the checklist and this guide before planning, implementing, reviewing or resuming step 4.

1. Reconcile Git status, the tracker and the actual implementation. Preserve unrelated pending work and the completed foundation planning retirement.
2. Check the user's latest instruction before starting a unit. **The user finalized the 4.5a interview plan and authorized implementation on 2026-11-04. Financial finalization (4.5b), later units, merging and production remain separate.**
3. Use the sequence below as the roadmap. Units 4.1-4.3 have detailed scopes; later units require scoped planning and acceptance criteria before implementation.
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
| **4.2 Required MRF documents** | [x] | Protected supporting-PDF handling, required project-folder operations and retryable archive processing for migrated MRFs. |
| **4.3 MRF submission and review** | [x] | Submission, PM approval/return/rejection, corrections and permanent-identity self-approval prevention; requires verified document gates from 4.2. |
| **4.4 Supplier directory** | [x] | Completed 2026-11-04 at `480311b`: shared records/maintenance pass automated, staging, all three manual groups and combined acceptance. |
| **4.5 Manual quotations** | [ ] | Split into 4.5a capture/source review/originals and 4.5b policy-dependent financial finalization/formal business revisions. Parent remains open until both pass. |
| **4.5a Capture and originals** | [x] | Completed 2026-11-05 at `26305c3`: automated/staging checks, all three explicit manual confirmations and source-bound combined acceptance pass. |
| **4.5b Financial finalization** | [ ] | Requires applicable company-policy decisions before calculations, finalization and immutable business revisions; not authorized by 4.5a. |
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

### 4.2 Targeted Manual Review

Automated local/CI/disposable/real-Drive/staging checks pass at implementation `664053a`; detailed evidence is in the tracker. The staging migration is applied and retained rows are preserved. After resolving local APP_ORIGIN configuration, the user explicitly confirmed **All three passed**. The original pending response remains historical in the tracker. Source-bound combined acceptance passed on 2026-11-03; 4.2 is complete.

Use the retained QA project and two currently assigned Site accounts, restoring an assignment through Administrator screens if the earlier revocation check removed it. Save manual QA MRFs and keep their Drive files with their records; smoke-test cleanup never touches them. Use `http://127.0.0.1:3000` for the local app. Existing projects require explicit folder setup under **Projects → project detail → Document folder**.

1. **Project document folders (`project-document-folders`):** as Administrator/PM, set up the existing QA project's folder; also verify a new QA project creates its folder automatically. Confirm visible status/retry and valid existing-folder linking. Root/outside-root/another-project destinations must be rejected. If changing a mapping after files exist, old files must remain available while new file operations use the new destination.
2. **Shared files (`mrf-document-sharing`):** as Site A, save an MRF and upload one valid supporting PDF. As Site B in another session, preview/download that same file. Keep unsaved Details/Materials open while uploading, replacing or removing files and verify the text is retained. Select a replacement in B, then change the attachment in A; B must review the current attachment before replacing it.
3. **Recovery and access (`mrf-document-recovery`):** use a PDF larger than 3 MiB, interrupt/reload during upload, then reselect the matching file and resume. A different file must be rejected. A corrupt/encrypted replacement must leave the previous current file intact. Check the applicable file/folder retry controls; assignment/session revocation must deny further protected file reads/actions. Preserve the retained QA records and files afterward.

Record actual results after the user confirms them. Generated approved MRFs/archive pairs are tested internally; official approval and its archive trigger remain unavailable until 4.3.

## 4.3 MRF Submission and Review — Complete

Implementation `36a4857` passes local, four-job CI, disposable integration, real-Drive and staging parity checks. The reviewed migration is applied to staging with retained data preserved. The user explicitly confirmed all three manual groups passed on 2026-11-04; source-bound combined acceptance passes and 4.3 is complete. Keep the editor layout redesign in step 6. Add atomic Save and submit on saved numbered MRFs, checking header and attachment versions; require complete requirements, funded scope and a validated PDF, with unfinished uploads completed or explicitly cancelled. Freeze project/form labels and source identity at submission. Submitted fields/files lock; no withdrawal. Preserve dirty collaborator input but require conflict review after a return. Saving returned edits retains Returned.

Any assigned Site user may resubmit. Record each permanent submitter and block every historical submitter from approval after any role change; authorized PM return/rejection remains allowed. PM reviews exact submissions; reasons require five trimmed characters. Initial rejection is terminal. Add register filters and compact detail timeline.

Approval atomically records decision, immutable snapshot and archive intent. Expose pending/failed/completed archive status, PM retry and protected access to every approved PDF pair. Current approved archive completion gates procurement readiness. Procurement alone reopens archived approved MRFs with a reason. Full corrections are permitted before authoritative downstream references; afterward only supporting-PDF corrections. Later quotation/PO/transfer writers must register references transactionally. Corrections allow PM approval/return, without rejection/cancellation; preserve prior versions and pause procurement. Document-only corrections preserve approved form/scope and retain the funded-scope exception.

Gate saves and every attachment-changing/background acknowledgement path by lifecycle; obsolete cleanup cannot block submission. Preserve current authorization, lock ordering, expected versions, retry receipts, atomic audit and private realtime. Verify actual approval-to-archive execution, all submitter identities, competing decisions, funding/upload/revocation races, corrections and private historical retrieval. Complete local, four-job CI, disposable SQL/Auth/browser/Realtime/Workflow/race/type, isolated real-Drive and staging-preservation checks, then targeted human acceptance before checking 4.3. No later workflow, merge or production authorization is inferred.

### 4.3 Targeted Manual Review

The earlier **Not tested yet** response on 2026-11-03 is superseded by the user’s explicit **All three groups passed** confirmation on 2026-11-04. All three checks below are accepted, with inherited 4.1/4.2/recovery provenance preserved. Combined acceptance passes at implementation `36a4857`. Use the retained QA project, assigned Site accounts and separate PM/Procurement sessions. Preserve saved MRFs and all their files. Local review uses `http://127.0.0.1:3000` with the full absolute `APP_ORIGIN=http://127.0.0.1:3000`; restart development after environment changes.

1. **Submission/review (`mrf-submission-review`):** save a complete MRF with a funded scope and verified PDF. Confirm incomplete requirements or unfinished uploads prevent submission. Keep unsaved text in a second Site editor, submit from the first, and confirm the second retains its text but cannot save. As PM return with a reason; reconcile and resubmit as assigned Site staff. Saving returned work must retain Returned. Reject a separate submitted QA MRF and confirm it cannot be edited or reopened.
2. **Approved archives (`mrf-approved-archives`):** as a different PM, approve a submitted MRF. Confirm approval is visible while archiving remains pending; after completion, preview/download both the approved company form and supporting PDF. Verify visible failure/retry if encountered, and confirm Site cannot perform PM archive retries. The generated form must match the submitted project labels.
3. **Corrections/history (`mrf-corrections-history`):** as Procurement reopen a fully archived approval with a reason. Confirm assigned Site staff can prepare a full correction, procurement readiness pauses, and PM can return or approve the correction without rejecting it. After reapproval/archive completion, both earlier and current approved document versions and the complete actor/reason timeline remain available. Automated disposable fixtures additionally cover document-only restrictions after downstream references and every submitter's self-approval restriction after role changes; these are not claimed as human tests.

## 4.4 Supplier Directory — Complete

**Authorized 2026-11-04:** the user confirmed the complete interview scope and requested implementation. Procurement alone maintains one company-wide supplier record per business; all non-Site roles read profiles/history. Site Personnel have no supplier access. Preserve existing styling and project-style register/detail routes with add/edit dialogs.

- Require name only. Address, TIN, contact person, email, phone and informational accreditation note are optional. Validate supplied email syntax; phone/TIN remain text without verification or financial interpretation.
- Names are unique across active/inactive suppliers after trimming, collapsing whitespace and ignoring case. Duplicate feedback links to the existing record. No deletion, merging, bank details, imports, uploads or accreditation approval workflow.
- New suppliers start active; Procurement can edit inactive profiles. Deactivate/reactivate requires at least five trimmed characters of reason. Later writers must disallow new inactive supplier selections while preserving existing linked work and frozen quotation/PO details.
- Search the register, default its Active/Inactive/All filter to Active, and order alphabetically. Show the latest 30 relevant changes with permanent actor identity, frozen name/role/time, field differences and status reasons; retain the full protected audit.
- Use grouped domain/server/feature modules, service-only checked RPCs, transactional records/audits/retry receipts, opaque expected versions and no-op saves. Reuse exact-session private realtime and authorized refetches; preserve filters/dirty input, require repeated conflict review, and clear protected state on confirmed access loss.
- Keep quotation counts/history and all purchasing workflows unavailable until their corresponding units. No prototype-data import.

**Done when:** focused unit/API, rollback SQL, observed-lock duplicate/edit/status/retry races and real-account browser/Realtime/access checks pass alongside local standard/public-browser, four-job CI, full disposable integration and retained-state-safe staging parity. Generated types must match the owning generator. Obtain the three manual confirmations below before checking 4.4. Earlier attestations retain their original dates/provenance. Supplier-only work does not require repeating live Drive smoke absent integration changes.

### 4.4 Targeted Manual Review — Complete

Automated local/four-job CI/disposable/staging checks pass at `480311b`; the migration is applied with retained state preserved. The earlier **Not tested yet** response is superseded by explicit **All three passed** confirmation on 2026-11-04. All three groups below are accepted and source-bound combined acceptance passes. Unit 4.4 is complete. Earlier MRF/recovery attestations retain their original dates/provenance. Unit 4.5 requires separate scoped planning and implementation authorization.

Use retained QA records and separately provisioned Procurement/read-only accounts; do not reset staging or repurpose retained identities. Suppliers have no deletion, so manually saved QA records and their audits remain retained.

1. **Sharing/permissions (`supplier-sharing-permissions`):** create a name-only supplier as Procurement; reopen it in another session, search it and review its optional fields. A non-Site reader sees details/history without maintenance controls; Site cannot access supplier data.
2. **Conflict recovery (`supplier-conflict-recovery`):** edit the same supplier in two Procurement sessions. Save in one while the other retains unsaved input; verify saved differences and explicit review before replacement. Repeat an intervening change. Verify access revocation denies reads/saves and clears protected input.
3. **Status/history (`supplier-status-history`):** deactivate with a reason; verify the default active register excludes it and the inactive filter finds it. A duplicate name remains blocked with an existing-record link. Edit/reactivate it and verify reasons, actor/role/time and field differences remain visible.

## 4.5a Manual Quotation Capture and Originals - Complete

Authorized 2026-11-04 after the user locked all interview decisions. Overall 4.5 stays open; 4.5b requires applicable company-policy confirmation before financial calculations/finalization and formal business revisions. AI remains step 5; comparisons, awards and POs remain later units.

Completed 2026-11-05 at implementation `26305c3`. Automated local/four-job CI/disposable/live-Drive/staging checks pass; the user explicitly confirmed all three targeted manual groups passed without skips, and matching combined acceptance passes. Detailed evidence is in the tracker.

- Procurement alone maintains drafts/files and retries jobs. All non-Site roles read quotations/originals/history; Site is denied. Create only from a currently approved, fully archived MRF and active supplier. First save fixes both identities and permanently registers the downstream MRF reference, including when later cancelled.
- One active draft per MRF/supplier. Require only those identities for first save; allow incomplete source fields, no lines and no files. Explicit Save, stable row identities, safe retries, no-op saves, immutable audits and repeated conflict review preserve input. Cancel/reopen with a reason of at least five trimmed characters; retain history and current files. Existing work may continue after supplier deactivation.
- Capture full supplier/header/terms, offered lines, matches/conversions, printed amounts and source tax/discount/charge fields as exact decimal strings; blank is distinct from zero. Preserve signed financial values, nonnegative quantities and positive conversion factors. No rounding, formulas, default VAT/rate/currency, financial approval or normalized generated quotation PDF. Quote details never update supplier master data.
- Source-check attestation plus line-match confirmations bind saved content/file versions. Require verified originals and no unfinished group change for checking. Content edits expire the quote check; changed lines/files expire relevant matches. Drafts remain editable; reviewed does not mean finalized.
- Originals support readable unencrypted PDF and decodable JPEG/PNG/WebP, up to 12 files, 20 MiB each and 45 MiB total. Atomic group changes retain previous originals until all selected changes validate. File saves/progress are independent of text. Reuse protected chunk/hash/provider/Range/Workflow foundations with explicit quotation metadata and MIME-aware validation.
- Resume after matching local-file reselection; retain frozen destinations and durable jobs. Recheck authority and MRF eligibility; pause writes during correction/revocation. Clean obsolete draft bytes only after current/candidate/protected reference checks; retain metadata. Current files on cancelled drafts remain retained. Future 4.5b must transactionally protect finalized file references before enabling finalization.
- Preserve worksheet structure with focused authoritative modules; no prototype dispatcher, Number-based financial helpers or unsupported workflow tabs. Missing suppliers open the directory in another tab; refresh options without replacing input.

**Done when:** local, four-job CI, disposable SQL/Auth/browser/Realtime/type/race, scoped live-Drive and retained-state-safe staging checks pass, then explicit human confirmation of shared capture/access, source review/conflicts, and originals/recovery/cancellation. Unit 4.5a meets these criteria on 2026-11-05; parent 4.5 remains unchecked until 4.5b also passes. Current evidence/blockers belong in the tracker.

### 4.5a Targeted Manual Review - Complete

All three groups below are accepted after the user's explicit **All three passed** confirmation on 2026-11-05, with no skipped checks. This supersedes the earlier **Not tested yet** response. Source-bound combined acceptance passes at `26305c3`; earlier units retain their own attestation dates and provenance. The steps remain below for reference.

1. **Capture and access:** Procurement opens an approved archived MRF, creates a draft from an active supplier and saves incomplete and full source data. Refresh and another permitted session show the same values, including exact decimals, blank/zero and quoted supplier details. Non-Site readers cannot edit; Site cannot open quotations or originals. Verify the first-save warning and permanent document-only MRF correction restriction.
2. **Source review and conflicts:** Attach originals, save material links/conversions and explicitly confirm matches and the overall source check. Change headers, lines and originals and verify the corresponding checks expire. Use two Procurement sessions for repeated conflicting edits; review the latest values while preserving input. Change access during editing and confirm writes stop.
3. **Originals and recovery:** Save PDF/image groups, preview/download them, replace/remove files and verify the previous group remains until every new file validates. Interrupt and reload an upload, reselect matching local files and resume; exercise invalid-file/job recovery. Cancel/reopen with reasons, confirm one active draft per supplier, retained current originals and readable history. Existing work remains editable after supplier deactivation.

## Milestone Completion and Documentation Ownership

Keep permanent product responsibilities in the [overview](project-overview.md), system contracts in [architecture](architecture.md), conventions in [code standards](code-standards.md) and execution/verification policy in [workflow rules](ai-workflow-rules.md). Keep current work, dependencies, dated evidence and deferred-suite restoration in the tracker rather than duplicating logs here.

Check checklist step 4 only after all required operational units and whole-operational acceptance pass. Captured email, foundation acceptance or a documentation checkpoint does not establish production readiness. Optional AI/broader document work, styling conversion, company-owned services, verified real email and release rehearsal retain their agreed later boundaries.
