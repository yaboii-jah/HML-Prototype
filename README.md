# HML ConstructSync

A browser-local construction operations prototype for projects, suppliers, purchasing, payments, deliveries, stock transfers and material usage. Business records and accounts stay in the current browser profile; server routes assist with document generation and AI/Google Drive integrations. Account switching demonstrates department workflows and is not production server authentication.

See the [project overview](docs/project-overview.md) for the agreed production purpose, workflows, scope and success criteria.

Follow the [AI workflow rules](docs/ai-workflow-rules.md) for development scope, documentation updates and verification expectations.

Use the [code standards](docs/code-standards.md) for implementation conventions and the Tailwind styling target.

Check the [progress tracker](docs/progress-tracker.md) for completed work, migration priorities, open decisions and dated verification results.

Use the companion [production checklist](docs/checklist.md) to follow foundational and future steps and mark them complete after verification.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. New browser profiles start with an empty operational workspace. The current local build still bootstraps test accounts defined in [account fixtures](src/app-state/account-fixtures.ts); these are prototype-only and must be retired before company operations. Individual production authentication and shared records remain migration work in the [progress tracker](docs/progress-tracker.md). Sign out preserves saved work.

Use the same hostname, port and browser profile throughout a walkthrough: localStorage and IndexedDB belong to that origin. The first load of this version clears all prior operational records, drafts, browser document files and demonstration backups once, including manually entered work. Accounts, credentials and account-management history are retained; old project assignments and sessions are cleared. A failed cleanup offers **Retry setup** and blocks workspace use until it finishes. After completion, newly entered records survive refreshes. Administrator can use **Clear workspace** in Administration after confirmation. It removes local projects, transactions, drafts, documents and old workspace backups, while preserving accounts, passwords and account-management history. Project assignments are removed; Google Drive archives are preserved.

## Main workflow

Site Personnel submits an MRF, then the Project Manager reviews it. Procurement checks site stock and quotations and prepares POs for Accounting review and approval, then confirms supplier issuance. Upfront payment verification precedes delivery clearance; credit payment and delivery can progress independently. Logistics dispatches; receiving teams confirm quantities; Site Personnel posts accepted stock and records usage. Legacy records keep their original approval/payment path.

MRF lifecycle details show outstanding actions by department, their blockers and permitted record links. Dashboard and notifications use the same action projection. Site inventory separates **Stock**, **Usage entries** and **Consumption**. The consumption view reconciles opening stock, additions, use, transfers out and adjustments to closing stock for Philippine calendar dates and exports all filtered rows to CSV.

## Storage and integrations

Snapshot version 12 uses `hml-constructsync-demo-v12`; sessions use `hml-constructsync-session-v2`, and the named account directory uses `hml-constructsync-users-v1`. The completed one-time cleanup is recorded in `hml-constructsync-empty-workspace-v1`. Uploaded originals and document caches use IndexedDB. No operational sample data is installed. After initialization, unreadable or older workflow snapshots require explicit recovery. Browser-storage failures show an in-memory warning; usage drafts remain available for safe retry where browser storage permits.

New projects use Google Drive document archives. Copy `.env.example` to `.env.local` and follow [Drive and AI configuration](docs/architecture.md#google-drive-and-ai-configuration). Missing configuration or failed uploads leave archives pending with retry controls; saving a browser cache does not complete a Drive upload. Existing files in Google Drive are preserved by workspace cleanup. Keep secrets out of Git. See [architecture context](docs/architecture.md) for current boundaries and the production target.

## Verification

Use Node 26.12.1 and npm 11.20.0, matching `.nvmrc` and the package metadata. Install the locked dependencies with `npm ci`.

```bash
npm run verify
npm run verify:browser
```

The first command runs lint, route type generation, TypeScript, unit/API tests and a production build. The browser command starts its own production server with real integrations disabled and runs all maintained suites using isolated headless Edge profiles. Windows with Microsoft Edge is required for browser verification. Select individual suites with `npm run verify:browser -- next-iteration usage-entries`. `npm run test:browser` is an alias. Logs and machine-readable results are written under ignored `.verification/`; screenshots stay in temporary browser profiles. Pull-request CI runs the same commands without live credentials.

```bash
npm run test:live
```

Live verification is separate and uses the application's configured Drive and Gemini credentials. It creates a unique test subfolder under the configured Drive root, uses synthetic documents, runs an isolated application rooted at that folder, checks extraction/upload/download integrity, and trashes only its run-owned folder afterward. It incurs AI usage. Check `.verification/live.json` for results and any cleanup failure. See [integration setup](docs/architecture.md#google-drive-and-ai-configuration), [verification profiles](docs/ai-workflow-rules.md#verification-profiles) and [readiness progress](docs/progress-tracker.md).

## Repository layout

See [architecture context](docs/architecture.md) for the current structure and agreed production target.

- `app/`: route adapters and server endpoints; installed Next.js guides govern route conventions.
- `src/features/`: department workflows and screens.
- `src/domain/`: business commands, read permissions, actions, stock and report calculations.
- `src/mock/` and `src/app-state/`: browser persistence, accounts and empty-workspace initialization.
- `src/documents/`: shared browser document storage, hashes and resumable uploads.
- `tests/` and `scripts/`: domain/API tests and browser checks.
- `docs/`: five core context documents plus the production checklist companion; workflows and acceptance criteria are in the [project overview](docs/project-overview.md).
