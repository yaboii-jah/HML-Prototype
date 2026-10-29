# Production Checklist

Use this companion to track the steps toward production. See the [progress tracker](progress-tracker.md) for current work, blockers and detailed verification history.

## Steps

- [x] **1. Save the current work in Git.**
  Done when the changes are reviewed and committed, with the commit reference recorded.
  Completed 2026-10-27: reviewed and committed as `a26983a`.

- [x] **2. Prepare Node, npm and CI for deployment.**
  Done when Node 26 development and Node 24 deployment use the declared npm version, deployment runtime checks pass, and local verification plus all four Linux/Windows CI combinations pass.
  Completed 2026-10-28: local verification and [all four CI jobs](https://github.com/yaboii-jah/HML-Prototype/actions/runs/40544882334) passed at `cc87c65`, with 365 tests per job and all 28 browser suites on both Windows runtimes. Hosted deployment remains part of step 7.

- [ ] **3. Add secure accounts, permissions and shared project data.**
  Done when individual accounts, current role/project permissions, shared projects/scopes and protected realtime updates pass the [implementation guide's](step-3-implementation.md) foundation checks, including rejection of unauthorized or revoked access. CI captures invitation/recovery email; hosted synthetic checks use restricted generated links. Operational records move in step 4.

- [ ] **4. Move operational records and business workflows to the server.**
  Done when each migrated workflow has shared authoritative records and realtime updates, with authorized, transactional, retry-safe and audited changes; prototype data authority/reset paths are retired and deferred operational browser coverage is restored.

- [ ] **5. Complete reliable document and AI integrations.**
  Done when protected project-folder creation, validation and browsing work, and protected document jobs archive the correct files, recover from failures and keep AI results subject to human review.

- [ ] **6. Convert the UI to Tailwind.**
  Done when the agreed screens use Tailwind/shared tokens and pass responsive, accessibility and workflow checks.

- [ ] **7. Verify staging, backups, monitoring and staff acceptance.**
  Done when release blockers are resolved and staging, restore, monitoring and staff-acceptance evidence is recorded, including real invitation/recovery email delivery from a verified sender and company-owned production services.

## Keeping This Updated

- Read this checklist before planning or completing foundation and migration milestones.
- For step 3, use the implementation guide for ordered units and completion criteria. Keep current work, blockers, next actions and detailed evidence in the tracker; a documentation checkpoint does not complete the foundation milestone.
- Check an item only after its completion condition is verified. Add the completion date and a short evidence note under it; link to the tracker's detailed result when useful.
- Keep active work, blockers, open questions and detailed verification in the [progress tracker](progress-tracker.md). An unchecked item may be planned, active or blocked; the tracker explains which.
- Add future steps when their scope is agreed. Tailwind is a separate track after the foundations, not a prerequisite for authentication or shared data.

This checklist records progress; it does not authorize Git publication, migrations or deployment. Follow the [AI workflow rules](ai-workflow-rules.md) and [architecture](architecture.md) when carrying out a step.
