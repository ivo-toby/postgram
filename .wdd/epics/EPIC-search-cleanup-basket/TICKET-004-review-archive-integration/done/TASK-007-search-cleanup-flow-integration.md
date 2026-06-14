---
id: TASK-007-search-cleanup-flow-integration
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-004-review-archive-integration
wave: WAVE-004
slug: search-cleanup-flow-integration
title: Search Cleanup Flow Integration
status: done
depends_on:
  - TASK-002-rest-bulk-archive-endpoint
  - TASK-005-search-result-selection
  - TASK-006-cleanup-basket-review-drawer
conflict_domains:
  - ui/src/components/SearchPage.tsx
  - ui/src/components/SearchPage.test.tsx
  - ui/src/components/CleanupBasketDrawer.tsx
  - tests/contract/rest-api.test.ts
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-007-search-cleanup-flow-integration
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-007-search-cleanup-flow-integration
worktree_status: verified
pr: local-merge:b9cdcd0
worker_thread_id: 019ec642-e86e-7ed0-94bf-35d5d119d59e
review_thread_id: 019ec64d-4d91-76d1-a5a1-99e287c2cafd
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm --prefix ui run test -- --run src/components/SearchPage.test.tsx
  - npm --prefix ui run typecheck
  - npm test -- tests/contract/rest-api.test.ts
---

# TASK-007-search-cleanup-flow-integration: Search Cleanup Flow Integration

## Status

done

## Parent Ticket

TICKET-004-review-archive-integration

## Wave

WAVE-004

## Objective

Wire the complete Search cleanup basket flow together, update final tests, and
record manual/browser validation evidence.

## Scope

- Included:
  - Search header basket button/count.
  - Open/close review drawer from SearchPage.
  - Archive success removes archived IDs from visible results, fetched detail,
    current selection, and basket state.
  - Partial failures remain in basket.
  - Final focused tests across the integrated flow.
  - Manual/browser validation notes in task evidence.
- Excluded:
  - New backend semantics.
  - Hard delete.
  - Query-level archive.

## Non-Scope

- Do not add broad UI redesign beyond what is necessary to integrate the
  cleanup basket workflow.

## Relevant Context

### Local Context

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/CleanupBasketDrawer.tsx`
- `ui/src/hooks/useCleanupBasket.ts`
- `ui/src/lib/api.ts`
- `tests/contract/rest-api.test.ts`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/api-contract.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`
- `../../shared-context/resources/validation-strategy.md`

## Likely Files / Areas

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/SearchPage.test.tsx`
- `ui/src/components/CleanupBasketDrawer.tsx`
- validation evidence in this task file

## Dependencies

- `TASK-002-rest-bulk-archive-endpoint`
- `TASK-005-search-result-selection`
- `TASK-006-cleanup-basket-review-drawer`

Dependency status:

- `TASK-002-rest-bulk-archive-endpoint` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `47e4423`.
- `TASK-005-search-result-selection` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `0f1c3f1`.
- `TASK-006-cleanup-basket-review-drawer` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `04e4c52`.
- SearchPage selection already owns checkbox/select-all-loaded/shift-click and
  add-selected-to-basket behavior; final integration should preserve those
  interactions while adding the review drawer entry point and archive cleanup.
- Wire `CleanupBasketDrawer` by passing the existing `api` client,
  `useCleanupBasket.items`, `remove`, `clear`, `applyArchiveResult`, and
  `onClose`. The final integration task owns removing successfully archived IDs
  from visible SearchPage results, fetched detail, and current selection.

## Conflict Domains

- `ui/src/components/SearchPage.tsx`
- Search cleanup flow state
- final manual/browser validation

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-007-search-cleanup-flow-integration

## Worker Worktree

/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-007-search-cleanup-flow-integration

Status: verified by controller.

Worker: Feynman (`019ec642-e86e-7ed0-94bf-35d5d119d59e`).

## PR / Patch Reference

local-merge:b9cdcd0

## RED-GREEN TDD Plan

### RED

Add or extend failing SearchPage tests for full flow behavior: basket count,
drawer opening, successful archive cleanup, and partial failure retention.

### GREEN

Integrate selection, basket hook, drawer, and API client into SearchPage and
remove archived IDs through existing result-state helpers.

### REFACTOR

Keep SearchPage readable by extracting any final local helper/component that
has grown beyond a small inline role.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record final browser/manual validation findings if they affect future cleanup
  workflow work.
- Preserve archive-only language and retain failed basket items with messages
  after partial failures.

## Task-Level Definition of Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] No unresolved P1/P2 review findings remain.
- [x] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
- `npm --prefix ui run typecheck`
- `npm test -- tests/contract/rest-api.test.ts`
- Manual/browser validation from
  `../../shared-context/resources/validation-strategy.md`

## Verification Evidence

- RED:
  - `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
    failed after adding the TASK-007 integration tests, before production
    changes. Existing 5 tests passed; 3 new tests failed because SearchPage had
    no accessible `Open cleanup basket, N item(s)` header control and no drawer
    integration yet.
- GREEN / required automated validation:
  - `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
    passed: 1 file, 8 tests.
  - `npm --prefix ui run test -- --run src/components/CleanupBasketDrawer.test.tsx src/hooks/useCleanupBasket.test.ts src/lib/api.test.ts`
    passed: 3 files, 21 tests.
  - `npm --prefix ui run typecheck` passed.
  - `npm test -- tests/contract/rest-api.test.ts` passed: 1 file, 22 tests.
  - `git diff --check` passed.
- Browser/manual validation:
  - Started Vite at `http://127.0.0.1:5174/`, opened the app in the in-app
    browser, entered a placeholder local API key through the login screen, and
    verified the Search page rendered the header button
    `Open cleanup basket, 0 items`.
  - Verified the empty cleanup basket drawer opened and closed from the header
    button: dialog count 1 after open, close button count 1, dialog count 0
    after close.
  - Full data-backed select/add/review/archive browser validation was not run
    because no backend was running on `localhost:3100`; Vite reported expected
    proxy `ECONNREFUSED` for `/api/queue` and `/api/entities`. To run the full
    manual pass, the controller should provide a local backend, a delete-scoped
    API key, and disposable seed entities.
- Reviewer Gauss (`019ec64d-4d91-76d1-a5a1-99e287c2cafd`) returned
  `REVIEW_PASS` with no P1/P2/P3 findings.
- Controller merged branch `codex/task/TASK-007-search-cleanup-flow-integration`
  into `codex/epic/search-cleanup-basket` in `b9cdcd0`.
- Controller merged-branch verification passed:
  `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
  (8 tests),
  `npm --prefix ui run test -- --run src/components/CleanupBasketDrawer.test.tsx src/hooks/useCleanupBasket.test.ts src/lib/api.test.ts`
  (21 tests), `npm --prefix ui run typecheck`,
  `npm test -- tests/contract/rest-api.test.ts` (22 tests),
  `npm run typecheck`, and `git diff --check HEAD~1..HEAD`.
- Controller browser smoke passed at `http://127.0.0.1:5173/`: Search rendered
  `Open cleanup basket, 0 items`; the empty drawer opened, showed disabled
  clear/archive controls, closed successfully, and emitted no browser console
  errors. Full data-backed archive validation remains blocked by the missing
  local backend/API key/seed data noted above.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Integrated `CleanupBasketDrawer` into `SearchPage` using the existing API
  client and `useCleanupBasket` state/callback contract.
- Added a Search header cleanup basket button/count that opens the review
  drawer and preserves existing checkbox, select-all-loaded, shift-click, and
  add-selected-to-basket behavior.
- On archive responses, successful IDs leave the basket through
  `applyArchiveResult` and are removed from visible results, fetched detail,
  selected detail, current result selection, and selection anchor state.
- Partial archive failures remain in the basket with drawer-visible messages
  through the existing basket hook behavior.
- No hard-delete UI, query-level archive, backend semantics, REST contract, or
  UI API client contract changes were made.
- Shared-context update needed: none.
- Final status: merged and done.
