# HML ConstructSync

## Overview

HML ConstructSync is an internal construction materials operations system for HML Technologies and Services Inc. It gives Site Personnel, Project Managers, Procurement, Accounting, Finance, Logistics and Administrators a shared way to follow each material request through sourcing, purchasing, payment verification, delivery and stock posting, alongside project inventory and material usage. Its main purpose is traceability across departments: staff can see the related records, responsible people, supporting documents, completed actions and outstanding work for a request.

> **Current status:** Production migration is in progress. The migration branch implements Supabase sessions, Administrator account management, shared projects/scopes, protected realtime, MRF drafts and supporting PDFs. Foundation units 3.1-3.6 and MRF unit 4.1 are verified complete. Unit 4.2 is verified complete, including explicit manual acceptance. Unit 4.3 submission, PM review, archives and corrections are verified complete as of 2026-11-04 after explicit confirmation of all three manual-review groups and passing combined acceptance. These MRF actions are available. Unit 4.4 supplier directory is verified complete on 2026-11-04, including all three explicit manual confirmations and passing combined acceptance. Unit 4.5a manual quotation capture and originals is verified complete on 2026-11-05, including all three manual confirmations and passing combined acceptance. Unit 4.5b financial finalization and revisions are verified complete on 2026-11-06, including all three explicit manual confirmations and matching combined acceptance. Parent 4.5 is complete. Internal 4.6 demand allocation is verified complete on 2026-11-06 at `7e9b3a0`; internal 4.7 stock ledger/reservations are verified at `e749844`. Purchasing preparation is verified complete in 4.8 below; staff stock workflows remain unavailable. This overview defines the intended complete system, not production readiness.

See [architecture context](architecture.md) for the technical boundaries and production migration responsibilities.

Unit 4.8 purchasing preparation is verified complete on 2026-11-07 at `f1248bc`. Comparisons and retained PDF/XLSX versions, explicit split supplier awards and numbered PO drafts with reviewed partial-order amounts pass automated, live-artifact and staging checks, all three explicit human-review groups with no skipped checks, and matching combined acceptance. Accounting review, gross commitments and approved-PO archives are verified complete in 4.9 on 2026-11-08 at `e00f8fd`, including all three explicit human confirmations and matching combined acceptance. Supplier issuance is verified complete in 4.10 on 2026-11-08 at `77e3965`, with automated/staging/Drive checks, explicit confirmation of all three human groups including assisted checks without skips/issues, and matching combined acceptance.

## Goals

1. Make each material request traceable to its applicable stock transfers, supplier quotations, purchase orders, verified payments, deliveries and supporting documents.
2. Give every required departmental action an identifiable responsible role, visible prerequisites and recorded actor history.
3. Keep project stock, scope budgets and outstanding payment balances consistent with approved and verified transactions, including partial fulfilment and split sourcing.
4. Keep operational records and their supporting evidence accessible to authorized staff across devices, with visible status and recovery paths when document processing fails.

## Core User Flow

The steps outline the main workflow. A request can split across source projects and suppliers; stock transfers and purchases can proceed in parallel. Payment, delivery, inventory posting and document review retain separate milestones rather than sharing one automatic request-closure status.

1. **Sign in:** Staff use their individual accounts and an assigned role. Site Personnel work within their assigned projects.
2. **Set up the project:** Administrator or Project Manager configures the project, document code, budget, scope allocations and document destination. Administrator assigns Site Personnel to projects.
3. **Request materials:** Site Personnel prepares a Material Requisition Form (MRF), chooses the project and scope, records the material requirements and attaches supporting documents. Any AI-extracted content is reviewed before submission.
4. **Review the request:** Project Manager approves, returns or rejects the MRF. Approved request documents enter the archive process, and outstanding requirements remain visible before dependent actions proceed.
5. **Plan sourcing:** Procurement checks other projects' stock and supplier offers, allocating available stock and purchasing the uncovered quantities. A material can be sourced from several projects or suppliers.
6. **Follow the stock-transfer branch:** Where a stock description differs or its match is uncertain, the requesting site's personnel confirm that it meets the same requested specifications. Source Site Personnel approve release; Logistics schedules and dispatches the transfer; destination Site Personnel receives the materials and posts accepted quantities to inventory.
7. **Follow the purchasing branch:** Procurement reviews supplier quotations, compares offers, confirms awards and submits purchase orders (POs). Accounting reviews costs, applicable tax treatment, budget and payment terms before approval. Procurement sends the approved PO to the supplier and records issuance.
8. **Coordinate payment and clear delivery:** Finance coordinates payment outside the application. Accounting archives payment proof and verifies the amount paid. Upfront purchases require full verified payment before delivery clearance; credit purchases allow payment and delivery to progress independently under the agreed terms.
9. **Receive purchased materials:** Logistics schedules and dispatches cleared deliveries, directly to site or through the warehouse. Procurement confirms warehouse receipts; Site Personnel confirms site receipts, records shortages or damage and posts accepted stock. Supporting delivery evidence is archived and reviewed.
10. **Record usage and follow remaining work:** Site Personnel records material usage and authorized stock corrections. Staff use dashboards, lifecycle views and reports to follow balances, departmental actions, document requirements and exceptions.

## Features

### Staff Responsibilities

| Role | Main responsibility |
| --- | --- |
| Administrator | Manage staff access, Site Personnel assignments and workspace/project setup. |
| Project Manager | Manage projects and scopes, review MRFs and monitor operational progress. |
| Site Personnel | Request materials, confirm stock suitability/releases, receive and post stock, and record usage on assigned projects. |
| Procurement | Source stock, review quotations, confirm awards, prepare/issue POs and receive warehouse deliveries. |
| Accounting | Review costs and budgets, approve POs, verify external payment proof, clear delivery and review documents. |
| Finance | Coordinate external payments, priorities, planned dates and outstanding-balance follow-up. |
| Logistics | Schedule and dispatch supplier, warehouse-to-site and inter-project deliveries. |

Roles describe responsibilities; the server must still authorize each record and action. Reports access does not grant transaction-editing rights. Site Personnel cannot view project/scope budget positions or Operations reports, while permitted non-Site roles can monitor cross-project operations.

### Projects and Access

- Project setup with document codes, budgets, scope allocations and project document folders.
- Individual staff accounts, assigned roles and Administrator-managed access. Site Personnel access follows project assignments.
- Active-role switching among a person's own grants, with Site Personnel kept exclusive from other roles. A person cannot approve their own submitted MRF or prepared PO after switching roles.
- A multi-role user resumes the last still-permitted role on that browser or chooses a role; a single-role user enters directly. Administrator changes to roles or project assignments require fresh sign-in for affected sessions. Deactivated accounts lose application access immediately.
- Scope allocations must fit within the project budget and cannot be reduced below committed plus spent amounts. Draft requests may remain unassigned; submission and initial/full-correction approval require a valid funded scope. Document-only corrections retain their scope and may proceed after existing POs consume the allocation. Requests do not reserve money. Confirmed 4.9 policy commits approved PO gross including VAT before EWT; initial/full-correction MRF submission and approval require some uncommitted scope allocation. Implementation and verification are tracked separately.
- Document numbers are allocated automatically per project and series, continue without an annual reset and are not reused. Saving a numbered record fixes its project ownership. The numbering operation must be transactional in production.

### Material Requests

- Draft, submit, review, return, correct and track MRFs with material quantities, requirements and supporting documents.
- Drafts are shared within the project: currently assigned Site Personnel may collaborate on editing them. Drafts may remain incomplete, without a funded scope or supporting PDF; submission requirements apply when submitting. Printed signatory names do not establish the verified actor's identity or authority.
- Optional AI-assisted document extraction with human review before submission.
- Linked request history and clear prerequisites for subsequent departmental actions.
- Save a numbered MRF before attaching its supporting PDF. File Upload/Replace/Remove actions save separately from unsaved Details/Materials. Accept one readable, unencrypted PDF up to 50 MiB; staff review that it contains the source MRF, key plan and work scope. Authorized colleagues share the current validated file. Interrupted uploads resume after reselecting the matching local PDF.
- Submission requires valid material requirements and the combined supporting PDF. Return/correction and reapproval retain linked history; dependent work waits for the required review and archive states. Preserve approved archive versions and document metadata history; obsolete unapproved bytes may be cleaned up safely.
- Save and submit commits the form and submission together. Submitted work locks until a PM decision; returned work remains Returned while assigned Site colleagues edit it. Rejection is terminal. Every person who has submitted the MRF remains barred from approving it after role changes. Submitted project labels remain frozen for review and the approved PDF.
- A compact review timeline identifies submissions, reasons, decisions and corrections. PM approval starts archiving; current archive completion gates procurement. Procurement may reopen a fully archived approval for correction. Once downstream records exist, corrections change supporting PDFs only; PM reapproval creates another retained archive version.

### Sourcing and Procurement

- Stock checks across projects, material specification confirmation where needed and source-release approval.
- Company-wide supplier directory: Procurement maintains structured profiles and active/inactive status; non-Site roles read profiles and history. Name is required; contact details/TIN and an informational accreditation note are optional. Names remain unique across inactive records; deactivation/reactivation retains reasons and history. Later supplier selection excludes inactive records without rewriting existing purchasing snapshots. Unit 4.4 implementation/verification is tracked separately.
- Reviewed quotations, comparative bids, supplier awards and split material allocations.
- Unit 4.5a implements manual quotation drafts and supplier originals, verified complete on 2026-11-05 with automated/staging checks, all three explicit human confirmations and passing combined acceptance at `26305c3`. Procurement captures source headers, offered lines, matches/conversions and printed financial values without calculations or default tax/currency assumptions. All non-Site roles can read. First save fixes the approved archived MRF and supplier and permanently restricts later MRF corrections to documents. Source checks expire when their saved content/originals change; they do not establish financial approval. Unit 4.5b financial finalization and immutable revisions are verified complete on 2026-11-06 at `8b8f32a`, including all three explicit manual confirmations and matching combined acceptance.
- For 4.5b, the user confirmed the existing quotation formulas with exact half-up cents, independent adjustments, existing goods/services EWT bases and aggregate included VAT. Procurement explicitly reviews classifications, PHP treatment and printed gross/net bases; unexplained cent differences block finalization. Require supplier reference/date/payment/delivery terms, originals, fresh reviews and a confirmed MRF match. Permit reviewed free items and classified extras. Finalization freezes a revision and starts archiving its originals and internal calculation PDF; it does not approve a PO or charge a budget.
- One unfinished replacement retains the current eligible offer until its successor is archived and eligible. Withdrawals are permanent per revision, with reasons and no automatic restoration of older offers. MRF document corrections pause quotation use until Procurement reconfirms applicability to the corrected approved archive. Inactive suppliers and expired offers cannot finalize or establish current purchasing eligibility. These 4.5b behaviors pass automated, staging and explicit human review; source-bound combined acceptance and completion evidence are recorded in the tracker.
- PO preparation and supplier issuance, with generated comparison PDFs and spreadsheets. Procurement prepares checked approved documents, sends them externally, then declares the channel, recipient and actual Philippine sending time. Issued means sent; supplier acknowledgement is separate later work.
- Finalizable quotations use PHP. Explicit foreign currency requires a corrected source document or extraction; there is no implicit conversion. Finalized quotation revisions and approved purchasing details retain their recorded basis rather than being silently overwritten.
- Quotation finalization requires the supplier originals and reviewed content; awarding and PO creation wait for the required quotation archives. Supplier issuance waits for the current MRF and approved-PO archives. An approval or local file copy does not bypass these archive gates.
- Procurement explicitly confirms supplier and quantity awards. Purchasing, transfers and active suitability holds share the requested-demand limit; allocations must also respect supplier capacity and available source stock.
- Matching stock descriptions and units require Procurement verification. Differently named or uncertain stock requires requesting-site confirmation that it has the same requested specifications; the review does not authorize a specification change. Suitability reviews hold demand without reserving source stock or establishing Served/Delivered progress; source-release requests reserve stock, and source Site Personnel may reduce or reject release. Approved suitability still requires Procurement's explicit release request after rechecking availability. Holds require explicit cancellation rather than automatic expiry.
- New comparison snapshots freeze the quantity remaining to purchase and its sourcing breakdown. Earlier saved versions retain their original basis.

Unit 4.6 is verified complete on 2026-11-06 at `7e9b3a0` as an internal demand foundation only, after local/four-job CI/full disposable/staging and scoped combined acceptance. Saved supplier awards, POs, suitability holds and transfer allocations share the requested-material cap; ownership conversions must not duplicate or temporarily free demand. Blocked work retains its claims until an explicit authorized transition changes them. A first claim permanently restricts MRF corrections to supporting documents. Unit 4.8 uses this boundary for awards and PO drafts; staff stock and transfer workflows remain later units. See the tracker for actual verification status.

### Accounting and Payment Coordination

Unit 4.11 now has local implementation for issued-PO Finance plans, shared Accounting payment drafts/proofs, installments/reversals, proportional gross spending and independently held/cleared delivery. It is not yet verified complete; the tracker owns pending acceptance. Payment planning does not establish payment, tax remittance or delivery progress. Permanent Finance coordinators and settlement actors must differ in both directions per PO. Verified proof and original actions remain retained through corrections. Full supplier-net settlement is required for Upfront clearance; Credit can clear unpaid or overdue. Zero-net POs require explicit no-cash confirmation. Failed prerequisites require fresh Accounting clearance after recovery, without rewinding completed deliveries or stock.

- Confirmed 4.9 policy: Procurement submits complete POs; Accounting reviews without editing costs, may hold/return/reject, and independently approves. Historical preparers and submitters cannot approve. Approval commits gross before EWT under a hard scope cap and queues a retained attributed PO PDF. Accounting revocation of an unissued approval releases money and retains demand; terminal rejection releases demand. Payment arrangements are Upfront/Credit with a current agreed Credit due date and reasoned departures from quotation terms. Unit 4.9 is verified complete on 2026-11-08 after all three human groups, including assisted checks, passed without skips or issues and matching combined acceptance passed.

- Accounting review of PO costing, applicable taxes, adjustments, scope budgets and payment arrangements.
- Finance priorities, planned payment dates, coordination notes and follow-up for externally executed payments.
- Proof-backed payment verification, outstanding balances, credit due dates and delivery clearance. Calculation support does not establish company accounting policy; tax treatment requires company confirmation.
- Finance coordination alone neither records payment nor clears delivery. Upfront clearance requires full verified payment; credit deliveries can progress while partial payments and an outstanding balance remain. Payment corrections preserve history and recalculate the balance without rewinding delivery or posted stock.

### Deliveries and Stock Transfers

- Supplier-to-site, supplier-to-warehouse, warehouse-to-site and inter-project delivery paths.
- Logistics scheduling and dispatch, receiving records, partial acceptance and shortage or damage reporting.
- Generated receipts, signed evidence and separate Accounting document review.
- Transfers have no supplier PO, invoice/payment approval, tax calculation or budget charge. Dispatch debits source stock once; receiving records accepted quantities; posting credits destination stock once. Shortages reopen sourcing without automatically restoring dispatched stock to the source.
- A transfer allocation may use several trips. Cancelling an undispatched trip does not itself cancel the approved allocation; changes to the allocation require explicit action.
- Generated receipts and signed evidence are distinct requirements. Corrected quantities require current-version evidence and can reopen document review. Archive failures remain retryable without undoing confirmed receiving or stock posting.

### Inventory and Consumption

- Project stock balances, reservations and separate receiving and stock-posting actions.
- Grouped material usage entries and authorized stock adjustments with recorded reasons.
- Consumption reconciliation showing opening stock, additions, usage, transfers out, adjustments and closing stock for a selected period.
- Usage is pooled by project/material/unit. Receipt-scope filters show provenance rather than creating separate scope balances; historical movements are not assigned invented scopes.
- Drafts reserve no stock. A confirmed usage entry saves its movements atomically using a stable retry identity, cannot consume unavailable stock and remains immutable. Corrections use separate adjustments with reasons rather than editing the original entry.
- Date-based operational reporting follows the Philippine calendar. Payment, receiving, posting and usage remain independent facts, so current remaining stock does not erase evidence that materials were delivered.

Unit 4.7 is verified complete on 2026-11-06 at `e749844` as a private project-stock foundation, with exact balances, immutable source postings, retained reservations and atomic stock/demand effects. Its automated/staging/internal acceptance passes; inventory screens, opening-stock entry, warehouse custody and staff stock actions remain with their later units.

### Monitoring and Documents

- Permitted shared changes appear automatically on open screens through Supabase Realtime. Reconnecting catches up from authoritative records; ordinary refreshes preserve unsaved form input, and conflicting edits require review before saving. This capability is a production target and is added as each record/workflow migrates.
- Dashboards, notifications and lifecycle views showing outstanding actions, blockers and permitted record links.
- Operational reports and protected audit history identifying the person and active role responsible for an action.
- Google Drive archives for originals, generated documents and evidence, with visible pending or failed status and retry controls.
- Historical actor names, permanent identities and event times are retained; missing past information is shown as unrecorded rather than inferred from today's account. Generated and uploaded files remain linked to their relevant record and document version.
- Current quotation and Accounting evidence groups accept up to 12 PDF/image files, 20 MB each and 45 MB total; transfer-trip evidence follows the same group limits. The corresponding validators define the executable limits, and changes to them require coordinated UI/server/documentation updates.

## Scope

### In Scope

- Internal material operations for HML as one company, across its projects and seven staff roles.
- Project and scope budgets, material requests, stock sourcing, procurement, payment coordination and verification, deliveries, inventory, consumption and document review.
- Individual staff access, shared durable records, protected audit attribution and controlled access to linked files.
- Human-reviewed AI assistance, document generation and archiving, operational monitoring and backup/recovery foundations described in the architecture.
- A fresh start with company records and provisioned accounts for the production release.

### Out of Scope

- Executing bank transfers, moving money or replacing the external payment process.
- Supplier self-service accounts or a supplier-facing portal.
- Full general-ledger accounting, payroll or human resources management.
- Construction scheduling, design tools or Building Information Modeling (BIM).
- Autonomous AI approvals, supplier selection or financial decisions.
- A public multi-company service or importing the prototype's browser records into production.

## Success Criteria

These are acceptance criteria for the intended production release, not claims that the migration is complete.

1. Authorized staff can open the same permitted project records from separate accounts and devices, confirmed changes remain available after refresh or a new session, and open screens receive permitted changes automatically with recovery after a realtime disconnection.
2. An MRF can be followed through its applicable transfer and purchasing branches, with links to the relevant quotations, awards, POs, payment proofs, deliveries, archive status and outstanding departmental actions. Split and partial fulfilment remain visible.
3. Users can perform only actions allowed by their current grants and project access. A person cannot approve their own submitted MRF or prepared PO, including after a role switch, and action history retains the original actor identity.
4. An upfront purchase remains blocked from delivery clearance until Accounting verifies full payment. A credit purchase can progress through delivery while its unpaid balance and due date remain visible.
5. Transfer dispatch, receipt posting and usage update stock exactly once. Usage cannot consume unavailable stock, and simultaneous or repeated submissions do not duplicate stock, budget or payment effects.
6. Authorized staff can retrieve the supporting documents for a record. Failed archive operations remain visibly pending or failed, support retry and never appear complete solely because a browser copy exists.
7. Inventory consumption reconciles opening stock and recorded movements to closing stock; budget and payment views agree with the transactions that establish their balances.
8. A representative workflow can be completed by staff using their assigned roles, including a stock-transfer branch, a purchased-material branch, receiving, stock posting, usage and document review, with remaining obligations visible throughout.
9. An alternative-stock review can hold request demand without blocking source inventory; approved source release then reserves stock. A partial or rejected transfer reopens only the uncovered demand, and competing purchases or transfers cannot oversource it.
10. Corrected delivery quantities require current evidence, usage retries do not consume stock twice, and generated comparison versions retain their frozen quantities and prices. Philippine-date consumption filters reconcile the same underlying movements without inventing scope balances.
