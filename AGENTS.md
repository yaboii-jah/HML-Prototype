<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project workflow

At the start of every project task, read all five core context documents before planning or making changes:

1. [Project overview](docs/project-overview.md): product scope, workflows and acceptance criteria.
2. [Architecture context](docs/architecture.md): boundaries, storage/access decisions and invariants.
3. [AI workflow rules](docs/ai-workflow-rules.md): scoping, execution and verification process.
4. [Code standards](docs/code-standards.md): implementation conventions.
5. [Progress tracker](docs/progress-tracker.md): current phase, goal, pending changes, open questions and verification history.

Read them again when resuming without their current contents or when the documentation has changed. Distinguish production targets from implemented behavior and preserve unrelated pending work.

Before completing a task, review its documentation impact and update affected documents in the same change. Update the tracker after meaningful changes or decisions. In the completion report, identify the documents updated or briefly explain why no update was necessary. Keep the five core documents and the agreed companion documents; follow the workflow rules for their detailed update responsibilities.

For foundation or migration milestone work, also read the companion [production checklist](docs/checklist.md) before planning or completing the unit. Update it as milestone progress changes; check a step only after verification, with its completion date and a brief evidence note. Keep active work, blockers and detailed evidence in the progress tracker.

When planning, implementing, reviewing or resuming checklist step 3, also read the [step 3 implementation guide](docs/step-3-implementation.md). It owns the agreed unit sequence and completion criteria. Before continuing, check the tracker for the active unit, blockers and next action; update unit checkboxes only after verification and keep detailed evidence in the tracker.
