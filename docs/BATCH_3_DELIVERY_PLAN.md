# Batch 3: Delivery stages and receipts

Client requirements **11, 12 and 13**, following [the batch roadmap](CLIENT_REQUIREMENTS_BATCH_PLAN.md).

## Confirmed decisions

- Support direct supplier/site delivery and supplier/company-warehouse/site delivery.
- Track warehouse quantities by their original PO/site. Procurement confirms warehouse receipt; Site Personnel confirms site receipt and posts stock.
- Logistics schedules and separately dispatches each leg. One warehouse receipt can supply multiple onward batches.
- Dispatched shortages remain recorded discrepancies and do not restore warehouse availability. Returns and pooled warehouse inventory remain separate future work.
- Delivery overview shows both Upfront/Credit arrangement and actual Finance methods. Receipts support preview, print and download before/after receiving without a Drive archive requirement.

## Implemented behavior

- Parent-linked delivery legs capture origin/destination and immutable named operation timestamps. All batches require a released PO; new receiving follows dispatch and department permissions.
- Supplier batches share the PO allowance. Direct batches retain reservations through posting review; warehouse receipts resolve accepted supplier quantities. Onward schedules reserve parent goods, dispatch consumes them, and site shortages preserve that consumption.
- Warehouse-held and available-to-schedule quantities are distinct. Site-only receipt quantities determine delivery progress and stock posting is allowed once. Fractional quantity arithmetic avoids residual balances.
- Delivery overview is tabular and retains material details on the batch page. Department queues, MRF history, PO/project links and reports reflect the delivery legs.
- Receipt PDFs reuse PO company artwork and styling, distinguish pending/confirmed quantities, retain receiver/date and issue/correction details, and continue long contents across pages. Linked input validation and uncached readonly generation preserve workflow state.
- V12 legacy direct batches remain readable/operational without invented dispatch metadata. New routing data is validated on reload; existing evidence uploads remain restricted to confirmed/posted site batches.

## Verification

Completed October 7, 2026. All 125 automated tests, ESLint, TypeScript/production build checks and both browser walkthroughs passed. Coverage includes route/department guards, parent/PO isolation, competing allocations, split forwarding, shortages, posting corrections, fractional balances, named audit/persistence, legacy loading, receipt validation/content and long-page continuation. The browser warehouse case received 100, forwarded 60/40 and posted 90 after a 10-unit shortage without restoring warehouse availability. Pending/received PDFs and desktop/mobile tables were verified; the rendered HML receipt's branding, margins and signature area were inspected. Philippine date defaults were checked across UTC midnight/year boundaries.

Process bypassing is deferred. Project monitoring/status tables are implemented in [Batch 5](BATCH_5_MONITORING_PLAN.md). Other deferred client requirements remain separate.
