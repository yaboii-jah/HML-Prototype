# HML ConstructSync — Current Application Context

> **Living document:** This is the canonical, implementation-aligned context for the application. Update this file in the same change whenever a major implementation changes the product scope, business workflow, domain model, permissions, routes, persistence, seeded walkthrough, architecture, or verification strategy. Do not record small visual polish, copy edits, or isolated bug fixes unless they change one of those areas.

**Last verified:** 2026-09-28
**Application version:** Prototype (`package.json` 0.1.0)
**State schema:** `DemoSnapshot` version 7

## Product in one paragraph

HML ConstructSync is a browser-only construction operations prototype that demonstrates the linked journey from a Material Request Form (MRF) through Project Manager review, supplier quotation draft and finalization, staged supplier awards, Purchase Order (PO) preparation, Finance review, supplier serving, delivery receiving, site inventory posting, material usage, and Accounting document/payment tracking. A fresh workspace starts empty so a presenter can enter each project and operational record manually. Procurement creates supplier references from finalized quotations. It uses simulated role switching, browser `localStorage` for records, and IndexedDB for uploaded MRF and supplier quotation files. A local Next.js server route can parse quotations with Gemini when `GEMINI_API_KEY` is configured. It has no authentication, database, shared file storage, supplier portal, or payment integration.

## Current product boundary

- Eight simulated roles share one workspace: Site Personnel, Project Manager, Procurement, Finance, Logistics, Accounting / Auditing, Management, and Administrator.
- Role switching changes permitted actions and dashboard tasks. It is a presentation of authorization rules, not security.
- Site filtering changes dashboard and queue context without creating separate tenant data.
- All operational changes pass through typed domain commands and update one linked snapshot.
- MRF and supplier quotation files are kept in the uploading browser's IndexedDB and linked to snapshot metadata. MRF uploads accept any file type and size the browser can store; documents are optional for submission. When files are added, the first fills the scope slot, the next fills the signed MRF slot, and later files are supporting documents. Older MRF attachment references remain metadata only. Each ordered supplier group of PDF and/or image files represents one supplier quote.
- The Gemini API key stays in the local Next.js server environment. Simulated roles do not secure the parsing endpoint; this integration is intended for local use only.
- For local parsing, copy `.env.example` to `.env.local`, set `GEMINI_API_KEY`, and restart `next dev`. Quotation review's manual fallback works without a key.
- External actions such as serving a PO and recording payment are demonstrations only.
- The primary experience is desktop, while delivery receiving and inventory actions are intended to remain usable on mobile widths.

## Core business flow

```text
Site Personnel creates/submits MRF
  -> Project Manager approves, returns, or rejects
  -> Procurement groups supplier files or enters a quotation manually, checks extracted details and MRF matches, and finalizes each quote
  -> Procurement compares finalized offers and stages justified, capped quantity awards across suppliers
  -> Procurement generates one draft PO per awarded supplier
  -> Procurement finalizes PO for Finance
  -> Finance approves, holds, returns, or rejects
  -> Procurement serves an approved PO
  -> Logistics schedules delivery batch(es)
  -> Site Personnel confirms accepted quantities
  -> Site Personnel reviews and posts accepted stock once
  -> Site Personnel records usage; Site or Accounting may make reasoned adjustments
  -> Accounting tracks documents and simulated payment references
  -> Management reviews cross-project status and exceptions
```

The statuses for the request, PO/Finance review, delivery, inventory posting, documents, and payment are intentionally separate. Finance approval does not mean served, paid, delivered, or posted to stock.

## Roles and implemented responsibilities

| Role | Main implemented responsibilities |
| --- | --- |
| Site Personnel | Create/save/submit or revise MRFs; confirm receiving; post accepted stock; record usage and stock adjustments. |
| Project Manager | Approve submitted MRFs or return/reject them with a reason. |
| Procurement | Upload grouped or manually entered supplier quotations, save and finalize reviewed revisions, confirm material matches and discrepancies, stage split awards, create/edit/finalize supplier-specific POs, and serve Finance-approved POs. |
| Finance | Set PO priority; approve, hold, return, or reject POs; approval is constrained by available site budget. |
| Logistics | Schedule delivery batches against the unscheduled balance of a served PO. |
| Accounting / Auditing | Track invoice/receipt review, discrepancies, payment references, and justified stock adjustments. |
| Management | Read cross-project reports and inspect exceptions; no operational approval commands. |
| Administrator | Add projects/sites, maintain Project Manager names and activity visibility; clear all workspace data with confirmation. |

The domain command layer in `src/domain/commands.ts` is the authority for permissions and transition validation. Hiding an action in the UI is not sufficient authorization.

## Workflow states and invariants

### Material requests

- States: `draft`, `submitted`, `returned`, `approved`, `rejected`.
- Only Site Personnel can create or edit an MRF, and only drafts or returned records are editable.
- Submission requires request details and at least one valid item. MRF documents are optional and do not block submission; uploads accept any file type and size the browser can store.
- General request information includes a manually entered, globally unique M.R.F No. and editable Request Date, plus Requested by, Approved by, Purchaser/Procurement Officer, and Finance Officer names. All six fields are required for submission but may be blank in a draft. Request Date is document metadata and may be in the future; system timestamps still drive activity and report filters.
- Each material carries its own date needed, purpose, delivery location, and remarks. Submission requires a name, unit, positive quantity, date, and location; purpose and remarks may be blank. Register and project summaries show the earliest material date.
- Only a submitted MRF can be reviewed by a Project Manager.
- The PM material cards display current on-hand site stock by exact material name and unit. Approval does not reserve or deduct stock.
- Return and rejection require a reason of at least five characters.
- Only approved MRFs can receive quotations.
- Workflow handoffs and consequential decisions use a confirmation dialog; draft saves and routine edits do not. Successful actions use a brief global toast, while action failures remain visible in page banners and field corrections remain beside their inputs.

### Quotations and purchase orders

- Quotations begin as persistent drafts and may cover some MRF lines. They retain offered lines, discounts and charges, supplier details, commercial terms, source file IDs, and immutable finalized revisions. Older seeded quotations remain readable as legacy references without original file bytes.
- The quotation queue has one group per supplier; each group accepts up to 12 ordered PDF/JPG/PNG/WebP files, 20 MB per file and 45 MB combined. A single Extract with AI action processes ready groups separately with a visible per-group processing state. The general Enter manually action can attach a queued group's files, including after an extraction failure, or start a file-free draft. Draft review cards open on click; source documents open in a multi-file preview dialog.
- Gemini proposes extracted data and MRF matches only. Procurement checks the original, corrects pricing and supplier details, confirms each match and unit conversion, and explains any remaining discrepancy before finalization. Manual entry works without a file or API key. Unfinalized drafts can be deleted; finalized quotations remain immutable.
- Finalized quotations can be compared without a fixed quote count. Procurement may record a supplier selection reason; awards are staged and persist until PO generation. Only PHP quotations are awardable.
- Each PO stores its awarded MRF quantities and source quotation revision. Multiple POs may share one MRF; a material may be split across suppliers. Active PO and staged allocations cannot exceed requested MRF quantities or the supplier's quoted quantity; rejected POs release their allocation.
- Award generation creates one draft PO per supplier from the staged quantities. Procurement confirms each PO's line discounts and other charges. Draft and Finance-returned POs may be edited; a draft using an older quote revision needs an explicit reason before finalizing. Finalized purchasing details are locked.
- PO printouts show each item's MRF delivery location. Draft printouts carry a preview watermark until Finance approval.
- PO states: `draft`, `finalized`, `hold`, `returned`, `rejected`, `approved`, `served`.
- Only draft or Finance-returned POs can be edited. Finalizing sends the PO to Finance.
- Finance can review `finalized` or `hold` POs. Hold, return, and rejection require a reason.
- Finance approval fails when the PO total exceeds the site's currently available budget.
- Only an approved PO can be served. Served purchasing details are locked.

### Budget

- The displayed provisional rule is `available = allocated - committed - spent`.
- Approved and served unpaid PO value is committed.
- A recorded payment moves that amount from commitment to spent, leaving available budget unchanged by the move itself.
- Draft, finalized, held, returned, and rejected POs are not commitments.
- This is prototype budget logic, not a formal accounting ledger.

### Delivery and inventory

- Only served POs can have delivery batches.
- Logistics can schedule expected quantities only within the unscheduled PO balance.
- Batch states: `expected`, `confirmed`, `posted`.
- Site Personnel confirms actual accepted quantities. A shortage or damaged/rejected amount requires an issue note.
- Accepted quantity cannot exceed the expected batch quantity or open PO balance.
- Posting uses accepted quantity, creates site-specific receipt movements, and is allowed once per batch.
- Editing accepted quantities at posting time requires a reason.
- Inventory is calculated from movements per site and per normalized material/unit pair: opening + receipts - usage +/- adjustments.
- Usage cannot create negative stock. Usage and adjustments require a reason; Accounting is a backup role for adjustments.

### Accounting

- Document review states are `Incomplete`, `Under Review`, `Complete`, and `Discrepancy`.
- Completing review requires both invoice and receipt references; a discrepancy requires a note.
- Payment status is derived independently as Unpaid, Partly Paid, or Paid.
- Payments must be positive and cannot exceed the unpaid PO amount.
- Accounting actions are available only for approved or served POs.

## Architecture and sources of truth

| Area | Current implementation |
| --- | --- |
| Framework | Next.js 16.3.6 App Router, React 19.2.8, TypeScript 5. |
| Route layer | `app/`; route files are thin adapters that render feature components. Dynamic route `params` and `searchParams` are awaited. |
| Feature screens | `src/features/` grouped by requests, purchasing, Finance, deliveries, inventory, Accounting, projects, suppliers, reports, dashboard, and admin. |
| Shared shell/UI | `src/components/`; `AppShell` owns navigation, role/site controls, prototype messaging, and shared workspace chrome. |
| State access | `DemoProvider` in `src/app-state/` exposes repository state, command execution, reset, and transient notices. |
| Domain model | `src/domain/types.ts` defines records and statuses. |
| Mutations | `src/domain/commands.ts` is the single transition, permission, and validation boundary. |
| Derived data | `src/domain/pricing.ts` calculates quotation and PO totals; `src/domain/procurement.ts` validates quote review and revisions; `src/domain/selectors.ts` calculates budgets, delivery balances, payment state, and inventory. `src/domain/queues.ts` derives role tasks and dashboard metrics. |
| Persistence | `src/mock/repository.ts` owns local loading, saving, migration, recovery, and reset behavior. |
| Workspace baseline | `src/mock/fixtures/blank.ts` creates an empty browser workspace. `seed.ts` remains a test fixture only. |
| Styling | Global layers in `src/styles/` plus `app/globals.css`; `ui-direction.md` documents the visual direction. |
| Verification | Domain tests in `tests/demo.test.mjs` and `tests/procurement.test.mjs`; extraction tests in `tests/quote-extraction.test.mjs`; grouped quotation, award, and Finance browser check in `scripts/quotation-smoke.mjs`; broader browser walkthrough in `scripts/browser-smoke.mjs`. |

Keep business rules out of page components where practical. New state transitions should be modeled as commands, new calculations as selectors, and durable records in the versioned snapshot.

## Persistence and recovery

- Current storage key: `hml-constructsync-demo-v7`.
- On first load, the repository creates an empty workspace if no saved state exists.
- Compatible data migrates from v6, v5, v4, v3, `hml-constructsync-demo-v2`, `hml-buildsync-demo-v2`, or version-1 `hml-buildsync-demo-v1`. Previous request-wide material details are copied to each item, IDs and edits are preserved, and Request Date is backfilled from each MRF's creation timestamp. Legacy quotes are upgraded to finalized records. Legacy category values and scope text remain stored for compatibility but are no longer editable in the workflow.
- MRF and quotation originals are browser-local. Clearing browser data removes them; the Gemini Files API is not used as permanent document storage.
- Malformed saved data enters an explicit recovery state instead of being silently overwritten.
- If storage is unavailable, the app continues with volatile in-tab state and displays a warning.
- Clear workspace restores the empty baseline, removes recognized legacy keys, and clears browser-local MRF and quotation files. Existing saved work remains until explicitly cleared.
- Old query-string links using `?view=&kind=&id=` redirect to current routes through `src/domain/legacy-links.ts`.

Any incompatible snapshot change requires a schema-version decision and a migration or an explicitly documented reset strategy.

## Route map

| Route | Purpose |
| --- | --- |
| `/` | Redirects legacy query links or defaults to `/dashboard`. |
| `/dashboard` | Role-specific metrics and derived task queue. |
| `/projects`, `/projects/[siteId]` | Project register and site workspace. |
| `/requests`, `/requests/new` | MRF register and creation. |
| `/requests/[id]`, `/requests/[id]/edit` | MRF detail/review and editable draft/return form. |
| `/requests/[id]/quotes` | Guided grouped upload or manual quote entry, saved review and finalization, comparison, staged split awards, and PO generation. |
| `/suppliers` | Supplier directory derived from finalized quotations. |
| `/purchase-orders`, `/purchase-orders/[id]` | PO register and linked detail. |
| `/purchase-orders/[id]/edit` | Editable draft or returned PO. |
| `/finance`, `/finance/[poId]` | Finance queue and budget review. |
| `/deliveries`, `/deliveries/new` | Delivery tracker and batch scheduling. |
| `/deliveries/[id]` | Receiving confirmation and stock-posting flow. |
| `/inventory`, `/inventory/[siteId]/[materialId]` | Site inventory and material movement history. |
| `/accounting`, `/accounting/[poId]` | Accounting queue and PO document/payment record. |
| `/reports` | Management cross-project reporting. |
| `/admin` | Project creation, Project Manager assignments, recent activity, and a confirmed clear-workspace action. |

All workspace routes are wrapped by `app/(workspace)/layout.tsx`, which applies the data gate and application shell.

## Empty workspace baseline

- A fresh browser starts with no projects, suppliers, MRFs, quotations, POs, deliveries, stock movements, payments, accounting records, or activity.
- Administrator adds a project with its Project Manager and allocated budget. Site Personnel can then create the first MRF.
- Suppliers enter the directory when Procurement finalizes a quotation.
- The historical cement transaction remains in `src/mock/fixtures/seed.ts` for automated test fixtures only. It is never loaded for a new or cleared workspace.

## Verification baseline

Run the following after changes that affect behavior or architecture:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

With the development server running, use `node scripts/browser-smoke.mjs` for the broader linked workflow, persistence, legacy-link, and responsive-width checks. Use `node scripts/quotation-smoke.mjs http://localhost:3100` with a production server on port 3100 for grouped quotation review, saved awards, split POs, Finance approval, and print status.

The domain test suite currently protects these high-value behaviors:

- Seeded purchasing, delivery, inventory, and budget consistency.
- MRF permission/review rules and ID preservation after return/resubmission.
- Single stock posting, outstanding quantities, site isolation, and nonnegative inventory.
- Payment movement from commitment to spent without double-reducing available budget.
- Version-1 and version-2 storage migration plus malformed-data recovery.
- Quote review/finalization, staged split award caps, charge confirmation, quote revisions, and version-4 migration.
- Legacy URL routing.

## Known assumptions and non-goals

- Logistics ownership and exact handoffs remain provisional.
- Accounting authority for payments and stock corrections remains provisional.
- The budget commitment calculation is a display rule pending client validation.
- Formal purchase closure is not modeled.
- Tax, VAT/EWT, accruals, bank balances, detailed ledgers, real notifications, shared uploads, email, and integrations are out of scope.
- The year embedded in generated PO references is currently fixed to `2026`.
- The repository is deliberately local-first and single-browser; concurrent multi-user behavior is not modeled.

## Maintenance contract

Update this file in the same implementation whenever a change affects any of the following:

1. Product scope, terminology, or a working assumption.
2. A role, permission, handoff, status, validation rule, or business invariant.
3. A domain record, command, selector, snapshot version, storage key, or migration.
4. A user-facing route, major feature area, or architectural ownership boundary.
5. Seeded records or the canonical walkthrough and its expected figures.
6. Required verification commands or protected end-to-end behavior.

When updating it:

- Describe the implemented behavior in present tense; keep future plans in **Known assumptions and non-goals**.
- Reconcile related sections rather than appending contradictory notes.
- Update **Last verified** and add one concise entry to the change log.
- Confirm statements against the implementation, especially `types.ts`, `commands.ts`, `selectors.ts`, the repository, route files, and tests.
- Keep detailed design history in version control; this file should remain a compact snapshot of the current system.

## Context change log

| Date | Context change |
| --- | --- |
| 2026-09-24 | Created the canonical application context from the implemented routes, domain model, command rules, persistence layer, seed data, and tests. |
| 2026-09-25 | Moved request detail fields to each material, added general information names, and migrated saved snapshots to version 3. |
| 2026-09-25 | Added browser-local supplier quotation files, Gemini extraction review, material-level comparison, split supplier awards, and version 4 data migration. |
| 2026-09-27 | Added grouped supplier quote drafts and revisions, guided review and finalization, persistent split allocations, supplier PO charge confirmation, version 5 migration, and updated browser verification. |
| 2026-09-28 | Changed new and cleared workspaces to start empty, added Administrator project creation and clear action, and added first-MRF setup guidance. |
| 2026-09-28 | Removed category and supplier setup from Admin, added reopenable MRF scope and signed files, optional material purpose, mixed-file supplier groups, batch AI action, draft deletion, decision dialogs, and version 6 migration. |
| 2026-09-28 | Added manual globally unique M.R.F numbers and editable Request Dates with version 7 migration, and streamlined quotation upload, review cards, and document preview. |
