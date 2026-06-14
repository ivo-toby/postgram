---
id: TASK-003-ui-bulk-archive-api-client
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-002-cleanup-basket-foundation
wave: WAVE-001
slug: ui-bulk-archive-api-client
title: UI Bulk Archive API Client
status: done
depends_on: []
conflict_domains:
  - ui/src/lib/api.ts
  - ui/src/lib/api.test.ts
  - ui/src/lib/types.ts
assigned_model_class: implementationSimple
review_model_class: review
branch: codex/task/TASK-003-ui-bulk-archive-api-client
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-003-ui-bulk-archive-api-client
worktree_status: verified
pr: local-merge:a593403
worker_thread_id: 019ec5db-dc95-7521-9ad5-873cb2398c2c
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm --prefix ui run test -- --run src/lib/api.test.ts
  - npm --prefix ui run typecheck
---

# TASK-003-ui-bulk-archive-api-client: UI Bulk Archive API Client

## Status

done

## Parent Ticket

TICKET-002-cleanup-basket-foundation

## Wave

WAVE-001

## Objective

Add a typed `bulkArchiveEntities(ids)` helper to the UI API client and cover the
request shape in `ui/src/lib/api.test.ts`.

## Scope

- Included:
  - API response/request types if useful.
  - `createApiClient().bulkArchiveEntities(ids)`.
  - Test proving URL, method, headers, and JSON body.
- Excluded:
  - Backend route implementation.
  - Basket state or SearchPage UI.

## Non-Scope

- Do not add UI retry or drawer behavior in this task.

## Relevant Context

### Local Context

- `ui/src/lib/api.ts`
- `ui/src/lib/api.test.ts`
- `ui/src/lib/types.ts`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/api-contract.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`

## Likely Files / Areas

- `ui/src/lib/api.ts`
- `ui/src/lib/api.test.ts`
- `ui/src/lib/types.ts`

## Dependencies

- None.

## Conflict Domains

- `ui/src/lib/api.ts`
- `ui/src/lib/api.test.ts`

## Assigned Model Class

implementationSimple

## Branch

codex/task/TASK-003-ui-bulk-archive-api-client

## Worker Worktree

Assigned path:
`/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-003-ui-bulk-archive-api-client`

Status: verified.

Worker: Singer (`019ec5db-dc95-7521-9ad5-873cb2398c2c`).

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing API client test for `bulkArchiveEntities`.

### GREEN

Add the API helper and any local types needed to satisfy the test.

### REFACTOR

Keep payload types small and local unless shared UI types clearly reduce
duplication.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record response-shape deviations only if they affect later tasks.

## Task-Level Definition of Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] No unresolved P1/P2 review findings remain.
- [x] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm --prefix ui run test -- --run src/lib/api.test.ts`
- Focused UI package command used in this checkout:
  `npm --prefix ui run test -- --run src/lib/api.test.ts`

## Verification Evidence

- RED: `npm --prefix ui run test -- --run src/lib/api.test.ts` failed as
  expected before implementation with
  `TypeError: client.bulkArchiveEntities is not a function` at
  `ui/src/lib/api.test.ts:116`.
- GREEN: `npm --prefix ui run test -- --run src/lib/api.test.ts` passed after
  implementation: 1 test file passed, 8 tests passed.
- Typecheck: `npm --prefix ui run typecheck` passed with `tsc --noEmit`.
- Expected WDD command concern:
  `npm --prefix ui run test -- --run src/lib/api.test.ts` exits before
  running tests with `npm error No workspaces found: --workspace=ui` because
  root `package.json` workspaces do not include `ui`.
- Controller review: no P1/P2 findings.
- Controller verification after merge: `npm --prefix ui run test -- --run
  src/lib/api.test.ts src/hooks/useCleanupBasket.test.ts` passed on
  `codex/epic/search-cleanup-basket` at `a593403`: 2 test files, 16 tests.
- Controller verification after merge: `npm --prefix ui run typecheck` passed.
- Merge: task branch merged into epic branch in local merge commit `a593403`.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added `createApiClient().bulkArchiveEntities(ids)` using
  `POST /api/entities/bulk/archive` with JSON body `{ ids }`.
- Added exported `BulkArchiveEntitiesResponse` in `ui/src/lib/api.ts` matching
  the shared archived/failed response contract.
- Added API client coverage for URL, method, authorization header,
  content-type header, JSON body, and returned archived/failed payload.
- Shared-context update needed: none for the API contract. Controller may want
  to reconcile the task validation command because `ui` is not an npm
  workspace in this checkout.
- Final gate: merged into `codex/epic/search-cleanup-basket`.
