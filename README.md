# HML ConstructSync

An internal construction operations application undergoing production migration. The foundation uses Supabase sign-in, current access grants, Administrator user management and shared project and scope setup. Dashboard is the landing page. See the tracker for verified workflows.

See the [project overview](docs/project-overview.md) for the agreed production purpose, workflows, scope and success criteria.

Follow the [AI workflow rules](docs/ai-workflow-rules.md) for development scope, documentation updates and verification expectations.

Use the [code standards](docs/code-standards.md) for implementation conventions and the Tailwind styling target.

Check the [progress tracker](docs/progress-tracker.md) for completed work, migration priorities, open decisions and dated verification results.

Use the companion [production checklist](docs/checklist.md) to follow foundational and future steps and mark them complete after verification.

Foundation and operational units through 4.11 are verified complete, including payment coordination, proof-backed settlement and delivery clearance. Unit 4.12 purchased delivery dispatch is next for scoped planning; staff dispatch/receiving/stock workflows and production release remain pending. See the [tracker](docs/progress-tracker.md#current-goal) for authorization, blockers and final evidence, and the [step 4 guide](docs/step-4-implementation.md#ordered-roadmap) for dependencies. The separate Vercel Node-version deployment blocker remains unresolved.

## Run locally

Use Node 26.12.1 (the local `.nvmrc` pin) and npm 11.20.0. The deployment baseline is Node 24.22.1; both supported majors accept later stable patch/minor releases within the declared package engine ranges. Installation rejects an unsupported Node or npm version.

```bash
npm ci
npm run dev
```

First copy `.env.example` to private `.env.local` and configure the existing staging URL, publishable key and server-only `SUPABASE_SECRET_KEY`. The project secret is separate from the maintenance PAT. Staging already has its first permanent Administrator; sign in with that account. For a new empty environment only, `npm run auth:staging:bootstrap` prompts privately for explicit identity and a hidden password, refuses another initialization and retains its ignored retry checkpoint. No default account is created. Open `http://127.0.0.1:3000/sign-in` after starting development.

With the Administrator role active, open **Users** to save staff invitations, edit names/roles/project assignments, deactivate/reactivate accounts or resume interrupted provisioning. Users set their own passwords. Email stays fixed after saving. Keep `ACCOUNT_EMAIL_ENABLED=false` until custom SMTP and matching templates are configured and verified: pending staff are saved with **Invitation not sent**. CI enables Mailpit; provider acceptance does not prove delivery. Recovery is available for already confirmed accounts, including interrupted invitation password setup. Sending recovery preserves sessions; a successful reset ends other sessions.

Use `127.0.0.1:3000` consistently. Role switching selects only the signed-in person's grants. Prototype account switching, automatic browser initialization and workspace reset are disconnected from the supported runtime. Existing browser data is neither imported nor automatically cleared. Use `npm run dev` for staging review: standard verification deliberately builds without live credentials, so create a fresh configured build before reviewing staging with `npm run start`.

Use **Projects** for project/scopes and **Material requests**, supplier quotations, PO, Accounting and Finance views for migrated operations. Current access, deletion, budget and realtime rules are in [architecture](docs/architecture.md); the [overview](docs/project-overview.md#core-user-flow) describes the complete intended workflow.

## Target workflow (later migration)

See the [core user flow](docs/project-overview.md#core-user-flow) and [monitoring requirements](docs/project-overview.md#monitoring-and-documents). Dispatch, receiving, inventory usage and operational monitoring still require their owning units; verified earlier purchasing/payment milestones do not establish those capabilities.

## Storage and integrations

Supabase owns authoritative business records, access and session bindings; Google Drive owns permanent documents. Browser snapshots and prototype fixtures grant no authority. See [storage boundaries](docs/architecture.md#storage-model).

Required protected upload/archive and project-folder operations accompany their verified step 4 workflows. Unmigrated provider routes remain disabled; optional AI and broader document features remain step 5. CI capture and restricted hosted links do not verify real email delivery.

## Verification

Keep Node 26 locally and use the npm version declared in `packageManager`. Install the locked dependencies with `npm ci`; `npm run check:toolchain` checks the active versions without installing dependencies. Node type definitions follow version 24 so application type checking reflects the production runtime.

```bash
npm run verify
npm run verify:browser
```

The first command checks the toolchain, then runs lint, route types, TypeScript, maintained unit/isolated-handler tests and a production build. The browser command runs `foundation-public` against an isolated server using Windows Edge or Linux Chrome, with external requests blocked. `npm run test:browser` is an alias. `npm run verify:foundation -- local` validates the current revision's standard/public-browser reports; `standard` and `database` produce scoped CI reports. `milestone` also requires imported four-job/disposable reports, staging parity and user-confirmed targeted manual review. Logs and results live under ignored `.verification/`. The tracker names deferred prototype suites and their restoration milestones; they are not foundation passes.

GitHub Actions retains clean installation, the high-severity audit and standard checks on Linux/Windows with Node 24/26. Both Windows jobs run the public browser suite. Separate Ubuntu database CI replays migrations, tests security/concurrency and real-account browser/email flows, compares generated types, and destroys only its own stack with its immutable audits. Hosted SQL checks roll back synthetic account/project commands; `npm run auth:staging:check` uses Auth-only identities and sends no mail. Deterministic retained-record hashes, counts and profile revisions protect staging data. Successful audited UI workflows run in disposable CI. Local Docker is not required. CI also verifies the acceptance branch; consult the tracker for actual hosted results.

Vercel remains a Node 24 deployment target. The repository's `vercel.json` invokes an installation bootstrap that rejects other Node majors before installing the declared npm version and running `npm ci`. Its `build:deployment` command checks Node 24 and npm again before building; it intentionally fails on local Node 26. Select Node 24 in Vercel project settings and check the build logs during the later protected deployment rehearsal. Package engine ranges admit local Node 26, so a hosting default must not silently change the intended production runtime. This configuration does not deploy the app or establish production readiness.

Development, verification and deployment builds use Next.js's `--webpack` option. It also supports Next.js's WebAssembly compiler fallback when Windows Application Control blocks the native compiler; Turbopack requires native bindings.

Guarded `db:staging:preview`, `db:staging:check` and `auth:staging:check` commands target the existing staging project. `npm run db:staging:acceptance` combines migration/Auth/type parity, rollback checks, owned Auth-only checks and channel rejection probes, preserving retained state without sending email. Its read-only type comparison writes only to `.verification/`. Migration application requires CI evidence for the exact migrations. Live provider verification belongs to explicitly scoped integration work: required document capabilities accompany their step 4 workflows, and optional AI/broader document features remain in step 5. Retained provider tooling is outside the supported foundation checks. See [verification profiles](docs/ai-workflow-rules.md#verification-profiles).

## Repository layout

See [architecture context](docs/architecture.md) for the current structure and agreed production target.

- `app/`: route adapters and server endpoints; installed Next.js guides govern route conventions.
- `src/features/`: department workflows and screens.
- `src/domain/`: business commands, read permissions, actions, stock and report calculations.
- `src/server/`: authorized Auth/database operations and provider modules; `src/mock/` and legacy `src/app-state/` retain prototype coverage outside the supported data/authentication path.
- `src/documents/`: shared browser document storage, hashes and resumable uploads.
- `tests/` and `scripts/`: domain/API tests and browser checks.
- `docs/`: five core context documents, the production checklist and the active step 4 guide; product workflows and release acceptance criteria are in the [project overview](docs/project-overview.md).
