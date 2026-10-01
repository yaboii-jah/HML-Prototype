# HML ConstructSync — Simple Testing Checklist

Follow this checklist using the role switcher. For detailed rules, see [APP_CONTEXT.md](APP_CONTEXT.md).

## Before testing

Start with a test workspace. Prepare a combined MRF supporting PDF and two supplier quotation files. Configure Drive using [GOOGLE_DRIVE_SETUP.md](GOOGLE_DRIVE_SETUP.md).

## Full workflow

- [ ] **Administrator:** Create a project, assign its PM, set its budget, and map its Drive folder.
- [ ] **Site Personnel:** Follow **Request details → Materials → Review & submit**. Attach the supporting PDF on the final step and submit. Check that PM sees it.
- [ ] **PM / Site Personnel:** Return the MRF with a reason, revise it, and resubmit. Check that its reference stays the same.
- [ ] **Project Manager:** Check the company MRF print preview and approve. Wait for both PDFs to archive before Procurement continues.
- [ ] **Procurement:** Add supplier quotations manually or with AI. Review details and material matches, finalize, and wait for their Drive archives.
- [ ] **Procurement:** Compare offers, award quantities with a reason, generate the supplier PO(s), and finalize for Finance.
- [ ] **Procurement:** Generate bid comparison PDF and Excel reports once no active POs are draft or returned. Check downloads and Drive copies.
- [ ] **Finance / Procurement:** Return and revise a PO, review VAT, withholding and print fields, then approve within budget. Wait for its PDF archive.
- [ ] **Procurement:** Mark the approved, archived PO served. Check that Logistics can schedule it.
- [ ] **Logistics / Site Personnel:** Schedule a partial delivery, confirm accepted quantities, and post stock once. Check the remaining balance.
- [ ] **Site Personnel:** Record usage, then receive and post the remaining delivery. Check inventory and movement history.
- [ ] **Accounting:** Record invoice, receipt, and payment references. Check document and payment statuses separately; Accounting can begin after PO approval.
- [ ] **Management:** Check that reports agree with the transaction. Refresh and confirm the work persists.

## Easy sample to follow

Use zero opening stock, a **PHP 100,000 budget**, and **100 bags of cement at PHP 250 each** with no extra charges.

| Action | Expected result |
| --- | --- |
| Approve the PHP 25,000 PO | Available budget: PHP 75,000 |
| Receive and post 60 bags | Stock: 60; outstanding: 40 |
| Use 30 bags | Stock: 30 |
| Receive and post the remaining 40 | Stock: 70; outstanding: 0 |
| Pay PHP 10,000 | Partly Paid; committed: PHP 15,000; spent: PHP 10,000 |
| Pay the remaining PHP 15,000 | Paid; committed: PHP 0; spent: PHP 25,000 |

Available budget stays PHP 75,000 as payments move commitment to spent.

## Key checks

- [ ] Next checks required fields; Back and Edit links keep entered values and the PDF. Save draft works with incomplete information. PDF-only corrections open on the final step.
- [ ] Failed Drive uploads can be retried; the next handoff waits where required.
- [ ] Excess awards, deliveries, payments, and usage are blocked. A delivery cannot be posted twice.
- [ ] Returns, holds, rejections, shortages, and stock corrections require the applicable reason or note.
- [ ] In a disposable workspace, clear data and confirm it becomes empty. Drive copies remain.

Approval, delivery, stock posting, payment, and document review are separate statuses.
