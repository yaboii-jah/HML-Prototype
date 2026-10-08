# Workflow testing reference

Use the [department accounts](PRESENTER_ACCESS.md) and a disposable test workspace. Sign out from Account and sign in with the next department. Configure a project, budget and Drive folder as Administrator. Prepare one MRF supporting PDF and supplier quotation files.

Seven roles are available. Project setup requires no manager assignment; the MRF keeps its generic Approved by signature.

## Main flow

- [ ] **Administrator:** Add the project and funded scopes, such as Structural and Civil. Their combined allocations stay within the project budget.
- [ ] **Site Personnel:** Create an MRF using Request details → Materials → Review & submit. Attach the supporting PDF.
- [ ] **Procurement:** Review the MRF, approve and wait for its Drive archive. Review and archive supplier quotations.
- [ ] **Procurement:** Generate the comparison PDF/Excel before creating a PO. Allocate materials and submit the PO to Accounting.
- [ ] **Accounting:** Check supplier/materials, adjust taxes and charges, choose upfront or credit, then approve within budget. Wait for the PO archive.
- [ ] Follow the applicable payment path below, then **Logistics** schedules the route/destination and records dispatch.
- [ ] For the warehouse route, **Procurement** confirms warehouse receipt; **Logistics** schedules and dispatches onward batches from its available quantities.
- [ ] **Site / Warehouse:** Confirm accepted quantities, post stock once and record usage. Optional evidence appears in Accounting without changing payments or stock.
- [ ] **Accounting / Management:** Review documents, payment history and reports. Refresh to confirm saved work remains.

| Payment arrangement | Test before Logistics |
| --- | --- |
| **Upfront** | Accounting prepares payment → Finance approves → Finance records full disbursement → Accounting releases PO. Approval or partial payment must leave release blocked. |
| **Credit / terms** | Accounting releases the approved, archived PO immediately. Finance payment may happen separately before or after delivery. No payment request is required for release. |

## Returns and key checks

- [ ] Registers use compact rows, a bounded scroll area, fixed table headers and visible pagination. Test 10/25/50, first/last/empty ranges, filter/sort/project resets, long names, light/dark themes and phone widths.
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

- [ ] Dashboard/project checklists update automatically. Served needs every requested quantity released; Delivered needs every requested quantity accepted at site. Warehouse stock, unawarded quantities and rejected POs cannot complete those milestones.
- [ ] Credit delivery and posting can finish while Finance is pending; upfront Finance can finish before Logistics release. Holds/returns identify the affected PO/payment request, with the MRF review status retained.
- [ ] Use Show records in the checklist to open linked PO/delivery tables and material coverage. Search/filter, page through records and refresh; inspection does not change records. Project details keep their route project even when the global context differs.
- [ ] Quotation review uses supplier tabs/searchable selection and Focused/All quotations sheets. Core materials edit inline with 10/25-line pagination and All/Needs review/Unmatched filters; Details keeps specifications, conversion, discount/tax, printed differences and notes. Issue links jump to the right field/page, and hidden lines still block finalization. Check 25 suppliers, 100 lines, read-only finalized versions, autosaving/reload, confirmed row deletion and mobile layouts. Award coverage, grouped uploads, comparisons and allocation inputs retain their behavior.
- [ ] Supplier uploads use a searchable, status-filtered queue (10/25 groups per page) beside one selected group’s files. Add selects the new group; switching groups preserves files and page order. Phone/tablet views use Back to suppliers. Extract all ready groups includes eligible groups across every page/filter; header Enter manually starts without files, while the selected group’s manual action includes its files. Check 1/10/25/50 groups, long filenames, empty/failed/completed states, and confirmations.
- [ ] Quotation process actions and removals require confirmation. Cancel/Escape preserves records and files; confirm executes once. Batch AI extraction asks once, and automatic archiving after finalization/report generation does not ask again. Type award quantities locally, then Apply/Update/Remove award; coverage updates only after confirmation. Unapplied edits persist between quotation steps and block PO generation until applied or reset. Check explicit archive/report retries, keyboard focus, and mobile dialogs in both themes.
- [ ] Request attachments show first-page PDF/image gallery cards. Swipe or use arrows between files; tapping opens a PDF.js modal with a compact toolbar, thumbnail sidebar, search, zoom, page navigation, rotation, print/download controls and continuous scrolling at desktop widths and Drive on mobile after archiving (local file before archive). Check missing/damaged files, modal margins and focus restoration. Pending corrections must not open an older Drive copy as the current attachment.
- [ ] Materials are a table on both Step 2 and the request detail page. Select a row or its Edit/View action to open the dialog; Escape, the close button and the footer all dismiss it and return focus to the row. Add material opens the new row's dialog with the name focused, an incomplete required field flags the row and opens it on validation failure, and Remove updates the table. Site stock appears on the detail table and Offers stays reachable without expanding.
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

- [ ] Sign-in has no credential hints or role picker and requires valid credentials. On workspace pages, **Account → Switch department** offers all seven departments without another password. Switching updates the user name, email, permissions and new audit actors while keeping the current page, project filter and records/files. Refresh keeps the selected account; sign-out keeps records/files; old role-only sessions require new sign-in.
- [ ] Screens and page titles have no prototype/demo/mock labels. Normal Administration has no reset action; `/admin/maintenance` allows Administrator reset only, with confirmation.

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
