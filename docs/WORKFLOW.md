# ConstructSync Workflow

Last updated: 2026-10-12

> Keep this document updated in the same change whenever the workflow, role responsibilities, payment rules, delivery rules or required documents change. It describes the current app behavior; implementation details belong in [APP_CONTEXT.md](APP_CONTEXT.md).

## Roles

| Role | Responsibility |
|---|---|
| Administrator | Manage users, projects, budgets, scopes and workspace settings. |
| Project Manager | Create/edit projects, approve or return MRFs, and monitor progress. |
| Site Personnel | Create MRFs, upload supporting documents, receive site deliveries, post inventory and record usage. |
| Procurement | Review quotations, prepare comparative bids, allocate materials, draft and issue POs, and receive warehouse deliveries. |
| Accounting / Auditing | Review costing, taxes and budget; approve POs; verify payment proof; clear delivery; review documents. |
| Finance | Prioritize and coordinate external payments, track planned dates and processing, and follow up on outstanding balances. |
| Logistics | Schedule and dispatch deliveries, including warehouse-to-site transfers. |

## Shared Purchasing Flow

1. **Administrator / Project Manager:** Create the project with a unique document code, budget and scopes. Project creation sets up its Google Drive folder. Assign a code to existing projects before creating new documents. Administrators assign Site Personnel accounts to their projects; site actions require the relevant assignment. Administrators and Project Managers can delete unused projects after confirmation; existing Drive folders are retained.
2. **Site Personnel:** Create the MRF, attach the combined supporting PDF, review any AI-extracted information and submit. The first draft save or submission assigns its permanent number; the original paper number is kept separately as Source MRF number.
3. **Project Manager:** Approve, return or reject the MRF. Approved MRF documents are archived to Drive.
4. **Procurement:** Check other project sites for available stock. Propose suitable same-unit transfers for some or all MRF quantities; source Site Personnel confirm release and Logistics handles delivery. Buy the uncovered quantities through the normal supplier process. Review, finalize and archive supplier quotations. Compare all materials side by side, select suppliers per material, split quantities or preview awards to one supplier. Review and save awards together, then create supplier PO drafts separately and submit them. Comparison prices include item discounts and VAT where applicable; quotation-level charges and EWT remain separate. Partial sourcing is allowed; save or discard unsaved choices before creating POs.
5. **Accounting:** Review prices, VAT/EWT, adjustments and budget. Approve upfront or credit/terms payment and archive the PO. Credit requires an agreed due date.
6. **Procurement:** Send the approved PO to the supplier and confirm issuance. The PO becomes **Served** and enters Finance coordination while unpaid.

## Site Stock Transfers

**Procurement checks stock and confirms suitability → source Site Personnel approve release → Logistics schedules and dispatches trips → destination Site Personnel receive and post accepted stock.**

- Proposals reserve source stock and MRF demand immediately. Source personnel can reduce or reject release; Procurement can cancel undispatched quantities with a reason. Cancelling a scheduled trip keeps its allocation for rescheduling.
- Dispatch removes stock from the source once. Receiving records accepted quantities; posting adds destination stock once. Shortages reopen sourcing without restoring the source balance.
- A material may combine stock from several sites and supplier purchases. New comparisons and supplier awards use the remaining purchase quantity. Earlier frozen reports retain their original quantities.
- Transfers need no supplier PO, payment approval or budget charge. Accounting separately reviews archived generated receipts, current signed receipts and supporting evidence. Drive failure can be retried without undoing delivery.

## Full Disbursement / Upfront

**Finance coordinates external payment → Accounting archives proof and verifies full net payment → Accounting confirms delivery clearance → Logistics schedules delivery.**

- Full verified payment is required before delivery clearance.
- Finance status updates alone do not record payment or authorize delivery.

## Credit / Terms

After supplier issuance, delivery and payment proceed independently:

- **Delivery:** Accounting clears delivery → Logistics schedules and dispatches → Receiving personnel confirm quantities.
- **Payment:** Finance coordinates external payment → Accounting archives proof and verifies partial or full payments against the outstanding net balance.
- Partial payments reduce the balance; full settlement marks the PO Paid. Each payment retains its own proof and history.
- Delivery can proceed while payment is outstanding. Outstanding amounts become overdue after the agreed due date.

## Finance Follow-up

- Finance sets Normal / High / Urgent priority, a next planned payment date and notes.
- Statuses: Pending, Scheduled, Processing, Awaiting Accounting verification or Delayed. Scheduled requires a date; Delayed requires a reason.
- Actual payments happen outside the app. Accounting verifies payment regardless of Finance's coordination status.
- Partial verification resets follow-up to Pending, preserves priority and clears the planned date. Full verification marks it Settled.
- Voiding a credit payment or reopening eligible upfront verification restores follow-up and retains history. Delivery progress is preserved.
- Finance uses Active and Settled views. Full payment moves a record to Settled; its details and coordination history remain available. Legacy disbursements also remain in their Settled view.

## Delivery, Inventory and Documents

- **Supplier → Site:** Site Personnel confirm quantities and shortages/damage, then post accepted materials into site inventory.
- **Supplier → Warehouse → Site:** Procurement confirms warehouse receipt; Logistics dispatches onward; Site Personnel receive and post site inventory.
- New supplier-to-warehouse deliveries default to **155 M. Paterno St., San Juan City**; Logistics can edit the destination before saving. Recorded warehouse addresses and onward-delivery origins remain unchanged.
- Generated delivery receipts must be archived to Drive. Receiving teams upload signed receipts; Accounting can upload missing documents. Procurement gets warehouse receipt reminders and Site Personnel gets site receipt reminders on the dashboard and notification menu. Reminders clear once the current generated and signed receipts are archived; corrected quantities require current-version evidence.
- Accounting completes document review after checking invoice/receipt references and archived evidence, including generated and signed receipts for each received batch.
- Payment, delivery, inventory posting and document completion are separate milestones. There is no single automatic MRF closure rule.

## Existing Records

Older MRFs retain Procurement review. Older Finance-managed POs retain Accounting payment requests → Finance approval → Finance disbursement under **Legacy payment requests**.

Older credit payment requests can cover a partial amount or the full outstanding balance. Previously recorded payments and approved requests remain intact.

## Document references

Projects use separate continuous numbers such as HML-MRF-0001, HML-PO-0001, HML-TRF-0001 and HML-DEL-0001. There is no yearly reset. A saved numbered MRF cannot change projects. Delivery receipts share the delivery number with a version suffix; bid comparison files inherit the MRF number. New archive copies carry the project prefix while original upload names, supplier references and bank references are retained. Existing saved references, report versions and completed archives are unchanged.
