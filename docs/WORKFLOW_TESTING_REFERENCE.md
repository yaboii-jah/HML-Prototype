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

- [ ] Dashboard/project checklists update automatically. Served needs every requested quantity released; Delivered needs every requested quantity accepted at site. Warehouse stock, unawarded quantities and rejected POs cannot complete those milestones.
- [ ] Credit delivery and posting can finish while Finance is pending; upfront Finance can finish before Logistics release. Holds/returns identify the affected PO/payment request, with the MRF review status retained.
- [ ] Expand an MRF to view linked PO/delivery tables and material coverage. Search/filter, load older rows and refresh; inspection does not change records. Project details keep their route project even when the global context differs.
- [ ] Quotation summaries and award coverage are tabular; draft edits, grouped files, comparisons and allocation inputs continue to work.
- [ ] Direct and warehouse routes preserve PO limits. Warehouse receipt changes no site stock; Site Personnel receives and posts final deliveries once. Split forwarding stays within the parent receipt.
- [ ] A warehouse dispatch of 60 with 50 accepted leaves the missing 10 consumed and records a discrepancy. Pending scheduling reservations and physically held quantities remain distinct.
- [ ] Preview/download receipts before receiving: actual quantities stay pending. After receiving, names/times and actual quantities appear. Long contents continue with company branding; printing changes no workflow state.
- [ ] Delivery overview shows schedule, destination, stage and arrangement/Finance methods, with material details on the batch page. Historical direct batches retain their recorded data and unknown operation metadata.
- [ ] Select the project's scope in Step 1. Changing projects clears it; AI import requires manual selection. Empty/exhausted scopes block submission or initial approval, while drafts may remain incomplete.
- [ ] Accounting checks both scope and project funds. Services count toward the payable; materials are Goods, while taxes/discounts remain separate adjustments. Partial payments move scope commitment to spending once.
- [ ] Administrator cannot reduce an allocation below committed/spent funds. Document-only MRF corrections preserve scope and work after funds are committed.
- [ ] Open an MRF from dashboard/project links: lifecycle summary and history include quotes, all POs, payments and delivery batches. Credit payment and delivery progress remain independent.
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
