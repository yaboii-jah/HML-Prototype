# Client requirements batch roadmap

Source: `ConstructSync_Client_Meeting_Notes.pdf`, prepared October 6, 2026, pages 1–4. **Extra Notes on pages 5–6 are excluded.**

This is a staged roadmap. Implement one batch at a time; settle its client decisions before coding. Current behavior is documented in [APP_CONTEXT.md](APP_CONTEXT.md), with the existing walkthrough in [WORKFLOW_TESTING_REFERENCE.md](WORKFLOW_TESTING_REFERENCE.md).

## Deferred, completed and optional requirements

| Requirement | Status | Treatment |
| --- | --- | --- |
| #3 — Quotations covering multiple MRFs | Deferred | Keep quotation consolidation outside these batches. |
| #6 — Owed/outstanding PO item management | Deferred | Do not add owed-item or finalization states. Existing remaining quantities and partial deliveries continue to support delivery tracking. |
| #10 — Planned project material master list | Deferred | Do not add planned-material allowances or remaining-plan quantity validation. |
| #17 — Request-level VAT/Non-VAT and mixed treatment | Dropped / replaced | VAT stays outside the MRF. Quotation-level VAT review carries into PO-level VAT and calculated EWT, with Accounting overrides and direct PO edits before approval. |
| #4 — Generate bid comparisons while comparing quotations | Completed | Verify the existing Compare-step feature during procurement regressions. |
| #18 — Payment deductions | Partially covered / optional follow-up | Calculated goods/services EWT and Accounting PO overrides are implemented. Other payment-stage deduction types remain unscheduled. |

## Implementation batches

| Order | Requirements | Deliverable | Starting condition |
| --- | --- | --- | --- |
| **1 — Audit and lifecycle — Completed** | #1, #2 | Capture the acting user's name and timestamps; combine each MRF's related PO, payment and delivery events into one timeline. | Verified October 7, 2026. Historical role-only entries retain their original attribution. |
| **2 — Classification and scope budgets — Completed** | #7, #8, #9 | Distinguish goods and services, allocate budgets by scope of work, and link each MRF to its scope and budget validation. | Verified October 7, 2026. Administrator allocates scopes within the project cap; MRFs check funds and Accounting checks priced POs. |
| **3 — Delivery stages and receipts — Completed** | #11, #12, #13 | Track warehouse/site stages, Procurement warehouse receipt, company-branded delivery receipts and a concise delivery overview. | Verified October 7, 2026. Direct/warehouse routes, separate dispatch, split forwarding and readonly receipt PDFs are implemented. |
| **4 — Controlled process bypasses — Deferred** | #5 | Reserved for future planning; process bypasses are excluded from the current implementation. | Resume only after an explicit request and confirmation of the bypass policy. |
| **5 — Project monitoring and tables — Completed** | #14, #15, #16 | Provide centralized project progress, an MRF lifecycle checklist and tabular workflow summaries with detail links. | Verified October 7, 2026. Shared readonly progress, expandable linked tables, filtering/pagination and quotation summaries are implemented. |

Batch 1 establishes the audit foundation. Extend its timeline as later batches introduce new events. Batches 2–3 establish the rules and delivery states that Batch 5 displays. Batch 4 is deferred and is not a dependency for Batch 5.

Batch 1 is complete: named action-time attribution, independent purchasing/payment/delivery summaries, combined history, expandable quotation saves, and scoped upload completion after account changes. See [Batch 1 specification and verification](BATCH_1_AUDIT_LIFECYCLE_PLAN.md). All 104 automated tests, lint, type checking, production build and both browser walkthroughs passed.

Batch 2 is complete: Administrator-owned scope allocations, MRF scope selection, scope/project PO limits and Goods/Services labels. See [Batch 2 decisions and verification](BATCH_2_SCOPE_BUDGET_PLAN.md). All 112 automated tests, lint, type checking, production build and both browser walkthroughs passed.

Batch 3 is complete: direct/warehouse delivery legs, Procurement receiving, parent-linked split forwarding, protected quantity balances, a tabular overview and HML receipt PDFs. See [Batch 3 decisions and verification](BATCH_3_DELIVERY_PLAN.md). All 125 automated tests, lint, type/build checks and both browser walkthroughs passed; receipt and desktop/mobile layouts were inspected.

Batch 5 is complete: dashboard/project lifecycle checklists, independent progress definitions, linked expandable tables, search/filters/pagination and tabular quotation summaries/award coverage. See [Batch 5 decisions and verification](BATCH_5_MONITORING_PLAN.md). All 134 automated tests, lint, type/build checks and both browser walkthroughs passed; desktop/mobile layouts were inspected. **All currently scheduled implementation batches are complete. Process bypasses remain deferred.**

## Client decisions before each batch

- **Batch 2 — Confirmed:** Administrator alone maintains scopes whose allocations divide the project cap. Unpriced MRFs check remaining scope funds without reserving money; Accounting checks the existing net PO payable against scope and project availability. Materials are Goods and non-material fees are Services. The presenter will manually clear prior walkthrough records.
- **Batch 3 — Confirmed:** Support direct and company-warehouse routes, tracked by original PO/site, with separate Logistics dispatch and multiple onward batches. Procurement receives at warehouse; Site Personnel receives/posts at site. Shortages remain discrepancies without restoring dispatched stock. Payment information shows arrangement and actual Finance methods. Receipts support preview/print/download before and after receiving.
- **Batch 4 — Deferred:** Retain all current approval, archive, payment and quantity controls. Future bypass planning must confirm eligible steps, authorized roles, required reasons/evidence and audit/status behavior.
- **Batch 5 — Confirmed:** Served requires released coverage of every requested material; Delivered requires accepted site quantities. Finance and stock posting progress independently. Dashboard/project pages share readonly columns and expandable record tables, while quotation summaries/award coverage use tables. No overall MRF closure rule is introduced.

## Acceptance and completion checklist

| Batch | Acceptance checks |
| --- | --- |
| **1** | New actions retain the user's name, department and timestamp after refresh. One MRF timeline includes all related POs, payment events and delivery batches, with ongoing and completed milestones. Historical records retain their original attribution. |
| **2** | Requests use a valid project scope; scoped budget checks follow the confirmed policy. Goods and service charges remain distinguishable without adding the deferred tax or planned-material rules. Existing project totals remain consistent. |
| **3** | Warehouse/site permissions and quantity balances work for partial deliveries and supported routes. Stock is not counted twice. Delivery receipts retain company branding. Summary views show key schedule, payment and destination details; materials remain available on detail pages. |
| **4 — Deferred** | No bypass implementation is scheduled. Existing workflow controls remain mandatory; define exception acceptance checks when this requirement is resumed. |
| **5** | Project tables reflect connected MRF, PO and delivery progress, including multiple POs and partial deliveries. Statuses match the confirmed definitions. Detail links and tables remain usable on desktop and mobile. |

For every active implementation batch:

- [ ] Resolve its client decisions and document the agreed rules.
- [ ] Define how existing saved records remain usable; never silently clear data or fabricate historical attribution.
- [ ] Add relevant permission/workflow checks and verify persistence.
- [ ] Verify the existing upfront/credit payment paths, bid comparisons, partial-delivery balances and duplicate-stock-posting protection.
- [ ] Run applicable tests, lint, type checking and build checks.
- [ ] Update the application context and testing reference, then mark the batch complete before starting the next.

All 18 main requirement numbers are accounted for above. Deferred items and the optional follow-up require separate future planning.
