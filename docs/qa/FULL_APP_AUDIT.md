<!-- Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 -->
# ConstructSync full application audit

Implementation follow-up: the next iteration addresses AUD-01–05 and AUD-07–14. AUD-06 (archive identification) remains deferred. This document preserves the original findings and baseline; see [iteration verification](ITERATION_2_VERIFICATION.md) for the implemented behavior and current checks.

Audit date: 16 October 2026. Target: local working tree, including existing uncommitted work. Starting HEAD: `c62142118b243fab1abbc42984d81117cb20edef`.

## Assessment

**The demonstrated business flow is substantially implemented and works in the scenarios verified here, but the app needs targeted corrections and repaired browser regression tests before it can be called consistently reliable.** This audit found **14 issues: 1 P1, 10 P2, and 3 P3**. No P0 defect was confirmed. Production readiness is assessed separately below; the documented single-browser prototype boundary is not counted as a regression.

The initial baseline passed 295 automated tests, ESLint, and TypeScript. The production build passed with network access; its first sandboxed attempt could not download Google Fonts. Of 25 original browser suites, 9 passed and 16 failed. Many failures are demonstrably outdated test assumptions rather than broken features: an obsolete account revision, omitted required project codes, an added quotation workflow step, renamed actions, and the retired maintenance route. Audit-only copies and independent browser checks were used to recover additional verification without editing those original scripts.

An independent sweep visited 11 main screens as each of seven roles and 18 additional detail/form/missing-record routes: **95 visits**. It checked **22 page families at six widths in both themes: 264 combinations**, finding no page-level horizontal overflow, no unnamed visible controls under the simple DOM-name check, and no uncaught page exceptions. This is a useful rendering baseline, not complete accessibility certification. The record details were primarily inspected as Administrator; the quotation and creation forms were additionally inspected under their working roles.

The connected command walkthrough also passed its assertions across **77 commands and 36 checkpoints**, including upfront purchasing, warehouse forwarding, receiving, usage, credit installments, and a completed inter-project stock transfer. See [coverage and limitations](APP_AUDIT_COVERAGE.md), [machine-readable browser evidence](../../artifacts/app-audit/browser-audit.json), and [evidence index](../../artifacts/app-audit/README.md).

## Findings, ordered by priority

P1 = high-priority protection or workflow defect; P2 = correctness, recoverability, usability, or verification gap; P3 = smaller consistency/accessibility improvement. All issues below are confirmed by source inspection and the evidence stated. Recommendations have not been implemented.

### AUD-01 · P1 · Quotation AI extraction omits the shared origin guard

**Affected:** Procurement quotation import; the local server when AI parsing is configured.

**Reproduce:** Invoke the quotation extraction handler with a multipart file, `Origin: https://untrusted.example`, a dummy API key, and a stubbed AI provider. The handler calls the provider and returns 200. The equivalent MRF import returns 403 before calling the provider.

**Expected / actual:** The quotation route should enforce the same origin restriction as MRF import. It currently checks the API key and parses files without checking Origin. The route is reachable before any browser-local department identity is validated.

**Impact:** An unintended caller can reach the AI operation if deployment/network/browser protections allow the request through. The audit proves missing server-side rejection, not a complete cross-site browser exploit; deployed protection was not assessed.

**Evidence:** `app/api/quotes/extract/route.ts:33`; contrasting guard at `app/api/requests/extract/route.ts:30`; [stubbed API probes](../../artifacts/app-audit/api-probes.json). No real AI request was made.

**Fix:** Call `sameOriginError` before parsing quotation input or checking configuration. Add a route regression that asserts a foreign Origin never reaches the provider. Effort: small.

### AUD-02 · P2 · Quotation input handling accepts disguised files and leaks malformed-body exceptions

**Affected:** Quotation extraction API and its failure feedback.

**Reproduce:** Submit a plain-text file named `quotation.pdf` with `application/pdf` MIME. The stubbed quotation route accepts it and calls the provider; MRF import returns 400. Separately, submit malformed multipart data: `request.formData()` throws out of the quotation handler.

**Expected / actual:** Invalid source bytes and unreadable multipart bodies should produce controlled JSON errors before invoking AI. Quotation extraction checks declared MIME/size, but does not inspect file signatures; multipart parsing sits outside its error handler.

**Impact:** Invalid uploads consume provider work and malformed requests escape the intended error response path. The existing client-side file filter cannot establish file contents.

**Evidence:** `app/api/quotes/extract/route.ts:36`, `:43`, `:49`; [API probes](../../artifacts/app-audit/api-probes.json).

**Fix:** Reuse the existing signature checks, move multipart parsing inside controlled error handling, and reject unexpected form parts. Assert a JSON 400 response and zero provider calls for both cases. Effort: small.

### AUD-03 · P2 · Some default dates use UTC while other forms use Philippine dates

**Affected:** Upfront payment verification, legacy Finance disbursement, and newly added MRF material dates.

**Reproduce:** At `2026-10-15T16:30:00Z` (00:30 on 16 October in Manila), open an issued upfront PO as Accounting. Its Payment date defaults to `2026-10-15`; the credit payment form uses the correct Philippine date. The same UTC truncation initializes MRF material dates even though the request date uses local calendar fields.

**Expected / actual:** Date defaults in the Philippine workflow should agree. `today()` and material initialization use `toISOString().slice(0, 10)`, which produces the previous calendar day during the first eight Philippine hours.

**Evidence:** `src/domain/format.ts:3`; `src/features/accounting/ExternalPaymentVerification.tsx:55`; `src/features/finance/Finance.tsx:84`; `src/features/requests/Requests.tsx:71`, `:140`; [deterministic probe](../../artifacts/app-audit/domain-probes.json); [payment screenshot](../../artifacts/app-audit/screenshots/upfront-payment-previous-day.png).

**Fix:** Use one Philippine calendar-date helper for business-date defaults. Cover 00:00, 07:59, and 08:00 Manila boundaries, including adding another MRF material. Effort: small.

### AUD-04 · P2 · Report date filters exclude records on their Philippine creation day

**Affected:** Project Manager / Administrator operations reports.

**Reproduce:** In an isolated workspace, set one request's creation time to `2026-10-15T16:30:00Z` and other requests outside the range. Filter Reports from/to `2026-10-16`. The Requests count is **0**, although that request was created on 16 October in Manila.

**Expected / actual:** Inclusive report dates should use the Philippine calendar, as activity and credit-date logic already do. Reports slices the UTC timestamp string directly. The same predicate filters requests, POs, and batches.

**Evidence:** `src/features/reports/Reports.tsx:28`; contrast with `src/domain/admin-activity.ts:9`; [browser probe](../../artifacts/app-audit/browser-audit.json), check `Report Philippine midnight boundary`; [screenshot](../../artifacts/app-audit/screenshots/reports-philippine-date-boundary.png).

**Fix:** Compare Philippine calendar dates derived from timestamps. Test both inclusive boundaries for request, PO, and delivery records. Effort: small.

### AUD-05 · P2 · A temporary installation failure is presented as a workspace-clearing recovery

**Affected:** Fresh/first-upgrade workspace installation and all departments' access.

**Reproduce:** With the installation marker absent in an isolated profile, return 503 for local comparison-document generation. The app shows “Saved data needs attention” and offers the Administrator **Clear workspace**. It exposes no retry operation or explanation that a reload can retry initialization.

**Expected / actual:** A temporary preparation failure should offer a nondestructive retry, preserve existing data, and distinguish installation failure from corrupt saved records. Installation failures are routed into the same recovery screen as unreadable snapshots.

**Impact:** Users cannot reach normal work and are directed toward deleting records/files even when the failure is temporary and their records remain readable. The probe did not clear any user workspace.

**Evidence:** `src/mock/showcase-install.ts:75`; `src/mock/repository.ts:161`; `src/components/ui/States.tsx:23`; [recovery screenshot](../../artifacts/app-audit/screenshots/installation-failure-recovery.png).

**Fix:** Distinguish installation/retry state from corrupt-data recovery. Offer Retry setup first and keep any destructive recovery secondary with accurate consequences. Verify recovery after one failed report request without clearing the snapshot. Effort: medium.

### AUD-06 · P2 · Project archive rows cannot distinguish the MRF from its supporting PDF

**Affected:** Local project document search, viewing, and downloads.

**Reproduce:** Open the first project's documents and search `PCH-MRF-0001`. Two rows are both named `PCH-MRF-0001.pdf`, with identical file type and action columns. They resolve to distinct files: the supporting request and generated MRF. Some supplier files from different requests also share undifferentiated labels.

**Expected / actual:** Users should identify document purpose and originating record before opening it. Recursive archive discovery inherits the record reference for both form/support archive IDs; the register exposes only that name, extension, and Open.

**Evidence:** `src/domain/local-files.ts:12`; `src/features/projects/LocalProjectFiles.tsx:13`; [duplicate rows](../../artifacts/app-audit/screenshots/project-archive-duplicate-names.png); [file-identity probe](../../artifacts/app-audit/domain-probes.json). Raw filename differences elsewhere in that probe are candidates, not additional defects by themselves.

**Fix:** Resolve explicit form/support identities and display document kind plus MRF/PO reference and version where applicable. Preserve the supporting file's meaningful name. Test search and download names for both artifacts. Effort: medium.

### AUD-07 · P2 · The documented browser regression baseline is substantially stale

**Affected:** Confidence in workflow, document, user-management, and UI verification.

**Reproduce:** Run the original suites against the built production server. **16 of 25 fail**, while the unit suite is green. Examples: broad smoke expects Site Personnel revision 1 after installation increments it to 2; several quote suites expect the review editor before selecting Upload & review; project creation helpers omit the now-required project code; material-row fixtures create stale sessions; transfer checks query hidden Users content; maintenance checks expect a route that now redirects.

**Expected / actual:** The documented checks should exercise current behavior and use current session/fixture setup. Existing failures abort later assertions, so a former passing verification claim cannot establish current coverage.

**Evidence:** `scripts/browser-smoke.mjs:251`; `scripts/user-management-smoke.mjs:53`; `scripts/material-rows-smoke.mjs:59`; `scripts/site-stock-transfers-smoke.mjs:76`; [original run summaries](../../artifacts/app-audit/verification-summary.json) and linked logs. Audit-only copies recover several checks, but do not repair the originals.

**Fix:** Centralize browser account/fixture setup, use current required fields and explicit workflow steps, and assert redirects rather than obsolete paths. Add one documented aggregate command that returns failure when any selected suite fails. Keep fixture data and rendered records distinct from app failures in reports. Effort: medium–large.

### AUD-08 · P2 · Accounting's stock form starts with a forbidden action selected

**Affected:** Accounting inventory adjustments.

**Reproduce:** Open any inventory material as Accounting. The Action control's value is `usage`, but its selected “Record usage” option is disabled for Accounting. Only “Stock adjustment” is permitted. The form and quantity wording initially describe usage.

**Expected / actual:** Accounting should enter a ready-to-use adjustment form. Its local state initializes to usage for every role and only disables the unavailable option. Domain authorization still rejects unauthorized usage, so this is an invalid starting interaction rather than a proven stock authorization bypass.

**Evidence:** `src/features/inventory/Inventory.tsx:55`, `:73`; [browser check](../../artifacts/app-audit/browser-audit.json), `Accounting stock action default`; [screenshot](../../artifacts/app-audit/screenshots/accounting-stock-action-default.png).

**Fix:** Initialize the action to adjustment for Accounting and show only permitted actions. Verify initial labels and the first submitted command for both roles. Effort: small.

### AUD-09 · P2 · Mobile dashboard metrics push the working queue below the first screen

**Affected:** Mobile dashboard usability, particularly people trying to reach their next task.

**Reproduce:** Open Dashboard at 375 × 812. Large summary cards form one column; the first screen is occupied by metrics, with the role task queue below them. Administrator has five cards; Site Personnel has four. The header and title consume additional space.

**Expected / actual:** The stated dashboard direction makes the role queue its working destination. The mobile layout retains tall summary cards before the queue. The late `auto-fit/minmax(175px,1fr)` rule creates the single-column stack at this width.

**Evidence:** `src/features/dashboard/Dashboard.tsx:20`; `src/styles/redesign.css:20`, `:23`; `src/styles/workflow-enhancements.css:111`; [mobile dashboard](../../artifacts/app-audit/screenshots/view--dashboard-375-dark.png).

**Fix:** Place the role queue ahead of secondary metrics on phones, or compress summaries into a compact two-column strip. Validate task visibility at 320–414px and ensure long monetary amounts still fit. Effort: small–medium.

### AUD-10 · P2 · Setup and presenter documentation disagree with the working app

**Affected:** Anyone preparing or running a demonstration.

**Reproduce:** Follow README sign-in instructions: they describe sample-account autofill and a shared `Demo123!` password, which the current sign-in does not offer. Follow the presenter's reset instructions: `/admin/maintenance` redirects to Administration and has no reset control. The canonical context links to a missing Drive setup document and retains a fixed-year PO-reference statement despite the current project-code numbering scheme.

**Evidence:** `README.md:5`, `:17` (also contains a trailing NUL-encoded fragment); `docs/PRESENTER_ACCESS.md:17`; `docs/APP_CONTEXT.md:23`, `:285`, `:347`; `app/(workspace)/admin/maintenance/page.tsx:4`; `src/domain/document-numbering.ts:42`. The audit confirmed the missing `docs/GOOGLE_DRIVE_SETUP.md` locally.

**Fix:** Rewrite startup/sign-in/reset guidance around current behavior, remove obsolete reference statements, repair the README encoding, and restore or replace the missing setup link. Keep the existing decision to hide normal workspace clearing explicit. Effort: small.

### AUD-14 · P2 · Downloaded comparison links can point to a different browser-storage origin

**Affected:** Local comparison workbook downloads and their source quotation links.

**Reproduce:** Generate the same synthetic local comparison through both supported loopback addresses. Both responses are 200. At `http://localhost:3100`, the XLSX quotation links match that origin. At `http://127.0.0.1:3100`, every extracted source link still begins `http://localhost:3100/demo-files/` instead of the active `127.0.0.1` origin.

**Expected / actual:** Downloaded local-document links should return to the origin holding their records and IndexedDB files. The route makes relative links absolute against `request.url`; the framework's reconstructed origin can differ from the browser origin, a distinction already handled by the shared local-origin guard.

**Impact:** Opening a source link can start a separate workspace or fail to find the document, even in the originating browser profile. Merely testing that downloaded links are absolute does not establish that they work for the active workspace. Both loopback addresses are explicitly supported by the current docs.

**Evidence:** `app/api/bid-comparisons/route.ts:21`; contrasting hostname handling in `src/server/local-drive.ts:10`; [real local HTTP/XLSX probe](../../artifacts/app-audit/origin-link-probe.json). This probe generated documents only; it did not modify stored app records or contact Drive.

**Fix:** Resolve local document URLs against the validated browser origin, retaining strict deployed-origin checks and avoiding trust in arbitrary forwarded headers. Assert exact origin equality for downloads from both loopback aliases and verify PDF annotations use the same correction. Effort: small–medium.

### AUD-11 · P3 · Workspace routes share one browser title

**Affected:** Browser tabs, history, bookmarks, and route announcements.

**Reproduce:** Navigate among workspace screens and records. All 95 sampled workspace visits retain `HML ConstructSync | Project Operations` despite different page headings.

**Expected / actual:** Titles should identify the current section/record. Only the root and sign-in define metadata. The installed Next accessibility guide notes that its route announcer prefers the document title over the heading.

**Evidence:** `app/layout.tsx:16`; the title fields in [browser evidence](../../artifacts/app-audit/browser-audit.json); local guide `node_modules/next/dist/docs/03-architecture/accessibility.md`, “Route Announcements”.

**Fix:** Add section titles and update record titles once browser-local records load. Keep the company/product suffix. Verify both direct navigation and client transitions. Effort: small–medium.

### AUD-12 · P3 · Navigation advertises destinations that immediately deny the current role

**Affected:** Project Manager, Procurement, Finance, Logistics, and Accounting navigation.

**Reproduce:** As Finance, follow Reports or Administration from the sidebar. Both are offered and then show Access unavailable. Project Manager is similarly offered Administration. Site Personnel's menu already filters restricted sections.

**Evidence:** `src/components/shell/AppShell.tsx:131`; the early non-site-role return at `src/domain/read-access.ts:62`; feature guards in `src/features/reports/Reports.tsx:25` and `src/features/admin/Admin.tsx:20`; role visits in browser evidence.

**Fix:** Apply section visibility consistently for all roles while retaining direct-route guards. Preserve read-only destinations that are actually permitted. Effort: small.

### AUD-13 · P3 · Quotation copy contains visible character-encoding artifacts

**Affected:** Procurement step summaries, confirmations, extraction status, and PO links.

**Reproduce:** Open a quotation workspace. The eyebrow reads `PROCUREMENT Â· QUOTATION REVIEW`; counts and confirmation text also contain `Â·`. Archive progress uses `Archiving?`.

**Evidence:** `src/features/requests/QuotationWorkspace.tsx:137`, `:155`, `:222`, `:229`, `:232`; body text recorded in browser evidence and quotation test logs.

**Fix:** Correct the UTF-8 source strings, use the intended separator/ellipsis, and check the rendered text of the affected states. Effort: small.

## What worked and practical limits

Verified strengths include linked domain commands with immutable named attribution, quantity/payment/budget guards, upfront verification followed by separate clearance, independent credit payment and delivery progress, cancellation/confirmation behavior, persistent local documents, stock transfer accounting, site-access restrictions, and themed loading/recovery presentation. These strengths are supported by the specific passing tests and probes in the coverage report; they do not imply every branch passed browser testing.

UI foundations are coherent: the existing Geist typography, blue palette, compact registers, pagination, visible status text, shared modals, and light/dark tokens generally hold together. Keyboard Escape/focus restoration was independently verified for project settings and exercised more broadly by the passing suites. The adapted quotation worksheet suite measured a minimum warning-text contrast of **4.60:1 for its targets**. Small-link candidates were recorded but were not automatically treated as accessibility violations, since row targets and spacing must be considered.

The 95 warmed-server navigation samples averaged approximately **384 ms** (293–877 ms), including deliberate script waits. This is a local measurement under audit load, not a user-facing latency promise, cold-start benchmark, or load test. Supplier allocation passed a 100-material/five-supplier stress scenario; additional large quotation checks are itemized in coverage.

Hallmark was applied in the context of the app's existing enterprise design direction: a consistent register system and a single sans-serif family are appropriate here. No generic marketing-template structural defect was confirmed. The mobile hierarchy and copy findings are concrete usability/execution issues, not a request for a redesign. Named Hallmark anti-pattern counts: **0 critical · 0 major · 0 minor**.

## Production-readiness gaps — separate from prototype defects

| Gap | Current evidence | Capability needed before real shared company use |
| --- | --- | --- |
| Shared, authoritative records | Operational records and account directory are browser-local; whole snapshots are written locally. | Shared persistence, server validation of commands, concurrency control, transactional quantities/payments, and durable audit history. |
| Server authentication and authorization | Department switching and account checks are client-side; server routes rely on deployment/origin controls rather than an app identity. | Server sessions and record/role authorization on every sensitive read/write. Verify deployed access controls independently. AUD-01 is an additional inconsistent guard within the current architecture. |
| Durable documents and recovery | Demonstration archives and installation backups remain in IndexedDB in the originating browser. Downloaded local links require that origin/profile and its records. | Durable company storage, documented backup/export/restore, retention, and recovery after device/browser loss. Live Drive permission/expiry behavior remains unverified. |
| Operational assurance | Local checks exercise fixtures and mocks. No deployment, real supplier transaction, live OCR accuracy study, load test, or operational monitoring was assessed. Google Fonts requires build-time network access. | Deployment checks, integration contract tests in a controlled environment, error/usage monitoring, capacity testing, and a repeatable build environment. |

## Recommended correction order

1. Add the quotation origin guard and controlled file/body validation (AUD-01/02).
2. Unify business calendar dates and correct report range comparisons (AUD-03/04).
3. Add nondestructive installation retry, distinguish archive document identities, and correct downloaded source-link origins (AUD-05/06/14).
4. Repair the original browser suites and synchronize presenter/setup documentation (AUD-07/10).
5. Correct the Accounting action default and mobile dashboard hierarchy (AUD-08/09), then finish titles, navigation visibility, and copy cleanup (AUD-11/12/13).

No application code, API, schema, or original regression script was changed by this audit. Audit documents, scripts, logs, summaries, and screenshots were added. Existing work was not reverted. Live Google Drive, AI providers, deployment protection, real browser zoom, non-Edge engines, and screen-reader announcements remain explicitly outside the directly verified results.
