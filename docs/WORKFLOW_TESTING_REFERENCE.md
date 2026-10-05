# Workflow testing reference

Use the role switcher and a disposable test workspace. Configure a project, budget and Drive folder as Administrator. Prepare one MRF supporting PDF and supplier quotation files.

Seven roles are available. Project setup requires no manager assignment; the MRF keeps its generic Approved by signature.

## Main flow

- [ ] **Site Personnel:** Create an MRF using Request details → Materials → Review & submit. Attach the supporting PDF.
- [ ] **Procurement:** Review the MRF, approve and wait for its Drive archive. Review and archive supplier quotations.
- [ ] **Procurement:** Generate the comparison PDF/Excel before creating a PO. Allocate materials and submit the PO to Accounting.
- [ ] **Accounting:** Check supplier/materials, adjust taxes and charges, choose upfront or credit, then approve within budget. Wait for the PO archive.
- [ ] Follow the applicable payment path below, then **Logistics** schedules delivery.
- [ ] **Site / Warehouse:** Confirm accepted quantities, post stock once and record usage. Optional evidence appears in Accounting without changing payments or stock.
- [ ] **Accounting / Management:** Review documents, payment history and reports. Refresh to confirm saved work remains.

| Payment arrangement | Test before Logistics |
| --- | --- |
| **Upfront** | Accounting prepares payment → Finance approves → Finance records full disbursement → Accounting releases PO. Approval or partial payment must leave release blocked. |
| **Credit / terms** | Accounting releases the approved, archived PO immediately. Finance payment may happen separately before or after delivery. No payment request is required for release. |

## Returns and key checks

- [ ] Procurement returns MRF → Site revises; Accounting returns PO → Procurement revises; Finance returns payment request → Accounting revises. References stay linked.
- [ ] Holds/rejections require reasons. A PO exceeding available budget cannot be approved under either payment arrangement.
- [ ] One open payment request per PO; partial requests are allowed. Rejected/disbursed requests stay in history. Duplicate disbursements and excess amounts are blocked.
- [ ] Approved PO finances lock. Missing/failed PO archive blocks release. Invoice/receipt completion is not required for upfront payment.
- [ ] Three-step forms retain values/files. Phone/tablet/desktop layouts, light/dark themes and document previews stay usable.
- [ ] Excess deliveries/usage and duplicate stock posting are blocked. Disbursement moves commitment to spent without reducing available budget twice.
- [ ] Old workflow data shows recovery and remains untouched until you explicitly confirm **Clear workspace**. Drive copies remain.
- [ ] A retired Project Manager session returns to sign-in. Current v12 records survive signing in with one of the seven available roles.

Current rules and routes: [APP_CONTEXT.md](APP_CONTEXT.md).
