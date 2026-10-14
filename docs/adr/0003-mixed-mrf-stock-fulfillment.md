# Fulfill MRFs through independent stock transfers and supplier purchases

An approved MRF can be fulfilled using stock from other projects, supplier purchases, or both, including splitting one material's quantity. A stock transfer is independent of a PO: creating a fictional supplier order would incorrectly introduce budget, tax, payment and document obligations for goods already owned by the company.

Procurement proposals reserve source stock immediately. Source-assigned Site Personnel may confirm smaller quantities or reject the proposal. Logistics can schedule several trips. Dispatch debits source stock once; destination receiving records accepted quantities and posting credits destination stock once. Shortages reopen sourcing without automatically returning dispatched quantities to the source. Undispatched allocations can be cancelled explicitly; holds do not expire automatically.

Transfers change quantities only, leaving original purchasing costs and budgets intact. Accounting reviews transfer receipts without a payment or invoice requirement. Comparative bids use the current quantity remaining to purchase, frozen in new report snapshots; historical reports retain their original basis.

The current implementation uses the browser-local prototype repository. Independent company computers will require shared server storage, authenticated project authorization and database transactions that lock stock/reservations and MRF demand together. The prototype's command boundary demonstrates these invariants but is not distributed stock locking.
