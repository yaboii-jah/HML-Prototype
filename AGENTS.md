<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project workflow

Start every task by reading these instructions and the current phase, goal, in-progress work and next action in the [progress tracker](docs/progress-tracker.md). Reconcile them with Git and the latest user instruction; preserve unrelated pending work.

Read other context by task, using headings/search to select relevant sections:

- [Project overview](docs/project-overview.md): product scope, workflows, responsibilities and acceptance criteria affected by the task.
- [Architecture](docs/architecture.md): affected system contracts, access/storage boundaries and invariants.
- [AI workflow rules](docs/ai-workflow-rules.md): execution, documentation and verification policy when planning or changing the project.
- [Code standards](docs/code-standards.md): applicable conventions before writing code.
- [Production checklist](docs/checklist.md): the relevant milestone and completion conditions for foundation/migration work.
- [Step 4 guide](docs/step-4-implementation.md): roadmap/dependencies, the current unit and completion criteria for step 4 work. Read completed units only when their contracts affect the task.

Reuse unchanged context within a session. On resumption, refresh current status and any relevant sections whose contents are missing or changed; do not reread every document by default. Distinguish production targets from implemented behavior.

Complete authorized work through the required acceptance gates. Use focused checks while iterating, concise successful results and matching existing evidence where permitted. Do not repeat passing checks without a relevant change or unresolved failure. Diagnose an unrelated failure once; report the blocker and seek scope expansion before substantial unrelated repairs. Never claim blocked acceptance passed.

Before completion, update only documents whose claims changed and record meaningful decisions/results in the tracker. Keep final dates, source revisions, evidence links and unresolved limitations concise; use Git for superseded narratives instead of appending transcripts. Check milestones only after verification, with date/evidence. Report changed documents and checks run. The workflow rules own detailed responsibilities.
