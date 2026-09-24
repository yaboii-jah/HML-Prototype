# HML ConstructSync — Current Application Context

> **Living document:** This is the canonical, implementation-aligned context for the application. Update this file in the same change whenever a major implementation changes the product scope, business workflow, domain model, permissions, routes, persistence, seeded walkthrough, architecture, or verification strategy. Do not record small visual polish, copy edits, or isolated bug fixes unless they change one of those areas.

**Last verified:** 2026-09-24
**Application version:** Prototype (`package.json` 0.1.0)
**State schema:** `DemoSnapshot` version 2

## Product in one paragraph

HML ConstructSync is a browser-only construction operations prototype that demonstrates the linked journey from a Material Request Form (MRF) through Project Manager review, supplier quotation comparison, Purchase Order (PO) preparation, Finance review, supplier serving, delivery receiving, site inventory posting, material usage, and Accounting document/payment tracking. It uses fictional seeded data, simulated role switching, and browser `localStorage`; it is not a production system and has no authentication, backend, database, real file storage, supplier portal, payment integration, or external API.

## Current product boundary

- Eight simulated roles share one workspace: Site Personnel, Project Manager, Procurement, Finance, Logistics, Accounting / Auditing, Management, and Administrator.
- Role switching changes permitted actions and dashboard tasks. It is a presentation of authorization rules, not security.
- Site filtering changes dashboard and queue context without creating separate tenant data.
- All operational changes pass through typed domain commands and update one linked snapshot.
- Documents are metadata references only (name/type or reference text); no document bytes are stored.
- External actions such as serving a PO and recording payment are demonstrations only.
- The primary experience is desktop, while delivery receiving and inventory actions are intended to remain usable on mobile widths.

## Core business flow

```text
Site Personnel creates/submits MRF
  -> Project Manager approves, returns, or rejects
  -> Procurement compares at least two quotes and drafts PO
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
| Procurement | Add quotations, select a supplier, create/edit/finalize POs, and serve Finance-approved POs. |
| Finance | Set PO priority; approve, hold, return, or reject POs; approval is constrained by available site budget. |
| Logistics | Schedule delivery batches against the unscheduled balance of a served PO. |
| Accounting / Auditing | Track invoice/receipt review, discrepancies, payment references, and justified stock adjustments. |
| Management | Read cross-project reports and inspect exceptions; no operational approval commands. |
| Administrator | Maintain site assignments, material categories, supplier reference data, and activity visibility. |

The domain command layer in `src/domain/commands.ts` is the authority for permissions and transition validation. Hiding an action in the UI is not sufficient authorization.

## Workflow states and invariants

### Material requests

- States: `draft`, `submitted`, `returned`, `approved`, `rejected`.
- Only Site Personnel can create or edit an MRF, and only drafts or returned records are editable.
- Submission requires request details, at least one valid item, and a signed MRF document reference.
- Only a submitted MRF can be reviewed by a Project Manager.
- Return and rejection require a reason of at least five characters.
- Only approved MRFs can receive quotations.

### Quotations and purchase orders

- A quote must cover every requested line with a positive unit price.
- A PO can be created only after at least two supplier quotations are available for an approved MRF.
- The supplier selection requires a written rationale; the cheapest quote may be highlighted but is never selected automatically.
- There is at most one PO per MRF in the current prototype.
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
| Derived data | `src/domain/selectors.ts` calculates totals, budgets, delivery balances, payment state, and inventory. `src/domain/queues.ts` derives role tasks and dashboard metrics. |
| Persistence | `src/mock/repository.ts` owns local loading, saving, migration, recovery, and reset behavior. |
| Seed baseline | `src/mock/fixtures/seed.ts` creates the initial linked demo snapshot. |
| Styling | Global layers in `src/styles/` plus `app/globals.css`; `ui-direction.md` documents the visual direction. |
| Verification | Domain tests in `tests/demo.test.mjs`; browser walkthrough in `scripts/browser-smoke.mjs`. |

Keep business rules out of page components where practical. New state transitions should be modeled as commands, new calculations as selectors, and durable records in the versioned snapshot.

## Persistence and recovery

- Current storage key: `hml-constructsync-demo-v2`.
- On first load, the repository seeds the workspace if no saved state exists.
- Compatible data migrates from `hml-buildsync-demo-v2` or version-1 `hml-buildsync-demo-v1` while preserving IDs and user edits where possible.
- Malformed saved data enters an explicit recovery state instead of being silently overwritten.
- If storage is unavailable, the app continues with volatile in-tab state and displays a warning.
- Reset restores the current seed and removes the recognized legacy keys.
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
| `/requests/[id]/quotes` | Quotation comparison, quote entry, and PO selection flow. |
| `/suppliers` | Supplier directory and reference maintenance. |
| `/purchase-orders`, `/purchase-orders/[id]` | PO register and linked detail. |
| `/purchase-orders/[id]/edit` | Editable draft or returned PO. |
| `/finance`, `/finance/[poId]` | Finance queue and budget review. |
| `/deliveries`, `/deliveries/new` | Delivery tracker and batch scheduling. |
| `/deliveries/[id]` | Receiving confirmation and stock-posting flow. |
| `/inventory`, `/inventory/[siteId]/[materialId]` | Site inventory and material movement history. |
| `/accounting`, `/accounting/[poId]` | Accounting queue and PO document/payment record. |
| `/reports` | Management cross-project reporting. |
| `/admin` | Assignments, supplier/category reference data, and recent activity. There is no routine reset control. |

All workspace routes are wrapped by `app/(workspace)/layout.tsx`, which applies the data gate and application shell.

## Seeded demonstration baseline

- Two sites: Harbor Residences · Site A and Northline Warehouse · Site B.
- Three suppliers and six material categories.
- Nine MRFs covering draft, submitted, returned, approved, and rejected states.
- Five POs covering draft, finalized, hold, approved, and served states.
- The canonical cement transaction is `MRF-2026-001` -> `PO-2026-001`:
  - 100 bags ordered at PHP 278 each (PHP 27,800).
  - 60 bags accepted and posted.
  - 30 bags used.
  - 30 bags currently on hand and 40 bags outstanding.
  - A second expected batch of 40 bags is ready for the receiving/posting walkthrough.
  - Posting that full second batch brings stock to 70 bags and outstanding quantity to zero.
- The seeded cement PO is unpaid and has an incomplete document review because the supplier invoice is pending.

If seed records or their identifiers change, update this section and every test or walkthrough that treats them as fixtures.

## Verification baseline

Run the following after changes that affect behavior or architecture:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

With the development server running, use `node scripts/browser-smoke.mjs` for the linked workflow, persistence, legacy-link, and responsive-width checks.

The domain test suite currently protects these high-value behaviors:

- Seeded purchasing, delivery, inventory, and budget consistency.
- MRF permission/review rules and ID preservation after return/resubmission.
- Single stock posting, outstanding quantities, site isolation, and nonnegative inventory.
- Payment movement from commitment to spent without double-reducing available budget.
- Version-1 and prior-product storage migration plus malformed-data recovery.
- Legacy URL routing.

## Known assumptions and non-goals

- Logistics ownership and exact handoffs remain provisional.
- Accounting authority for payments and stock corrections remains provisional.
- The budget commitment calculation is a display rule pending client validation.
- Formal purchase closure is not modeled.
- Tax, VAT/EWT, accruals, bank balances, detailed ledgers, real notifications, real uploads, email, and integrations are out of scope.
- The year embedded in generated MRF and PO references is currently fixed to `2026`.
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
