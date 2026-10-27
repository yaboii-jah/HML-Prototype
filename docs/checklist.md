# Production Checklist

Use this companion to track the steps toward production. See the [progress tracker](progress-tracker.md) for current work, blockers and detailed verification history.

## Steps

- [x] **1. Save the current work in Git.**
  Done when the changes are reviewed and committed, with the commit reference recorded.
  Completed 2026-10-27: reviewed and committed as `a26983a`.

- [ ] **2. Prepare Node, npm and CI for deployment.**
  Done when Node 26 development and Node 24 deployment use the declared npm version, deployment runtime checks pass, and local verification plus all four Linux/Windows CI combinations pass.
  Local fixes passed 2026-10-27 with 365 tests and 28 browser suites. Initial hosted CI passed both Linux jobs; the corrected four-job run is pending.

- [ ] **3. Add secure accounts, permissions and shared data.**
  Done when authorized users can share permitted records and unauthorized or revoked access is rejected.

- [ ] **4. Move business workflows to the server.**
  Done when business updates are authorized, transactional, safe to retry and audited, with prototype data authority and reset paths retired.

- [ ] **5. Complete reliable document and AI integrations.**
  Done when protected jobs archive the correct files, recover from failures and keep AI results subject to human review.

- [ ] **6. Convert the UI to Tailwind.**
  Done when the agreed screens use Tailwind/shared tokens and pass responsive, accessibility and workflow checks.

- [ ] **7. Verify staging, backups, monitoring and staff acceptance.**
  Done when release blockers are resolved and staging, restore, monitoring and staff-acceptance evidence is recorded.

## Keeping This Updated

- Read this checklist before planning or completing foundation and migration milestones.
- Check an item only after its completion condition is verified. Add the completion date and a short evidence note under it; link to the tracker's detailed result when useful.
- Keep active work, blockers, open questions and detailed verification in the [progress tracker](progress-tracker.md). An unchecked item may be planned, active or blocked; the tracker explains which.
- Add future steps when their scope is agreed. Tailwind is a separate track after the foundations, not a prerequisite for authentication or shared data.

This checklist records progress; it does not authorize Git publication, migrations or deployment. Follow the [AI workflow rules](ai-workflow-rules.md) and [architecture](architecture.md) when carrying out a step.
