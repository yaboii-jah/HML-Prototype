# Batch 5: Project monitoring and workflow tables

Client requirements **14, 15 and 16**, following [the batch roadmap](CLIENT_REQUIREMENTS_BATCH_PLAN.md). Process bypassing remains deferred.

## Confirmed definitions

- Served: released POs cover every requested material quantity.
- Delivered: every requested quantity is accepted at the project site. Warehouse receipt is intermediate; stock posting and payment remain separate.
- Finance: approved net payable and actual payments, with completion requiring full approved material coverage and full payment. Active Finance requests and Accounting preparation/returns retain their owners.
- Logistics: scheduling, forwarding, dispatch, in-transit receiving and discrepancies from related records.

## Implemented behavior

- A readonly monitoring projection evaluates each material/unit across related POs. Rejected POs are excluded from fulfilment but remain visible in record details. Unawarded quantities remain partial; posted coverage comes from site receipt batches rather than current inventory balance.
- Dashboard/project pages share the checklist with independent progress columns, search/filters, 50-row pagination and closed-by-default expandable PO/delivery/material tables. The dashboard preserves role tasks/metrics/budgets; the project preserves scopes, stock and Drive documents.
- Project routes retain their project scope independently from global dashboard context. Updates follow saved snapshots without new backend polling or persisted progress statuses. Actual audit events supply latest activity; missing historical attribution remains explicit.
- Quotation summaries and award coverage are tabular while editing, file grouping, extraction, comparison and allocation controls retain their behavior.

## Verification

Completed October 7, 2026. All 134 automated tests, ESLint, TypeScript/production build checks and both browser walkthroughs passed. Coverage includes split/partial/unawarded quantities, mixed units, rejected replacements, credit/upfront independence, payment holds/returns, warehouse exclusion, posting corrections, usage independence and explicit legacy audit links. Browser checks verified 50-row pagination across 64 MRFs, search, project filtering/isolation, expandable links and unchanged records after inspection, followed by the existing quotation/purchasing/receiving workflows. Viewport fit and contrast passed in both themes; desktop/mobile monitoring screenshots were inspected.
