# Batch 2: Goods, Services and scope budgets

Client requirements **7, 8 and 9** from the main meeting notes. This follows [the batch roadmap](CLIENT_REQUIREMENTS_BATCH_PLAN.md).

## Confirmed decisions

- Administrator alone creates and edits project scopes and their allocations.
- Scope allocations divide the existing project budget; the overall allocation remains a cap.
- An MRF selects one funded scope. Its unpriced request checks remaining funds without reserving them; Accounting checks the actual PO payable against both budgets.
- The presenter will manually clear existing walkthrough records before fresh scope setup.

## Implemented behavior

- Administration manages stable scope IDs, unique project-scoped names and PHP allocations. Allocations cannot exceed the project cap or fall below existing scope commitment/spending; meaningful changes retain named audit records.
- The three-step MRF form selects Scope of work in Step 1 and shows it in review/detail views. Project changes and AI imports clear selection. Incomplete drafts remain allowed; full corrections can change scope before purchasing, while document-only corrections preserve it.
- Project and Accounting pages show scope balances. Approval uses the existing net payable and current balances, covering Services as well as Goods. Payment transfers commitment to spending without reducing available funds again.
- Materials/offers are Goods. Shipping and other non-material fees are Services; taxes and discounts remain financial adjustments. Existing tax, comparison, print and inventory behavior remains intact.
- V12 workspaces without scope metadata remain readable with empty scopes and explicit unassigned requests. New submissions/PO approvals require a valid scope; existing approved/released workflows continue. No existing records are automatically assigned or cleared.

## Verification

Completed October 7, 2026. All 112 automated tests, ESLint, TypeScript checks, production build and both browser walkthroughs passed. Checks covered allocation caps/permissions, exhausted scopes, competing approvals, service fees, partial payments, corrections, named audit reloads and unscoped v12 loading. Browser checks exercised scope setup and limits, read-only department access, manual scope selection after AI import, project changes, split POs, upfront/credit workflows and the existing comparison/archive/receiving paths. Scope forms and tables passed viewport/contrast checks in both themes; desktop/mobile screenshots were inspected.

Later batches and deferred requirements remain separate.
