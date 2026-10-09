# ConstructSync purchasing and delivery

## Language

**Department account:** A predefined sign-in identity linked to one of the seven department roles.
_Avoid_: Demo role, role picker

**Department session:** The active department account, retained until sign-out. A different account begins a new session.

**Workspace:** The linked projects, requests, purchasing, delivery and stock records shared by department accounts during a walkthrough.

**Project budget:** The total allocation available to a project. Its cap covers scope allocations and existing committed/spent funds.

**Scope of work:** A named work package within one project, such as Structural or Civil. Each MRF belongs to one scope; the supporting scope document is separate.

**Unused scope:** A scope with no MRF referencing it, including drafts, returned and rejected requests. Removing it returns its allocation to unallocated project funds without changing the project budget.

**Scope allocation:** The portion of the project's budget allotted to a scope by Administrator. Allocations share the project cap and cover both Goods and Services.

**Available scope budget:** The scope allocation remaining after approved commitments and recorded spending. An unpriced MRF does not reserve these funds.

**Goods:** Requested materials and supplier material offers that can be ordered and received.

**Services:** Non-material fees, such as delivery or installation charges. Taxes and discounts remain financial adjustments.

**Audit actor:** The named department account responsible for an action when it happens. This is separate from a signatory printed on a document.

**Audit event:** A recorded action with its actor, time, affected record and any changed fields or required reason. Historical events retain their original attribution.

**MRF lifecycle:** The connected history and current progress of a material request, its quotations, purchasing, payments and deliveries. Credit payment and delivery progress are independent.

**Served MRF:** A request whose complete material quantities are covered by purchase orders released to Logistics.

**Delivered MRF:** A request whose complete material quantities have been accepted at the project site. Warehouse receipt is an intermediate stage; stock posting and payment are separate milestones.

**Lifecycle checklist:** Automatic, independent progress indicators derived from each MRF and its related records. Partial quantities remain visible until every requested material is covered.

**Started operation:** File preparation or archiving initiated by an authorized account. Its recorded responsibility stays with the initiating account; a later retry is a new action.

**MRF review:** Procurement's decision to accept, return or reject a material request from Site Personnel.

**PO review:** Accounting's review of a purchase order, including its taxes, charges, payment mode and project budget.
_Avoid_: Finance PO approval

**Calculated EWT:** Withholding derived from the VAT-exclusive goods and services amounts at 1% and 2% respectively. NON VAT quotations and orders have zero calculated EWT.

**Manual EWT override:** An Accounting-entered withholding amount retained until Accounting restores calculated EWT.

**Effective PO supplier:** The supplier currently named on the purchase order, which may differ from the original quotation's supplier following Accounting review.

**Payment request:** Accounting's request for Finance to approve and disburse a specified amount against a PO.
_Avoid_: Payment, receipt

**Disbursement:** A payment recorded by Finance against an approved payment request. Approval alone is not disbursement.

**Release to Logistics:** Accounting's authorization for delivery scheduling after PO review and required payment conditions are satisfied.
_Avoid_: Serve PO

**Upfront order:** A PO requiring full recorded disbursement before release to Logistics.

**Credit / terms order:** A PO whose delivery can proceed independently of payment processing after Accounting review.

**Document review:** Accounting's review of invoice and receipt evidence, separate from PO approval and payment approval.

**Company warehouse:** An intermediate receiving location where Procurement confirms goods against a PO. Its receipts supply onward batches for the original site.

**Site warehouse:** The project's receiving and inventory location, handled by Site Personnel.

**Delivery leg:** One scheduled movement of goods from supplier to site, supplier to company warehouse, or company warehouse to site.

**Dispatch:** Logistics' recorded confirmation that a scheduled delivery has left its origin.

**Warehouse forwarding:** Allocation and dispatch of accepted warehouse goods to their original PO's site. A shortage at site does not restore the dispatched allocation.

**Delivery receipt:** The company document showing a leg's expected and recorded accepted quantities. A pending receipt identifies goods awaiting confirmation.

**Site Personnel / Warehouse:** The role that requests materials, confirms site receiving, posts stock and records material usage.
