# Step 3 Implementation Guide

Agreed 2026-10-29; hosted environment strategy revised 2026-10-30. This guide owns the unit sequence and completion criteria. Read the [progress tracker](progress-tracker.md#current-goal) for actual implementation state, blockers, next action and verification evidence.

## Purpose and Resume Procedure

Use this guide when planning, implementing, reviewing or resuming checklist step 3. First read the five core documents required by [AGENTS.md](../AGENTS.md) and the [production checklist](checklist.md).

1. Check Git status and the tracker's current goal before choosing work. Preserve unrelated changes and distinguish recorded verification from checks still needed.
2. Find the first unfinished unit below and read its dependencies and completion condition. Work within the authorized unit; the existence of this plan does not authorize external provisioning, migrations, publication or deployment.
3. Inspect the affected implementation and current installed/provider documentation. Keep the architecture's production targets distinct from the prototype's behavior.
4. Verify the unit, then record its outcome, remaining gaps and exact next action in the tracker. Check its box only after its completion condition passes; link to the tracker's evidence instead of duplicating logs here.

The five core documents remain authoritative for product behavior, architecture, development rules and current progress. This guide owns the step 3 sequence and unit completion criteria. The checklist owns milestone completion. Update the affected sources together when an agreed decision changes.

## Agreed Boundary

Step 3 is the complete **account and project foundation**, delivered in small verified units. Its completion does not make the application ready for company operations.

| Area | Step 3 outcome | Later work |
| --- | --- | --- |
| Identity and access | Individual accounts, current role/project grants, same-person role switching and immediate access invalidation. | MRF/PO self-approval enforcement is verified with those workflows in step 4. |
| Shared records | Profiles, grants, assignments, projects, scopes, session authorization and foundation audit history in Postgres. | Operational records move with their authoritative workflows in step 4. |
| Project setup | Existing names, locations, document codes, PHP budgets and scope allocations. | Transactional document numbering and purchasing commitments/spending in step 4. |
| Realtime | Permitted foundation changes refresh open screens automatically. | Extend subscriptions as each operational workflow moves in step 4. |
| Documents and AI | Unfinished provider paths are disabled before any protected or costly work occurs. | Drive folder creation, validation, browsing, archives and AI processing in step 5. |
| Interface | Preserve agreed workflows and existing styling for migrated areas. Explicitly mark temporary gaps. | Tailwind conversion in step 6; release verification in step 7. |

Carry forward the [access policy](architecture.md#auth-and-access-model), [realtime design](architecture.md#realtime-updates) and [module organization](code-standards.md#file-organization). These choices are settled: remember the last permitted role per browser; require fresh sign-in after Administrator changes to roles or project assignments; preserve unsaved edits on ordinary record conflicts; use captured email first. Revisit them only when a consequential new constraint appears.

Use an isolated migration branch and retain the committed prototype as a recoverable baseline. The documentation branch is `docs/step-3-implementation-plan`, created from `0a7fb00`; consult Git for later branch and publication state. Fresh production records are required; browser-data import is excluded. Development uses the user's accounts and available free services. Bring any required purchase or upgrade back for a concrete cost decision.

## Module Interfaces and Data Flow

Keep the existing main folders (Option A), adding business-area groups as code migrates:

```text
app/                      Thin page, route and server-action adapters
src/features/<area>/      Screens, forms and local interaction state
src/domain/<area>/        Pure types, validation and calculations
src/server/<area>/        Authorized queries, commands and data access
```

Start with accounts and projects. Shared authentication, database and realtime infrastructure stays reusable within the existing layers. Avoid a repository-wide relocation before these areas work.

- A page requests a role-safe view from the relevant server module and passes only needed data to its screen. Project filters and form state remain client concerns.
- A command accepts an explicit operation and validated input, an expected record version for edits, and a stable retry identity where creation could otherwise duplicate effects. Derive the actor and current authority on the server.
- Server logic checks the session, active role and current database grants, applies domain rules and commits related changes with audit attribution atomically. Preserve endpoint-family response contracts; command results describe the saved record or actionable failure, rather than returning an entire workspace snapshot.
- Realtime signals trigger another authorized read. External providers stay outside database transactions. Financial values are omitted from Site Personnel views and cannot be retrieved through alternate Data API, RPC or subscription paths.

Remove migrated dependencies on the global `DemoSnapshot`, `useDemo()` and broad command dispatcher as their replacements become verified. Keep useful pure rules and isolated synthetic fixtures. Account administration, project writes and access checks must not fall back to browser authority.

## Ordered Units

### 3.0 Record the Plan

- [x] Synchronize this guide, the core context documents, checklist and required-reading pointers.

**Done when:** local documentation links/anchors, scope consistency and whitespace pass; the managed Next.js instructions remain unchanged; the tracker identifies unit 3.1 as planned, with no application implementation claimed.

Completed 2026-10-29: documentation-only verification is recorded in the [tracker](progress-tracker.md#session-notes).

### 3.1 Establish Hosted Staging and Database Foundations

- [x] Hosted staging and foundation schema verified.

**Depends on:** 3.0.

- Use the existing staging project `gxphubtycnvhpgstruqb` in organization `szmmzavejsnmqgvnyqbn`, region `eu-west-1`. Production `caiasmpfhueuouxqhalo` is reserved for step 7. The local app will connect to staging in 3.2; local Docker is not required.
- Pin Supabase CLI 2.122.0, add versioned SQL migrations, generated types and explicit staging preview/apply/type-generation commands. Reject missing/mismatched/production targets; keep credentials and temporary CLI state outside Git. Inspect existing tables, history and Auth settings before applying changes; disable public/anonymous signup.
- Add profiles, grants, assignments, projects/scopes, application access revisions/session bindings and protected audits. Separate financial records from metadata; enforce uniqueness, valid amounts, foreign keys and transactional allocation caps. Prepare versions/retry identities for later commands.
- Implement explicit privileges and RLS. Missing/inactive/unauthorized accounts or invalidated bindings receive no protected access; editable metadata and stale JWT claims grant none. Keep session binding, protected writes and audit attribution privileged.
- Add an Ubuntu/Node 24 disposable Docker Supabase CI job for migration replay, database/security checks and type consistency; keep existing four standard jobs independent. Apply reviewed migrations to staging after disposable verification, then run scoped synthetic checks whose cleanup preserves retained staging data.
- Update environment guidance and the tracker. A required purchase/upgrade needs a concrete cost decision. Publication, merging and app deployment remain separate actions.

**Done when:** disposable CI replays all migrations and passes database/security/type checks, the same migrations and scoped checks pass on staging, standard code/documentation checks pass, and cleanup preserves development/company data. Keep the unit unchecked while hosted CI or staging verification is pending. This unit can be verified before a usable account screen exists.

Completed 2026-10-30: local checks, [final disposable CI](https://github.com/yaboii-jah/HML-Prototype/actions/runs/40962444259), hosted migration/Auth/security checks, matching generated types and synthetic cleanup passed. Detailed evidence and informational advisor findings are recorded in the [tracker](progress-tracker.md#session-notes). App/session integration begins in 3.2; the whole step 3 milestone remains unchecked.

**Tooling:** copy the environment template's staging settings into private `.env.local` and supply a staging-authorized `SUPABASE_ACCESS_TOKEN`; tooling deliberately avoids another account's global CLI identity. Use `npm run db:staging:preview`, `db:staging:apply`, `db:staging:types`, `db:staging:check` and `db:staging:auth:check`/`db:staging:auth:apply`. The Auth command enables the email provider, disables public/anonymous registration and sets the declared password/local callback settings; it leaves SMTP and other providers alone. CLI `auth.email.enable_signup` must remain true for existing-user email sign-in; root `auth.enable_signup = false` blocks public registration. The local callback is `http://127.0.0.1:3000/auth/confirm`, implemented in 3.2.

Type generation uses pinned `@supabase/postgrest-typegen` 0.6.0 in both environments. Hosted tooling supplies read-only catalog queries through the staging Management API; CI supplies the same queries through its disposable database. This avoids the different generator used by CLI `gen types --project-id` and keeps the generated file comparable without local Docker or a database password.

`npm run verify:db` runs only on disposable GitHub Linux runners and creates its own workdir, project and loopback-bound network. Its artifact contains verification evidence and generated database types. The first run supplies the initial generated types; commit that artifact as `src/server/database/database.types.ts`, then rerun for type consistency. Download the passing `database-ci.json` artifact into ignored `.verification/`; staging application verifies its migration hash and successful type check. Synthetic SQL checks run inside a rollback-only transaction. Hosted migration application never resets staging, and ordinary unit/API checks require neither Docker nor hosted credentials.

### 3.2 Replace Session Handling and Gate the Workspace

- [x] Real session handling and migration access gates verified.

**Depends on:** 3.1.

- Implement real password sign-in/out, invitation/recovery confirmation and controlled first-Administrator provisioning. Disable public registration and remove default demonstration credentials from the supported runtime path.
- Bind a verified Auth session ID to the current application access revision after fresh authentication. Check that binding and current grants on every protected read/write; JWT refresh must never renew revoked application access. Keep privileged binding creation server-only.
- Separate the session projection, role preference and UI state from business records. A single-role user enters directly; multi-role users resume the last still-permitted role on that browser or choose one. Role switching retains permanent identity.
- Refactor the shell and page gates to work without a full demo workspace. Use projects as the supported landing screen. Protect direct navigation and server operations, including unfinished handlers that currently accept browser record snapshots.
- Disable unmigrated operational screens, demo reset/initialization paths and provider handlers in the migration runtime. Keep the committed baseline recoverable and synthetic test data isolated.

**Agreed implementation:** work on `feat/step-3-sessions`; use pinned Supabase JS/SSR packages, server-checked cookie sessions and service-only RPC wrappers over private binding/provisioning functions. Capture the access revision before password verification and compare it under a lock when binding the fresh Auth session. Opening an invitation/recovery page does not consume its token; submitting the password verifies the one-time link, updates the password in an unbound temporary session, then returns to ordinary sign-in. Require the current password for ordinary Auth password changes. Use a staging-only interactive first-Administrator command with explicit identity and a hidden password; handle retries/partial failures without adopting unrelated identities. Keep the server-only project secret separate from the maintenance PAT.

Projects is a protected unavailable landing state until 3.4. Disabled provider endpoints keep JSON error contracts and perform no body/provider work (`401` for an invalid application session, `503` for an authenticated unavailable operation). Bring the portable browser launcher and focused real-account/Mailpit coverage forward from 3.6. Name deferred prototype suites and their restoration milestones; isolated legacy handler fixtures are provider regression coverage, not proof that those application endpoints remain enabled.

**Done when:** real sessions can enter the supported shell; anonymous, inactive and revoked sessions cannot read or mutate protected data; forged roles and browser snapshots grant no authority; unfinished direct endpoints perform no provider work. Invitation/recovery callbacks handle invalid or expired links and unsafe redirects without granting access.

Completed 2026-10-30: local standard checks passed with 371 tests/build; all four standard CI jobs and disposable database/Auth/browser/email/type checks passed at published code `270c9d4`. Staging migration, Auth settings, rollback security checks, matching generated types and scoped session/recovery parity passed with synthetic cleanup. The [tracker](progress-tracker.md#session-notes) records exact runs, deferred browser coverage, Free-plan limits and remaining release advisories. The user subsequently provisioned and signed in as the first permanent staging Administrator; production is unchanged.

**Local use:** configure the staging URL/publishable key and server-only `SUPABASE_SECRET_KEY` in private `.env.local`. Run `npm run auth:staging:bootstrap` once in a private terminal to enter the first Administrator's name/email and hidden password, then `npm run dev` and open `http://127.0.0.1:3000/sign-in`. Keep the ignored bootstrap checkpoint on partial failure and retry the same identity; the password from initial creation remains in use. No default credentials or real invitation email are installed. `npm run auth:staging:check` verifies scoped synthetic session/recovery behavior without sending mail and cleans its own identity. Hosted Auth tooling applies security/URL settings; committed templates run in Mailpit CI because the Free/default email provider rejects template modification. Standard verification builds deliberately omit live credentials; use the configured development server for local review.

### 3.3 Implement Account Administration

- [ ] Account administration and access invalidation verified.

**Depends on:** 3.2.

**Agreed implementation (2026-10-30):** use `feat/step-3-accounts`. `/admin` owns user management and is available only with the active Administrator role. Reuse the retained directory/editor styling without restoring the demo container. Support multiple non-Site roles; Site Personnel is exclusive, with zero or many unique existing project assignments. Confirm and atomically clear assignments when leaving Site Personnel. Email is fixed after saving an invitation; correct mistakes by deactivating the account and creating the correct recipient. Never let an Administrator remove their own Administrator grant or deactivate themselves. Reactivation retains grants/assignments and must precede sending any new message. Name changes and unchanged submissions preserve sessions; access changes invalidate all existing application sessions.

Preserve at least one enabled Administrator who has completed a successful application sign-in. Pending invitations and password setup alone do not qualify. Backfill the first application sign-in timestamp only from existing binding evidence. Serialize account mutations with a real private guard-row update, recheck current actor/session/grants in each transaction, check expected versions and atomically commit changes, invalidation and immutable audits. Retried logical requests must not duplicate identities or audit events. Conflicts preserve the draft for review and reapplication.

Provision an unconfirmed Auth identity with a preallocated UUID, no known initial password and a trusted `app_metadata` operation marker. Never adopt an existing identity by email alone. Persist private provisioning/message stages and safe failure categories; keep Auth/email calls outside SQL transactions, rechecking authorization before dispatch/finalization. Default hosted email capability to disabled: allow saving pending staff and clearly show **Invitation not sent**. CI enables Mailpit. Completed message attempts never resend on retry; an intentional resend creates a new attempt. Accepted dispatch is not proof of delivery; timeouts/crashes remain uncertain. Confirmed identities whose invitation password save failed use recovery. Recovery dispatch preserves sessions; a successful password reset revokes other managed Auth sessions and their bindings.

Close the reset/login race by capturing a server-only opaque credential fingerprint before the password challenge. Binding locks the Auth user **FOR SHARE before the profile**, compares that fingerprint and the access revision, and requires the new RPC signature. A changed fingerprint fails closed and requires a new sign-in, including legitimate provider re-encryption; never re-preflight and bind the already-issued session. Keep hashes/fingerprints out of browser data, logs and audits.

Verification includes real commands/UI, captured invite/recovery/retry failures, non-Administrator/forged requests, no-op/conflict/Site rules, first-sign-in qualification, observed-lock last-Administrator races at both isolation levels, access revocation after refresh, and the reset/login race. Hosted SQL runs real commands inside a rollback-only fixture transaction; separate HTTP checks use owned Auth-only identities without application profiles. Full successful provisioning/UI workflows run only in disposable CI, whose whole stack is destroyed with its audits. Do not add audit-deletion or test-authorization exemptions. Compare retained counts and the real Administrator's version/revision before and after staging checks.

- Adapt the existing account-management UI for invitations/resends, profile management, role grants, assignments, deactivation/reactivation and recovery links. Verify messages through CI Mailpit; hosted manual tests use restricted synthetic-account link generation without claiming email delivery.
- Enforce Site Personnel exclusivity and assignment limits. Preserve at least one active Administrator under concurrent changes and prevent self-deactivation. Retain permanent identities and historical audit attribution.
- Apply role/assignment changes and access-revision invalidation atomically. Require fresh sign-in for affected sessions across browsers; immediate rejection is enforced by the database/server even before realtime UI feedback exists.
- Make Auth/database/email partial failures visible and recoverable. Retry provisioning without duplicate identities or granting access before valid application grants exist.

**Done when:** Administrator-only account flows work with captured messages, including failed/resend cases; non-Administrators cannot bypass them; old sessions remain rejected after token refresh; last-Administrator and concurrent-change checks pass. Existing domain/self-approval requirements are retained for step 4, not reported as implemented approval flows.

### 3.4 Implement Shared Projects and Scopes

- [ ] Shared project/scope behavior and concurrency verified.

**Depends on:** 3.3.

- Move project and scope reads/writes into their grouped modules, retaining existing setup fields and role responsibilities. Connect personnel assignments to shared projects.
- Enforce name/code uniqueness, valid PHP amounts and allocation limits on the server/database. Serialize competing changes so combined scope allocations cannot exceed the project budget or outlive a conflicting budget reduction.
- Use version checks for edits and stable retry identities for creation. On conflicts, preserve input, show the newer-record warning and require review/reapplication before saving.
- Deliver only permitted project records and role-safe fields. Site Personnel can see their assigned project/scope information without budget values.
- Disable Drive setup actions, request/PO counters, commitment/spending summaries, stock panels and operational links until their authoritative sources migrate. Display unavailable states instead of invented zero balances.

**Done when:** independent authenticated sessions share permitted project/scope changes, unauthorized and unassigned access is rejected, allocations remain valid under concurrency, retries do not duplicate records/audits, and stale saves cannot silently replace newer data.

### 3.5 Add Protected Realtime Updates

- [ ] Authorized realtime updates and recovery verified.

**Depends on:** 3.4. Plan event hooks with earlier writes so this unit can connect them without replacing persistence.

- Send database-backed private Broadcast notifications after committed foundation changes. Use current authorized recipients and user/access-revision topics; include minimal invalidation signals, not business-record or financial payloads. Ordinary browser clients cannot publish authoritative changes.
- Recheck access and refetch affected views on relevant events, after subscription establishment/reconnect and when returning to the app. Coalesce refreshes and preserve ordinary unsaved input; clean up obsolete subscriptions on role/session changes.
- Notify affected users of access changes, clear protected client state and require sign-in again. Old access-revision topics receive no later record notifications, even while an old socket remains connected.
- Show a visible stale/reconnecting state and a manual refresh/retry path when realtime is unavailable. Official writes continue to require online server confirmation.

**Done when:** two isolated browser sessions receive permitted changes automatically; record edits do not erase a draft; subscription gaps recover through fresh reads; revoked users receive no subsequent protected record notifications or data. Access remains enforced when events are delayed, missed or forged.

### 3.6 Verify the Foundation and Complete the Milestone

- [ ] Foundation acceptance, CI and development-backend parity verified.

**Depends on:** 3.5.

- Retain standard Linux/Windows and Node 24/26 checks. Extend the disposable Supabase/Mailpit and real-account browser coverage introduced in 3.2 to complete foundation acceptance. Keep its shared Linux Chrome/Windows Edge launcher, bounded CDP waits and isolated profiles.
- Configure local-only Auth/Data/Realtime endpoints before building test bundles. Validate endpoints explicitly: the existing Node-fetch network guard does not isolate browser requests or Realtime WebSockets. Automated tests must never reset or depend on the hosted development project.
- Map the acceptance scenarios below to maintained tests. Preserve existing domain tests and record each deferred browser workflow, its reason and restoration milestone; deferred cases are never counted as passed.
- Run synthetic parity checks against the existing staging project using accounts provisioned without sending email. Keep cleanup scoped to run-owned resources. Keep the app review local; a hosted application preview and production promotion are deferred to step 7.
- Review documentation, remaining release blockers and actual hosted/local evidence before checking step 3 complete.

**Done when:** required local and hosted CI foundation checks pass, dedicated development-backend parity is recorded, deferred coverage is visible, and the tracker/checklist describe the supported foundation accurately. Captured-email verification does not satisfy real email delivery or production readiness.

## Required Acceptance Scenarios

| Scenario | Required result |
| --- | --- |
| Invitation and recovery | Captured links establish only the intended account flow; invalid/expired/replayed links and delivery failures have safe recovery paths. |
| Identity and roles | Switching a person's granted roles preserves their permanent identity; Site Personnel cannot hold another role; remembered roles are revalidated. |
| Unauthorized requests | Anonymous users, forged metadata, direct URLs and direct Data API/RPC requests cannot bypass current access checks. |
| Access changes | Deactivation, role removal and assignment changes reject old application sessions immediately, including after token refresh and with missed notifications. |
| Administrator safeguards | Concurrent account/grant changes retain an active Administrator and cannot self-deactivate or rewrite past attribution. |
| Shared records and confidentiality | Separate accounts see the same allowed projects; Site Personnel see assigned records and never receive budget fields through any exposed path. |
| Concurrent allocations and edits | Competing writes preserve budget limits; stale writes fail visibly while keeping the ordinary draft available for review. |
| Retry and audit integrity | Repeated creation submissions do not duplicate records or audit effects; actors and times are generated from verified server context. |
| Realtime lifecycle | Permitted changes refresh automatically; reconnect/focus catch up; obsolete topics stay silent; drafts survive ordinary refreshes. |
| Temporary gaps | Unsupported screens and endpoints are explicitly unavailable and cannot execute provider work or fall back to local business authority. |
| Environment isolation | CI resources/URLs are loopback and disposable; hosted checks explicitly target staging and clean only run-owned resources. Production and retained development data remain protected. |

Run the [standard completion checks](ai-workflow-rules.md#before-moving-to-the-next-unit) for each applicable code unit, not only at the end. Record exact scope and results in the tracker. Real email delivery with a verified sender, company-owned production services, deployment, backup/restore and staff acceptance remain release requirements for the later protected rehearsal.
