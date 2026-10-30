# HML ConstructSync

An internal construction operations application undergoing production migration. The foundation uses Supabase sign-in, current access grants and a protected workspace. Unit 3.3 adds Administrator user management; consult the tracker for verification. Projects is the landing page; project editing and operational screens remain temporarily unavailable until their migration units are complete.

See the [project overview](docs/project-overview.md) for the agreed production purpose, workflows, scope and success criteria.

Follow the [AI workflow rules](docs/ai-workflow-rules.md) for development scope, documentation updates and verification expectations.

Use the [code standards](docs/code-standards.md) for implementation conventions and the Tailwind styling target.

Check the [progress tracker](docs/progress-tracker.md) for completed work, migration priorities, open decisions and dated verification results.

Use the companion [production checklist](docs/checklist.md) to follow foundational and future steps and mark them complete after verification.

For checklist step 3, read the [implementation guide](docs/step-3-implementation.md) for the agreed account/project foundation, ordered units, local setup and acceptance criteria. The tracker distinguishes verified behavior from remaining migration work.

## Run locally

Use Node 26.12.1 (the local `.nvmrc` pin) and npm 11.20.0. The deployment baseline is Node 24.22.1; both supported majors accept later stable patch/minor releases within the declared package engine ranges. Installation rejects an unsupported Node or npm version.

```bash
npm ci
npm run dev
```

First copy `.env.example` to private `.env.local` and configure the existing staging URL, publishable key and server-only `SUPABASE_SECRET_KEY`. The project secret is separate from the maintenance PAT. Staging already has its first permanent Administrator; sign in with that account. For a new empty environment only, `npm run auth:staging:bootstrap` prompts privately for explicit identity and a hidden password, refuses another initialization and retains its ignored retry checkpoint. No default account is created. Open `http://127.0.0.1:3000/sign-in` after starting development.

With the Administrator role active, open **Users** to save staff invitations, edit names/roles/project assignments, deactivate/reactivate accounts or resume interrupted provisioning. Users set their own passwords. Email stays fixed after saving. Keep `ACCOUNT_EMAIL_ENABLED=false` until custom SMTP and matching templates are configured and verified: pending staff are saved with **Invitation not sent**. CI enables Mailpit; provider acceptance does not prove delivery. Recovery is available for already confirmed accounts, including interrupted invitation password setup. Sending recovery preserves sessions; a successful reset ends other sessions.

Use `127.0.0.1:3000` consistently. Role switching selects only the signed-in person's grants. Prototype account switching, automatic browser initialization and workspace reset are disconnected from the supported runtime. Existing browser data is neither imported nor automatically cleared. Use `npm run dev` for staging review: standard verification deliberately builds without live credentials, so create a fresh configured build before reviewing staging with `npm run start`.

## Target workflow (later migration)

Site Personnel submits an MRF, then the Project Manager reviews it. Procurement checks site stock and quotations and prepares POs for Accounting review and approval, then confirms supplier issuance. Upfront payment verification precedes delivery clearance; credit payment and delivery can progress independently. Logistics dispatches; receiving teams confirm quantities; Site Personnel posts accepted stock and records usage. Legacy records keep their original approval/payment path.

MRF lifecycle details show outstanding actions by department, their blockers and permitted record links. Dashboard and notifications use the same action projection. Site inventory separates **Stock**, **Usage entries** and **Consumption**. The consumption view reconciles opening stock, additions, use, transfers out and adjustments to closing stock for Philippine calendar dates and exports all filtered rows to CSV.

## Storage and integrations

Supabase owns identity, profiles, grants and application session bindings. Shared project/scope screens and realtime follow in later foundation units. Prototype rules and isolated test fixtures remain while operational records move with their server workflows; their browser snapshots do not establish authority in the supported runtime.

Document generation, Drive and AI endpoints are disabled before provider work until step 5. CI captures invitation/recovery messages in Mailpit; hosted synthetic checks generate restricted links without sending email. Free projects using Supabase's default provider cannot modify email templates. Real delivery requires the verified custom SMTP setup. Keep secrets out of Git; see [architecture context](docs/architecture.md) for boundaries and remaining release requirements.

## Verification

Keep Node 26 locally and use the npm version declared in `packageManager`. Install the locked dependencies with `npm ci`; `npm run check:toolchain` checks the active versions without installing dependencies. Node type definitions follow version 24 so application type checking reflects the production runtime.

```bash
npm run verify
npm run verify:browser
```

The first command checks the toolchain, then runs lint, route types, TypeScript, maintained unit/isolated-handler tests and a production build. The browser command runs `foundation-public` against an isolated server using Windows Edge or Linux Chrome, with external requests blocked. `npm run test:browser` is an alias. Logs and results live under ignored `.verification/`. The tracker names deferred prototype suites and their restoration milestones; they are not foundation passes.

GitHub Actions retains clean installation, the high-severity audit and standard checks on Linux/Windows with Node 24/26. Both Windows jobs run the public browser suite. Separate Ubuntu database CI replays migrations, tests security/concurrency and real-account browser/email flows, compares generated types, and destroys only its own stack with its immutable audits. Hosted SQL checks roll back their account fixtures; `npm run auth:staging:check` uses Auth-only identities, sends no mail and verifies retained profiles, revisions and audits stay unchanged. Successful audited account/UI workflows run in disposable CI. Local Docker is not required. CI also verifies the active accounts branch; consult the tracker for actual hosted results.

Vercel remains a Node 24 deployment target. The repository's `vercel.json` invokes an installation bootstrap that rejects other Node majors before installing the declared npm version and running `npm ci`. Its `build:deployment` command checks Node 24 and npm again before building; it intentionally fails on local Node 26. Select Node 24 in Vercel project settings and check the build logs during the later protected deployment rehearsal. Package engine ranges admit local Node 26, so a hosting default must not silently change the intended production runtime. This configuration does not deploy the app or establish production readiness.

Development, verification and deployment builds use Next.js's `--webpack` option. It also supports Next.js's WebAssembly compiler fallback when Windows Application Control blocks the native compiler; Turbopack requires native bindings.

Guarded `db:staging:preview`, `db:staging:check` and `auth:staging:check` commands target the existing staging project. Migration application requires CI evidence for the exact migrations. Auth parity creates and removes only its own synthetic identity and sends no email. Live provider verification is deferred to step 5; its retained tooling is outside the supported foundation checks. See [verification profiles](docs/ai-workflow-rules.md#verification-profiles).

## Repository layout

See [architecture context](docs/architecture.md) for the current structure and agreed production target.

- `app/`: route adapters and server endpoints; installed Next.js guides govern route conventions.
- `src/features/`: department workflows and screens.
- `src/domain/`: business commands, read permissions, actions, stock and report calculations.
- `src/server/`: authorized Auth/database operations and provider modules; `src/mock/` and legacy `src/app-state/` retain prototype coverage outside the supported data/authentication path.
- `src/documents/`: shared browser document storage, hashes and resumable uploads.
- `tests/` and `scripts/`: domain/API tests and browser checks.
- `docs/`: five core context documents, the production checklist and the step 3 implementation companion; product workflows and release acceptance criteria are in the [project overview](docs/project-overview.md).
