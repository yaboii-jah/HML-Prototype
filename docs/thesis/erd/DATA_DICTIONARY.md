# Core ERD: entity and relationship notes

This proposed 11-entity core business view describes the intended production workflow with authenticated users and shared persistent records. It is not an exhaustive database schema or migration. See the [production design basis](../PRODUCTION_DESIGN.md).

## Entities

| Entity | Meaning |
|---|---|
| User | A named user with one of the seven roles; Administrator is a role, not a separate entity. |
| Project | A construction project with its allocated budget, site location and Drive archive folder. |
| Supplier | Supplier contact and business details used by quotations and POs. |
| MRF | A project material request created by Site Personnel and reviewed by the Project Manager. |
| MRF Item | One requested material, quantity, unit, required date and delivery location. |
| Quotation | A dated supplier offer for an MRF with its currency, review status and source reference. |
| Purchase Order | An order sourced from a quotation, with the actual supplier, reviewed amounts, payment mode and Finance scheduling fields. |
| Verified Payment | Accounting's verification of an external supplier payment using archived proof. |
| Delivery | One scheduled purchasing or site-transfer trip. Exactly one PO or Stock Transfer owns it; the common entity abstracts the prototype's two delivery record types. |
| Inventory Movement | A material-specific project receipt, transfer-out, transfer-in, usage or adjustment; balances are derived from movements. |
| Stock Transfer | An internal sourcing record for one MRF, identifying different source and destination projects. It has no supplier PO or payment obligation. |

## Shown fields and table colors

| Entity | Displayed fields | Header color |
|---|---|---|
| User | user_id, name, email, role, active, created_at | #BCD8F7 |
| Project | project_id, name, location, budget, drive_folder_id | #FFDD8A |
| Supplier | supplier_id, name, contact, email, phone, tin, address | #BBE6CC |
| MRF | mrf_id, project_id, requested_by, reference, request_date, status, instructions | #DAC8F1 |
| MRF Item | item_id, mrf_id, material_name, quantity, unit, needed_date, location, remarks | #F5C3D6 |
| Quotation | quotation_id, mrf_id, supplier_id, reference, quote_date, currency, review_status, source_reference | #BAE8E7 |
| Purchase Order | po_id, mrf_id, quotation_id, supplier_id, reference, payment_mode, status, gross_amount, net_payable, priority, planned_date, due_date | #BBC5F4 |
| Verified Payment | payment_id, po_id, amount, method, reference, payment_date, verified_at, proof_reference | #F7C99E |
| Delivery | delivery_id, po_id, transfer_id, reference, leg, scheduled_date, received_at, status, destination | #DCEB9F |
| Inventory Movement | movement_id, project_id, delivery_id, material_name, unit, kind, quantity, occurred_at | #D2D9E0 |
| Stock Transfer | transfer_id, mrf_id, source_id, destination_id, reference, status, created_at | #F2D4DC |

## Cardinalities

**1:N** means one-to-many (the parent may currently have zero children). **0..1:N** means a child may omit its parent, while that parent can be referenced by many children. The figure uses endpoint symbols only; the cardinality shorthand below is documentation, not a visible connector label. A crossing has no junction meaning; only endpoints attach records.

| Parent | Child | Child FK | Label |
|---|---|---|---|
| User | MRF | requested_by | 1:N |
| Project | MRF | project_id | 1:N |
| MRF | MRF Item | mrf_id | 1:N |
| MRF | Quotation | mrf_id | 1:N |
| Supplier | Quotation | supplier_id | 1:N |
| MRF | Purchase Order | mrf_id | 1:N |
| Quotation | Purchase Order | quotation_id | 1:N |
| Supplier | Purchase Order | supplier_id | 1:N |
| Purchase Order | Verified Payment | po_id | 1:N |
| Purchase Order | Delivery | po_id | 0..1:N |
| Project | Inventory Movement | project_id | 1:N |
| Delivery | Inventory Movement | delivery_id | 0..1:N |
| MRF | Stock Transfer | mrf_id | 1:N |
| Project | Stock Transfer | source_id | 1:N |
| Project | Stock Transfer | destination_id | 1:N |
| Stock Transfer | Delivery | transfer_id | 0..1:N |

## Workflow rules

- A Project contains MRFs and each MRF contains requested items. Scope-of-work budgets and shared material identities remain supporting detail outside this core business view; displayed names are not unique material keys.
- One MRF can receive several supplier quotations and produce multiple POs. Quotation lines, PO lines and allocations preserve split sourcing, source quantities, prices and unit conversions in the complete database; those entities are omitted from this figure.
- Unmatched supplier extras cannot be awarded until their match is reviewed and confirmed. Ordered quantities are reconciled in the requested stock unit.
- PO supplier identity is independent of the source quotation supplier, retaining Accounting vendor edits and original quotation provenance.
- Finance's current payment plan is summarized by PO priority and planned_date. Separate coordination records and history are omitted from this core view.
- Finance's planned_date is separate from Accounting's agreed credit due_date. Actual supplier payment happens outside the app; Accounting verifies it using archived proof. Scheduling never increases paid totals.
- Upfront requires full verified net payment before separate Accounting delivery clearance. Credit allows delivery while unpaid or partly paid, with several verified payments against the PO. Voided payments remain historical and do not count toward settlement.
- One MRF may have zero or many Stock Transfers, each connecting different source_id and destination_id projects. Its destination must match the MRF project. A transfer can have zero or many trips and does not reference a supplier PO or payment.
- A Delivery has exactly one parent: po_id XOR transfer_id. Both FKs are individually nullable, but neither both-set nor both-empty is valid. The visible XOR row is a constraint, not a stored attribute. This common business Delivery entity abstracts Batch and TransferDelivery without prescribing a migration.
- Supporting transfer lines link MRF items to source materials, proposed and released quantities; delivery lines record expected and accepted quantities. One item can combine several sites and supplier purchases. New comparisons use only the remaining purchase quantity, while old snapshots retain their basis.
- Source-assigned Site Personnel confirm release. Dispatch posts transfer-out at the source once; accepted destination quantities post transfer-in once. Reservations and explicit cancellation of undispatched allocations affect availability; shortages reopen demand without restoring dispatched stock. Original costs and budgets remain unchanged. Accounting reviews transfer receipts without invoices or payment proof.
- A PO or Stock Transfer can have several delivery trips. The delivery leg identifies supplier-to-site, supplier-to-warehouse, warehouse-to-site or site-to-site. Detailed delivery lines and warehouse source links are omitted, not replaced by one quantity for a whole delivery.
- Inventory movements identify the project and may reference a delivery batch. Usage, opening and adjustments may omit that reference. The complete database also identifies each material and delivery line; those structures are omitted here. Warehouse receipts do not create site stock. Enforce one posting per accepted site line; balances are derived from movements.

## Supporting details omitted

Document storage and proof associations, allocation drafts, bid comparisons, financial adjustments, reviewed tax settings, audit actors, revision snapshots and coordination history remain outside the figure. proof_reference summarizes archived evidence rather than limiting a payment to one attachment. Approval, payment, delivery clearance, stock posting and document completion are independent milestones. Draft field optionality and submission/finalization validation are not fully represented by the few displayed fields.

Gross amount and net payable summarize reviewed PO financial amounts; detailed VAT, EWT and adjustments remain outside this core figure. Names, units and document references are business summaries, not substitutes for the supporting normalized structures. User has the seven current roles; Administrator is not a separate entity. Project assignments constrain source-site release and destination receipt/posting; their supporting user-project relationships are omitted from the core figure. No supplier portal is assumed. Stable material identity belongs to the supporting production model; displayed names alone do not identify stock. This does not introduce a new material-catalog management feature.

## Sources

- [Current workflow](../../WORKFLOW.md)
- [Current domain records](../../../src/domain/types.ts)
- [Domain glossary](../../../CONTEXT.md)
