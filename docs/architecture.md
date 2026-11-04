# Architecture Context

This document describes the agreed **target architecture** for HML ConstructSync, an internal construction operations system for HML Technologies and Services Inc. It is a guide for the production migration, not a claim that the migration is complete. HML will start with fresh operational records; importing the prototype's browser data is not part of this plan.

The committed prototype remains recoverable in Git. The migration branch implements Supabase sessions, a small protected shell, Administrator account management, shared projects/scopes, protected realtime, MRF drafts and required supporting files; consult the tracker for completed 4.2/4.3 acceptance and the next unit. Request register/detail/editor and protected MRF document routes use authoritative records. Checked MRF submission/review/correction and approved-document retrieval are implemented in 4.3, with automated/staging verification, explicit human acceptance and combined acceptance complete on 2026-11-04. Unmigrated provider endpoints and later operational workflows remain disabled. Prototype rules and isolated fixtures remain for regression coverage, but demonstration accounts, identity switching and reset/initialization are disconnected from the supported runtime. Production readiness requires the remaining milestones.

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Application | Next.js App Router and TypeScript | Pages, route handlers, server-side application logic and typed domain rules. React is the UI library used by Next.js, not a separate application framework. |
| UI | Tailwind CSS v4 | Target styling system for the existing screens and responsive layouts. Tailwind is installed today, but the current interface uses custom CSS; conversion is separate work. |
| Runtime and hosting | Node.js 24.x on Vercel; Node.js 26 locally | Keep local development on Node 26.12.1 and npm 11.20.0. The production baseline is Node 24.22.1 with the same npm version; CI is configured to verify both runtimes on Linux and Windows. Node type definitions follow the production major. Vercel installation and build checks require Node 24 rather than silently selecting another accepted development runtime. See [Vercel's supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). |
| Authentication | Supabase Auth | Individual, invitation-only email/password accounts, sessions, password recovery and revocation. |
| Business data | Supabase Postgres | Shared authoritative records, access grants, audit history, document metadata and job state. |
| Live updates | Supabase Realtime Broadcast | Private change notifications that refresh permitted views; introduced with each shared record/workflow. |
| Document files | Google Drive | Permanent originals, generated documents and related evidence, organized in company-controlled project folders. |
| Background work | Vercel Workflows | Durable, retryable processing for integrations and document work that may outlast an ordinary request. |
| Authentication email | Resend via Supabase custom SMTP | Production invitation and recovery email from a verified sender domain; step 3 uses CI Mailpit capture and restricted synthetic-account link generation for hosted manual checks. |
| Document extraction | Gemini | Assist with MRF and quotation extraction; a person reviews the result before it affects official records. |
| Document generation | Existing PDF and Excel libraries | Generate and render the application's PDFs and spreadsheets. |

Hosted testing may use a Vercel Hobby project only when its use meets Vercel's eligibility terms. Company operations require an appropriate commercial Vercel plan. The intended business deployment remains on Vercel behind an HML-owned custom domain; a domain is an address, not a separate hosting platform.

Development and production builds explicitly use Next.js's supported Webpack option. Windows Application Control blocked the updated native SWC compiler during local verification; Next.js's WebAssembly fallback supports Webpack but cannot run Turbopack. Keep the local, CI and deployment build commands consistent without changing the operating-system policy. This bundler choice does not change the application framework or data boundaries.

## System Boundaries

The current repository is a single Next.js application. Its folders group responsibilities; they are not separate applications or independent services.

```text
app/                   Next.js pages, layouts and API route handlers
src/
  app-state/           Client providers, sessions and browser workspace state
  components/          Shared UI components and application shell
  documents/           Browser document caches and upload helpers
  domain/              Business rules, commands, permissions and calculations
  features/            Department screens and workflows
  mock/                Prototype browser repository and workspace initialization
  server/              Authorized Auth/database operations and provider integrations
  styles/              Current custom CSS
public/                Public assets such as company branding
tests/                 Automated tests, helpers and isolated fixtures
scripts/               Verification, browser checks and document tooling
.github/workflows/     GitHub Actions continuous integration
docs/                  Five core documents, checklist and active milestone guide
```

| Current area | Responsibility during migration |
| --- | --- |
| `app/` | Keep Next.js routing and thin request handlers. Authenticate and authorize every server operation before accessing records or providers. |
| `src/features/` and `src/components/` | Keep the existing user workflows and shared UI; migrate styling to Tailwind without changing business behavior unnecessarily. |
| `src/domain/` | Keep reusable business rules and calculations. Enforce authoritative validations and state transitions on the server as well as in the interface. |
| `src/app-state/` | Refactor into client session, interaction and view state. It must not be the authority for shared records or permissions. |
| `src/documents/` and `src/server/` | Keep and adapt useful document, upload, generation and provider code behind authenticated server boundaries. |
| `src/mock/` and demo account fixtures | Retire production browser-repository, identity-switching, automatic cleanup and reset paths. Keep synthetic data isolated to tests. |
| `src/styles/` | Migrate the current custom styles to Tailwind as part of the separate UI conversion. |
| `tests/`, `scripts/` and `.github/workflows/` | Keep verification and CI, updating them as the production implementation replaces prototype behavior. |

Versioned changes live in `supabase/migrations/`, with generated database types under `src/server/database/`. Hosted application/verification state is recorded in the tracker. `src/server/workflows/` contains document background work using pinned Workflow SDK 5.3.0; it is separate from `.github/workflows/`, which runs repository checks. The SDK generates its internal handlers and requires their exclusion from the Auth proxy; application/provider routes retain their own authorization. Local execution uses its Local World, while Vercel deployment uses the managed World and its deployment identity. Hosted deployment verification remains release work.

The intended request flow is: an authenticated user acts in a Next.js screen; a server handler verifies the session and current grants; server-side business logic reads and updates Postgres; and a durable workflow handles external operations when needed. A Drive upload or Gemini extraction may report pending, failed or completed status back to the application. Client-supplied roles, record contents and provider results are not authority for business decisions.

Workflow jobs retain the initiating audit identity and are bound to the intended record, source version and permitted acknowledgements. Current authorization and business conditions still need server-side checks at the relevant steps; a captured identity is not unrestricted authority after an account or access change. Manual retries record the retrying actor without rewriting earlier responsibility.

### Account and Project Foundation

The account/project foundation is implemented and verified: individual identities, current role/project permissions, shared projects/scopes, protected foundation audits and realtime updates. Completion evidence is recorded in the [tracker](progress-tracker.md#session-notes).

Keep operational records and their authoritative reads/writes together during step 4. Unmigrated screens and server handlers remain explicitly unavailable on the migration branch. The supported shell uses projects as its initial landing screen and operates without a global demo workspace. Operational counters, commitments/spending, stock and workflow panels stay unavailable until their sources migrate; absence of migrated data is not a zero balance.

Project setup retains names, locations, document codes, PHP budgets and scope allocations. Enforce allocation caps atomically even before purchasing exists. Site Personnel receive permitted project/scope information without financial values through any exposed interface. Existing purchasing/tax policy questions remain unresolved by this foundation.

Project/scope commands keep metadata, financial rows, immutable audit events and durable retry outcomes in one transaction. Exact decimal-string money and string versions cross RPC/view boundaries; the new runtime does not convert financial values to JavaScript numbers. Project-first locking and opaque versions protect allocation edits and reductions, including stronger isolation levels. Unchanged saves skip record/audit writes. A previously completed request cannot recreate a deleted record. Required setup includes name/location/code and an explicit nonnegative PHP budget; scope creation/renaming uses the ten existing standard names, with pre-existing labels retained on unchanged-name edits.

Unused setup may be deleted with history retained. Project Managers cannot clear Administrator-managed assignments through deletion. Administrators may confirm deletion plus clearing the exact reviewed assignment set; changed assignments require another review. Clear only the deleted project's assignments, preserve identities/other assignments and invalidate affected application bindings. Pending provisioning references and document-use locks block deletion. Deletion acquires the account guard before project locks to serialize against account reservation/assignment commands. Operational migrations must add reference restrictions before enabling their writes. All non-Site roles can read project change history; Site Personnel receive no financial/history payloads.

Required protected upload/archive capabilities move forward with the step 4 workflows that need them, including necessary project Drive folder creation/validation and retryable processing. Broader folder browsing, optional AI and other document capabilities remain in step 5. Provider operations stay disabled until their protected replacement is verified; no workflow may fabricate archive completion or bypass its document gate. MRF/PO self-approval enforcement and transactional document numbering are verified with the relevant workflows in step 4. Preserve the committed prototype in Git rather than treating old browser records or simulated identities as production authority.

### Operational Migration Contracts

The [active step 4 guide](step-4-implementation.md) owns the agreed roadmap and unit completion criteria. The plan is recorded before implementation; request screens remain unavailable until their corresponding unit is verified. Required document handling is part of the workflow it enables rather than an exception to archive integrity.

MRF drafts are project-shared and writable only by currently assigned Site Personnel. They may omit submission-required fields, materials, documents or a funded scope. Partial material rows preserve absent quantities as null; supplied quantities are positive exact decimal strings. A supplied scope must belong to the project. First successful save allocates the permanent project/series number through a transactional counter row and locks the project code and MRF project ownership. Number allocation, record/items, verified actor attribution, immutable audit and durable retry outcome commit atomically; failed transactions and retries do not consume another committed number. Referenced projects/scopes cannot be deleted, and operational records are not cascade-deleted. Printed signatories, creator and latest editor are distinct from the permanent submitter identity used for later self-approval prevention. These contracts pass local, disposable CI and staging parity checks at implementation `43f7f80`; the user confirmed all three targeted manual checks and source-bound combined acceptance passes. Explicit saves preserve unsaved input in the open editor only, and newer versions require review before replacing a whole draft. The request views reuse the private session-bound invalidation transport.

Purchases, suitability holds and transfer allocations share one authoritative demand limit. Transfers and usage share stock availability/reservation rules. Establish those consistency contracts before enabling competing writes; preserve the existing independent payment, delivery, receiving and stock-posting milestones. Unconfirmed company financial policy gates dependent calculations and approvals rather than being inferred from prototype formulas.

Module organization follows Option A in [code standards](code-standards.md#file-organization): group business areas within the existing layers and replace broad snapshot/command dependencies as each area migrates. Styling remains a separate track.

Unit 4.3 adds checked lifecycle transitions. Save and submit validates and commits the form plus submission atomically against header and attachment versions; unfinished uploads must finish or be cancelled. Each immutable submission freezes the form, project labels and supporting identity. Every historical submitter's permanent identity blocks approval after role changes; creator/editor/printed names grant no approval authority. PM return/rejection remains allowed, with reasons. Returned saves retain Returned; submitted/approved files and forms lock except through the permitted correction phase. Existing dirty editors retain input but cannot overwrite a submitted version.

Approval records the decision, approved snapshot and durable archive intent in one transaction. Approved is distinct from archive complete; only the latest verified approved pair with no open correction establishes procurement readiness. Protected opaque archive-file IDs reuse the authorized streaming/Range route. Procurement alone reopens an archived approval; downstream references force document-only correction, preserving form/scope and historical archives. Future quotation/PO/transfer writers must call the private downstream registration guard in the same transaction under the MRF lock. Current funded-scope checks use authoritative allocations; later commitment/spend writers must extend eligibility before enabling their financial workflows. No remaining-balance value is fabricated in 4.3. Verification and staging availability remain in the tracker.

### Supplier Directory Contract

Unit 4.4 adds company-wide supplier profiles behind service-only checked RPCs. Procurement alone writes; non-Site roles read; Site is denied through every exposed interface. Private supplier rows/receipts use RLS with no direct client grants. Current session bindings and role grants are verified server-side; commands acquire the foundation guard before actor/record locks and publish minimal invalidations only to current eligible non-Site sessions. Name uniqueness includes inactive records and collapses whitespace/case. Exact string versions, stable retry keys, transactional immutable audits and no-op saves follow existing conventions. Private realtime refetches preserve dirty forms and require renewed conflict review. Supplier history exposes the latest 30 events, with full audits retained. Inactive suppliers remain editable; status changes require reasons and no deletion is exposed. Later quotation/PO writers enforce active selection without mutating historical snapshots. Implementation and acceptance status remain in the tracker.

## Storage Model

- **Postgres:** The source of truth for users' application profiles, role and project assignments, projects, MRFs, quotations, purchase orders, budgets, payments, deliveries, stock, document references, audit events and workflow/job status. Related changes such as stock, budgets and document numbering need database transactions, concurrency control and safe retries.
- **Google Drive:** The permanent file store for originals, generated PDFs/spreadsheets and supporting evidence. Postgres stores the record relationship, Drive file identifier, version and archive status; a browser cache or an attempted upload does not count as a completed archive. Supabase Storage is not part of the intended permanent file architecture.
- **Browser storage:** May hold UI preferences and unsent drafts for convenience. Official business actions require an online connection and server confirmation; browser data is not the shared system of record. Apply access and privacy controls to any locally retained draft or file cache.
- **Workflow state:** Persist small identifiers, status and retry information. Keep document bytes and provider secrets inside server-side steps rather than workflow payloads or results. Use bounded uploads, targeting roughly 3 MiB chunks where appropriate, and verify the actual request encoding against [Vercel's function limits](https://vercel.com/docs/functions/limitations).

### MRF Document Lifecycle

Unit 4.2 implements this contract; its verification and staging state are recorded in the tracker. A saved numbered MRF has an independent attachment revision and at most one current validated supporting PDF. Upload progress cannot change the header/material version. Replacement retains the current file until exact provider identity, size/hash and PDF readability checks pass and the expected attachment revision commits atomically. All actions and protected reads verify the current session, grants and project access. Drive session URLs are encrypted in private server state; clients receive upload/document UUIDs and confirmed offsets. Raw uploads are bounded to 3 MiB chunks; retrieval streams authorized files with private/no-store headers and checked byte ranges. Reload requires matching local-file reselection; no document bytes persist in browser storage.

New project commands atomically enqueue folder intent. Existing projects require explicit setup by Administrator/PM. Folder mappings retain history and exclusive project ownership, and must be writable descendants of the configured root, excluding the root itself. Mapping changes affect future operations; admitted uploads/jobs retain their recorded destinations. An empty folder does not block deletion of otherwise unused project setup; its ownership/history remain retained. Operational MRF references still restrict deletion.

Private Postgres jobs and receipts precede Workflow dispatch. Reopened/polling views reconcile uncertain dispatch; expiring database claims serialize duplicate runs. Stable preallocated Drive IDs and exact verification recover lost provider/DB acknowledgements. Every processing acknowledgement rechecks required current authority; a revoked role/assignment/access revision pauses the job. Ordinary logout does not cancel admitted work. Original identity/name and explicit retry attribution are distinct. Assigned Site handles draft files/cleanup; Admin/PM handles folders. An explicit PM archive retry may adopt the corrected current mapping while retaining the prior attempt's destination and provider identities; draft validation instead retains its upload destination and requires a new upload to relocate. Provider calls remain outside transactions and document bytes stay outside workflow state.

Immutable archive snapshots bind request/header and attachment revisions, the exact supporting version/hash, frozen project/form fields and verified approval identity/name/time. The engine generates and verifies the company form and supporting pair before one database acknowledgement. No public approval/snapshot trigger exists in 4.2; 4.3 supplies that checked transaction. Approved versions and their source remain retained. Cleanup only trashes owned obsolete unapproved bytes after reference checks; metadata history persists and failures remain retryable without invalidating the current file.

### Development Environments

Local development and foundation review use a Next.js app connected to hosted staging. Local Docker is optional and is not required by the supported development workflow. GitHub Actions uses a disposable Docker-backed Supabase stack for clean migration/security checks, including Mailpit/account-flow coverage. Automated tests use explicitly validated loopback endpoints and never reset or depend on staging. See [Supabase's email testing](https://supabase.com/docs/guides/auth/testing-auth-flows).

The user has provisioned both projects in organization `szmmzavejsnmqgvnyqbn`: **ConstructSync Staging** (`gxphubtycnvhpgstruqb`) and **ConstructSync Production** (`caiasmpfhueuouxqhalo`). Both were verified healthy in `eu-west-1` on the Free plan on 2026-10-30. Retain those projects and regions. Development, migration tooling and scoped synthetic checks target staging explicitly; production configuration and promotion belong to step 7. Prefer available free resources; any required purchase or upgrade needs a concrete cost decision. Keep a hosted application preview for the later protected rehearsal.

Versioned SQL migrations are the schema authority. Review and verify them against the disposable CI stack before applying to staging. Development commands preview/apply migrations and generate types remotely without requiring Docker-based schema pulls/diffs. Type generation uses one pinned Supabase generator for both the hosted read-only catalog transport and CI's disposable database; hosted CLI generation otherwise uses a different generator version. Keep staging data between sessions; synthetic cleanup is restricted to the run's own resources. Hosted manual account testing uses restricted developer tooling to generate invitation/recovery links for synthetic identities; tokens stay outside source control and ordinary application responses/logs. Those checks verify token handling rather than email delivery.

Real email delivery remains unverified until a suitable sender domain is available, verified and configured with Resend/custom SMTP. A sending domain is independent of the application's local development address. Real invitation/recovery delivery and company-owned production services are release requirements; local capture and developer-owned services do not satisfy them. See [Resend's SMTP prerequisites](https://resend.com/docs/send-with-supabase-smtp).

For hosted testing, the existing Google Drive integration may use OAuth with an authorized My Drive account. Configure the OAuth application out of External Testing where Google permits; Drive-scoped refresh tokens in External Testing expire after seven days. Credentials can still be revoked, so failures must be visible and reconnection supported. See [Google's OAuth token expiration guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

Before HML relies on the system for company operations, provision a company-owned Shared Drive and grant a dedicated service account the required access. Company documents must not depend on an individual employee's My Drive account. Establish and test database backups, Drive recovery and responsibility for restoring both the records and their referenced files.

### Google Drive and AI Configuration

For local integration testing, copy the repository's [environment template](../.env.example) to server-local `.env.local`. Use a test Drive root where the configured account can create and read files. Configure only on the server:

| Setting | Purpose |
| --- | --- |
| `GOOGLE_DRIVE_ENABLED` | Set `true` to enable deployed integration; `false` also disables local integration. Keep live-enabled testing protected while production authorization remains pending. |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Root folder accessible to the configured integration account. |
| `GOOGLE_DRIVE_UPLOAD_TOKEN_KEY` | Base64-encoded 32-byte secret for encrypted resumable-upload tickets. |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | Service-account credentials for the intended Shared Drive configuration. |
| `GOOGLE_DRIVE_OAUTH_CLIENT_ID`, `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET`, `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN` | Alternative OAuth configuration for authorized My Drive testing. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Server-side extraction credentials and model configuration. |
| `WORKFLOW_LOCAL_BASE_URL` | Local callback origin matching the running Next app (normally `http://127.0.0.1:3000`); deployed Vercel execution uses its managed World/deployment identity. |

Use the Drive credential mode appropriate to the environment rather than configuring conflicting identities. Keep credential contents and `.env.local` out of Git and documentation. Restart the local server after changing environment values. These are the current integration settings, not a complete future production environment specification.

Validate the project's mapped folder and resolve pending/failed archives through the application's status and retry controls. Authentication failures require credential renewal or reconnection; inaccessible folders require correcting permissions or mapping. Preserve existing files while resolving failures. A previous successful live check does not establish future credential validity or production access control.

For repeatable verification and ownership-checked test cleanup, follow [AI workflow rules](ai-workflow-rules.md#before-moving-to-the-next-unit). Backup/restore targets and operational ownership remain [open decisions](progress-tracker.md#open-questions).

On the Free plan, hosted projects using Supabase's default email provider cannot modify invitation/recovery templates (verified by the staging API in 3.2). The guarded staging Auth command applies security/URL settings only. CI uses the committed templates with Mailpit; hosted checks generate restricted synthetic links without sending mail. Configure the verified custom SMTP provider and matching templates before real email delivery is enabled.

## Auth and Access Model

Unit 3.2 implements this model on the migration branch; verified local/CI/staging evidence is recorded in the tracker. The supported shell uses a small session projection and protected unavailable pages until later units migrate their records. Server-owned HttpOnly Auth cookies hold the session; browser role cookies are validated preferences. Proxy refreshes tokens, while server operations and database policies independently check current session bindings and grants. Private binding/provisioning implementations have service-only invoker RPC wrappers; the authenticated session-projection RPC returns only the caller's current context. Opening an invitation/recovery page does not consume its link or grant workspace access: password submission verifies the one-time proof in a temporary unbound session, then returns to password sign-in.

- Each staff member has an individual Supabase Auth identity and signs in with email and password. Administrators invite and manage accounts; public self-registration is disabled. Recovery and account removal or deactivation require controlled procedures.
- Account administration must retain at least one active Administrator who has completed an application sign-in. Pending invitations and password setup alone do not qualify. Prevent self-deactivation and removal of one's own Administrator grant; another Administrator must perform those operations. Serialize account decisions through a private guard-row update, including at stronger isolation levels.
- HML is the single company in this design. Administrators grant application roles and, where required, project access. A person may hold multiple non-Site Personnel roles and switch the active role only among their own grants. Site Personnel is exclusive and cannot be combined with another role.
- Site Personnel can have zero or many unique existing project assignments. Leaving that role clears assignments atomically after confirmation. Account email is fixed after invitation saving; deactivate an incorrect recipient and create the correct invitation. Reactivation retains grants/assignments and precedes new invite/recovery dispatch.
- Remember a multi-role user's last still-permitted role per browser; otherwise show a role chooser. A single-role user enters directly. The preference grants no authority, and role switching keeps the same permanent identity.
- Site Personnel access is limited to assigned projects and permitted operations. Other roles receive the record and operation access explicitly assigned to their responsibilities; a visible screen or role name alone never grants authority.
- Server operations verify the signed-in user's permanent identity and current database grants for the requested record and action. Use row-level security for exposed tables, explicit grants where the Data API is used, and appropriately scoped server authorization. Never rely on editable user metadata or stale client-provided role claims. Keep service-role credentials on the server only. See [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Administrator changes to roles or project assignments require fresh sign-in for affected application sessions; deactivation rejects access immediately. The application design binds a verified Supabase session ID to an application-owned access revision after fresh authentication. Change grants and invalidate old bindings atomically, enforce the binding in server/database authorization, and keep binding creation privileged. JWT refresh never renews invalidated access. Verify the current Auth session as well as its application binding; JWT validity alone is insufficient. See [Supabase sessions](https://supabase.com/docs/guides/auth/sessions).
- Provision the first Administrator through a controlled server-side procedure with explicit inputs and no default credentials. Deactivate/reactivate accounts while retaining permanent identities and audit history. Invitation/recovery partial failures must remain visible and recoverable without duplicate identities or premature access grants.
- Account provisioning reserves a stable request and permanent Auth UUID before external work. Trusted application metadata proves identity ownership; matching email alone never does. Incomplete requests appear in the Administrator directory and can be resumed by a current Administrator. Commit profiles/grants/audits atomically after Auth creation. Keep external calls outside SQL transactions and retain private message attempts with accepted, failed or uncertain status. Retried attempts never redispatch; intentional resends use a new attempt. Hosted email defaults to disabled through `ACCOUNT_EMAIL_ENABLED=false`; saving pending staff remains supported.
- Capture the application revision and an opaque server-only credential fingerprint before the password challenge. Session binding locks the Auth user FOR SHARE before the profile and compares both proofs. A mismatch requires a new password sign-in; never repair the already-issued session. Native successful password reset deletes other managed Auth sessions and cascades their bindings, including if later app bookkeeping fails. Merely sending recovery preserves sessions. A consumed invitation with failed password saving requires recovery because Auth has already confirmed the email.
- A user cannot approve their own submitted MRF or their own prepared purchase order, even after switching roles or reassignment. Enforce this using the permanent user ID on the server.
- Audit events capture the permanent actor identity, the active role used for the action, the affected record and the action time. Role switches or later account changes must not rewrite past attribution.

Disabled provider endpoints preserve their JSON error contracts: invalid application sessions receive `401`, while authenticated unavailable operations receive `503`. They perform no request-body or provider work before returning.

## Realtime Updates

Unit 3.5 is verified at code checkpoint `e2ab489`, with the matching migration applied to staging. The user disabled public access and reported that the supplied manual checklist passed overall on 2026-11-02. Read-only WebSocket probes independently confirmed explicit `PrivateOnly` rejection of public channels and rejection of anonymous private access. The earlier configuration blocker is resolved; whole-foundation acceptance is verified in 3.6. This completes the account/project foundation, while operational migration and release readiness remain later work. The maintenance token still lacks Realtime configuration permissions, so its management-API check is not the evidence for this setting.

Unit 3.5 implements the foundation transport on `feat/step-3-realtime`; verification and hosted rollout are tracked separately. Private topics identify the user, access revision and exact Auth session. The uncached credential endpoint returns only the verified user's existing access token in memory; refresh credentials remain HttpOnly and renewal stays server-side. The browser uses a token callback so Realtime heartbeat/rejoin cannot replace that credential with an empty browser Auth store.

Guarded adapters preserve the existing account/project commands, audits and retry outcomes. They acquire the shared foundation guard before actor/record locks, then lock candidate Auth sessions in stable order before final recipient selection and publication. This orders supported access changes and native session deletion with record notifications. A pre-revocation signal may arrive late; fresh authorization still governs every read. Account signals target Administrators/the affected user, with assignment-count changes also refreshing Project Managers. Project signals follow current project access.

Supported views are the Projects directory, project detail and Administrator directory. Their uncached view endpoint reuses the authorized query modules, including Site financial-field omission and explicit deleted-target results. Events, focus, reconnect and visible-tab checks every 30 seconds refresh saved data without replacing editor input. Newer relevant versions require explicit review; deletion leaves an unsavable draft view. Confirmed access loss clears the entire protected subtree; temporary failures retain drafts and show retry status. Other protected pages receive session checks without operational data subscriptions.

Use private Supabase Broadcast notifications to refresh permitted views after committed changes. Supabase recommends Broadcast for database-driven updates; see [subscribing to database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes). Step 3 covers accounts, access and projects/scopes; operational updates follow their step 4 migration.

Keep business records authoritative in Postgres. Broadcast minimal invalidation signals, then fetch current role-safe data through authorized server modules. Browser clients cannot publish authoritative record changes. Fresh reads must remain isolated between users and omit Site Personnel financial data.

Private-channel authorization is cached during a connection, so a grant edit alone cannot be treated as an immediate socket revocation. Use current authorized recipients and user/access-revision topics. Require the current session binding to subscribe to the matching topic; send no later record notifications to obsolete revisions. An access-change signal may tell the old session to clear protected state and sign in again, while server/database rejection takes effect independently. See [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

Refetch after subscription establishment/reconnect and when returning to the app to recover missed changes. Show stale/reconnecting status with a manual retry path. Preserve ordinary unsaved input during refreshes; edits carry a record version and a stale save requires review/reapplication. Access invalidation instead clears protected client state. Realtime availability never replaces online server confirmation for official writes.

## Invariants

1. Shared business records and permissions are authoritative on the server and in Postgres, not in browser storage, simulated accounts or client-selected roles.
2. Every official action checks the current authenticated user, current grants and record-specific access on the server. Role changes and account deactivation must take effect through current server-side checks.
3. The same permanent user cannot approve their own submitted MRF or prepared purchase order, regardless of active role or later reassignment.
4. Stock, budget, payment, approval and document-numbering changes preserve their business rules under concurrent requests; retries must not duplicate effects.
5. Audit attribution is server-generated and historical events remain protected from rewriting when names, roles or assignments change.
6. A document is archived only after Drive confirms the correct file and the associated record acknowledges that result. Failures stay visible and retryable without creating duplicate business effects.
7. Provider calls and file transfers do not run inside database transactions. Durable jobs use bounded payloads and idempotent external operations, and expose pending or failed states.
8. Secrets and privileged credentials remain server-side. AI-generated values require human review before an official business action uses them.
9. Production starts with fresh company records and provisioned individual accounts. It contains no default demonstration credentials, automatic demonstration data seeding or prototype workspace-clearing initialization.
10. Production requires a verified deployment, appropriate hosting and company-owned Drive access, tested backup and recovery, and operational monitoring; a successful build or tidy folder structure alone does not establish readiness.
11. Realtime notifications reveal only permitted change signals and cannot establish authority. Current database access and session bindings remain enforced when notifications are delayed, missed or forged.

Current production gaps, their migration order and dated verification evidence are maintained in the [progress tracker](progress-tracker.md).
