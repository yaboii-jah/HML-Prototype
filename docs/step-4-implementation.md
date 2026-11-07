# Step 4 Implementation Guide

Agreed 2026-11-03. This active companion owns the operational migration sequence, unit scope and completion criteria. The [progress tracker](progress-tracker.md#current-goal) owns current work, blockers, next actions and verification evidence. The [production checklist](checklist.md) owns milestone completion.

## Purpose and Resume Procedure

Read the five core documents required by [AGENTS.md](../AGENTS.md), the checklist and this guide before planning, implementing, reviewing or resuming step 4.

1. Reconcile Git status, the tracker and the actual implementation. Preserve unrelated pending work and the completed foundation planning retirement.
2. Check the user's latest instruction before starting a unit. **Unit 4.8 is verified complete at `f1248bc` on 2026-11-07 after explicit confirmation of all three human groups with no skipped checks and passing combined acceptance. Unit 4.9 is verified complete at `e00f8fd` on 2026-11-08 after explicit acceptance of all three human groups including assisted checks and passing combined acceptance. Unit 4.10 is verified complete at `77e3965` on 2026-11-08. Unit 4.11 requires its own scoped planning and authorization; merge and production remain separate.**
3. Use the sequence below as the roadmap. Units through 4.10 have detailed scopes; later units require scoped planning and acceptance criteria before implementation.
4. Verify a unit within its boundary, record actual results in the tracker, then check its completion box. A documentation checkpoint does not complete an operational workflow or checklist step 4.
5. Retire this companion after the milestone is complete, preserving durable contracts in the core documents and completion evidence in the tracker.

## Agreed Boundary

Step 4 migrates operational workflows to shared authoritative records. Each implementation unit includes current authorization, transactional changes, safe retries, immutable audit attribution, private realtime refreshes, the supported UI and its verification. Realtime/security/testing are part of each unit rather than deferred to final acceptance.

- Preserve the verified account/project foundation, current styling and intended workflows. Keep useful prototype rules and isolated fixtures; browser snapshots and the global demo dispatcher do not establish authority.
- Bring protected upload/archive capabilities forward with the workflows that require them. This includes required project-folder operations and retryable processing. Optional AI and broader document capabilities remain in step 5; Tailwind remains step 6 and release rehearsal remains step 7.
- Never fabricate an archived state or bypass a required document gate. Unsupported dependent actions stay explicitly unavailable until their prerequisites are verified.
- Establish one shared demand-allocation contract for purchases, suitability holds and transfers, and one stock ledger/reservation contract for transfers and usage, before enabling competing writes.
- The quotation calculation baseline was explicitly confirmed for 4.5b on 2026-11-05, and partial-order preparation policy was confirmed for 4.8 on 2026-11-06. The gross-before-EWT budget charge and unissued-approval revocation policy were confirmed for 4.9 on 2026-11-07. Payment settlement and later correction policies remain subject to the [open decisions](progress-tracker.md#company-accounting-policy). Confirm applicable policy before enabling those dependent workflows; prototype formulas alone are not company approval.
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
| **4.5 Manual quotations** | [x] | Completed 2026-11-06: 4.5a capture/originals and 4.5b reviewed finalization/revisions both pass their automated, staging, explicit human and combined acceptance gates. |
| **4.5a Capture and originals** | [x] | Completed 2026-11-05 at `26305c3`: automated/staging checks, all three explicit manual confirmations and source-bound combined acceptance pass. |
| **4.5b Financial finalization** | [x] | Completed 2026-11-06 at `8b8f32a`: local/four-job CI/disposable/live-Drive/staging checks, all three manual groups with no skips and matching combined acceptance pass. |
| **4.6 Shared demand allocation** | [x] | Completed 2026-11-06 at `7e9b3a0`: private exact demand/claim contract passes local/four-job CI/full disposable/staging checks and scoped combined internal-demand acceptance. No staff allocation workflow is enabled. |
| **4.7 Stock ledger and reservations** | [x] | Completed 2026-11-06 at `e749844`: exact private project-stock ledger/reservations pass local/four-job CI/full disposable/types/staging and scoped combined internal-stock acceptance. No staff stock workflow is enabled. |
| **4.8 Awards and PO drafts** | [x] | Completed 2026-11-07 at `f1248bc`: automated/live-artifact/staging checks, all three explicit human groups with no skips and matching combined acceptance pass. |
| **4.9 Accounting approval and commitments** | [x] | Completed 2026-11-08 at `e00f8fd`: automated/live-Drive/staging checks, all three explicit human groups including assisted checks with no skips or issues, and matching combined acceptance pass. |
| **4.10 Supplier issuance** | [x] | Completed 2026-11-08 at `77e3965`: automated/staging/Drive, explicit three-group human and combined acceptance pass. |
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

Authorized 2026-11-04 after the user locked all interview decisions. Unit 4.5 was split so applicable company-policy confirmation preceded 4.5b financial calculations/finalization and formal business revisions. Parent completion is recorded with 4.5b below. AI remains step 5; comparisons, awards and POs remain later units.

Completed 2026-11-05 at implementation `26305c3`. Automated local/four-job CI/disposable/live-Drive/staging checks pass; the user explicitly confirmed all three targeted manual groups passed without skips, and matching combined acceptance passes. Detailed evidence is in the tracker.

- Procurement alone maintains drafts/files and retries jobs. All non-Site roles read quotations/originals/history; Site is denied. Create only from a currently approved, fully archived MRF and active supplier. First save fixes both identities and permanently registers the downstream MRF reference, including when later cancelled.
- One active draft per MRF/supplier. Require only those identities for first save; allow incomplete source fields, no lines and no files. Explicit Save, stable row identities, safe retries, no-op saves, immutable audits and repeated conflict review preserve input. Cancel/reopen with a reason of at least five trimmed characters; retain history and current files. Existing work may continue after supplier deactivation.
- Capture full supplier/header/terms, offered lines, matches/conversions, printed amounts and source tax/discount/charge fields as exact decimal strings; blank is distinct from zero. Preserve signed financial values, nonnegative quantities and positive conversion factors. No rounding, formulas, default VAT/rate/currency, financial approval or normalized generated quotation PDF. Quote details never update supplier master data.
- Source-check attestation plus line-match confirmations bind saved content/file versions. Require verified originals and no unfinished group change for checking. Content edits expire the quote check; changed lines/files expire relevant matches. Drafts remain editable; reviewed does not mean finalized.
- Originals support readable unencrypted PDF and decodable JPEG/PNG/WebP, up to 12 files, 20 MiB each and 45 MiB total. Atomic group changes retain previous originals until all selected changes validate. File saves/progress are independent of text. Reuse protected chunk/hash/provider/Range/Workflow foundations with explicit quotation metadata and MIME-aware validation.
- Resume after matching local-file reselection; retain frozen destinations and durable jobs. Recheck authority and MRF eligibility; pause writes during correction/revocation. Clean obsolete draft bytes only after current/candidate/protected reference checks; retain metadata. Current files on cancelled drafts remain retained. Unit 4.5b now transactionally protects finalized file references before enabling finalization.
- Preserve worksheet structure with focused authoritative modules; no prototype dispatcher, Number-based financial helpers or unsupported workflow tabs. Missing suppliers open the directory in another tab; refresh options without replacing input.

**Done when:** local, four-job CI, disposable SQL/Auth/browser/Realtime/type/race, scoped live-Drive and retained-state-safe staging checks pass, then explicit human confirmation of shared capture/access, source review/conflicts, and originals/recovery/cancellation. Unit 4.5a meets these criteria on 2026-11-05; parent 4.5 completion is recorded with the accepted 4.5b unit below. Current evidence/blockers belong in the tracker.

### 4.5a Targeted Manual Review - Complete
    
All three groups below are accepted after the user's explicit **All three passed** confirmation on 2026-11-05, with no skipped checks. This supersedes the earlier **Not tested yet** response. Source-bound combined acceptance passes at `26305c3`; earlier units retain their own attestation dates and provenance. The steps remain below for reference.

1. **Capture and access:** Procurement opens an approved archived MRF, creates a draft from an active supplier and saves incomplete and full source data. Refresh and another permitted session show the same values, including exact decimals, blank/zero and quoted supplier details. Non-Site readers cannot edit; Site cannot open quotations or originals. Verify the first-save warning and permanent document-only MRF correction restriction.
2. **Source review and conflicts:** Attach originals, save material links/conversions and explicitly confirm matches and the overall source check. Change headers, lines and originals and verify the corresponding checks expire. Use two Procurement sessions for repeated conflicting edits; review the latest values while preserving input. Change access during editing and confirm writes stop.
3. **Originals and recovery:** Save PDF/image groups, preview/download them, replace/remove files and verify the previous group remains until every new file validates. Interrupt and reload an upload, reselect matching local files and resume; exercise invalid-file/job recovery. Cancel/reopen with reasons, confirm one active draft per supplier, retained current originals and readable history. Existing work remains editable after supplier deactivation.

## 4.5b Financial Finalization and Revisions

**Completed 2026-11-06 at `8b8f32a`:** automated/staging verification, all three explicit human confirmations with no skipped checks and matching combined acceptance pass. Parent 4.5 is complete; checklist step 4 remains open for later units.

**Authorized 2026-11-05:** the user locked every interview decision and requested implementation. Existing quotation business formulas are confirmed for this unit; keep later partial-order, PO, budget-charging, settlement and correction policies separate. Procurement alone maintains financial review, finalizes, revises, withdraws, reconfirms MRF applicability and retries archives. All non-Site roles read; Site remains denied. Preserve the worksheet, styling, explicit saves and repeated conflict review.

### Reviewed Calculations and Readiness

- Preserve source fields and exact decimals. Normalize classifications separately; source amounts are corrected through source capture and renewed review. Use a shared pure exact decimal/rational engine for previews and server recomputation, half-up to cents at the existing calculation stages. Never use JavaScript financial numbers or silently fill VAT assumptions.
- Preserve one quotation-wide VAT/NON-VAT status, inclusive/exclusive basis and explicit rate; line discounts first; document percentages independently use the material subtotal after line discounts. Preserve existing adjustment taxability and automatic goods/services EWT bases. Document discounts do not reduce EWT bases; non-taxable services receive neither added VAT nor services EWT. Mixed material tax treatments/unsupported bases cannot finalize.
- Financial currency is fixed PHP without a selector/conversion. A silent source currency is allowed after explicit financial review; an explicitly foreign source requires a corrected supplier document. Preserve the captured currency text.
- Classify every source row as material, service/adjustment, duplicate summary or reference-only alternative. Preserve provenance and exclusion reasons; prevent duplicate VAT/charges. Unmatched extras may remain, but at least one current confirmed MRF match is required; unmatched/reference-only rows cannot support later awards. Free items require explicit source-bound confirmation, positive quantity and a recorded zero price; blank remains incomplete.
- Derive included VAT from the aggregate signed taxable contribution and round once; retain existing exclusive-VAT stages. Map printed amounts to their source-defined computation basis, including gross versus net. Compared amounts must match exactly at cents; notes do not override differences or authorize invented balancing adjustments.
- Require supplier reference, quotation date, payment and delivery terms, verified originals, current source/match checks and explicit financial confirmation. Validity date is optional and visibly unrecorded if absent. Require positive gross and EWT no greater than gross. Inactive suppliers or expired offers block finalization; use Philippine dates. Drafts remain editable.

### Revision and Archive Contract

- One family per MRF/supplier and one unfinished replacement, including a finalized archive candidate. Preserve existing draft/cancelled identities and history; create no invented finalized backfill. A new revision copies saved source and permitted same-family original references, requires a five-character reason and clears all source/match/financial confirmations. No file reparenting or provider ownership-tag rewriting.
- Finalization acts on saved expected source/file/financial/family versions. In one transaction it verifies current authority/readiness, assigns a permanent revision number, freezes source/normalized inputs/results/rule version, original identities/hashes, current approved MRF archive and verified actor, protects file membership, and writes archive intent/audit/retry outcome. Finalized source/files are immutable.
- Retain original bytes plus a generated, clearly labeled internal review PDF containing inputs, classification, breakdown, reconciliation, matches/conversions, source manifest and actor. Complete archives only after exact provider verification and database acknowledgement. Reuse durable intent, stable provider identities, claims and reconciliation; bytes/provider calls stay outside transactions and Workflow payloads. Destinations freeze; explicit retries retain attempt history and may adopt a corrected mapping.
- Keep lifecycle events and archive state separate from immutable financial snapshots. A completed, currently eligible candidate automatically becomes current; blocked candidates require an explicit Procurement recheck/activation. Preserve the earlier current revision if still usable until replacement passes every gate. Never choose current by maximum revision number or resurrect an older revision automatically.
- Withdrawal requires a reason and is permanent for that revision. Restoring an offer requires a new revision. Withdrawing a pending candidate releases the replacement slot, retains its snapshot/files and prevents late acknowledgement from activating it. Historical archive completion cannot grant eligibility after business gates change; access revocation still pauses admitted work.
- Reopening MRF documents pauses use. After the corrected MRF is reapproved/archived, Procurement reconfirms each applicable revision against the exact new MRF archive, with a retained audit/attestation separate from frozen financial data. Changed offers require a revision.
- Extend checked private records/RPCs and role-safe view types for financial reviews, families, immutable revisions/file membership, availability events and archive jobs. Extend protected retrieval to historical originals and review PDFs using opaque IDs, private/no-store streaming and Range handling. Keep current lock order, stable retries, atomic audits, private realtime and protected-state clearing.

### Verification and Acceptance

Cover company examples, all existing formula cases, exact ties/high precision, aggregate VAT, gross/net mapping, free/excluded rows, missing required terms, foreign source, expired/inactive offers and negative net. Cover duplicate finalization/revisions, stale reviews, activation/withdrawal/MRF/cleanup/file-acknowledgement/revocation races, immutable history and cross-family file denial. Exercise real application review/finalization/replacement/reconfirmation and actual Workflow archive/retry/history/Range paths with disposable accounts and fake Drive. Inspect desktop/mobile and multipage generated PDFs.

Run local standard/public-browser checks, four-job CI and full disposable SQL/Auth/browser/Realtime/Workflow/type/race acceptance. Apply only CI-verified migration SQL to staging with retained-state preservation, then scoped live-Drive and staging parity checks. No retained QA records/files are disposable. Record actual evidence in the tracker and extend scenario mapping without treating earlier attestations as new tests.

**Three human groups accepted:** (1) financial review/reconciliation/PHP/readiness; (2) immutable revisions/replacement/withdrawal/MRF reconfirmation/conflicts; (3) originals/internal PDF archives/history/recovery/access. All three were explicitly confirmed passed with no skipped checks on 2026-11-06. Matching combined acceptance passes; 4.5b and parent 4.5 are complete. Step 4 remains open for later units.

**Review status, 2026-11-06:** local/four-job CI/disposable/live-Drive/final staging checks pass at source `8b8f32a`, with retained staging state unchanged. The earlier **Not tested yet** response is superseded by explicit confirmation that all three new groups passed with no skipped checks. Matching combined acceptance passes. Earlier attestations retain their original dates and provenance. Detailed evidence is in the tracker; the review steps below remain for reference.

For the targeted review, open an approved archived MRF through **Material requests → Supplier quotations** with Procurement active. Retain the QA records and originals after review.

1. **Financial review:** save the supplier reference/date/payment/delivery terms and source amounts; classify rows and adjustments, PHP/VAT basis, free items and exclusions. Compare material amounts, adjustments, included/added VAT, goods/services EWT and net with the supplier figures. Confirm that a mismatch or missing required review blocks finalization; select gross or net according to the source, save and explicitly confirm the financial review, then finalize.
2. **Revisions and applicability:** verify finalized source/files remain read-only. Start a reasoned revision, renew cleared source/match/financial checks, and confirm the eligible predecessor stays current until replacement archiving completes. Check permanent withdrawal without predecessor restoration. After an MRF document correction is reapproved and archived, explicitly review and reconfirm applicability. In two Procurement sessions, review newer changes while preserving input/reasons before retrying.
3. **Archives and access:** preview/download retained originals and the internal review PDF; compare its inputs, totals, reconciliation and original-file manifest with the screen. Check readable attributed history and any available archive failure/retry state. A non-Site reader can view the evidence without maintenance controls; Site Personnel cannot open quotation data or documents. Keep all retained QA files with their records.

## 4.6 Shared Demand Allocation — Complete

Completed 2026-11-06 at `7e9b3a0`: local lint/types/428 unit/API tests/build/public-browser, four-job standard CI, full disposable SQL/Auth/browser/Workflow/Realtime/type/race checks and staging parity pass. Applied only the exact CI-verified SQL to staging; retained state is identical and new demand tables remain empty. `verify:foundation -- demand` passes. This accepts only the internal boundary; no new human attestation/provider smoke is claimed, and earlier attestations retain their dates/provenance. Step 4 remains open; 4.7 needs separate scoped planning.

The user locked all six interview decisions and requested implementation on 2026-11-06. Build a private foundation with no staff UI or public allocation endpoint. Units 4.7, 4.8 and later workflows remain separate.

- Bind exact demand to stable approved MRF material identities, quantities and units. Purchases, saved awards, suitability holds and transfer allocations share one cap. No floating-point tolerance or financial rounding.
- Saved awards consume demand immediately. Replace award-to-PO and suitability-to-transfer ownership atomically. Keep remaining purchasing demand distinct from unassigned demand, which additionally excludes saved awards.
- Private transaction helpers create/change/release/replace claims alongside the owning business record. No direct browser/service-role grants. Future checked writers own authorization, source capacity, stock and lifecycle validation; this unit does not fabricate those workflows.
- Blocked or paused work retains claims until an explicit authorized transition changes/releases them. Receiving or dispatch does not itself release demand. The first claim, including a suitability hold, permanently registers downstream use and restricts MRF correction to documents, even after release.
- Preserve foundation-guard/MRF lock order, opaque versions, stable retries, atomic immutable actor history and rollback safety. Exact quantities remain strings at internal interfaces.

**Done when:** exact-quantity/domain, rollback SQL and observed-lock contention/conversion/retry/correction checks pass at both isolation levels; standard local/public-browser, four-job CI, full disposable integration/types and retained-state-safe staging parity pass. Synthetic owning transactions verify the internal boundary; no new staff workflow exists to manually attest. Preserve earlier human attestations and their provenance. No new live provider capability is introduced. Record evidence in the tracker before checking 4.6.

## 4.7 Stock Ledger and Reservations — Complete

Completed 2026-11-06 at `e749844`: local lint/types/431 tests/build/public-browser, all four standard jobs, full disposable SQL/Auth/browser/Workflow/Realtime/type/race checks and staging parity pass. Exact CI-verified SQL is applied only to staging; retained state matches and new stock tables remain empty. `verify:foundation -- stock` passes. This accepts only the internal foundation; earlier staff/Drive attestations retain their provenance, and no new staff/provider attestation is claimed. Step 4 remains open; 4.8 needs separate scoped planning.

Authorized 2026-11-06 after all six interview decisions were locked. Implement only the internal project-stock foundation, with no inventory UI, public mutation endpoint, opening-stock entry, warehouse pool or later owning workflow.

- Use UUID stock accounts unique by project and trimmed/case-insensitive description/unit. Preserve internal spaces and distinct unit labels. Preserve initial display labels; retain zero-balance identities/history and restrictive project references.
- Immutable signed movements receive server posting timestamps. Exact decimal-string quantities produce on-hand, reserved and available balances; require on-hand >= reserved >= 0. Corrections add reasoned movements; no backdating/edit/delete interface.
- Source-release requests reserve stock; suitability and usage drafts do not. Reservations persist through pauses/revocation until explicit release/reduction/consumption. Dispatch consumes its own reservation with its debit atomically; trip cancellation alone does not release an allocation.
- Private grouped operations carry expected account versions, stable transport/source identities, retry receipts and permanent actor history. A business source cannot post twice under a new operation UUID. Future checked owning commands validate business authority/source eligibility and commit their rows plus demand/stock changes together.
- Follow guard/actor/session/project/MRF/account lock ordering. Joint synthetic Procurement transactions verify 4.6 atomicity. The narrow source-Site-to-destination-demand authorization adapter remains a 4.14 dependency; grant no destination access or impersonated actor.

**Done when:** exact-quantity/domain, rollback SQL, source-identity/no-op/rollback/security and observed-lock reservation/usage/dispatch/access/project races pass at both isolation levels, alongside local/public-browser/four-job CI/full disposable/types and retained-state-safe staging parity. Extend scoped internal acceptance; preserve earlier human/Drive evidence without inventing new attestations. Record actual evidence before checking 4.7.

## 4.8 Comparisons, Awards and PO Drafts — Complete

**Completed 2026-11-07 at `f1248bc`:** local/four-job CI/full disposable/type/race, owned real-Drive artifact/cleanup and preserved-state staging checks pass. The user explicitly confirmed **All three passed** with no skipped checks for comparisons/artifacts, awards/PO pricing/previews and lifecycle/conflicts/access, superseding the earlier **Not tested yet** response. Matching combined acceptance passes; earlier attestations retain their original dates and provenance. Detailed evidence is in the tracker. Step 4 remains open; 4.9 requires scoped planning and separate implementation authorization.

Authorized 2026-11-06 after all twenty interview decisions and the shared-understanding check were locked. The user requested implementation. Preserve incumbent styling, unrelated pending documentation edits and retained QA records/files. Procurement alone writes; all non-Site roles read; Site is denied. Accounting submission/approval, commitments, issuance and official PO archives remain 4.9/4.10.

- Compare current eligible archived quotation revisions against the current approved MRF. Permit one supplier and partial coverage; show missing/capacity-limited offers. Rank discounted material prices including applicable VAT, with quotation-wide charges and gross/EWT/net separately. Explicitly select ambiguous alternatives; awards remain manual and may use several confirmed matched material rows. Freeze remaining purchasing quantities and sourcing breakdown in retained PDF/XLSX versions; saved awards do not reduce the purchasing basis. Artifact completion is independent of awards.
- Saved awards consume exact demand and quoted source-line capacity. Require a five-character reason per supplier group. Convert the entire supplier award group to one numbered PO draft atomically, replacing claims without a gap. There is one active PO per MRF/supplier; subsequent quantities change through that draft.
- Preserve quoted prices, percentage rates and tax treatment; use the confirmed exact calculation stages on selected quantities. Partial-line fixed discounts start blank with the source amount visible; document adjustments start copied but unconfirmed. Explicitly review inclusion and fixed amounts, with reasons for differences. Do not invent charges or reconcile partial totals against the full source total.
- Show both offered and requested quantities; finite fractions are permitted, quantity rounding is not. Print MRF units and converted prices up to six decimals with an approximation marker where necessary, retaining the exact offered quantity/price/conversion basis. Totals use exact source arithmetic.
- Permit incomplete numbered drafts with valid demand claims, visible missing review and expiring confirmations after relevant edits. Zero-value drafts retain an unresolved later Accounting-policy blocker. Linked supplier/MRF/project/source identities remain fixed; printed vendor and order details, including optional bank details, are editable snapshots. Record every PO creator/content editor/rebinding/reopening actor permanently; unchanged saves and viewing/retries do not add preparers.
- Eligibility changes retain work/claims and block progress. Permit explicit reductions/cancellation; rebind all active work for the supplier/MRF to one eligible revision together, with reviewed mappings. Reasoned cancellation releases demand, preserves numbers/history and does not recreate awards. Explicit reopen rechecks source, demand, capacity and the active-PO limit; converted awards cannot independently reopen.
- Use checked service-only commands, opaque versions, stable retry receipts, immutable audits and same-transaction demand effects. Extend PO counters, authoritative role-safe views and private realtime with repeated conflict review. Generate durable independently retryable comparison artifacts with exact frozen spreadsheet values, provider verification and protected retrieval. Draft PO previews use saved server records and stamp every page PREVIEW — NOT FOR ISSUE.

**Done when:** exact pricing/conversion/capacity/free-item cases, atomic conversion/rollback/retry/numbering/lifecycle/eligibility/access races at both isolation levels and real application/Realtime/Workflow recovery pass. Complete local/public-browser/four-job CI/full disposable/types, exact-CI-SQL staging parity with retained-state preservation, owned live-Drive artifact checks/cleanup and three new explicit human groups (comparisons/artifacts; awards/PO pricing/previews; lifecycle/conflicts/access). Preserve earlier attestation provenance. Matching combined acceptance is required before checking 4.8.

**Targeted human review — accepted:** all three groups below were explicitly confirmed passed with no skipped checks on 2026-11-07. The review steps remain for reference. Use an approved, fully archived MRF and at least one eligible archived quotation. Finalize and archive a quotation through the existing quotation screen if the chosen QA request has none. Retain these QA records and their files.

1. **Comparisons and artifacts:** open Purchasing from the MRF; check current offers, partial coverage, alternative selection where applicable and the remaining-purchase versus unassigned quantities. Save a comparison and open both retained PDF and XLSX. Check their quantities, source identities and material-only rankings against the screen; verify an earlier version stays frozen after later sourcing changes. Exercise a visible artifact retry if one is available.
2. **Awards and PO pricing/previews:** save an explicit supplier award and reason, convert the whole group to one numbered draft and edit its quantities/printed details. Check offered versus MRF units, partial fixed discounts, document adjustment inclusion/amounts/reasons and expiring pricing reviews. Save incomplete work, then complete its reviews. Open the saved preview and verify quantities, exact source/conversion notes, totals and PREVIEW — NOT FOR ISSUE on every page.
3. **Lifecycle, conflicts and access:** use two Procurement windows to check repeated newer-version review without losing input. Check cancellation/reopening and retained numbering/demand; where available, change source eligibility and review an explicit whole-group rebind. Confirm other non-Site roles can read, Site cannot access purchasing/documents and changed access clears protected work. Confirm Accounting submission and supplier issuance remain unavailable.

All three results are recorded explicitly with no skipped checks or remaining issues. This purchasing confirmation is separate from earlier quotation/supplier/MRF attestations and does not establish acceptance of later units.

## 4.9 Accounting Approval and Commitments — Complete

**Completed 2026-11-08 at `e00f8fd`:** local/public-browser, four-job CI, full disposable SQL/Auth/application/Workflow/Realtime/type/race, owned live-Drive/cleanup and retained-state-safe staging checks pass. The user explicitly confirmed all three human groups including assisted checks passed with no skips or remaining issues. Matching combined acceptance passes. Earlier attestation dates/provenance and retained QA records/files are preserved. Step 4 remains open; authorized 4.10 work is tracked below. The Vercel deployment failure is separate from this unit acceptance.

**Authorized 2026-11-07:** the user locked all twenty interview decisions and the shared-understanding check, then requested implementation. Unit 4.8 remains verified complete. Preserve incumbent styling, unrelated pending documentation and retained QA records/files. Supplier issuance remains 4.10; payments, spending and delivery clearance remain 4.11.

- Procurement submits complete saved, freshly checked POs into immutable submission versions. Submitted/Held content locks; Procurement may recall either with a reason. Accounting may approve, hold, return or reject. Returned saves stay Returned; recall restores Draft. Hold, return and recall retain demand. Rejection is terminal, releases demand, frees the active supplier group and preserves numbering/history. Never permit generic reopening of a rejection.
- Every historical creator/content editor/rebinder/reopener and submitter is permanently barred from approval by user UUID. They may perform other authorized review actions. Accounting alone may revoke an unissued approval with a reason, returning it for Procurement edits/cancellation, releasing its commitment and retaining demand. Reapproval keeps the PO number and retains all approval versions.
- Positive gross and nonnegative supplier net are required; reviewed zero net is allowed. Submission reserves no money. Approval atomically commits saved gross including VAT before EWT, with a hard scope cap and no override. For gross PHP 10,000/EWT 100/net 9,900, commit PHP 10,000; a PHP 15,000 allocation then has PHP 5,000 uncommitted. Allocation reductions cannot fall below active commitments. Show exact commitments/uncommitted allocations in Accounting and non-Site project/scope views, distinct from unallocated project budget. Spending remains unavailable.
- Initial/full-correction MRF submission and PM approval require positive uncommitted scope allocation; drafts and the document-only correction exception remain. Procurement records Upfront/Credit, an agreed Credit due date on/after the PO date and Philippine submission/approval date, and explicit quotation-terms match or a reasoned departure. Existing drafts receive no invented payment mode or approval.
- Submission/approval recheck complete pricing, current source eligibility, current approved MRF archives and finalized quotation archives. Comparisons remain optional. After approval, quotation expiry/replacement is tolerated; withdrawal or supplier inactivity blocks progress without releasing demand/money. MRF document correction requires Procurement reconfirmation of the exact historical quotation and eligible Accounting PO-applicability attestation against the corrected approved archive. Preserve the frozen approval, commitment, source selection and PDF.
- Approval freezes inputs/results/rule/source/terms and verified actor, commitment, immutable audit/retry receipt and durable approved-PDF archive intent together. Generate from the immutable exact-string snapshot with approval attribution; unapproved previews retain their watermark. Archive failures retain approval/commitment. Accounting owns retries, including adoption after original-actor revocation. Retain destinations/provider identities/attempt attribution; late archive completion cannot reactivate revoked approval. Supplier issuance stays unavailable.
- Extend checked commands and role-safe views for review states, immutable submissions/approvals, payment arrangements, applicability, archives and financial positions. Guard every existing save/check/rebind/cancel/reopen endpoint against locked states. Use current authorization, opaque versions, stable retries, parent-project serialization, exact decimals, transactional audit/demand/budget effects and private realtime conflict recovery. Restore Accounting queue/detail and project rollups; non-Site reads only, Site financial denial.

**Done when:** budget contention/reduction/release/rollback/retry, all preparer/submitter identities, stale decisions, date boundaries, locked-endpoint bypasses, rejection/reopening, source/correction/withdrawal and archive/revocation races pass at both isolation levels. Verify actual Auth/application/Realtime/Workflow/private PDF/Range/recovery paths and desktop/mobile/multipage output. Complete local/public-browser/four-job CI/full disposable/types, owned live-Drive and exact-CI-SQL retained-state-safe staging checks. Obtain three new explicit human groups: review/terms/lifecycle; budgets/project visibility; archives/applicability/conflicts/access. Preserve earlier attestation provenance. Matching combined acceptance is required before checking 4.9. No merge or production authorization is implied.

### 4.9 Targeted Human Review — Complete

**Accepted 2026-11-08:** after reporting overall success, the user explicitly selected **All three passed**, including assisted checks, with no skips or remaining issues. This supersedes **Not tested yet / checks remain** on 2026-11-07. Matching combined acceptance passes. The walkthrough below remains for reference; earlier attestations retain their original dates and provenance.

Follow the steps in order. Each step names the account to use and the result to look for. The group numbers let you report the same three acceptance results at the end.

#### Before you start

Open the [review app](http://127.0.0.1:3000). Use QA records in the staging-backed app and keep their records and files after testing.

Have these accounts ready. Separate browser profiles or a normal window and a private window make switching between people easier.

| Name used below | Account needed |
| --- | --- |
| **Preparer** | A QA person with Procurement and Accounting roles. Use Procurement to prepare the Main PO; switch to Accounting only for the self-approval check. |
| **Reviewer** | A different Accounting person who has never prepared, edited or submitted the Main PO. |
| **PM** | A Project Manager who can change the QA scope allocation and review its MRF. |
| **Site** | Site Personnel assigned to the QA project. |
| **Administrator** | Available to help with the final access-change check. |

Prepare these records before starting:

- **Main PO:** an editable QA draft with positive gross, reviewed prices and a finalized quotation whose archives are complete. Use a PO with withholding so its supplier net is lower than its gross; this makes the budget comparison visible. For the payment examples below, use a quotation stating **30 days credit**. Its MRF must already be approved and fully archived.
- **Rejection PO:** another QA draft, with its own MRF/supplier group and an approved, archived MRF. This keeps the permanent-rejection test separate from the Main PO.
- **QA scope:** use a scope with no other commitments for the Main PO. The project budget must be large enough to fund the allocation changes in steps 6–7.
- **Correction file:** a valid replacement supporting PDF for the Main PO's MRF, with the same material requirements.

If an account or record is missing, report **Pending — setup needed** and ask for help preparing it. The assisted checks below also need prepared examples; they remain pending until those examples are available.

Write down:

```text
Main PO number:
Rejection PO number:
Main MRF number:
Project / scope:
Main PO gross:
Main PO supplier net payable:
Starting Unassigned quantity for each Main PO material (MRF units):
```

**For every confirmation:** click the named action, complete the dialog and confirm it there. Give a reason of at least five characters when requested, such as `QA review check`. Wait for the dialog to close and the saved status to update before moving on.

**For budget checks:** gross includes VAT before withholding tax (EWT); supplier net is the amount after withholding. Approval commits the gross. For example, a PO showing gross **₱10,000** and net **₱9,900** commits **₱10,000**. Use your own PO's displayed amounts in the steps below.

#### Walkthrough

**1. Check the payment fields — Preparer, Procurement role (Group 1)**

1. Open **Purchase orders → Main PO → Edit saved preparation**. Set **PO date** to today in Philippine time.
2. Set **Payment arrangement** to **Upfront**. Under **Agreement against quotation**, choose **Agreed terms differ from quotation**. Enter `QA supplier agreed upfront payment instead of 30 days credit` in **Agreed difference and reason**.
3. Click **Save preparation**, then **Confirm saved preparation** and its confirmation button.
4. Edit again. Choose **Credit**, set **Agreed Credit due date** to yesterday, and save. Try to confirm the saved preparation.
5. Change the due date to today. Keep **Agreed terms differ from quotation** and change the reason to `QA supplier agreed payment due today instead of 30 days credit`. Save and confirm again.
6. Finally, set the due date to 30 days after the PO date and choose **Arrangement matches quotation**. Save and confirm. Leave this valid Credit arrangement on the Main PO.

**Expected:** yesterday's due date blocks confirmation/submission. Today is accepted when the PO date is today; a future date is accepted too. Upfront needs no Credit due date. The screen shows the saved arrangement and your explicit match or difference review.

**2. Submit the PO — Preparer, Procurement role (Group 1)**

1. On the Main PO, click **Submit to Accounting** and confirm it in the dialog.
2. Check the review status and budget figures.

**Expected:** status becomes **Submitted**. PO editing is locked. **Committed gross** remains zero; submission has not reserved money.

**3. Check who can approve — Preparer, then Reviewer (Group 1)**

1. Switch the Preparer's active role to **Accounting** and open the Main PO from **Accounting**.
2. Check **Approve PO** and the explanation beside the review actions.
3. Switch the Preparer back to **Procurement**. In the separate browser session, sign in as the Reviewer and open the same PO from **Accounting**.

**Expected:** the Preparer cannot approve their own PO after switching roles. The Reviewer can see the costs, terms and decision controls, but cannot edit PO content. Approval may still be unavailable until the budget check in steps 6–7.

**4. Try Hold, Recall and Return — Reviewer and Preparer (Group 1)**

1. **Reviewer:** click **Hold PO**, enter a reason and confirm. Expect **Held**, with content still locked.
2. **Preparer:** click **Recall PO**, enter a reason and confirm. Expect **Draft**. Edit **Notes**, save, confirm the saved preparation and submit again. Expect **Submitted**.
3. **Reviewer:** click **Return for correction**, give a reason and confirm. Expect **Returned**.
4. **Preparer:** edit **Notes** and save. Check that the status is still **Returned**. Confirm the saved preparation and submit again. Expect **Submitted**.

**Expected throughout:** money is not committed. The requested material quantities stay allocated to this PO. To check quantities, use **Back to comparisons and awards** and compare the material's **Unassigned** quantity before and after these actions.

**5. Check a decision that becomes outdated — both sessions (Group 3)**

1. **Reviewer:** open **Hold PO**, type `Keep this reason while another person updates the PO`, and leave the dialog open without confirming.
2. **Preparer:** recall the Main PO. Wait for the Reviewer's dialog to show that the PO changed.
3. **Reviewer:** check that the typed reason is still present. Review the displayed values, then click **I reviewed the latest values**. Leave the dialog open.
4. **Preparer:** confirm the saved preparation and submit again.
5. **Reviewer:** wait until the page shows **Submitted** and the dialog again requires review of changed values. Check the reason, review the values and click **I reviewed the latest values** again. Now confirm **Hold PO**.

**Expected:** each newer version requires another explicit review. Your reason survives both changes. You cannot confirm an outdated decision. The final status is **Held**.

**6. Check insufficient budget — PM, then Reviewer (Group 2)**

1. **PM:** open **Projects → QA project → Scopes of work**. On the Main PO's scope, click **Edit allocation**.
2. Set **Scope allocation (PHP)** to one cent less than the Main PO's gross. Save and confirm **Save scope allocation**.
3. **Reviewer:** wait for the Main PO's **Scope allocation** to show the new amount.

**Expected:** **Approve PO** is unavailable, with an insufficient-budget explanation. The PO remains **Held** and committed gross remains zero.

**7. Approve at the exact budget limit — PM, then Reviewer (Group 2)**

1. **PM:** set the scope allocation equal to the Main PO's gross and save it.
2. **Reviewer:** wait for that exact allocation to appear. Click **Approve PO**, review the amounts and confirm.
3. Write down the PO number, approval version, committed gross and uncommitted allocation.

**Expected:** status is **Approved**, committed gross equals the PO gross, and uncommitted allocation is **₱0.00**. Supplier net payable is shown separately. Approved-PDF archiving starts.

**8. Compare Projects and check the allocation floor — PM (Group 2)**

1. Open the QA project. Compare the scope's **Committed gross** and **Uncommitted** figures with Accounting.
2. Try saving an allocation one cent below the committed gross.
3. Check the rejection message, then cancel the unsuccessful edit.

**Expected:** the two screens agree. The lower allocation is refused and the saved allocation stays unchanged. **Unallocated** project budget is shown separately from **Uncommitted scope allocation**.

**9. Open the approved document — Reviewer (Group 3)**

1. On the Main PO, find **Retained approval versions**. Wait for **Approved PDF: complete**.
2. Click **Open approved PDF v1**. Compare the PO number, quantities, gross, withholding, net payable and payment terms with the saved PO.
3. Check the approval name, time and version. Keep a copy for comparison after step 11.

**Expected:** the approved PDF is readable and has no **PREVIEW — NOT FOR ISSUE** watermark. A separate draft-preview link may still produce a watermarked preview.

**10. Correct the MRF's supporting PDF — Preparer, Site, PM and Reviewer (Group 3)**

1. **Preparer, Procurement role:** open the Main MRF. Enter a **Correction reason** and click **Open correction**.
2. **Site:** replace its supporting PDF using **Upload replacement**. Wait for validation, then **Save and submit**.
3. **PM:** open the corrected MRF, click **Approve MRF**, and wait for its new approved archives to complete.
4. **Preparer:** open the quotation linked to the Main PO. Click **Review corrected MRF**, inspect the new MRF documents, enter a review reason and confirm **Reconfirm current MRF**.
5. **Reviewer:** open the Main MRF's new approved documents and review them. Return to the Main PO, click **Confirm corrected MRF applicability**, enter a reason and confirm.

**Expected:** the MRF correction changes supporting documents only. Procurement and Accounting each have a review to complete. The PO stays **Approved**; its commitment, approval version and existing PDF stay unchanged. This correction works even with zero uncommitted allocation.

**11. Revoke and approve again — Reviewer and Preparer (Groups 1 and 2)**

1. **Reviewer:** click **Revoke approval**, enter a reason and confirm.
2. Check that the PO is **Returned**, committed gross is zero and the scope allocation is available again. Check that **Unassigned** material quantities have not increased: the PO still holds those quantities.
3. **Preparer:** edit **Notes**, save, confirm the saved preparation and submit again.
4. **Reviewer:** approve again and wait for its approved PDF to complete. Open both retained approval PDFs.

**Expected:** the PO keeps its original number. **Approval v2** is added and v1 remains available and unchanged. The gross is committed once for the current approval.

**12. Check permanent rejection and Site visibility — Rejection PO, then Site (Groups 1 and 2)**

1. **Preparer:** note the separate Rejection PO's requested quantities and each material's current **Unassigned** quantity, using MRF units. Save, confirm and submit that PO.
2. **Reviewer:** use **Reject PO permanently**, enter a reason and confirm.
3. **Preparer:** reopen its detail page and check its history and the material's **Unassigned** quantity on the comparisons/awards page.
4. **Site:** open the QA project. Also try the Main PO's Accounting URL and approved-PDF URL copied from the Reviewer's session.

**Expected:** the rejected PO keeps its number/history and has no reopening action. Each material's **Unassigned** quantity increases by the rejected PO's requested quantity. The released supplier group can be used for a new award without reusing the rejected PO number. Site can read its assigned project but receives no budget figures, Accounting PO content or approved PDF.

#### Assisted checks — continue when the examples are ready

These checks are required too. Ask for the prepared QA example or account described below. Until it is available, record **Pending — assistance needed** for the check and its group.

**A. Approved PDF failure and retry — Reviewer (Group 3)**

Use a prepared QA PO whose approved-PDF archive has failed in an isolated test setup.

1. Check that the PO is still **Approved** and its gross is still committed.
2. Under **Retained approval versions**, click **Retry approved PDF v1**, enter a reason and confirm **Retry approved PDF archive**.
3. Wait for **complete**, then open the approved PDF.

**Expected:** retry succeeds using the same approval and committed amount. There is one retained PDF entry for that approval; the person preparing the isolated test also confirms that the retry created no duplicate file. Preparing this failure uses an isolated QA setup; shared Drive configuration stays unchanged.

**B. Approved source changes — Preparer and Reviewer (Group 3)**

Use a separate approved QA PO for these checks, with prepared expired/replaced-source examples and a QA-only supplier.

1. Open the examples whose approved quotation has expired or has been replaced by a newer revision. Compare the bound quotation, approval, PDF and commitment with their recorded values.
2. **Preparer:** open **Suppliers**, find the QA supplier and use **Deactivate supplier** with a reason. Check the approved PO, then reactivate the supplier.
3. Finally, open the quotation revision actually linked to this separate QA PO and use **Withdraw revision** with a reason. Withdrawal is permanent, so use this separate source-test record.

**Expected:** expiry/replacement retains the approved historical source without rewriting the approval or PDF. Supplier inactivity and withdrawal show blockers while retaining approval, money and material quantities. Reactivation clears the inactivity blocker. Withdrawal requires revocation/correction before further progress.

**C. Former preparers and submitters — prepared QA accounts (Group 1)**

Use prepared PO/account examples for a former creator, content editor and submitter who now has Accounting access. Sign in as each person, use Accounting and open the relevant submitted PO.

**Expected:** **Approve PO** is blocked for each historical identity, even after their role changes. Another eligible Accounting person is needed. Record which prepared examples you checked.

**D. Changed access — Reviewer and Administrator (Group 3)**

For this check, have the Administrator prepare a QA reader with both **Accounting** and **Finance** roles. Use that account as the Reviewer below; removing Accounting leaves a valid Finance grant while testing whether the old session is rejected.

1. **Reviewer:** open the Main PO and an approved-PDF link. Keep the PO screen open.
2. **Administrator:** remove Accounting access from this QA Reviewer account.
3. **Reviewer:** before signing in again, check that the protected app content clears and that reopening the approved-PDF URL with the old session is denied.
4. **Administrator:** restore the QA access after the test. Sign in afresh as the Reviewer.

**Expected:** the old session no longer grants access. Restoring the role requires a new sign-in; it does not restore the old session. Existing approval history and commitments remain intact.

#### Report your results

Use **Passed** only when every listed check for that group was completed successfully. Use **Pending** for an untested/skipped check or missing setup, and **Issue** when actual behavior differs from the expected result.

```text
Group 1 — Review, terms and lifecycle:
Passed / Pending / Issue
(Steps 1–4, 11–12 and assisted check C)

Group 2 — Budgets and project visibility:
Passed / Pending / Issue
(Steps 6–8 and 11–12)

Group 3 — Archives, applicability, conflicts and access:
Passed / Pending / Issue
(Steps 5, 9–10 and assisted checks A, B and D)

For each Pending or Issue:
Step/check:
PO number:
Expected result:
Actual result or setup needed:
```

These are three new confirmations; earlier purchasing acceptance does not cover them. Only confirmation that all three groups passed without skips, together with matching automated acceptance, closes 4.9.

## 4.10 Supplier Issuance

**Completed 2026-11-08 at `77e3965`:** local, all four standard CI jobs, full disposable integration/types/races, retained-state-safe staging and owned live-Drive/cleanup pass. The user confirmed all three human groups including all assisted checks without skips/issues. Matching combined acceptance passes. Earlier local-only checkpoints below are historical; step 4 remains open.

**Authorized 2026-11-08:** the user confirmed all seventeen interview decisions and the shared understanding, then requested implementation. Preserve the pending 4.9 closeout. Procurement records the initial external sending only: Prepare to send → send externally → Confirm sent. No messaging, proof uploads, retransmission log or supplier acknowledgement.

- Preparation requires current approval/applicability, supplier/source readiness, valid Credit terms and live verification of the current MRF archives plus exact approved-PO PDF. Bind those versions, block revocation while prepared and never auto-expire. Any currently authorized Procurement colleague may finish or cancel; cancellation requires a reason and explicit Not sent declaration.
- Record channel (Email/Chat/Physical handover/Other), recipient, actual Philippine sending timestamp and optional notes; Other needs explanation. Retain automatic recording time and permanent actor snapshots. Actual sending is on/after preparation, not future, and within the approved Credit due date; valid late recording is allowed.
- Confirm sent needs no live Drive call. Source/MRF changes after preparation retain actual issuance with visible unresolved blockers if already sent; if not sent, cancel preparation and resolve them. Sending outside valid preparation/timing cannot establish normal issuance and needs external escalation.
- Issuance is permanent and separate from approval: no normal revoke/cancel/content edit and no changes to commitments, demand or delivery/payment progress. Procurement may append reasoned corrections to sending details while retaining originals and valid time bounds. Unresolved blockers have no override; post-issue financial/order correction remains later work.
- Use private checked transactions, versions, stable receipts, immutable history, current access, existing lock order and protected realtime. Extend incumbent PO detail/directory with clear steps and recovery; preserve non-Site reads and Site denial.

**Done when:** transactional/security/retry/time/source/access and observed-lock issuance/revocation/cancellation races pass at both isolation levels; real application/Realtime/Drive verification and failure recovery, local/four-job/disposable/types, scoped live-Drive and retained-state-safe staging checks pass. Inspect desktop/mobile and complete three new explicit human groups: issuance; lifecycle/history; archive/conflict/access. Match combined acceptance before checking 4.10. Payment/delivery, Vercel repair, merge and production remain separate.

**Historical local checkpoint 2026-11-08:** standard lint/types/471 tests/build, public browser, owned migration replay and rollback/race checks, pinned type consistency and full real-account application/Workflow/Realtime/Drive-double verification pass. Desktop/mobile review is complete. Publication/four-job CI/disposable CI, retained-state-safe staging, owned live Drive, three new human groups and matching combined acceptance remain pending. The unit stays unchecked.

### 4.10 Targeted Human Review

**Confirmed 2026-11-08:** the user explicitly selected All three passed, including every assisted check, with no skips or remaining issues. Hosted verification and combined acceptance also pass, completing 4.10. Earlier 4.9 acceptance does not cover these new actions. Keep all QA records and files after testing.

#### Before you start

Open the supplied review app after its database has the 4.10 migration. Have these QA accounts ready:

| Name below | Account |
| --- | --- |
| **Sender** | Procurement person preparing and sending the PO. |
| **Colleague** | A different Procurement person, using a separate browser session. |
| **Accountant** | Accounting person who did not prepare or submit this PO. |
| **Site / Administrator** | Site person assigned to the QA project; Administrator to help with the access check. |

Use an approved QA PO with no blockers, a valid payment arrangement and completed MRF/supporting/approved-PO archives. Use a supplier contact you can safely send QA documents to. Start with **Sending status: Not issued**. Record the PO number and its **Committed gross**. Issuance is permanent, so reserve this PO for the sending checks.

For each action, click its button, read the dialog, complete the fields and confirm using the button inside the dialog. Wait for the dialog to close and the saved status to change. A required reason needs at least five characters. Use **Pending — setup needed** for any missing account or example.

#### Walkthrough

**1. Prepare the PO — Sender (Group 1)**

1. Open **Purchase orders → QA PO → Supplier issuance**.
2. Click **Prepare to send**, read the checks and confirm in the dialog.
3. Wait for **Prepared to send**. Open **Open checked approved PO**, **Open checked MRF** and **Open checked supporting PDF**.

**Expected:** all three documents are readable and belong to this PO/MRF. The page names the Sender and preparation time. Nothing has been sent by ConstructSync.

**2. Check the lock and colleague cancellation — Accountant, then Colleague (Group 2)**

1. **Accountant:** open the same PO from **Accounting**. Check **Revoke approval**.
2. **Colleague:** open the PO. Without sending anything, click **Cancel preparation**. Enter `QA documents have not been sent` as the reason.
3. Leave **I confirm these documents have not been sent** unticked. Check the confirmation button, then tick the declaration and confirm.
4. Open **Sending history**. Compare **Committed gross** with your starting figure.

**Expected:** revocation is unavailable while prepared. Cancellation needs both the reason and declaration. Status returns to **Not issued**. History retains the Sender as preparer and Colleague as canceller. Approval and committed gross stay unchanged; the Accountant can now revoke if correction is needed.

**3. Send outside the app and record it — Sender and Colleague (Group 1)**

1. **Sender:** prepare the same PO again. Wait for success before sending.
2. Send the checked documents externally to the safe QA contact. Note the actual Philippine date and time.
3. **Colleague:** click **Confirm sent**. Choose the sending channel, enter the recipient name/contact and actual sending time. For **Other**, explain the channel. Notes are optional.
4. Verify what was actually sent, then tick **I confirm these checked documents were sent to this recipient**. A Procurement colleague may record the event; the application retains who prepared and who recorded it.
5. Confirm and check the saved result in both browser sessions.

**Expected:** status becomes **Issued** automatically in the other session too. The original preparer and person recording the sending are named separately. Actual sending time and automatic recording time are separate. Issued means sent; supplier acknowledgement is not recorded here. Gross, demand and payment/delivery/stock progress do not change.

**4. Check permanent issue and correct a detail — Accountant, then the sending person (Group 2)**

1. **Accountant:** reopen this PO. Check that **Revoke approval** remains unavailable. Check that Procurement cannot edit or cancel the PO.
2. **Procurement:** click **Correct sending details**. Correct a recipient spelling or note, enter a reason and confirm the accuracy declaration.
3. Open **Sending history**. Compare **Original sending declaration** with the new correction and the current details.

**Expected:** the correction is appended with its actor, recording time and reason. The original stays unchanged. PO content, financial terms, commitments and demand remain unchanged. Corrections cannot move actual sending outside its valid time bounds.

**5. Check time validation — a separate prepared QA PO (Group 1)**

1. Open **Confirm sent** without actually sending this PO.
2. Fill a channel and recipient. Enter a time before the displayed preparation, then a time in the future.
3. Check the explanation and disabled confirmation. Close the dialog and cancel the preparation truthfully as **Not sent**.

**Expected:** both times are refused. Do not invent a sending event to complete this check. Sending before preparation or outside approved Credit timing requires external escalation.

#### Assisted checks — prepared examples required (Group 3)

Have the person preparing the review provide these isolated QA examples. Keep the group **Pending — assistance needed** until every item is tested.

| Check | What to do | Expected |
| --- | --- | --- |
| Missing/changed Drive document | On an isolated example with a missing or changed required file, try Prepare to send. Restore the original file/access and retry. | Failure leaves Not issued and no preparation. Retry succeeds after repair. Shared Drive configuration and retained documents are not altered for this test. |
| Interrupted response | Use the supplied lost-response example, then click Check saved outcome. | The original outcome appears once, with no duplicate preparation, issuance or history. |
| Repeated conflict | Leave Confirm sent open with completed entries. Have a colleague make two separate permitted version changes; after each, review the latest values explicitly. | Entries survive each change. Confirmation remains unavailable until the latest values are reviewed. |
| Changed prerequisite | Use separate prepared examples for a supplier/source or MRF change. For the unsent example cancel and resolve first. For the already-sent example record its valid actual sending. | Unsent documents are not sent under stale prerequisites. The sent event becomes Issued with visible unresolved blockers; no override is offered. |
| Credit timing / late entry | Use prepared Credit examples for overdue-before-preparation, sending after the due date, and valid timely sending recorded after the due date. | Overdue preparation and late sending are refused; valid timely sending can be recorded later. Actual Philippine sending date governs this check. |
| Reader and changed access | Accounting/another non-Site reader opens the issued details; Site tries its PO/document URLs. Administrator removes a QA Procurement person's access while their dialog is open. | Readers cannot record sending. Site receives no PO or private documents. Removed access clears protected content and prevents completion; restoring access requires a fresh sign-in. |

#### Report your results

Use **Passed** only after all checks in that group pass without skips. Use **Pending** for untested checks or missing setup, and **Issue** for unexpected behavior.

```text
QA PO number:
Group 1 — Preparation and sending (steps 1, 3, 5): Passed / Pending / Issue
Group 2 — Locks, colleague handoff and history (steps 2, 4): Passed / Pending / Issue
Group 3 — Archives, conflicts and access (all assisted checks): Passed / Pending / Issue

For each Pending or Issue:
Step/check:
PO number:
Expected result:
Actual result or setup needed:
```

All three explicit results and source-matched automated/hosted acceptance are required before checking 4.10 complete.

## Milestone Completion and Documentation Ownership

Keep permanent product responsibilities in the [overview](project-overview.md), system contracts in [architecture](architecture.md), conventions in [code standards](code-standards.md) and execution/verification policy in [workflow rules](ai-workflow-rules.md). Keep current work, dependencies, dated evidence and deferred-suite restoration in the tracker rather than duplicating logs here.

Check checklist step 4 only after all required operational units and whole-operational acceptance pass. Captured email, foundation acceptance or a documentation checkpoint does not establish production readiness. Optional AI/broader document work, styling conversion, company-owned services, verified real email and release rehearsal retain their agreed later boundaries.
