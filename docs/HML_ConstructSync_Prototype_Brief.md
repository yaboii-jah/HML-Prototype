# HML ConstructSync - Prototype Brief

This brief follows the client-approved department flow. Use [APP_CONTEXT.md](APP_CONTEXT.md) for detailed current rules and [WORKFLOW_TESTING_REFERENCE.md](WORKFLOW_TESTING_REFERENCE.md) for the walkthrough.

## Prototype boundary

The app demonstrates construction purchasing and delivery in one browser-local workspace. A fresh workspace starts empty; records persist in localStorage and uploaded files in IndexedDB. Drive archiving and Gemini quotation extraction use server integrations when configured. Role access and payment records are demonstrations, not production authentication or actual bank transfers.

Seven roles are available: Site Personnel, Procurement, Accounting / Auditing, Finance, Logistics, Management and Administrator. Keep the role switcher and project context visible.

## Department flow

1. **Site Personnel:** Create an MRF in three steps: Request details, Materials, Review & submit. Attach the combined supporting PDF. Keep the generic Approved by signature as document information.
2. **Procurement:** Review the MRF and archive its approval. Review supplier quotations, generate the comparison PDF/Excel, allocate materials and submit supplier-specific POs.
3. **Accounting:** Review PO taxes, charges, budget and payment arrangement. Approve and archive the PO; prepare payment requests and explicitly release eligible orders to Logistics.
4. **Finance:** Review payment requests and separately record actual disbursement. Payment approval alone does not record money paid.
5. **Logistics:** Schedule full or partial deliveries against released POs.
6. **Site / Warehouse:** Confirm accepted quantities, post stock once, upload optional delivery evidence and record material usage.

**Upfront:** Full actual disbursement is required before Accounting releases the PO.

**Credit / terms:** Accounting can release the approved, archived PO while Finance handles payment independently, before or after delivery.

Returns go from Procurement to Site for an MRF, Accounting to Procurement for a PO, and Finance to Accounting for a payment request. Preserve references and activity history across revisions.

## Oversight and setup

Management reviews cross-project reports and exceptions. Administrator creates projects using name, location and allocated budget, maps Drive folders, reviews activity and can explicitly clear browser workspace data. Project setup has no manager assignment.

Keep request, PO review, payment approval, disbursement, release, delivery, document review and stock posting states separate. Enforce budget limits, outstanding quantities, one open payment request per PO, duplicate-payment protection and nonnegative stock.

## Interaction and verification

Use readable forms, clear department handoffs, accessible keyboard controls and consistent spacing across desktop, tablet and phone layouts. Confirm decisions, disbursements, stock posting and workspace clearing. Derive counts and reports from saved records.

Verify both payment arrangements, returns and corrections, comparison downloads, archive retries, receiving, stock posting, usage and reload persistence. Current v12 records remain readable after a retired role session; previous-workflow records remain untouched until the user explicitly clears them. Retain historical actors and archived documents.
