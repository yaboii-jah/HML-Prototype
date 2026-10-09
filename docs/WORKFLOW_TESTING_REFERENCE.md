# Workflow testing reference

Use the [department accounts](PRESENTER_ACCESS.md) and a disposable test workspace. Sign out from Account and sign in with the next department. Configure a project, budget and Drive folder as Administrator. Prepare one MRF supporting PDF and supplier quotation files.

Eight roles are available. Project setup requires no manager assignment; the MRF keeps its generic Approved by signature.

## Main flow

- [ ] **Administrator:** Add the project and funded scopes, such as Structural and Civil. Their combined allocations stay within the project budget.
- [ ] **Site Personnel:** Create an MRF using Request details → Materials → Review & submit. Attach the supporting PDF.
- [ ] **Project Manager:** Review the new MRF, approve and wait for its Drive archive.
- [ ] **Procurement:** Review and archive supplier quotations.
- [ ] **Procurement:** In Compare & allocate, compare base converted prices and apply supplier quantities per material. Review saved allocations by supplier, generate PO drafts, then prepare and submit them to Accounting. PDF/Excel comparisons remain optional and independent.
- [ ] **Accounting:** Check supplier/materials, adjust taxes and charges, choose upfront or credit, then approve within budget. Wait for the PO archive.
- [ ] Follow the applicable payment path below, then **Logistics** schedules the route/destination and records dispatch.
- [ ] For the warehouse route, **Procurement** confirms warehouse receipt; **Logistics** schedules and dispatches onward batches from its available quantities.
- [ ] **Site / Warehouse:** Confirm accepted quantities, post stock once and record usage. Optional evidence appears in Accounting without changing payments or stock.
- [ ] **Accounting / Management:** Review documents, payment history and reports. Refresh to confirm saved work remains.

| Payment arrangement | Test before Logistics |
| --- | --- |
| **Upfront** | Procurement confirms the archived PO was issued to the supplier (Served). Accounting attaches and archives proof, records date/method/reference, verifies the fixed net payable after EWT, then separately confirms delivery clearance. Missing/pending/failed proof archives must leave verification and release blocked. |
| **Credit / terms** | Accounting releases the approved, archived PO immediately. Finance payment may happen separately before or after delivery. No payment request is required for release. |

## Returns and key checks

- [ ] Registers use compact rows, a bounded scroll area, fixed table headers and visible pagination. Test 10/25/50, first/last/empty ranges, filter/sort/project resets, long names, light/dark themes and phone widths.
- [ ] The purchase order, Accounting, Finance and delivery batch activity timelines start collapsed with their history row and event counts in the heading. Expand one to check the bounded scrolling table, its fixed header, 10/25/50 paging, that grouped saves stay expanded across pages, and that a short or empty history explains itself. The MRF lifecycle combined history keeps its 50-row Load more behaviour.
- [ ] Accounting pages count MRF groups and keep all matching POs together. Deliveries separates Delivery batches and Ready to schedule, each retaining its own filters/page.
- [ ] Desktop navigation fits without scrolling; short windows expose secondary routes through More sections, with the active rou
te indicated. The mobile hamburger drawer scrolls. Every destination remains reachable.
- [ ] Project, activity, supplier history and MRF related-record modals keep title/Close accessible. Test tab keys, Escape, scrolling and focus restoration. Closing project settings during folder validation ignores late results and permits retry when reopened.

- [ ] **Administration:** Add project from its separate form; confirmation opens its settings modal on Drive folder. Project / Drive folder / Scopes tabs remember the last tab and unsaved edits when reopened.
- [ ] Confirm project/scope saves and unused-scope removal. Cancel keeps entered values and records. Used scopes stay protected; project budgets cannot fall below allocations or committed/spent funds. Existing PO fields and archived files stay unchanged.
- [ ] Folder mapping visibly validates, confirms the validated target, saves and reports success. Fail/retry stays beside the field; cancellation or an unchanged mapping adds no audit event.
- [ ] Locally, folder validation works through both `localhost` and `127.0.0.1` at the server's port. Matching browser requests reach folder validation; mismatched origins/ports remain blocked. Deployed origin restrictions remain strict.
- [ ] Activity has 10 rows by default (10/25/50), a details modal and record links, and search/project/department/date filters. Check inclusive Philippine midnight boundaries, Clear filters, legacy/unassigned entries and deleted-scope references; browsing changes no records.
- [ ] Scroll long expanded sections: their heading stays below the workspace/archive bars, nested headings do not overlap, and material search stays accessible. Collapse from the floating heading restores focus/context; horizontal tables, short sections, keyboard navigation and mobile layouts remain usable.

- [ ] Dashboard/project checklists update automatically. Served needs every requested quantity issued for revised upfront POs; existing and credit POs retain released coverage; Delivered needs every requested quantity accepted at site. Warehouse stock, unawarded quantities and rejected POs cannot complete those milestones.
- [ ] Credit delivery and posting can finish while Finance is pending; upfront Finance can finish before Logistics release. Holds/returns identify the affected PO/payment request, with the MRF review status retained.
- [ ] Use Show records in the checklist to open linked PO/delivery tables and material coverage. Search/filter, page through records and refresh; inspection does not change records. Project details keep their route project even when the global context differs.
- [ ] Quotation review uses supplier tabs/searchable selection and Focused/All quotations sheets. Core materials edit inline with 10/25-line pagination and All/Needs review/Unmatched filters; Details keeps specifications, conversion, discount/tax, printed differences and notes. Issue links jump to the right field/page, and hidden lines still block finalization. Check 25 suppliers, 100 lines, read-only finalized versions, autosaving/reload, confirmed row deletion and mobile layouts. Award coverage, grouped uploads, comparisons and allocation inputs retain their behavior.
- [ ] Supplier uploads use a searchable, status-filtered queue (10/25 groups per page) beside one selected group’s files. Add selects the new group; switching groups preserves files and page order. Phone/tablet views use Back to suppliers. Extract all ready groups includes eligible groups across every page/filter; header Enter manually starts without files, while the selected group’s manual action includes its files. Check 1/10/25/50 groups, long filenames, empty/failed/completed states, and confirmations.
- [ ] Quotation process actions and removals require confirmation. Cancel/Escape preserves records and files; confirm executes once. Batch AI extraction asks once, and automatic archiving after finalization/report generation does not ask again. Type award quantities locally, then Apply allocations once per material; coverage updates only after confirmation. Full-capacity redistribution between suppliers must save atomically. Unapplied edits persist between materials and quotation steps, display Edited markers, and block PO generation until applied or reset. Fill remaining respects other entered quantities; supplier review is the final generation confirmation. Check explicit archive/report retries, keyboard focus, and mobile dialogs in both themes.
- [ ] Request attachments show first-page PDF/image gallery cards. Swipe or use arrows between files; tapping opens a PDF.js modal with a compact toolbar, thumbnail sidebar, search, zoom, page navigation, rotation, print/download controls and continuous scrolling at desktop widths and Drive on mobile after archiving (local file before archive). Check missing/damaged files, modal margins and focus restoration. Pending corrections must not open an older Drive copy as the current attachment.
- [ ] Materials are a table on both Step 2 and the request detail page. Select a row or its Edit/View action to open the dialog; Escape and the labelled Close/Done controls dismiss it and return focus to the row. Add material opens the new row's dialog with the name focused, an incomplete required field flags the row and opens it on validation failure, and Delete updates the table. Site stock appears on the detail table and Offers stays reachable without expanding.
- [ ] Direct and warehouse routes preserve PO limits. Warehouse receipt changes no site stock; Site Personnel receives and posts final deliveries once. Split forwarding stays within the parent receipt.
- [ ] A warehouse dispatch of 60 with 50 accepted leaves the missing 10 consumed and records a discrepancy. Pending scheduling reservations and physically held quantities remain distinct.
- [ ] Preview/download receipts before receiving: actual quantities stay pending. After receiving, names/times and actual quantities appear. Long contents continue with company branding; printing changes no workflow state.
- [ ] Delivery overview shows schedule, destination, stage and arrangement/Finance methods, with material details on the batch page. Historical direct batches retain their recorded data and unknown operation metadata.
- [ ] Select the project's scope in Step 1. Changing projects clears it; AI import requires manual selection. Empty/exhausted scopes block submission or initial approval, while drafts may remain incomplete.
- [ ] Accounting checks both scope and project funds. Services count toward the payable; materials are Goods, while taxes/discounts remain separate adjustments. Partial payments move scope commitment to spending once.
- [ ] Administrator cannot reduce an allocation below committed/spent funds. Document-only MRF corrections preserve scope and work after funds are committed.
- [ ] Ordinary MRF visits start with **MRF lifecycle** collapsed; **Open full lifecycle** links open it automatically. Expand it to show progress and **Combined activity history** together, including quotes, all POs, payments and delivery batches. Collapse/reopen without losing loaded history or changing records. Credit payment and delivery progress remain independent.
- [ ] New audit actions show user name, department and Philippine date/time after refresh. Historical entries retain their recorded role; no guessed user or completion timestamp appears.
- [ ] Quote edits retain changed-field names; unchanged saves add no event. Expand grouped saves and load older history. Deleted drafts remain traceable.
- [ ] Start an upload, sign out and sign in as another department: completion retains the initiator and current login. Retries retain their own actor/outcome, even for repeated errors; duplicate callbacks add no event. Stale forms cannot make new decisions.

- [ ] Sign-in has no credential hints or role picker and requires valid credentials. On workspace pages, **Account → Switch department** offers all eight departments without another password. Switching updates the user name, email, permissions and new audit actors while keeping the current page, project filter and records/files. Refresh keeps the selected account; sign-out keeps records/files; old role-only sessions require new sign-in.
- [ ] Screens and page titles have no prototype/demo/mock labels. Administration exposes **Clear workspace** to Administrator only; `/admin/maintenance` retains the reset confirmation.

- [ ] **Optional AI MRF entry:** In Step 1, import one PDF or up to 12 ordered page photos (4 MB total). Preview, extract, then apply. Choose the project manually; correct missing values and check all materials.
- [ ] AI import requires a separate supporting PDF and review checkbox before submission. Editing details/materials or reopening a saved AI draft requires review again. Import failures preserve manual entries; source scans disappear on reload and never become attachments.

- [ ] Procurement returns MRF → Site revises; Accounting returns PO → Procurement revises; Finance returns payment request → Accounting revises. References stay linked.
- [ ] Holds/rejections require reasons. A PO exceeding available budget cannot be approved under either payment arrangement.
- [ ] One open payment request per PO; partial requests are allowed. Rejected/disbursed requests stay in history. Duplicate disbursements and excess amounts are blocked.
- [ ] Approved PO finances lock. Missing/failed PO archive blocks release. Invoice/receipt completion is not required for upfront payment.
- [ ] Three-step forms retain values/files. Phone/tablet/desktop layouts, light/dark themes and document previews stay usable.
- [ ] Excess deliveries/usage and duplicate stock posting are blocked. Disbursement moves commitment to spent without reducing available budget twice.
- [ ] Old workflow data shows recovery and remains untouched until you explicitly confirm **Clear workspace**. Drive copies remain.
- [ ] A retired Project Manager session returns to sign-in. Current v12 records survive signing in with one of the seven available roles.

Current rules and routes: [APP_CONTEXT.md](APP_CONTEXT.md).

- [ ] Quotation Offered materials: scroll horizontally to all columns and vertically through long pages; headers stay visible and the scrollbar sits above pagination. Page changes reset vertical scrolling; issue links reveal the correct field. Check desktop/mobile and both themes without page overflow.

- [ ] Compare & allocate: test 20-100 materials, All/Remaining/Edited filters, partial and split awards, per-material Reset, Next remaining material, existing-PO restrictions and stale allocation removal. Mobile Materials/back navigation preserves edits. Offer details show conversion, adjusted pricing and terms; base estimates exclude later PO adjustments. Collapsing Comparison reports preserves alternative choices.

- [ ] Quotation VAT review: confirm VAT / NON VAT, price basis and rate after manual entry or extraction. Financial summaries show goods/services and estimated EWT/net; comparison prices and exports remain material projections. Change finalized treatment through a revision. Move delivery/service rows into adjustments and verify they are counted once.
- [ ] Automatic EWT: VAT-inclusive goods use amount / 1.12 × 1%; delivery and other services use amount / 1.12 × 2% at 12% VAT. Test other rates, exclusive prices, exempt fees, line discounts and general discounts. NON VAT has zero VAT/EWT. Sample gross ₱1,236,196.38 produces goods EWT ₱10,858.90, services EWT ₱357.14 and net ₱1,224,980.34.
- [ ] Accounting PO edits: while submitted/on hold, edit supplier, requested materials, quantities/prices, discounts, fees, document fields and EWT. Reject unrequested materials, excess MRF quantities, duplicate supplier POs and invalid totals. Manual category overrides survive price edits; **Use calculated EWT** restores formulas. Return/resubmit preserves direct edits and source quotations stay unchanged. Approved/released POs remain locked. Verify effective supplier and net payable in previews/PDFs, Finance and budget figures.

- [ ] Administrator: Add project automatically creates its Drive folder and displays Folder ready. Simulate Drive failure: project remains saved; Retry folder creation and Link an existing folder are available. Retry reuses the same folder; manual linking validates company ancestry. Reload preserves setup status; renaming does not rename Drive folders; delayed automatic responses cannot replace manually linked folders.

## Revised full-disbursement compatibility and exceptions

- [ ] Existing MRFs without `workflow` retain Procurement review and their existing Finance/payment path. Loading preserves all stored data; no workspace reset or guessed historical issuance/payment is required.
- [ ] New MRFs use `pm-external-v1`; their POs inherit it. Project Manager reviews all projects and every correction, including documents-only corrections, before Procurement resumes.
- [ ] Cancel supplier issuance, verification, clearance, proof removal and reopening confirmations; nothing changes. Double confirmation cannot repeat a transition.
- [ ] Reopen an approved PO before issuance with a reason, edit and resubmit, reapprove in Accounting, and archive a new PO PDF version. Previous approved PDFs remain available. Issued POs reject financial edits.
- [ ] Verify using PDF/image proof before a delivery batch exists. Fail the upload and retry; no verification is permitted until one proof archives. File signature, count, size and total limits apply.
- [ ] Reopen verification before clearance: paid/spent resets, commitment returns, original identity/time/reference/proof snapshots remain available, and delivery blocks until reverified. After clearance, reopening and proof removal are locked.
- [ ] Revised upfront POs do not create Finance payment requests or disbursements; credit/terms and existing records keep those actions.
- [ ] Check proof filenames, actions, confirmations, history and scroll containment at 320/375/414/768 px and desktop widths in both themes.


## Shared delivery documents

Run `node --experimental-strip-types scripts/delivery-documents-smoke.mjs http://127.0.0.1:3000` with the main app running. All Drive calls are mocked.

- [ ] Confirm supplier-to-site, supplier-to-warehouse and warehouse-to-site receipts: generated snapshots archive automatically, preserving receiver details and quantities.
- [ ] Simulate a Drive failure, post stock anyway, correct quantities with a reason, then retry both original and revised versions. Keep earlier PDFs and prevent duplicate copies.
- [ ] Site Personnel uploads signed site receipts; Procurement uploads signed warehouse receipts; Accounting adds either and PO-level invoices. Reject crossed departments and PO/batch associations.
- [ ] Accounting cannot mark Complete until current generated receipts, matching signed receipts and all uploaded evidence have completed archives. Generic legacy delivery receipts require explicit Accounting classification.
- [ ] New deliveries, evidence and corrected quantities reopen Complete reviews and preserve prior review history. Invoice paperwork never changes payment or stock.
- [ ] Reload preserves snapshots, archives and evidence. Historical deliveries create no automatic upload; use the explicit archive action.
- [ ] Check grouped evidence, archive statuses, retry actions and file previews on phones/tablets/desktops in both themes.


## Named users and project permissions

Run `npm test` for directory bootstrap, salted credentials, normalized unique emails, named-account changes, deactivation/reactivation, Administrator safeguards, session revisions, stale commands, retired Management preservation and PM project controls. Run `node --experimental-strip-types scripts/user-management-smoke.mjs http://127.0.0.1:3000` for a disposable browser walkthrough. It mocks project-folder Drive calls and checks user creation, password reset, access status, named presenter selection, PM project/budget/scope controls, Reports, Admin/maintenance restrictions, fresh password sign-in and cross-tab session invalidation. Users and editors are checked in light/dark themes at 320, 375, 414, 768 and 1440 pixels. Existing broad browser smoke uses PM for reports instead of the retired Management role.


## External credit/terms payments

`tests/credit-terms.test.mjs` covers due-date approval, issuance, unpaid delivery/receiving/stock posting, proof-backed partial/final payments, void corrections, ledger and budget totals, invalid or duplicate payments, Philippine overdue boundaries and compatible persistence. Payment-proof route tests cover uploads after credit delivery clearance while preserving upfront and legacy-credit restrictions. Run `node --experimental-strip-types scripts/credit-terms-smoke.mjs http://127.0.0.1:3000` for the disposable browser journey: manual due date, approval/archive, issuance, unpaid clearance, failed proof archive and retry, partial/final payments, void history, overdue Reports, Finance restrictions, reload and responsive light/dark layouts. Drive writes are mocked. `scripts/full-disbursement-smoke.mjs` remains the upfront-flow regression.


Finance coordination regression: `npm test` covers Finance-only updates, required dates/reasons, stale revisions, immutable history, Philippine date boundaries, unchanged budget and delivery totals, partial/full/void credit verification, and upfront verification/reopening. Run `node --experimental-strip-types scripts/credit-terms-smoke.mjs http://127.0.0.1:3000` against `npm run dev` to exercise status confirmation/cancellation, active/settled filters, Accounting handoffs, retained priority, refresh persistence and mobile/desktop layouts in both themes. All Drive responses in that walkthrough are mocked.
