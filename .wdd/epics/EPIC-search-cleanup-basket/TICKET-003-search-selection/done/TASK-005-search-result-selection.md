---
id: TASK-005-search-result-selection
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-003-search-selection
wave: WAVE-002
slug: search-result-selection
title: Search Result Selection
status: done
depends_on:
  - TASK-004-cleanup-basket-state
conflict_domains:
  - ui/src/components/SearchPage.tsx
  - ui/src/components/SearchPage.test.tsx
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-005-search-result-selection
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-005-search-result-selection
worktree_status: verified
pr: local-merge:0f1c3f1
worker_thread_id: 019ec61b-5ecc-7293-be12-93dfe9846204
review_thread_id: 019ec627-2295-7f23-8dd0-eb5e5dcdb3ad
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm --prefix ui run test -- --run src/components/SearchPage.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-005-search-result-selection: Search Result Selection

## Status

done

## Parent Ticket

TICKET-003-search-selection

## Wave

WAVE-002

## Objective

Add checkbox selection, select-all-loaded, shift-click visible range selection,
and an add-to-basket action bar to Search results while preserving normal
detail navigation.

## Scope

- Included:
  - Result card checkbox UI.
  - Selected IDs and last-selection-anchor state.
  - Shift-click visible range selection.
  - Select-all-loaded behavior.
  - Add selected snapshots to cleanup basket.
  - Clear current selection.
  - Tests for click behavior and selection flows.
- Excluded:
  - Review drawer.
  - Final archive mutation.
  - Backend/API work.

## Non-Scope

- Do not make card body clicks toggle selection.
- Do not add query-level archive controls.

## Relevant Context

### Local Context

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/TasksPage.tsx`
- `ui/src/components/tasks/BulkActionBar.tsx`
- `ui/src/components/TasksPage.test.tsx`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`

## Likely Files / Areas

- `ui/src/components/SearchPage.tsx`
- `ui/src/components/SearchPage.test.tsx`
- Optional focused component/helper files for selection bar or selection logic.

## Dependencies

- `TASK-004-cleanup-basket-state`

Dependency status:

- `TASK-004-cleanup-basket-state` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `a593403`.
- Use `useCleanupBasket`, `createCleanupBasketItem`, and related basket state
  helpers from `ui/src/hooks/useCleanupBasket.ts`.

## Conflict Domains

- `ui/src/components/SearchPage.tsx`
- Search result card UI and state

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-005-search-result-selection

## Worker Worktree

/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-005-search-result-selection

Status: verified by controller.

Worker: Erdos (`019ec61b-5ecc-7293-be12-93dfe9846204`).

## PR / Patch Reference

local-merge:0f1c3f1

## RED-GREEN TDD Plan

### RED

Add failing UI tests for checkbox toggling without opening detail, card body
opening detail, shift-click range selection, select-all-loaded, and add
selected to basket.

### GREEN

Wire SearchPage selection state to ResultCard checkboxes and the basket hook,
using current visible result order for ranges.

### REFACTOR

Extract a selection helper or action bar component if it keeps SearchPage
readable.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record any final shift-click anchor behavior if it differs from current
  planning assumptions.

## Task-Level Definition of Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] No unresolved P1/P2 review findings remain.
- [x] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
- `npm --prefix ui run typecheck`

## Verification Evidence

- Setup: initial `npm --prefix ui run test -- --run
  src/components/SearchPage.test.tsx` could not start because UI dependencies
  were not installed in this task worktree (`vitest: command not found`);
  `npm --prefix ui ci` completed successfully from the existing lockfile.
- RED harness fix: first test run after dependency install failed before
  behavior assertions because this Node/jsdom environment did not provide
  `window.localStorage`; the SearchPage test now installs localStorage like
  existing hook tests.
- RED: `npm --prefix ui run test -- --run
  src/components/SearchPage.test.tsx` then failed as expected with 5 behavior
  failures for missing result checkboxes, card-body detail target, select-all
  loaded, and add-to-basket controls.
- GREEN: `npm --prefix ui run test -- --run
  src/components/SearchPage.test.tsx` passed: 1 test file, 5 tests.
- GREEN: `npm --prefix ui run typecheck` passed with `tsc --noEmit`.
- Final validation: `npm --prefix ui run test -- --run
  src/components/SearchPage.test.tsx` passed: 1 test file, 5 tests.
- Final validation: `npm --prefix ui run typecheck` passed with
  `tsc --noEmit`.
- Final validation: `git diff --check` passed.
- Reviewer Anscombe (`019ec627-2295-7f23-8dd0-eb5e5dcdb3ad`) returned
  `REVIEW_PASS` with no P1/P2/P3 findings.
- Controller merged branch `codex/task/TASK-005-search-result-selection`
  into `codex/epic/search-cleanup-basket` in `0f1c3f1`.
- Controller merged-branch verification passed:
  `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
  (5 tests), `npm --prefix ui run typecheck`, `npm run typecheck`, and
  `git diff --check HEAD~2..HEAD`.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added SearchPage result checkbox selection with separate card-body detail
  navigation.
- Added visible-order shift-click range selection and select-all-loaded for the
  currently loaded visible result list.
- Wired selected result snapshots into the existing `useCleanupBasket` hook via
  the active API key stored under `pgm_api_key`.
- Added a compact selected-count action bar with select-all-loaded,
  add-selected-to-basket, clear-selection, and basket-count feedback.
- Added focused SearchPage component tests covering required selection flows.
- Shared-context update needed: none. Anchor behavior matches planning:
  shift-click uses the prior visible selection anchor and applies the clicked
  checkbox's checked state across the visible range.
- Final gate: ready for controller review.
- Final status: merged and done.
