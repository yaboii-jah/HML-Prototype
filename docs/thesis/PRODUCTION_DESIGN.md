# ConstructSync diagram design basis

The ERD, context diagram, Level 1 DFD and six connected process flowcharts describe the intended production ConstructSync application. The prototype provides a reference for business features and rules; its browser-local storage, simulated sign-in and presenter controls are not assumptions of this design.

## Production assumptions

- Named users authenticate through a server-validated identity. The server enforces role permissions for records, decisions and document operations. Administrator is a user role, not a separate account entity.
- Operational records are persistent and shared across authorized users. Related updates must maintain consistency when users work concurrently. Local browser state is not the authoritative company record.
- The relational model uses stable record identifiers and foreign keys. Supporting structures retain material identities, scope allocations, quotation/PO/delivery lines, source allocations, financial adjustments and historical actor attribution.
- Google Drive is the company document archive. The application retains file identifiers, record associations, archive outcomes and evidence versions. Credentials remain server-controlled; a browser-only upload is not sufficient archived evidence.
- AI produces draft fields and matching suggestions. Authorized people review these before approval or finalization. AI does not make purchasing, payment or delivery decisions.
- Finance coordinates supplier payments processed outside ConstructSync. Accounting records verified payments with archived proof and separately authorizes delivery clearance. No bank integration or supplier portal is assumed.
- An approved MRF can use other-project stock, supplier purchases or both, including splitting one item's quantity. Reservations must protect source availability and MRF demand together. Source-assigned Site Personnel authorize release; destination-assigned personnel receive and post stock.

These assumptions establish the logical design basis. They do not select a database or authentication provider, specify a complete physical schema, or claim that production infrastructure is already deployed.

## Consistency across figures

| Production function | Core ERD representation | Level 1 process / logical store | Process flow coverage |
|---|---|---|---|
| Users, projects, scopes and budgets | User, Project; scopes, assignments and allocations are supporting structures | 1.0 / D1 | Request overview: configured project prerequisite; purchasing: budget review |
| Material requests and review | MRF, MRF Item | 2.0 / D2 | Request overview: submission, approval, return and rejection |
| Supplier offers, allocations and orders | Supplier, Quotation, Purchase Order; detailed lines and allocations are supporting structures | 3.0 / D3 | Request overview: quantity allocation; purchasing: offers, PO review and issuance |
| Other-project stock sourcing | Stock Transfer, MRF and source/destination Project relationships; material-level transfer lines are supporting structures | 3.0 / D3, reading D5 stock; 5.0 records release decisions in D3 | Site transfer: matching verification, availability check, source release, resourcing and dispatch |
| Payment coordination, verification and supplier clearance | Purchase Order planning fields, Verified Payment; clearance and history are supporting structures | 4.0 / D4 | Payment coordination: upfront payment gate and independent credit payment/delivery paths |
| Purchasing/transfer trips and project stock | Shared Delivery, Inventory Movement; delivery lines and warehouse source links are supporting structures | 5.0 / D5, with sourced quantities in D3 | Site transfer: source deduction; delivery/receiving: supplier scheduling, direct/warehouse paths, receiving and destination stock posting |
| Extraction, evidence and archiving | Source/proof references summarize supporting document associations and versions | 6.0 / D6; AI and Google Drive cross the application boundary | Purchasing: PO archive; payment coordination: payment evidence; receipt review: warehouse/site receipt archives and Accounting review |

The context diagram summarizes the same external information exchanges as Level 1. Its ten external participants are logical information sources and recipients. Supplier originates quotations and receives issued purchase orders through Procurement; suppliers do not directly access the application. Supplier arrows represent document provenance and destination, while Procurement arrows represent reviewed quotation data, sourcing decisions, transfers and PO preparation. This business-information view does not imply a supplier portal or integration. DFD stores group related records and are not individual SQL tables. Process-flow arrows show activity progression; DFD arrows show information movement.

The request and fulfillment overview introduces five focused process figures. Descriptive starting events and process handoffs connect these figures independently of their captions. Issued supplier POs begin payment coordination; cleared supplier deliveries proceed to scheduling; dispatched site transfers proceed directly to destination receiving. The Credit connector routes independent delivery-clearance and payment work. Warehouse and site evidence each proceeds to receipt review independently of site inventory posting. Reduced source releases and missing transfer quantities return to material sourcing without restoring dispatched source stock.

## Core rules retained

- One MRF can have several quotations and supplier POs. Each PO can have multiple verified payments and delivery batches.
- One MRF can have several Stock Transfers. A transfer has different source and destination projects, with its destination matching the MRF project, and can have several trips.
- Delivery has exactly one source: a PO or Stock Transfer. Both displayed foreign keys are individually optional, but the mandatory XOR constraint excludes both-set and both-empty records. This business abstraction covers the prototype's Batch and TransferDelivery collections without prescribing a database migration.
- Stock proposals reserve availability and demand. Source personnel may approve fewer quantities or reject release. Explicit cancellation releases undispatched allocations. New bid comparisons use remaining purchase quantities; historical reports retain their original basis.
- Current transfer requests proceed from Procurement's verification of matching descriptions, units and available quantities directly to source-site release confirmation. The current transfer figure omits the destination suitability-review path retained for previously submitted reviews.
- Dispatch deducts source stock once; accepted destination quantities are posted once. Shortages reopen demand without restoring dispatched stock. Transfers preserve original costs and budgets, require no PO/payment/supplier clearance, and retain Accounting receipt evidence review.
- A PO's effective supplier may differ from its quotation supplier; original quotation provenance remains available.
- Finance's planned payment date is distinct from Accounting's agreed credit due date. Scheduling does not establish payment.
- Upfront delivery clearance requires full verified net payment. Credit delivery can proceed after Accounting clearance while the balance remains unpaid or partly paid.
- Warehouse receipt does not post site inventory. Accepted site lines produce stock receipts; usage and adjustments may have no delivery reference. Duplicate receipt posting must be prevented.
- Voided payments remain historical and are excluded from settlement totals. Payment, delivery, stock posting and document review remain separate milestones.

## Review outcome and intentional simplifications

Updated and checked on 2026-10-13. The ERD represents independent stock transfers, Levels 0/1 include transfer information, and six connected flowcharts separate PO processing, payments, transfers, inventory and receipt review. The previous four-figure set and older historical exports remain available but are not the current thesis figures.

The eleven-entity ERD intentionally omits supporting tables; its displayed names and document references do not replace normalized identities or attachment associations. The complete schema also needs scopes/budgets, user-project assignments, offered and ordered lines, transfer/delivery lines, material matching and allocations, warehouse forwarding links, documents/proof versions, source release and purchase clearance records, tax/charge details, coordination history and audit records. Draft optionality, credential/session structures and concurrency controls are not fully specified in the core figure.

The DFD describes business information, not browser storage or a deployment architecture. Levels 0 and 1 remain the main overview figures; no Level 2 is introduced. The flowcharts summarize business activities rather than screens, retries or technical infrastructure. These omissions keep the paper figures readable without inheriting prototype limitations. [Diagram convention references](research/diagram-conventions.md) distinguish published guidance from these project-specific modeling choices.

Maintain this basis when business rules change, together with the [ERD notes](erd/DATA_DICTIONARY.md), [DFD flow register](dfd/FLOW_REGISTER.md) and [process flow notes](pfd/README.md). Application code is implementation evidence, not authority for importing prototype shortcuts into the production design.
