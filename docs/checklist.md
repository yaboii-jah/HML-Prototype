# Production Checklist

Use this companion to track the steps toward production. See the [progress tracker](progress-tracker.md) for current work, blockers and detailed verification history.

## Steps

- [x] **1. Save the current work in Git.**
  Done when the changes are reviewed and committed, with the commit reference recorded.
  Completed 2026-10-27: reviewed and committed as `a26983a`.

- [x] **2. Prepare Node, npm and CI for deployment.**
  Done when Node 26 development and Node 24 deployment use the declared npm version, deployment runtime checks pass, and local verification plus all four Linux/Windows CI combinations pass.
  Completed 2026-10-28: local verification and [all four CI jobs](https://github.com/yaboii-jah/HML-Prototype/actions/runs/40544882334) passed at `cc87c65`, with 365 tests per job and all 28 browser suites on both Windows runtimes. Hosted deployment remains part of step 7.

- [x] **3. Add secure accounts, permissions and shared project data.**
  Done when individual accounts, current role/project permissions, shared projects/scopes and protected realtime updates pass maintained foundation acceptance checks, including rejection of unauthorized or revoked access. CI captures invitation/recovery email; hosted synthetic checks use restricted generated links. Operational records move in step 4.
  Completed 2026-11-03: units 3.1-3.6 pass local checks, all four standard CI jobs, disposable foundation acceptance, staging parity and the user's targeted retry review at implementation `4a940cc`. See the [tracker](progress-tracker.md#session-notes) for evidence. Operational workflows and production release remain later milestones.

- [ ] **4. Move operational records and business workflows to the server.**
  Done when each migrated workflow has shared authoritative records and realtime updates, with authorized, transactional, retry-safe and audited changes; prototype data authority/reset paths are retired and deferred operational browser coverage is restored.
  Agreed sequence and unit criteria are in the active [step 4 guide](step-4-implementation.md). Documentation unit 4.0 is verified. Unit 4.1 implementation `43f7f80` passes local checks, all four standard CI jobs, disposable integration and staging parity; the staging migration is applied with retained state preserved. Unit 4.1 is complete as of 2026-11-03 after explicit user confirmation of shared drafts, conflict review and assignment revocation, with passing combined acceptance evidence. Step 4 remains unchecked for its later units. Required document upload/archive capabilities accompany their later workflows.
  Unit 4.2 is complete on 2026-11-03: implementation `664053a` passes local/four-job CI/disposable/real-Drive/staging checks, explicit confirmation covers all three manual groups, and source-bound combined acceptance passes. Unit 4.3 implementation `36a4857` passes local/four-job CI/disposable/live-Drive/staging checks; its migration is applied with retained state preserved. Unit 4.3 is complete on 2026-11-04 after explicit confirmation of all three manual groups and passing combined acceptance. Step 4 remains unchecked for later units; 4.4 supplier-directory implementation `480311b` passes local/four-job CI/disposable/staging checks with retained state preserved. Unit 4.4 is complete on 2026-11-04 after explicit confirmation of all three manual groups and passing combined acceptance. Step 4 remains unchecked for later units; 4.5a completion is recorded below.

  Unit 4.5 is split: 4.5a manual quotation capture and originals is complete on 2026-11-05 at `26305c3`, with local/four-job CI/disposable/live-Drive/staging checks, explicit confirmation of all three manual groups and passing source-bound combined acceptance. The user confirmed quotation calculations, locked the detailed 4.5b scope and requested implementation on 2026-11-05. Financial finalization, immutable revisions, originals/internal PDF archives and guarded activation are implemented; source `8b8f32a` passes local/four-job CI/disposable/live-Drive/final staging checks with retained state preserved. Completed 2026-11-06: the user explicitly confirmed all three new human groups passed with no skipped checks, superseding the earlier **Not tested yet** response. Matching combined acceptance passes, completing 4.5b and parent 4.5. Checklist step 4 stays unchecked for later units. The tracker owns evidence and next actions.

  Unit 4.6 is complete on 2026-11-06 at `7e9b3a0`: private shared demand allocation passes local lint/types/428 tests/build/public-browser, four-job CI, full disposable integration/types/races, retained-state-safe staging parity and scoped combined internal-demand acceptance. No staff allocation workflow or new human/provider attestation is claimed. Step 4 remains unchecked for later units.

  Unit 4.7 is complete on 2026-11-06 at `e749844`: private project-stock ledger/reservations pass local lint/types/431 tests/build/public-browser, four-job CI, full disposable integration/types/races and retained-query regression, retained-state-safe staging parity and scoped combined internal-stock acceptance. No new staff/provider attestation is claimed. Unit 4.8 is complete on 2026-11-07 at `f1248bc`: source-current automated, staging-preservation and live-artifact checks, explicit confirmation of all three new human groups with no skipped checks, and matching combined acceptance pass. This supersedes its earlier **Not tested yet** response; earlier attestations retain their original provenance. Step 4 remains unchecked for later units. Unit 4.9 implementation `e00f8fd` passes local/four-job CI/full disposable/live-Drive/staging-preservation and responsive/PDF review checks on 2026-11-07. Completed 2026-11-08: the user explicitly confirmed all three new human groups including assisted checks passed without skips or issues, superseding Not tested yet. Matching combined acceptance passes and 4.9 is complete. Step 4 remains unchecked for later units. Unit 4.10 supplier issuance is complete on 2026-11-08 at `77e3965`: local/four-job CI/disposable/staging preservation/owned Drive checks, all three explicit human groups including assisted checks without skips/issues, and combined acceptance pass. Step 4 stays open for later units.

  Step 4.11 payment coordination/verification is published in [draft PR #46](https://github.com/yaboii-jah/HML-Prototype/pull/46) from `feat/step-4-payment-verification`. Standard local verification (lint, typegen, typecheck, 477 unit/API tests and build), focused payment SQL rollback checks, observed-lock payment races at both isolation levels, the real-session payment browser workflow, desktop/375px Finance/payment inspection and the four-job hosted Verify matrix pass. The disposable database acceptance passes the 4.11 payment SQL, browser, Workflow, Realtime and race checks; its pre-existing realtime protocol check was corrected for a hosted queue backlog and its final run is recorded in the tracker. Owned live-Drive, retained-state-safe staging checks and the three new human groups remain pending. Its detailed scope and human walkthrough are in the active step 4 guide. This does not complete step 4 or authorize staging, merge or production.

- [ ] **5. Complete reliable document and AI integrations.**
  Done when the remaining broader docume
  nt/project-folder features and optional AI integrations work, building on the protected uploads, required folder operations and archive jobs verified with step 4 workflows. Verify correct files, recovery from failures, protected browsing and human review of AI results.

- [ ] **6. Convert the UI to Tailwind.**
  Done when the agreed screens use Tailwind/shared tokens and pass responsive, accessibility and workflow checks.

- [ ] **7. Verify staging, backups, monitoring and staff acceptance.**
  Done when release blockers are resolved and staging, restore, monitoring and staff-acceptance evidence is recorded, including real invitation/recovery email delivery from a verified sender and company-owned production services.

## Keeping This Updated

- Read this checklist before planning or completing foundation and migration milestones.
- Use agreed milestone completion conditions and maintained verification tooling. Keep active units, blockers, next actions and detailed evidence in the tracker.
- Check an item only after its completion condition is verified. Add the completion date and a short evidence note under it; link to the tracker's detailed result when useful.
- Keep active work, blockers, open questions and detailed verification in the [progress tracker](progress-tracker.md). An unchecked item may be planned, active or blocked; the tracker explains which.
- Add future steps when their scope is agreed. Tailwind is a separate track after the foundations, not a prerequisite for authentication or shared data.

This checklist records progress; it does not authorize Git publication, migrations or deployment. Follow the [AI workflow rules](ai-workflow-rules.md) and [architecture](architecture.md) when carrying out a step.
