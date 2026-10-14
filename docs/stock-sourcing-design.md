# Site stock sourcing table

Agreed with the product owner on 2026-10-13 for Procurement personnel who need a straightforward way to reuse site materials before buying the remaining MRF quantities.

## Select and review

The original eight-column table shows requested material, requested quantity, already sourced, still to source, source stock, available quantity, transfer quantity, and match. Source project and the optional transfer note sit above it. The source-project selector changes the visible stock without clearing selections from other projects. Only available stock with the same description and unit appears as a new option, ignoring case and extra description spaces. If no match exists, Procurement switches source projects or continues to supplier quotations. Multiple stock selections use aligned subrows within a material. Recorded availability is not an assurance that the source project can spare those materials.

Procurement chooses stock explicitly, enters quantities manually, and can combine several projects for one material. Identical descriptions, ignoring case and extra spaces, display “Matches request” automatically; one final-review confirmation verifies the descriptions and units of all matching selections before sending. This confirmation is not saved with the draft and resets when selections change or the review reopens. All new verified selections go directly to source sites for release confirmation; the optional requesting-site review and draft explanation are removed. New selections cannot use different descriptions. The dropdown shows the selected stock without repeating its description below; its tooltip and the final review expose the full specification.

Drafts recover for the same account, MRF and browser after tab changes, navigation and refresh. They hold neither stock nor demand. One final review groups selections by source project and labels every selection as a source-release request. Sending validates and saves the complete selection atomically; a failure preserves the draft and saves no partial requests.

## Review and release

Previously submitted suitability reviews remain actionable and set aside MRF demand while leaving source stock available. Destination-assigned Site Personnel can approve the proposed quantity, approve fewer units with a reason, or reject with a reason. Approval creates a task for Procurement to recheck availability and explicitly request release. Reduced, rejected, cancelled or stale quantities return to purchasing.

When Procurement requests release, the selected quantity moves from the suitability hold to a real transfer reservation in one action. Any approved quantity omitted from this request returns to purchasing. Stock availability is checked again; failure leaves the approved review available for correction or cancellation. A review can be consumed only once.

Source Site Personnel then confirm quantities that can be spared. Logistics schedules and dispatches the actual transfer; destination Site Personnel receive and post it. Procurement can cancel unresolved reviews explicitly. Holds have no automatic expiry.

An 18-panel request with 6 awaiting source release and 8 awaiting suitability approval leaves 4 panels to buy. Suitability reviews never establish Served or Delivered coverage, stock ownership, supplier payment, or budget spending.

## Presentation and compatibility

The Procurement overview prioritizes office computers. The table has a 1440px minimum width and column proportions of 18%, 7%, 9%, 7%, 29%, 7%, 10%, and 13%. Cells use 12px vertical and 16px horizontal padding with top alignment. Descriptions stay on one line when they fit and wrap longer specifications in full. On-hand and reserved counts share one line; available quantity and unit share another. The quantity input and unit align horizontally. Row actions use visible rectangular buttons, including a danger outline for removing an unsent selection, with 44px touch targets on phones. The table has a sticky header and contained scrolling, while review actions remain outside it. The two top fields stack on phones. Stock selection and destination review remain usable on phones, with keyboard access, full specification text, nearby validation errors and explicit loading/success states. Existing app tokens, routes and browser-local storage remain in use.

Active reviews reduce quantities available to supplier awards and POs, including Accounting edits. New comparative reports freeze the separate review quantity; historical snapshots retain their original quantities. Existing version-12 workspaces and transfers load without invented technical approvals. Material or requested-quantity corrections invalidate affected active reviews.

Older differing-description drafts remain visible for removal, but new submissions reject them with a matching-stock-only message. Already-submitted suitability reviews, approved reviews awaiting release and existing transfers retain their full workflow. Domain commands and storage formats remain compatible.

Older matching drafts marked for site review are treated as source-release selections in the final review, with fresh verification required before sending. Their former review flag and explanation are ignored for new submissions, which always send `needsReview: false`. Saved records and domain approval commands remain intact.

## Transfer QA refinements (2026-10-13)

The ConstructSync QA PDF's ten suggestions are implemented across stock sourcing and `/stock-transfers/[id]`:

1. Selected stock descriptions appear once in the table, in the dropdown; full specifications remain available in its tooltip and the final review.
2. The outlined Remove button sits below Matches request in the Match column and removes only an unsent selection.
3. Sending uses one bottom-right progress notification that resolves to success or an error. Validation stays inline and failed submissions retain the draft.
4. Transfer forms leave 16px above their action rows, including Schedule trip.
5. Scheduled date and evidence reference inputs have matching 44px heights.
6. Print preview has 16px of space before the trip materials table.
7. Transfer evidence uses the shared chooser/drop area, with Document type above it and Signed delivery receipt selected initially. File types, multiple selection and existing limits are preserved.
8. Automatic generated-receipt archives, evidence uploads and retries use the shared archive activity strip. Document rows show Archiving while the job runs; failures remain saved with an explicit retry. Chunked evidence uploads report confirmed bytes; generated receipts use indeterminate activity because the server produces their files.
9. Accounting review separates its heading, status and gaps from the form, aligns fields on desktop, stacks them on phones and gives notes at least 88px of height.
10. Transfer sections, document rows, uploader and action buttons use consistent gaps and contained tables. Viewing evidence has an Opening state independent of archive activity.

These changes preserve source approval, reservations, trip scheduling, dispatch, receiving, posting, Accounting requirements, permissions, API contracts and stored records. Archive completion follows the saved command acknowledgement; a Drive failure never undoes receiving or posting.

Verification: all 284 automated tests, lint, TypeScript and the production build pass. `scripts/site-stock-transfers-smoke.mjs` passes the full sourcing-to-Accounting walkthrough, delayed and failed generated/evidence archives, retry without duplicate attachments, shared multi-file uploads, field/action spacing, and 320/375/414/768/1440px layouts in both themes. Screenshots of the sourcing table, document uploader and Accounting review were inspected. Browser Drive responses are mocked; no company files are created.
