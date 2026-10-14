# ConstructSync Core UML Class Model

This thesis domain model uses the 11 business concepts in the [core ERD](../erd/README.md), with essential attributes and selected business operations. It follows the [production design basis](../PRODUCTION_DESIGN.md) and [current workflow](../../WORKFLOW.md). It is the text specification for the [exported class diagram](README.md).

The operations below describe conceptual domain responsibilities. The current application represents these concepts mainly as TypeScript records and implements behavior through command functions; these operation names are not claims about existing instance methods. Attributes, operation lists, and supporting details are intentionally selective.

## Core classes

| Class | Meaning | Essential attributes | Main operations |
|---|---|---|---|
| User | A named account with one department role. | id: UUID; name: String; email: String; role: Role; active: Boolean | updateAccount(); assignProject() |
| Project | A construction project with its site location and budget. | id: UUID; name: String; location: String; budget: Decimal | updateDetails(); allocateBudget(); getStockBalance() |
| Supplier | The supplier whose contact details are used for offers and orders. | id: UUID; name: String; contact: String; phone: String; address: String | getContactDetails() |
| MRF | A project material request submitted by Site Personnel for Project Manager review. | id: UUID; reference: String; requestDate: Date; status: String; instructions: String | submit(); review(decision); revise() |
| MRFItem | One requested material within an MRF. | id: UUID; materialName: String; quantity: Decimal; unit: String; neededDate: Date | updateQuantity() |
| Quotation | A supplier offer for an MRF, reviewed before use in purchasing. | id: UUID; reference: String; quoteDate: Date; currency: String; reviewStatus: String | finalize(); calculateTotal() |
| PurchaseOrder | A supplier order with Accounting-reviewed costing and payment terms. | id: UUID; reference: String; status: String; paymentMode: String; netPayable: Decimal | review(decision); issue(); clearDelivery() |
| VerifiedPayment | Accounting's retained verification of an external supplier payment and its proof. | id: UUID; amount: Decimal; paymentDate: Date; verifiedAt: DateTime; proofReference: String | verify(); void(reason) |
| Delivery | One scheduled supplier, warehouse-forwarding, or site-transfer trip. | id: UUID; reference: String; leg: String; scheduledDate: Date; status: String | schedule(); dispatch(); confirmReceipt() |
| StockTransfer | A request to fulfill an MRF using stock from a different project. | id: UUID; reference: String; status: String; createdAt: DateTime | requestRelease(); reviewRelease(decision); cancelUndispatched() |
| InventoryMovement | A material-specific stock change recorded for a project. | id: UUID; materialName: String; unit: String; kind: String; quantity: Decimal | post() |

### Attribute conventions

- UUID, String, Decimal, Boolean, Date, and DateTime are conceptual attribute types; they do not select an implementation language or database engine.
- Each `id` corresponds to that entity's identifier in the [core schema](../erd/DATABASE_SCHEMA.md). `reference` corresponds to its document reference. Camel-case names express the ERD's attributes in class notation, such as `netPayable` for `net_payable`.
- Related objects appear through associations instead of repeating all foreign-key attributes in the class boxes.
- `Role` has seven values: Administrator, Project Manager, Site Personnel, Procurement, Logistics, Accounting / Auditing, and Finance. Use one User class with a role attribute; department roles do not form User subclasses.
- `InventoryMovement.quantity` is the signed stock effect: receipts and transfer-in increase stock; usage and transfer-out reduce stock; adjustments can increase or reduce stock. Material names and units are display summaries. Stable material identities remain supporting production detail.

## Operation meanings and responsibilities

Operations name business responsibilities without prescribing method signatures, object mutation, or where implementation code must live. Each action still requires the appropriate role and record state. Read operations do not grant permission to change a record.

| Class and operation | Meaning | Responsible role |
|---|---|---|
| User.updateAccount() | Maintain account details, department role, and active state. | Administrator |
| User.assignProject() | Assign a Site Personnel account to one or more projects. | Administrator |
| Project.updateDetails() | Maintain the project's identifying details, location, and budget. | Administrator or Project Manager |
| Project.allocateBudget() | Allocate budget to scopes of work within the project's available budget. Scope records remain supporting detail. | Administrator or Project Manager |
| Project.getStockBalance() | Read the balance for a material and unit by accumulating the project's inventory movements. | Authorized project viewers |
| Supplier.getContactDetails() | Read supplier contact information for purchasing and coordination. | Authorized supplier viewers |
| MRF.submit() | Submit an editable request with its required supporting PDF and at least one valid item. | Site Personnel assigned to the project |
| MRF.review(decision) | Approve, return, or reject a submitted request. | Project Manager for the current workflow |
| MRF.revise() | Edit a draft, returned request, or authorized correction before resubmission. | Site Personnel assigned to the project |
| MRFItem.updateQuantity() | Change a requested quantity through its editable parent MRF. | Site Personnel assigned to the project |
| Quotation.finalize() | Complete review of the offer, its item matches, and financial details so it can be used for purchasing. | Procurement |
| Quotation.calculateTotal() | Calculate the offered total with the applicable discounts, taxes, and charges. | Authorized purchasing viewers |
| PurchaseOrder.review(decision) | Review costing, taxes, charges, budget, and payment terms; approve, hold, return, or reject the order. | Accounting / Auditing |
| PurchaseOrder.issue() | Confirm that the approved, archived PO was sent to the supplier. This marks the PO Served. | Procurement |
| PurchaseOrder.clearDelivery() | Authorize supplier delivery separately from payment verification, subject to the order's payment arrangement. | Accounting / Auditing |
| VerifiedPayment.verify() | Verify an external payment using archived proof; verify full upfront payment or partial/full credit payment as applicable. | Accounting / Auditing |
| VerifiedPayment.void(reason) | Correct a recorded credit payment with a reason, retaining its original details and evidence while removing it from the paid balance. Upfront verification corrections use the separate reopening workflow. | Accounting / Auditing |
| Delivery.schedule() | Schedule a supplier delivery, an onward warehouse delivery, or an approved site-transfer trip. | Logistics |
| Delivery.dispatch() | Confirm departure from the origin. A site-transfer dispatch also records source stock deduction once. | Logistics |
| Delivery.confirmReceipt() | Record accepted quantities and shortages or damage at the receiving location. It does not post destination site stock. | Procurement for company-warehouse receipt; assigned destination Site Personnel for site receipt |
| StockTransfer.requestRelease() | Request source-site release after verifying matching stock descriptions, units, availability, and uncovered MRF demand. | Procurement |
| StockTransfer.reviewRelease(decision) | Approve the quantities the source site can spare, reduce them, or reject the release request. | Site Personnel assigned to the source project |
| StockTransfer.cancelUndispatched() | Cancel undispatched quantities with a reason and release the associated reservations. | Procurement |
| InventoryMovement.post() | Record a stock effect once. Accepted site receipts are posted after receiving; usage and adjustments are recorded separately. Transfer-out is linked to dispatch. | Site Personnel for site receipts, usage, and adjustments; Accounting / Auditing for adjustments; Logistics initiates the automatic transfer-out effect through dispatch |

The selected operations omit routine actions such as PO draft preparation, submission, Finance follow-up, and evidence uploads from the class compartments. Those capabilities remain part of the workflow and supporting structures.

## Associations and multiplicities

Read `Project 1 — 0..* MRF` as: each MRF belongs to exactly one Project, and one Project may have zero or many MRFs. `0..1` means an optional single object. Use ordinary associations except for the stated MRF-item composition.

| Relationship | Meaning |
|---|---|
| User 1 — 0..* MRF | One named requesting account creates each MRF; an account may create many requests. |
| User 0..* — 0..* Project | Site assignments link Site Personnel accounts to projects. Projects may have several assigned accounts. |
| Project 1 — 0..* MRF | Each request belongs to one project. |
| MRF 1 — 0..* MRFItem | Composition: each item belongs to one MRF and is part of its lifecycle. Drafts may have no items; submission requires at least one valid item. |
| MRF 1 — 0..* Quotation | A request may receive offers from several suppliers. |
| Supplier 1 — 0..* Quotation | Each quotation identifies its offering supplier. |
| MRF 1 — 0..* PurchaseOrder | One request may be fulfilled through several supplier orders. |
| Quotation 1 — 0..* PurchaseOrder | Each supplier PO retains its source quotation. |
| Supplier 1 — 0..* PurchaseOrder | Each PO identifies its effective supplier independently of the source quotation. |
| PurchaseOrder 1 — 0..* VerifiedPayment | An order may have several payment verifications, including partial credit payments. |
| PurchaseOrder 0..1 — 0..* Delivery | A purchasing delivery has one PO owner; a stock-transfer delivery has no PO owner. |
| StockTransfer 0..1 — 0..* Delivery | A transfer delivery has one StockTransfer owner; a purchasing delivery has no transfer owner. |
| MRF 1 — 0..* StockTransfer | A request may use stock from several source projects. |
| Project 1 — 0..* StockTransfer (source) | Every transfer identifies one source project. Name this association end `source`. |
| Project 1 — 0..* StockTransfer (destination) | Every transfer identifies one destination project. Name this association end `destination`. |
| Project 1 — 0..* InventoryMovement | Each movement affects stock within one project. |
| Delivery 0..1 — 0..* InventoryMovement | A movement may identify its delivery. Usage and adjustments can omit this association. |

### Relationship constraints

- **Exactly one delivery owner:** A Delivery belongs to either one PurchaseOrder or one StockTransfer, exclusively. Mark the pair of owner associations with `{xor}` and the note "exactly one owner". Both populated and both absent are invalid.
- **Transfer projects:** Source and destination must differ. The destination must equal the project of the transfer's MRF.
- **Site authorization:** The User-Project assignment association applies to Site Personnel. Project Manager review spans projects without requiring such assignments. Account associations identify responsibility; they do not replace role permissions.
- **Requesting account:** The User-MRF relationship identifies a named account in the production model. A printed MRF signatory is separate document metadata. The prototype's `requestedBy` text must not be interpreted as a User foreign key.
- **Stock effects:** Warehouse receiving does not create site stock. Site receiving and posting are separate milestones. Each accepted site line is posted once; one multi-material delivery can produce several movements. A stock transfer deducts source stock once at dispatch and adds accepted destination stock once at posting.
- **Reservations:** Reserved, undispatched source stock remains on hand but is unavailable for other consumption. `getStockBalance()` describes on-hand balance; available stock also accounts for reservations.
- **Payments:** Finance's planned payment date and coordination status do not establish payment. Upfront clearance requires full verified payment. Credit delivery can proceed after Accounting clearance while a balance remains unpaid or partly paid. Voiding a credit payment retains history and does not undo delivery.

## Supporting detail and implementation correspondence

Quotation items, PO items, delivery items, transfer items, supplier awards, project scopes, material identities, documents/proof versions, receipt snapshots, historical actors, Finance coordination, tax details, and audit records remain outside the 11-class view. Detailed quantities, prices, evidence, and rules remain in those supporting structures; the class boxes do not replace them with a single material or attachment for an entire order.

Supplier-to-warehouse deliveries can supply multiple onward warehouse-to-site trips. Their warehouse source links are supporting detail. Existing stock-suitability reviews remain actionable, while new matching-stock selections go directly to source-release requests. Legacy payment requests and disbursements are outside this current-workflow overview.

| Thesis class | Current implementation evidence |
|---|---|
| User | `ManagedUser` in the user directory, with one `Role`; audit identities preserve the acting account. |
| Project | `Site` in the domain records. |
| Supplier | `Supplier`, with additional quotation contact details in `SupplierQuoteDetails`. |
| MRF | `MRF`, with its request archive and correction records. |
| MRFItem | `Item`, contained in `MRF.items`. |
| Quotation | `Quote`, with `QuoteLine` and financial details. |
| PurchaseOrder | `PO`, with its lines, financial review, issuance, payment coordination, and clearance. |
| VerifiedPayment | `ExternalPayment` and `CreditPayment`, retained within a PO. |
| Delivery | The conceptual common view of `Batch` and `TransferDelivery`; no implemented shared superclass is implied. |
| StockTransfer | `StockTransfer`, with its source/destination projects and transfer lines. |
| InventoryMovement | `Movement`; balances are derived through selectors and stock helpers. |

The MRFItem composition describes domain ownership. It does not introduce a database cascade-delete policy. Existing code services, repositories, browser storage, and authentication machinery belong to implementation architecture documentation rather than these core class boxes.

## Validation scenarios

Use these scenarios to review a diagram prepared from this specification. They are documentation acceptance checks, not newly executed application tests.

| Scenario | Expected model behavior |
|---|---|
| An MRF requests 100 units, sourced through POs for 40 and 20 units plus a transfer for 40 units. | One MRF supports multiple POs and a StockTransfer together. Detailed item classes retain the quantity allocations. |
| A credit PO has a PHP 100,000 net payable and PHP 40,000 verified payment. | The remaining balance is PHP 60,000. Accounting can clear delivery independently of full settlement; Finance planning alone cannot increase the paid total. |
| An upfront PO has a PHP 100,000 net payable and PHP 40,000 verified payment. | Delivery clearance remains blocked until full verified payment. |
| A supplier delivers to the company warehouse before the materials are forwarded to the project site. | Procurement confirms warehouse receipt; Logistics schedules and dispatches onward trips; destination Site Personnel receive and separately post site stock. |
| A StockTransfer supplies an MRF at Project B using stock at Project A. | The source is A, the destination is B, and B owns the MRF. Its trips have transfer ownership and no supplier PO/payment dependency. |
| A posting action is retried after accepted site quantities were already posted. | No duplicate receipt movement is created for an accepted site line. |
| Site Personnel record usage or Accounting records an adjustment without a delivery. | The movement still belongs to a project; its Delivery association may be absent. |

## Sources

- [Production design basis](../PRODUCTION_DESIGN.md)
- [Core ERD model](../erd/model.mjs), [entity and relationship notes](../erd/DATA_DICTIONARY.md), and [core schema](../erd/DATABASE_SCHEMA.md)
- [Current workflow](../../WORKFLOW.md) and [domain glossary](../../../CONTEXT.md)
- [Domain records](../../../src/domain/types.ts), [domain commands](../../../src/domain/commands.ts), [stock-transfer behavior](../../../src/domain/stock-transfers.ts), and [user directory](../../../src/app-state/user-directory.ts)
- [Sparx Systems: UML class diagram notation](https://sparxsystems.com/resources/tutorials/uml2/class-diagram.html) — classes, attributes, operations, associations, multiplicity, generalization, and composition.
