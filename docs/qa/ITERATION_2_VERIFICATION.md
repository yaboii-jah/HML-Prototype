# Next iteration verification

Implemented 17 October 2026, following the full application audit and the approved iteration plan.

## Delivered behavior

- Shared outstanding actions show current work and blockers across departments, purchase orders, deliveries, transfers and payment branches. Request monitoring, request history, dashboard tasks and notifications use the same projection. Actions respect department and assigned-project permissions.
- Site inventory has a Consumption tab, also available at `/inventory?view=consumption`. It defaults to the current Philippine month through today and shows opening stock, stock added, usage, transfers out, signed adjustments and closing stock by project, material and unit. Its CSV includes every filtered page. Undated movements mark affected balances incomplete. Browsing and exporting never alter stock.
- Date defaults and reporting filters use the Philippine calendar. Reports and Administration enforce the same role restrictions through navigation and direct routes. Accounting defaults to inventory adjustments. Browser titles identify the current section or record, and mobile dashboards place the action queue before metrics.
- Quotation extraction rejects foreign origins, disguised file types and malformed multipart input before calling AI. Downloaded comparison links use the validated request origin, including supported loopback hosts. PDFs retain allowed source links.
- Temporary setup failure offers a deduplicated retry. It preserves the current snapshot and drafts; successful showcase installation keeps the original snapshot in its existing backup store. Corrupt-data recovery remains a separate state.

## Validation

- 318 automated domain, repository and API tests passed, including quotation rejection cases, Philippine date boundaries, consumption arithmetic, read permissions, parallel workflow actions, retry preservation and actual PDF/XLSX source links.
- Production build and TypeScript checks passed. ESLint passed without warnings.
- All 27 browser suites passed against the final production build. Evidence is recorded by [the aggregate regression runner](../../scripts/browser-regression.mjs) in [verification.json](../../artifacts/iteration-2/verification.json), with an individual log for each suite. The runner returns a failing exit code if any suite fails or times out.
- The new iteration browser scenario covers consumption CSV pagination, assigned-project access, invalid dates, keyboard dismissal, unchanged stock, department handoffs, record titles, mobile queue order, navigation, Accounting defaults, and setup failure/retry with backup preservation.
- Visual checks include [desktop consumption](../../artifacts/iteration-2/screenshots/consumption-1440-light.png) and [mobile consumption](../../artifacts/iteration-2/screenshots/consumption-375-light.png), with long material names wrapping inside their cells. The report scrolls its wide table locally on phones.

Run the app and execute `npm run test:browser -- http://127.0.0.1:3100`. The default run includes all 25 original audit suites plus usage entries and the new iteration scenario. Browser fixtures use separate temporary profiles and a real local account directory, avoiding stale session revisions and user workspace data.

## Scope and limits

This remains a browser-local prototype with the v12 snapshot format. No collection migration or hosted persistence was added. Existing seed records, usage drafts and audit history remain supported. Automated external-service checks use controlled responses; real Google Drive credentials and live AI extraction were not exercised. Archive identification (AUD-06), low-stock configuration and a new delivery-issue workflow remain deferred.
