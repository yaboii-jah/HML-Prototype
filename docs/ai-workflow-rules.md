# AI Workflow Rules

## Approach

Develop the project incrementally against agreed requirements. At the start of every project task, read all five core context documents listed in [AGENTS.md](../AGENTS.md) before planning or making changes, then inspect the relevant implementation. Read them again when resuming without their current contents or when the documentation has changed. Follow applicable repository instructions, including the installed Next.js documentation guidance.

Use the progress tracker's current phase, goal, blockers and pending work when choosing or resuming a unit. Reading only the tracker or a subset of the context documents does not satisfy the required reading step.

For foundation or migration milestone work, also read the [production checklist](checklist.md) before planning or completing the unit. It is a companion to the five core documents, not a sixth document required for every unrelated task.

Distinguish the intended production architecture from capabilities already implemented. Use the code to establish current behavior and the agreed documents to establish the target. Surface consequential conflicts rather than silently changing the product or claiming that planned capabilities already exist.

For substantial changes, present a brief plan covering the intended behavior, affected boundaries and verification. Once the user authorizes the scope, carry it through to completion without repeatedly asking for approval. A new decision is needed when consequential ambiguity remains or the required work extends beyond that authorization.

## Scoping Rules

- Work on one coherent feature or migration unit at a time, with an observable outcome and a defined verification method.
- Prefer small, complete increments over speculative infrastructure or unrelated cleanup.
- Keep coordinated UI, server and data changes together when they are required for the same behavior. Folder boundaries alone do not define separate units.
- Preserve unrelated user changes and existing behavior outside the agreed scope.
- Perform commits, pushes, merges, deployments, migrations and changes to external services only when covered by the user's authorization. Existing authorization carries through the work it covers.

## When to Split Work

Split a proposed implementation step when it combines:

- Independent features, unrelated workflows or API changes with separate acceptance criteria.
- A broad styling conversion and an authentication or persistence migration that can be delivered and verified separately.
- A settled requirement and a consequential product decision that still needs an answer.
- More behavior than can be verified as a bounded unit with a clear result and failure path.

Each resulting unit must have a useful outcome and evidence of correctness. A foundational migration unit may be verified at its own boundary before the complete user-facing workflow is available; state that limit explicitly.

## Handling Missing Requirements

- Investigate repository facts before asking the user. Read relevant code, configuration, tests and documentation rather than asking for information already available there.
- Ask with a recommended answer when uncertainty changes feature scope, access rights, workflow, financial rules, data handling or another consequential product decision.
- Resolve routine implementation details using existing conventions and judgment within the authorized scope.
- Continue independent work while a decision is pending; wait for the answer before implementing behavior that depends on it.
- Record agreed requirement changes in the relevant context document before implementing the affected behavior. Treat unconfirmed company accounting rules as open questions rather than established policy.

## Protected Files

- Manage third-party dependencies through the package manager and update the corresponding lockfile when dependencies change. Keep library internals in `node_modules/` untouched.
- Generate build artifacts and derived files through their owning tools rather than hand-editing `.next/`, build outputs or generated Next.js type files.
- Preserve the managed Next.js block in `AGENTS.md`. Put project-specific instructions outside its markers.
- Change private configuration and company branding, fonts or document templates only when the authorized task requires it. Keep secret values out of source control, documentation and verification output; use `.env.example` for configuration guidance.
- Treat maintained source code, custom UI components, tests and verification scripts as editable within the task's scope. Their folder names do not make them generated or protected assets.

## Keeping Docs in Sync

Before completing a task, explicitly review its documentation impact. Update affected documents in the same change; keep unaffected documents unchanged. In the completion report, identify which documents were updated or briefly explain why no documentation update was necessary.

Update the relevant document in the same change when agreed behavior or implementation decisions change:

- Product goals, feature scope, user responsibilities or core workflows belong in the [project overview](project-overview.md).
- System boundaries, storage, authentication/access and invariants belong in [architecture context](architecture.md).
- Implementation conventions and code-quality expectations belong in [code standards](code-standards.md).
- Ordered milestones, completion conditions and checked status belong in the [production checklist](checklist.md).
- Development process and verification expectations belong in this document; update other relevant maintained documentation when its claims would otherwise become inaccurate.

Document both the target and remaining implementation gaps accurately. A completed unit does not establish that the entire production migration is complete.

Maintain the five core context documents plus the production checklist companion unless the user changes the documentation scope. Keep detailed architecture decisions in architecture context and a short rationale/status summary in the tracker; do not recreate superseded context files or ADR folders as routine maintenance.

Update the [progress tracker](progress-tracker.md) after each meaningful implementation or documentation change and consequential decision. Record completed units, actual work in progress, next units, open questions and verification evidence. Distinguish local completion from publication and production readiness; planned work is not work in progress. Keep session notes concise and current rather than appending a transcript.

When milestone progress changes, update the checklist and the tracker's current state in the same change. Check a step only after its completion condition passes, with a completion date and brief evidence note; keep detailed verification and blockers in the tracker. Add future steps when agreed rather than maintaining a second milestone table here or in the tracker.

## Before Moving to the Next Unit

1. Verify the unit's intended behavior within its defined boundary, including relevant failure paths. State any remaining dependency on later units.
2. Check the architecture invariants and advance the agreed target without introducing new violations. Keep existing production gaps visible; changes to the target require an agreed decision.
3. Run focused checks while iterating. Add or update tests when they protect meaningful behavior or a regression. When a code change is complete, run `npm run verify`, which includes lint, type generation, type checking, unit/API tests and the production build. Run focused `npm run verify:browser -- <suite names>` checks when UI behavior changes.
4. For documentation-only changes, check headings, links, formatting and consistency with the relevant specifications. Application tests and builds are not required solely for prose changes.
5. Complete the documentation-impact review described above and update the tracker after meaningful changes or decisions. Report what changed, which documents were updated (or why none needed changes), which checks ran, their results and any remaining blockers, without claiming unrun or incomplete checks passed.

Use the repository's isolated verification paths by default. Run live integration checks only when the user's authorization covers their provider usage and external effects. Preserve existing company data, confine test data and cleanup to the run's own resources, and report cleanup failures. Broaden or repeat verification when changes, failures or unresolved concerns justify it.

### Verification Profiles

- **Standard code checks:** `npm run verify` checks the active toolchain, then produces lint, type generation, TypeScript, unit/API and build logs plus a summary under ignored `.verification/`. Keep Node 26.12.1 locally and npm 11.20.0 as declared in the package metadata; production targets Node 24.x, with 24.22.1 as the CI baseline. Later stable releases within the declared engine ranges are accepted. `npm ci` also checks the toolchain. Vercel installation and `npm run build:deployment` require Node 24 explicitly; the latter intentionally fails on local Node 26.
- **Browser checks:** `npm run verify:browser` starts an isolated production server with live credentials disabled and runs the maintained suites. Windows and Microsoft Edge are currently required. Select suites when appropriate. Hosted CI (`CI=true`) runs browser suites serially to bound competing Edge workloads; local runs retain two workers. The selected worker count is recorded in the browser summary. CI is configured for standard checks and the existing high-severity dependency audit on Linux/Windows with both Node baselines; both Windows jobs additionally run the full browser suite. Pull requests, pushes to `main`/`staging` and manual dispatch trigger the workflow, with separate artifacts per OS/runtime. Verify hosted results rather than assuming local success proves CI or deployment success.
- **Live integrations:** After producing a build, run `npm run test:live` only within authorized live integration work and with the server configuration described in [architecture context](architecture.md#google-drive-and-ai-configuration). It incurs provider usage, creates a unique run-owned child under the configured Drive root, uses synthetic documents and restricts its application process to that child. Cleanup verifies ownership before trashing only that folder and then verifies its trashed state. A cleanup failure fails the command and identifies the remaining run-owned folder for follow-up; the application exposes no deletion endpoint for this test cleanup.

The live result is recorded in ignored `.verification/live.json`; browser results are under `.verification/browser/`. Logs are local evidence and may not exist in another checkout. Keep dated, scoped outcomes in the tracker, without credentials, raw provider responses or company documents. A live pass verifies the credentials and permissions used at that time, not future availability or readiness for company operations.

Browser checks set explicit focus and normal-motion defaults; accessibility cases separately exercise reduced motion. Wait for animated loading visuals to reach their asserted state within a bounded timeout; a fixed Node timer does not prove that the browser's animation clock has advanced. When a full navigation is required, wait for the new document and the relevant page content instead of accepting an existing heading or URL change as readiness. Give full-navigation protocol calls a separate bounded time budget when a valid delayed response exceeds an ordinary-call deadline; retain content assertions, ordinary-call limits and overall suite deadlines. Keep permission, session-reset and storage-failure assertions strict, and check the settled destination after account switching. Ticket-tampering tests must change actual decoded bytes rather than replacing a character with a value it may already contain.
