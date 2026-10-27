# Architecture Context

This document describes the agreed **target architecture** for HML ConstructSync, an internal construction operations system for HML Technologies and Services Inc. It is a guide for the production migration, not a claim that the migration is complete. HML will start with fresh operational records; importing the prototype's browser data is not part of this plan.

Today the app is a browser-local prototype: accounts, sessions and business records are stored in the browser, document originals and caches use IndexedDB, and Next.js server routes support document generation, Google Drive and Gemini. The current account switching simulates staff identities rather than enforcing production authentication. New workspaces start without operational sample records, but the app still includes demonstration accounts and reset/initialization behavior. Those must be retired before business use.

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Application | Next.js App Router and TypeScript | Pages, route handlers, server-side application logic and typed domain rules. React is the UI library used by Next.js, not a separate application framework. |
| UI | Tailwind CSS v4 | Target styling system for the existing screens and responsive layouts. Tailwind is installed today, but the current interface uses custom CSS; conversion is separate work. |
| Runtime and hosting | Node.js 24.x on Vercel | Run the deployed application and server integrations. The repository currently pins Node 26.12.1; update and verify the runtime and tooling for the target before deployment. See [Vercel's supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). |
| Authentication | Supabase Auth | Individual, invitation-only email/password accounts, sessions, password recovery and revocation. |
| Business data | Supabase Postgres | Shared authoritative records, access grants, audit history, document metadata and job state. |
| Document files | Google Drive | Permanent originals, generated documents and related evidence, organized in company-controlled project folders. |
| Background work | Vercel Workflows | Durable, retryable processing for integrations and document work that may outlast an ordinary request. |
| Authentication email | Resend via Supabase custom SMTP | Invitation and account recovery email from a verified sender domain. |
| Document extraction | Gemini | Assist with MRF and quotation extraction; a person reviews the result before it affects official records. |
| Document generation | Existing PDF and Excel libraries | Generate and render the application's PDFs and spreadsheets. |

Hosted testing may use a Vercel Hobby project only when its use meets Vercel's eligibility terms. Company operations require an appropriate commercial Vercel plan. The intended business deployment remains on Vercel behind an HML-owned custom domain; a domain is an address, not a separate hosting platform.

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
  server/              Server-side documents, Google Drive and AI integrations
  styles/              Current custom CSS
public/                Public assets such as company branding
tests/                 Automated tests, helpers and isolated fixtures
scripts/               Verification, browser checks and document tooling
.github/workflows/     GitHub Actions continuous integration
docs/                  Five core context documents plus a checklist companion
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

The migration is expected to introduce `src/server/workflows/` for application background work and `supabase/migrations/` for versioned database changes. These folders do not currently exist. Application workflows are separate from `.github/workflows/`, which runs repository checks.

The intended request flow is: an authenticated user acts in a Next.js screen; a server handler verifies the session and current grants; server-side business logic reads and updates Postgres; and a durable workflow handles external operations when needed. A Drive upload or Gemini extraction may report pending, failed or completed status back to the application. Client-supplied roles, record contents and provider results are not authority for business decisions.

Workflow jobs retain the initiating audit identity and are bound to the intended record, source version and permitted acknowledgements. Current authorization and business conditions still need server-side checks at the relevant steps; a captured identity is not unrestricted authority after an account or access change. Manual retries record the retrying actor without rewriting earlier responsibility.

## Storage Model

- **Postgres:** The source of truth for users' application profiles, role and project assignments, projects, MRFs, quotations, purchase orders, budgets, payments, deliveries, stock, document references, audit events and workflow/job status. Related changes such as stock, budgets and document numbering need database transactions, concurrency control and safe retries.
- **Google Drive:** The permanent file store for originals, generated PDFs/spreadsheets and supporting evidence. Postgres stores the record relationship, Drive file identifier, version and archive status; a browser cache or an attempted upload does not count as a completed archive. Supabase Storage is not part of the intended permanent file architecture.
- **Browser storage:** May hold UI preferences and unsent drafts for convenience. Official business actions require an online connection and server confirmation; browser data is not the shared system of record. Apply access and privacy controls to any locally retained draft or file cache.
- **Workflow state:** Persist small identifiers, status and retry information. Keep document bytes and provider secrets inside server-side steps rather than workflow payloads or results. Use bounded uploads, targeting roughly 3 MiB chunks where appropriate, and verify the actual request encoding against [Vercel's function limits](https://vercel.com/docs/functions/limitations).

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

Use the Drive credential mode appropriate to the environment rather than configuring conflicting identities. Keep credential contents and `.env.local` out of Git and documentation. Restart the local server after changing environment values. These are the current integration settings, not a complete future production environment specification.

Validate the project's mapped folder and resolve pending/failed archives through the application's status and retry controls. Authentication failures require credential renewal or reconnection; inaccessible folders require correcting permissions or mapping. Preserve existing files while resolving failures. A previous successful live check does not establish future credential validity or production access control.

For repeatable verification and ownership-checked test cleanup, follow [AI workflow rules](ai-workflow-rules.md#before-moving-to-the-next-unit). Backup/restore targets and operational ownership remain [open decisions](progress-tracker.md#open-questions).

## Auth and Access Model

- Each staff member has an individual Supabase Auth identity and signs in with email and password. Administrators invite and manage accounts; public self-registration is disabled. Recovery and account removal or deactivation require controlled procedures.
- Account administration must retain at least one active Administrator and prevent self-deactivation. Apply these safeguards when changing role grants or account status as well as during account provisioning.
- HML is the single company in this design. Administrators grant application roles and, where required, project access. A person may hold multiple non-Site Personnel roles and switch the active role only among their own grants. Site Personnel is exclusive and cannot be combined with another role.
- Site Personnel access is limited to assigned projects and permitted operations. Other roles receive the record and operation access explicitly assigned to their responsibilities; a visible screen or role name alone never grants authority.
- Server operations verify the signed-in user's permanent identity and current database grants for the requested record and action. Use row-level security for exposed tables, explicit grants where the Data API is used, and appropriately scoped server authorization. Never rely on editable user metadata or stale client-provided role claims. Keep service-role credentials on the server only. See [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- A user cannot approve their own submitted MRF or their own prepared purchase order, even after switching roles or reassignment. Enforce this using the permanent user ID on the server.
- Audit events capture the permanent actor identity, the active role used for the action, the affected record and the action time. Role switches or later account changes must not rewrite past attribution.

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

Current production gaps, their migration order and dated verification evidence are maintained in the [progress tracker](progress-tracker.md).
