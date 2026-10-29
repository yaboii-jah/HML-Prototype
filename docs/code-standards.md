# Code Standards

These standards apply to new or substantially changed code. Improve the affected code within the authorized scope and keep unrelated cleanup separate. They describe the production target; existing code may need scoped migration work before it complies. Use [AI workflow rules](ai-workflow-rules.md) for planning and verification, and [architecture context](architecture.md) for system boundaries and invariants.

## General

- Give each module and component a clear responsibility. Separate unrelated concerns while keeping the code for one coherent behavior easy to follow.
- Use descriptive names and readable multiline formatting for functions, control flow and JSX. Avoid introducing compressed one-line components or multi-step statements that obscure behavior.
- Fix the cause of a problem rather than adding overlapping workarounds. Reuse established helpers where responsibilities match; keep purpose-specific business validation explicit.
- Prefer straightforward code and early returns over deeply nested conditions or speculative abstractions. Extract a helper when it gives a meaningful responsibility a name or centralizes a rule.
- Preserve existing behavior and contracts outside the requested change. Treat changes to business rules as product decisions, not incidental refactoring.
- Use semantic elements, accessible labels and keyboard-operable controls. Make loading, empty, error and retry states understandable to the person using the app.
- Follow the existing lint and compiler configuration. A suppression or exception needs a specific reason; weakening checks is not a substitute for correcting the code.

## TypeScript

- Keep strict mode enabled. Use TypeScript for application modules and TSX for modules containing JSX; retain the appropriate JavaScript module format for existing Node scripts and tests.
- Keep server code and verification tooling compatible with the Node 24 production baseline even when developing on Node 26. Node type definitions follow version 24; verify both supported runtimes in CI before relying on a newer API.
- Prefer precise types, discriminated unions and explicit optional fields. Use `unknown` for untrusted data and narrow it before use rather than introducing `any`.
- Validate external inputs at system boundaries, including requests, provider responses and persisted browser data. A cast after `JSON.parse` or `response.json()` does not validate the value.
- Use runtime checks or existing validators to establish the required shape and business constraints before treating input as a domain value. Reuse validation where contracts match; do not add a new schema library solely to satisfy this document.
- Limit assertions and non-null assertions to cases supported by a checked invariant. `as const` and other legitimate type refinements are allowed; assertions must not hide missing validation or incorrect types.
- Preserve the distinction between missing, invalid and valid values. Avoid silent defaults when they would change a financial, quantity, access or workflow decision.

## Next.js

- Follow the relevant guides shipped with the installed Next.js version before changing framework behavior. Retain required Next.js file conventions and heed deprecation guidance.
- Default pages and layouts to Server Components. Add `"use client"` at the boundary that needs state, event handlers, hooks or browser-only APIs, keeping that boundary as small as practical.
- Keep page adapters and route handlers focused on routing and orchestration. Put reusable business rules and provider operations in their responsible modules.
- Keep privileged database access, credentials and provider secrets on the server. Pass only the data needed by the client; navigation visibility is not authorization.
- Keep authoritative per-user reads fresh and isolated between users. Realtime refreshes must obtain current authorized data while preserving ordinary unsaved form state; shared caching must never reuse another user's permissions or view.
- Treat current browser-state-dependent screens as migration work. Move authoritative reads and mutations server-side in coherent, verified units rather than claiming a client-side permission check already meets the production target.
- Use effects to synchronize with external systems when needed; derive values directly from current data when no synchronization is required.

## Styling

- Use Tailwind CSS v4 and shared design tokens as the app UI target. The current custom CSS remains until the authorized styling migration replaces it; the presence of installed Tailwind packages does not mean that conversion is complete.
- Reuse the project's theme colors and established spacing and geometry choices. Define reusable values centrally instead of scattering new literal colors or arbitrary measurements through ordinary UI components.
- Prefer Tailwind utilities for component styling. Small custom CSS exceptions are allowed for a clear, justified need, such as a complex layout or print behavior; keep them scoped and avoid turning them into a parallel styling system.
- Keep global and theme rules centralized and support the existing light/dark behavior. Preserve responsive, focus and loading states when converting styles.
- Generated PDFs and spreadsheets have their own document layout requirements. They may use fixed measurements, fonts and brand colors needed for the approved output; app UI utility rules do not replace those document contracts.

## API Routes

- Parse and validate request input, record identifiers, permitted operations and upload bounds before using them. Reject invalid input with an appropriate HTTP status and actionable, non-sensitive error.
- For production operations, verify the authenticated user's current grants and record/project access before a protected read, mutation or costly provider call. Same-origin or configuration checks do not establish user identity or authorization.
- Read authoritative business records on the server instead of trusting client-supplied roles, financial values or record snapshots.
- Preserve each existing endpoint family's response contract. JSON errors normally use `{ error: string }` with an appropriate status; successful JSON bodies remain operation-specific, and PDFs, spreadsheets and streams retain their content type. A universal response envelope requires a separate contract change.
- Keep handlers thin and delegate reusable operations to the appropriate server module. Share transport and infrastructure where useful while retaining purpose-specific validation.
- Handle provider failures, timeouts and cancellation explicitly. Keep partial completion and retry behavior visible, and avoid exposing credentials or sensitive provider responses in errors or logs.

## Data and Storage

- Follow the storage ownership defined in [architecture context](architecture.md): Postgres owns authoritative business records and metadata, Google Drive owns permanent document files, and browser storage is limited to permitted drafts, preferences and caches in the production target.
- Store file references and archive status with their business records. A browser copy or an attempted upload is not a completed archive.
- Keep business calculations in shared domain functions. Validate quantities, amounts and dates using the agreed rules, and preserve approved rounding and financial behavior. Unconfirmed company accounting policies remain questions rather than implementation assumptions.
- Protect related business updates with the transaction, concurrency and idempotency guarantees required by the architecture. Keep external provider calls outside database transactions.
- Preserve permanent actor identity and historical names/timestamps when normalizing stored values. Treat compatibility handling as an explicit boundary and verify that it does not reset records, widen access or duplicate effects.
- Keep large file bytes and secrets out of ordinary record and workflow payloads. Never place private business documents in `public/` merely to make them accessible.
- Edit commands carry an expected record version; reject stale saves with an actionable conflict instead of silently replacing newer data. Use stable retry identities for operations that can create duplicate effects, and apply related business/audit changes atomically.

## File Organization

Follow the current structure and migration responsibilities in [architecture context](architecture.md). Prefer these placement rules over creating a new top-level folder for each change:

- Keep Next.js route conventions under `app/`, feature-specific screens and interaction code under `src/features/`, and reusable UI under `src/components/`.
- Put pure business rules and calculations in `src/domain/`, and privileged data access, document generation and provider integration code in `src/server/`. Avoid browser, framework or provider I/O in pure domain functions.
- Group migrated business areas within these existing layers (Option A): `src/features/<area>/` owns screens and forms, `src/domain/<area>/` owns pure types/rules, and `src/server/<area>/` owns authorized queries/commands. Start with accounts and projects; organize other areas as their workflows migrate.
- Give callers a focused interface: queries return only permitted view data and commands describe explicit record operations. Separate session/UI projections from business records and retire migrated dependencies on the global demo snapshot and command dispatcher. Keep server-only implementations out of browser import graphs.
- Use `src/app-state/` for client interaction/session projections and `src/documents/` for browser document helpers. The prototype repository must not become the production data authority.
- Keep synthetic datasets and test helpers isolated under `tests/`; keep maintained verification tooling under `scripts/`. Generate outputs in their designated ignored locations.
- Use PascalCase for component files and descriptive kebab-case names for non-component modules. Prefer named exports for reusable modules while retaining framework-required default exports.
- Preserve runtime-compatible imports. Use the configured `@/src/...` alias where the Next.js bundler supports it; retain relative imports with `.ts` extensions in modules loaded directly by Node's TypeScript stripping. Do not impose aliases or extension removal across those execution boundaries.
