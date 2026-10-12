# Taguig City Rehabilitation sample pack

One combined MRF (2 pages: company form plus illustrative key plan) and four correct supplier quotations. Architectural scope; eight matching materials. All names, quantities, prices, contacts and work zones are fictional samples.

- Project: **Taguig City Rehabilitation**. Use the existing project; these files do not create or change it.
- Paper/source MRF reference: **TCR-SAMPLE-001**. ConstructSync assigns its own project-numbered reference on first save.
- Request / quotation date: **2026-10-12**. Date needed for every material: **2026-10-26**.
- Prices and printed totals include **12% VAT**. Do not add VAT again. No discounts, extra freight or service charges.
- Payment terms: **30 days net from delivery**. Accounting enters the agreed payment due date separately.
- All four quotations are correct; there are no intentional discrepancies.

| Quotation | Printed total / gross | App goods EWT | App net supplier payable |
|---|---:|---:|---:|
| TCR Q01 Northbridge Building Materials.pdf | PHP 164,750.00 | PHP 1,470.98 | PHP 163,279.02 |
| TCR Q02 Harborline Finishes Trading.pdf | PHP 164,886.00 | PHP 1,472.20 | PHP 163,413.80 |
| TCR Q03 Pillarstone Construction Supply.pdf | PHP 166,164.00 | PHP 1,483.61 | PHP 164,680.39 |
| TCR Q04 Crestmark Architectural Products.pdf | PHP 166,280.00 | PHP 1,484.64 | PHP 164,795.36 |

EWT and net values above are expected values under the app's automatic VAT-goods settings, shown for checking. They are not extra supplier charges and are not printed as the quotation total.

## Use in ConstructSync

1. On /requests/new, import the combined MRF and extract with AI (or enter manually). Select the **existing Taguig City Rehabilitation** project and its matching **Architectural** scope. Review all eight materials and the dates.
2. Attach the same combined MRF PDF as the supporting PDF in Review & submit. The AI import alone does not satisfy that attachment requirement.
3. After MRF approval/archive, open Quotations. Create four supplier groups and upload one quotation PDF into each group.
4. Review VAT-inclusive settings, line amounts, quantities and MRF matches before finalization. Each quotation offers the same eight items so they can be compared directly.

Regenerate: node --experimental-strip-types scripts/generate-taguig-sample-pack.mjs
