## Suggestions
  - all quotations are php, remove currency form
  - can we design the scrollbar ui? that will aligned to the app theme?
  - scenario where a list of materials is shown and its quantity etc.., do not display the material name again like in qty on delivery receipt ( not in a document )
  - do not show prices of scope of work on a dropdown form when creating a request
  - add scope of work and other necessary filters on site inventory
  - move generate bid comparison on the upper part than awarding and allocation container and maybe provide a pdf preview of the comparison bid
  
## Questions

## Accepted decisions and implementation

- **Implemented — PHP-only quotations:** Removed editable currency. Missing currency defaults to PHP. Explicit foreign currency remains visible and blocks finalization; replace the supplier document with a PHP quotation or re-extract an incorrect currency reading. There is no conversion or manual currency override. Historical finalized quotations remain unchanged.
- **Implemented — themed scrollbars:** Native scrollbars use the app's light/dark palette. Horizontal scrolling stays available; intentionally hidden gallery/tab scrollbars and forced-colors browser defaults are preserved.
- **Implemented — material input labels:** Delivery scheduling, receiving and stock posting show each material name once in its row. Quantity and issue inputs retain descriptive accessible names. Generated documents are unchanged.
- **Implemented — request scope selector:** Options show scope names without budget amounts. Scope IDs, allocations and budget validation are preserved.
- **Implemented — inventory filters:** Search combines with scope received, unit and in-stock/out-of-stock filters. Project changes reset selections. Scope filters use receipt → delivery batch → PO → MRF provenance. Balances remain pooled across scopes within each project; opening stock without scope provenance remains visible in the unfiltered view.
- **Implemented — comparison reports:** Moved above allocation and opened by default. Saved PDF versions can be previewed with the standard viewer. Preview reads the existing saved artifact and does not generate a report, change awards or create a new version. Existing prerequisites, confirmations, downloads and Drive archive actions remain available.

Validation: 221 domain tests passed, including PHP-only finalization and scope receipt provenance. Quotation editor browser checks passed with 25 suppliers and 100 materials. Inventory and saved PDF preview checks passed at desktop/mobile sizes in light/dark themes, including combined filters, unchanged report records, missing-file feedback and focus restoration. TypeScript and lint checks passed.
  

## Issues
   
 
