# ConstructSync diagram design basis

The ERD, context diagram, Level 1 DFD and combined process flow describe the intended production ConstructSync application. The prototype provides a reference for business features and rules; its browser-local storage, simulated sign-in and presenter controls are not assumptions of this design.

## Production assumptions

- Named users authenticate through a server-validated identity. The server enforces role permissions for records, decisions and document operations. Administrator is a user role, not a separate account entity.
- Operational records are persistent and shared across authorized users. Related updates must maintain consistency when users work concurrently. Local browser state is not the authoritative company record.
- The relational model uses stable record identifiers and foreign keys. Supporting structures retain material identities, scope allocations, quotation/PO/delivery lines, source allocations, financial adjustments and historical actor attribution.
- Google Drive is the company document archive. The application retains file identifiers, record associations, archive outcomes and evidence versions. Credentials remain server-controlled; a browser-only upload is not sufficient archived evidence.
- AI produces draft fields and matching suggestions. Authorized people review these before approval or finalization. AI does not make purchasing, payment or delivery decisions.
- Finance coordinates supplier payments processed outside ConstructSync. Accounting records verified payments with archived proof and separately authorizes delivery clearance. No bank integration or supplier portal is assumed.

These assumptions establish the logical design basis. They do not select a database or authentication provider, specify a complete physical schema, or claim that production infrastructure is already deployed.

## Consistency across figures

| Production function | Core ERD representation | Level 1 process / logical store | Process flow coverage |
|---|---|---|---|
| Users, projects, scopes and budgets | User, Project; scopes and allocations are supporting structures | 1.0 / D1 | Project setup and budget review |
| Material requests and review | MRF, MRF Item | 2.0 / D2 | Submission, approval, return and rejection |
| Supplier offers, allocations and orders | Supplier, Quotation, Purchase Order; offer/order lines and allocations are supporting structures | 3.0 / D3 | Quotation review, comparison, allocation, PO review and issuance |
| Payment coordination, verification and clearance | Purchase Order planning fields, Verified Payment; clearance and history are supporting structures | 4.0 / D4 | Upfront payment gate and independent credit payment/delivery paths |
| Delivery batches and project stock | Delivery, Inventory Movement; material/delivery lines and warehouse source links are supporting structures | 5.0 / D5 | Direct delivery, warehouse transfer, site receiving and stock posting |
| Extraction, evidence and archiving | Source/proof references summarize supporting document associations and versions | 6.0 / D6; AI and Google Drive are external entities | Reviewed extraction and archived purchasing, payment and receipt evidence |

The context diagram summarizes the same external information exchanges as Level 1. DFD stores group related records and are not individual SQL tables. Process-flow arrows show activity progression; DFD arrows show information movement.

## Core rules retained

- One MRF can have several quotations and supplier POs. Each PO can have multiple verified payments and delivery batches.
- A PO's effective supplier may differ from its quotation supplier; original quotation provenance remains available.
- Finance's planned payment date is distinct from Accounting's agreed credit due date. Scheduling does not establish payment.
- Upfront delivery clearance requires full verified net payment. Credit delivery can proceed after Accounting clearance while the balance remains unpaid or partly paid.
- Warehouse receipt does not post site inventory. Accepted site lines produce stock receipts; usage and adjustments may have no delivery reference. Duplicate receipt posting must be prevented.
- Voided payments remain historical and are excluded from settlement totals. Payment, delivery, stock posting and document review remain separate milestones.

## Review outcome and intentional simplifications

Reviewed on 2026-10-11. The core relationships, balanced data exchanges and revised process branches are compatible with this production basis. No figure changes were required by this review.

The ten-entity ERD intentionally omits supporting tables; its displayed names and document references do not replace normalized identities or attachment associations. The complete schema also needs scopes/budgets, offered and ordered lines, delivery lines, material matching and allocations, warehouse forwarding links, documents/proof versions, approval and clearance records, tax/charge details, coordination history and audit records. Draft optionality, credential/session structures and concurrency controls are not fully specified in the core figure.

The DFD describes business information, not browser storage or a deployment architecture. The process flow summarizes business activities rather than screens, retries or technical infrastructure. These omissions keep the paper figures readable without inheriting prototype limitations.

Maintain this basis when business rules change, together with the [ERD notes](erd/DATA_DICTIONARY.md), [DFD flow register](dfd/FLOW_REGISTER.md) and [process flow notes](pfd/README.md). Application code is implementation evidence, not authority for importing prototype shortcuts into the production design.
