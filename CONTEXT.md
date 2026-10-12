# ConstructSync purchasing and delivery

## Language

**Department account:** A named browser-local sign-in identity managed by Administrator and linked to one of the seven department roles.
_Avoid_: Demo role, role picker

**Department session:** The active department account, retained until sign-out. A different account begins a new session.

**Workspace:** The linked projects, requests, purchasing, delivery and stock records shared by department accounts during a walkthrough.

**Project budget:** The total allocation available to a project. Its cap covers scope allocations and existing committed/spent funds.

**Project document code:** A unique uppercase prefix chosen by Administrator or Project Manager. New document references use `CODE-TYPE-0001`, with separate continuous sequences for MRFs, POs and deliveries. The code locks when first used on a saved record or archived-copy identity. Existing references remain unchanged.

**Source MRF number:** The original number printed on an imported or manually entered paper MRF. It is separate from ConstructSync's automatic reference and does not control its sequence.

**Scope of work:** A named work package within one project, such as Structural or Civil. Each MRF belongs to one scope; the supporting scope document is separate.

**Unused scope:** A scope with no MRF referencing it, including drafts, returned and rejected requests. Removing it returns its allocation to unallocated project funds without changing the project budget.

**Scope allocation:** The portion of the project's budget allotted to a scope by Project Manager or Administrator. Allocations share the project cap and cover both Goods and Services.

**Available scope budget:** The scope allocation remaining after approved commitments and recorded spending. An unpriced MRF does not reserve these funds.

**Goods:** Requested materials and supplier material offers that can be ordered and received.

**Item match confirmation:** Procurement explicitly confirms that an offered material refers to the linked requested material. This does not approve its price, quantity, taxes or supplier payment.

**Eligible item match:** An unconfirmed, high-confidence suggested item link with the same quantity and unit, no conversion, and no outstanding line issue or printed-amount difference. Procurement may confirm these links together after checking the source; partial offers and uncertain matches receive individual confirmation.

**PHP quotation:** A supplier quotation priced in Philippine pesos. Missing currency defaults to PHP; an explicitly detected foreign currency must be replaced with a PHP quotation or corrected by re-extraction before finalization. Existing finalized records retain their recorded currency.

**Services:** Non-material fees, such as delivery or installation charges. Taxes and discounts remain financial adjustments.

**Audit actor:** The named department account responsible for an action when it happens. This is separate from a signatory printed on a document.

**Audit event:** A recorded action with its actor, time, affected record and any changed fields or required reason. Historical events retain their original attribution.

**MRF lifecycle:** The connected history and current progress of a material request, its quotations, purchasing, payments and deliveries. Credit payment and delivery progress are independent.

**Served MRF:** A request whose complete material quantities are covered by purchase orders released to Logistics and source-approved site stock transfers, adjusted for transfer shortages.

**Delivered MRF:** A request whose complete material quantities have been accepted at the project site. Warehouse receipt is an intermediate stage; stock posting and payment are separate milestones.

**Lifecycle checklist:** Automatic, independent progress indicators derived from each MRF and its related records. Partial quantities remain visible until every requested material is covered.

**Started operation:** File preparation or archiving initiated by an authorized account. Its recorded responsibility stays with the initiating account; a later retry is a new action.

**MRF review:** The Project Manager's decision to approve, return or reject a material request from Site Personnel in the revised workflow. Procurement review applies to older requests using the legacy workflow.

**PO review:** Accounting's review of a purchase order, including its taxes, charges, payment mode and project budget.
_Avoid_: Finance PO approval

**Quotation total:** The gross value of the offered materials and included charges after discounts and the quotation's VAT treatment, before withholding deductions.

**Comparative bid:** A side-by-side comparison of supplier material offers for the full requested MRF quantities. Missing and short offers remain visible; comparison choices do not purchase materials.

**Comparable material price:** The offered material price after item discounts, including VAT where applicable, converted to the requested material unit. Quotation-wide charges, discounts and EWT remain separate. A fixed discount is spread over the quoted quantity for comparison; its use on a partial purchase still needs confirmation.

**Supplier award:** Procurement's saved choice of a supplier offer and purchase quantity for a requested material. A material may be split between offers. Awards account for existing orders, persist until PO draft creation, and are distinct from comparison-offer choices.

**Estimated supplier payable:** The quotation total less calculated goods and services EWT. This is a quotation estimate, separate from Accounting's payment verification and the actual supplier settlement.

**Calculated EWT:** Withholding derived from the VAT-exclusive goods and services amounts at 1% and 2% respectively. NON VAT quotations and orders have zero calculated EWT.

**Manual EWT override:** An Accounting-entered withholding amount retained until Accounting restores calculated EWT.

**Effective PO supplier:** The supplier currently named on the purchase order, which may differ from the original quotation's supplier following Accounting review.

**Payment request:** Accounting's legacy request for Finance to approve and disburse a specified amount against a PO. It belongs to the earlier Finance-managed payment flow.
_Avoid_: Payment, receipt

**Disbursement:** A legacy payment recorded by Finance against an approved payment request. Approval alone is not disbursement; revised workflows use external payment verification.

**Release to Logistics:** Accounting's authorization for delivery scheduling after PO review and required payment conditions are satisfied.
_Avoid_: Serve PO

**Upfront order:** A PO requiring full verified supplier payment before release to Logistics.

**Credit / terms order:** A PO allowing delivery after approval and supplier issuance before full payment. Settlement can comprise partial payments toward an agreed due date.

**External payment verification:** Accounting's confirmation of a supplier payment processed outside ConstructSync by Finance, supported by archived proof. A credit payment can settle part or all of the outstanding balance.

**Payment due date:** The agreed date for settling the outstanding supplier balance. A remaining credit balance becomes overdue on the following Philippine calendar day, independently of delivery progress.

**Payment coordination:** Finance's prioritization and follow-up of supplier payments processed outside ConstructSync. A scheduled or processing payment is distinct from an Accounting-verified payment.

**Planned payment date:** Finance's intended date for the next external payment. It is separate from Accounting's agreed payment due date and does not establish that payment occurred.

**Inventory movement:** A project stock receipt, usage or adjustment. The inventory balance is the accumulated effect of these movements.

**Stock transfer:** A Procurement proposal to fulfill an approved MRF using materials held at another project site. Source Site Personnel confirm the quantities that may be released; one transfer may use several delivery trips.

**Stock reservation:** Undispatched stock held for a proposed or approved transfer. It remains physically on hand but cannot be used or allocated to another transfer until released.

**Available site stock:** Posted project stock remaining after transfer reservations. Materials in transit and receipts awaiting stock posting are excluded.

**Transfer delivery:** One scheduled trip from a source project to the MRF's destination project. Dispatch reduces source stock; destination receiving and posting are separate actions.

**Sourcing coverage:** Requested quantities committed to stock transfers, supplier awards, or purchase orders. Coverage prevents duplicate sourcing; it does not mean the goods have arrived.

**Site assignment:** An Administrator's association of a Site Personnel account with one or more projects, authorizing that account's site actions.

**Pooled project stock:** The balance of a material and unit within one project, shared across scopes of work. Selecting a scope shows materials received for that scope while retaining their full project balance; it does not attribute usage to a scope.

**Shared material identity:** A proposed production identity for the same material across requests and inventory movements. Its displayed name alone does not establish uniqueness.

**Voided payment:** A recorded payment corrected with a reason, excluded from the paid balance while its original details and evidence remain in history. Voiding does not revoke delivery clearance or change receiving records.

**Document review:** Accounting's review of invoice and receipt evidence, separate from PO approval and payment approval.

**Company warehouse:** An intermediate receiving location where Procurement confirms goods against a PO. Its receipts supply onward batches for the original site.

**Site warehouse:** The project's receiving and inventory location, handled by Site Personnel.

**Delivery leg:** One scheduled movement of goods from supplier to site, supplier to company warehouse, or company warehouse to site.

**Dispatch:** Logistics' recorded confirmation that a scheduled delivery has left its origin.

**Warehouse forwarding:** Allocation and dispatch of accepted warehouse goods to their original PO's site. A shortage at site does not restore the dispatched allocation.

**Delivery receipt:** The company document showing a leg's expected and recorded accepted quantities. A pending receipt identifies goods awaiting confirmation.

**Generated receipt snapshot:** The company-produced delivery receipt preserving quantities and receiver details at confirmation or a later posting correction. Earlier snapshots remain distinct from corrected ones.
_Avoid_: Signed receipt, payment proof

**Signed delivery receipt:** Uploaded delivery paperwork bearing a receiving acknowledgment, linked to a particular delivery and its recorded quantities. Accounting checks its signature and contents separately from the generated receipt.
_Avoid_: Generated receipt, payment receipt

**PO-level document:** Invoice or supporting paperwork associated with a purchase order as a whole rather than a particular delivery batch.

**Site Personnel / Warehouse:** The role that requests materials, confirms site receiving, posts stock and records material usage.
