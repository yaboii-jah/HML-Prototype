# Batch 1: Named audits and the combined MRF lifecycle

Client requirements: **1 — Audit trail**, **2 — Combined timeline**. This specification follows [CLIENT_REQUIREMENTS_BATCH_PLAN.md](CLIENT_REQUIREMENTS_BATCH_PLAN.md); later batches remain gated by their client decisions.

## Agreed behavior

- Place a prominent lifecycle section on the existing MRF detail page, reached by dashboard and project links.
- Summarize MRF, purchasing, payment and delivery progress, followed by full chronological history. Payment and delivery progress remain independent; no overall MRF completion rule is introduced.
- Retain immutable user name/email/department snapshots when actions occur. Document signatories remain separate. Existing role-only history stays readable without inventing names.
- Record business edits and archive outcomes, including previously silent quote drafts, supplier allocations and payment priorities. Edited records retain changed-field labels and required reasons, without before/after values; no-op automatic saves add no event.
- Keep each saved event. Only the display groups consecutive quotation saves for the same actor and quotation when gaps are at most 60 seconds. Expand groups to inspect every original save.
- Display recorded date/time with seconds in Philippine time. Never treat an editable business date or latest record update as a completion time. Missing timestamps are shown as not recorded.
- Show 50 history rows/groups initially, with Load more. Existing related records have links; removed records retain plain references.

## Data and operation boundaries

The optional audit metadata includes acting-account snapshots, typed event kinds, MRF/PO ownership, saved references and changed fields. Named reviewer/uploader/payment/stock metadata supplements existing role fields; workspace schema 12 and email/role session storage remain compatible.

Lifecycle ownership follows explicit MRF, quote, comparison, allocation, PO, payment request/payment, delivery and accounting evidence relationships. Shared-site usage is not assigned to an MRF merely because material names match.

Started archive, comparison-generation and evidence-preparation operations capture their initiating identity and target before asynchronous work. Their runners accept only relevant acknowledgements, bind to source versions and preserve current business guards. They cannot make new approvals/payments, operate on another record, or restore a previous user's selected role. A manual retry captures its new actor and records its outcome even when the error is unchanged; duplicate acknowledgements do not create duplicate events.

## Verification

- Immutable actor identity, independent document signatories, invalid actors and historical attribution.
- Meaningful edit/no-op detection, deleted draft/allocation ownership and isolation between different MRFs.
- Quotation saves grouped only in the view; no stored history is discarded.
- Started uploads finishing after sign-out/account change, explicit retries, source changes and forbidden commands/targets.
- Split POs, credit delivery with pending payment, partial deliveries, corrections, record links, pagination and desktop/mobile layout.
- V12 reloads without rewriting legacy history; existing login/session and financial/quantity rules.

Completed October 7, 2026. All 104 automated tests, ESLint, TypeScript checks and production build passed. Both browser walkthroughs passed, covering the upfront/credit workflows, split POs, independent report archive retries, receiving/evidence, persistence and duplicate-posting controls. The delayed MRF upload retained its initiating Procurement user after sign-out and Finance sign-in. History pagination, expandable saves, removed-record references, contrast and viewport fit passed at 320, 375, 768 and 1440 pixels in both themes; desktop/mobile screenshots were inspected.
