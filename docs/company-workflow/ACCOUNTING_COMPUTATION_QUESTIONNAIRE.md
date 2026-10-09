# Company Accounting Computation Questionnaire

Date prepared: 2026-10-09

Purpose: Confirm the company's actual computation rules so ConstructSync can match the amounts shown in quotations, purchase orders, invoices, payments, and project budgets.

## Confirmation status

| Computation | Status |
| --- | --- |
| EWT for goods | Confirmed by the company |
| EWT for services | Confirmed by the company |
| VAT, charges, discounts, rounding, budget charging, and settlement rules | Awaiting company confirmation |

The EWT confirmations above come from the client discussion. The remaining rules must not be treated as confirmed merely because the app currently implements a formula.

## Message to Accounting

The EWT goods/services computations are already confirmed. To match the app with your actual workflow, could you confirm the following?

### 1. VAT

Are supplier prices usually VAT-inclusive or VAT-exclusive? Can this vary by supplier or transaction? What VAT rates do you use?

**Company response:**

<!-- Record the company's answer, applicable exceptions, and examples here. -->

### 2. Charges

How do you calculate delivery, freight, handling, installation, and other fees? Which charges receive VAT?

**Company response:**

<!-- Record fixed amounts, percentage bases, and VAT treatment here. -->

### 3. Discounts

Are discounts applied per material or to the whole quotation/PO? Are they applied before or after VAT? For percentage discounts, what amount is the percentage based on?

**Company response:**

<!-- Record the discount base and when each discount is applied here. -->

### 4. Multiple adjustments

If there are several discounts or charges, are they calculated independently from the same subtotal, or applied sequentially?

**Company response:**

<!-- Record the calculation order and an example with multiple adjustments here. -->

### 5. Partial orders

If we order only some quoted materials or quantities, how should discounts and delivery/service charges change?

**Company response:**

<!-- Record whether charges are retained, prorated, recalculated, or requoted here. -->

### 6. Rounding

Do you round each material line, each tax calculation, or only the final total? How many decimal places do you use?

**Company response:**

<!-- Record rounding precision, method, and treatment of small differences here. -->

### 7. Budget charging

Should the project budget be charged the gross purchase value before EWT, the net supplier payment after EWT, or another amount? How is VAT treated in the budget?

**Current app behavior — awaiting company confirmation:** ConstructSync currently uses net supplier payable after EWT for project/scope budget commitments and recorded spending. It does not separately track EWT remittance as a tax liability. This describes the current implementation, not an approved company accounting rule.

**Company response:**

<!-- Record the budget charge basis and treatment of VAT and withheld tax here. -->

### 8. Payment settlement

What amounts should reconcile across the PO, invoice, payment to the supplier, and withheld tax? Are there deductions besides EWT, such as retention or previous advances?

**Company response:**

<!-- Record how full settlement is determined and any additional deductions here. -->

### 9. Corrections

How are shortages, rejected materials, returns, and supplier credit notes reflected in the payable amount and project budget?

**Company response:**

<!-- Record adjustment documents, approvals, and effects on payable/budget amounts here. -->

## Request for a worked transaction

Could you provide one actual completed transaction showing the original amounts, every adjustment, VAT, EWT, final supplier payment, and budget charge?

Please include the related documents where available:

- Supplier quotation.
- Approved purchase order.
- Supplier invoice.
- Payment proof.
- Accounting computation sheet.
- Related withholding documentation and credit notes, if applicable.

**Transaction reference:**

**Supporting document references:**

Use the table below to record the company's actual calculation order. Rows are prompts and do not prescribe the company's formula; add, remove, or reorder them as needed.

| Step / component | Calculation or basis | Amount | Supporting reference |
| --- | --- | --- | --- |
| Original material amounts | | | |
| Material-line discounts | | | |
| General discounts | | | |
| Delivery/service/other charges | | | |
| VAT | | | |
| Gross purchase value before EWT | | | |
| Confirmed EWT goods computation | | | |
| Confirmed EWT services computation | | | |
| Other deductions or prior advances | | | |
| Final supplier payment | | | |
| Amount charged to the project/scope budget | | | |

## Response record

**Answered by / role:**

**Date answered:**

**Exceptions or unresolved questions:**

**Rules confirmed for implementation:**
