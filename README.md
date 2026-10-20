# HML ConstructSync

A browser-local construction operations prototype for projects, suppliers, purchasing, payments, deliveries, stock transfers and material usage. Business records and accounts stay in the current browser profile; server routes assist with document generation and AI/Google Drive integrations. Account switching demonstrates department workflows and is not production server authentication.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. New browser profiles start with an empty workspace and the named accounts in [Presenter access](docs/PRESENTER_ACCESS.md). Sign in as Administrator or Project Manager to add projects and configure their Google Drive folders. Switch accounts from the header to demonstrate department handoffs. Sign out preserves saved work.

Use the same hostname, port and browser profile throughout a walkthrough: localStorage and IndexedDB belong to that origin. The first load of this version clears all prior operational records, drafts, browser document files and demonstration backups once, including manually entered work. Accounts, credentials and account-management history are retained; old project assignments and sessions are cleared. A failed cleanup offers **Retry setup** and blocks workspace use until it finishes. After completion, newly entered records survive refreshes. Administration has no routine workspace-clearing control.

## Main workflow

Site Personnel submits an MRF, then the Project Manager reviews it. Procurement checks site stock and quotations and prepares POs for Accounting review and approval, then confirms supplier issuance. Upfront payment verification precedes delivery clearance; credit payment and delivery can progress independently. Logistics dispatches; receiving teams confirm quantities; Site Personnel posts accepted stock and records usage. Legacy records keep their original approval/payment path.

MRF lifecycle details show outstanding actions by department, their blockers and permitted record links. Dashboard and notifications use the same action projection. Site inventory separates **Stock**, **Usage entries** and **Consumption**. The consumption view reconciles opening stock, additions, use, transfers out and adjustments to closing stock for Philippine calendar dates and exports all filtered rows to CSV.

## Storage and integrations

Snapshot version 12 uses `hml-constructsync-demo-v12`; sessions use `hml-constructsync-session-v2`, and the named account directory uses `hml-constructsync-users-v1`. The completed one-time cleanup is recorded in `hml-constructsync-empty-workspace-v1`. Uploaded originals and document caches use IndexedDB. No operational sample data is installed. After initialization, unreadable or older workflow snapshots require explicit recovery. Browser-storage failures show an in-memory warning; usage drafts remain available for safe retry where browser storage permits.

New projects use Google Drive document archives. Copy `.env.example` to `.env.local` and follow [Drive configuration](docs/GOOGLE_DRIVE_SETUP.md). Missing configuration or failed uploads leave archives pending with retry controls; saving a browser cache does not complete a Drive upload. Existing files in Google Drive are preserved by workspace cleanup. Keep secrets out of Git. See [canonical application context](docs/APP_CONTEXT.md).

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run start -- --port 3100
```

With that production server running in a separate terminal:

```bash
npm run test:browser -- http://127.0.0.1:3100
```

The aggregate runner launches isolated headless Edge profiles, runs the audited browser suite set plus usage/iteration checks, writes logs and a machine-readable result under `artifacts/iteration-2`, and exits nonzero if a selected suite fails. To rerun selected suites, append names, for example `next-iteration usage-entries`. Fixture-based suites explicitly mark their workspaces initialized; `showcase` verifies empty startup, one-time cleanup, retained accounts and Google Drive routing. Populated fixtures are used only by automated tests. Screenshot paths are printed by each suite. These are local prototype checks, not live AI/Drive or production authorization certification.

See [iteration verification](docs/qa/ITERATION_2_VERIFICATION.md) for delivered behavior, audit follow-up and scope limits.

## Repository layout

- `app/`: route adapters and server endpoints; installed Next.js guides govern route conventions.
- `src/features/`: department workflows and screens.
- `src/domain/`: business commands, read permissions, actions, stock and report calculations.
- `src/mock/` and `src/app-state/`: browser persistence, accounts and empty-workspace initialization.
- `tests/` and `scripts/`: domain/API tests and browser checks.
- `docs/WORKFLOW.md`: business walkthrough and acceptance references.
