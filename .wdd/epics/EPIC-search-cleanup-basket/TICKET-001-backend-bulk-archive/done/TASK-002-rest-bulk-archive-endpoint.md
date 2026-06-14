---
id: TASK-002-rest-bulk-archive-endpoint
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-001-backend-bulk-archive
wave: WAVE-002
slug: rest-bulk-archive-endpoint
title: REST Bulk Archive Endpoint
status: done
depends_on:
  - TASK-001-bulk-archive-service
conflict_domains:
  - src/transport/rest.ts
  - tests/contract/rest-api.test.ts
  - src/services/entity-service.ts
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-002-rest-bulk-archive-endpoint
worker_worktree: /Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-002-rest-bulk-archive-endpoint
worktree_status: verified
pr: local-merge:47e4423
worker_thread_id: 019ec61b-5e6f-7e60-8cd9-79177615cae7
review_thread_id: 019ec624-e246-78a3-b8eb-c6c1073da2fe
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm test -- tests/contract/rest-api.test.ts
---

# TASK-002-rest-bulk-archive-endpoint: REST Bulk Archive Endpoint

## Status

done

## Parent Ticket

TICKET-001-backend-bulk-archive

## Wave

WAVE-002

## Objective

Expose `POST /api/entities/bulk/archive` with request validation, delete-scope
authorization, and mixed archived/failed response payloads.

## Scope

- Included:
  - Zod schema for `{ ids: uuid[] }`.
  - Max batch size 500.
  - Route registration in `src/transport/rest.ts`.
  - Contract tests for validation, auth/delete scope, and partial result shape.
- Excluded:
  - Service implementation beyond consuming `bulkArchiveEntities`.
  - UI API client.
  - MCP/CLI bulk archive.

## Non-Scope

- Do not add query-based archive or hard delete endpoints.

## Relevant Context

### Local Context

- `src/transport/rest.ts`
- `src/services/entity-service.ts`
- `tests/contract/rest-api.test.ts`
- `src/auth/key-service.ts`
- `src/util/errors.ts`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/api-contract.md`
- `../../shared-context/resources/discovered-conventions.md`
- `../../shared-context/resources/testing-strategy.md`

## Likely Files / Areas

- `src/transport/rest.ts`
- `tests/contract/rest-api.test.ts`

## Dependencies

- `TASK-001-bulk-archive-service`

Dependency status:

- `TASK-001-bulk-archive-service` is done and merged into
  `codex/epic/search-cleanup-basket` in local merge commit `a593403`.
- Use the exported `bulkArchiveEntities` service API from
  `src/services/entity-service.ts`.

## Conflict Domains

- `src/transport/rest.ts`
- `tests/contract/rest-api.test.ts`
- REST entity endpoint contract

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-002-rest-bulk-archive-endpoint

## Worker Worktree

/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-002-rest-bulk-archive-endpoint

Status: verified by controller.

Worker: Curie (`019ec61b-5e6f-7e60-8cd9-79177615cae7`).

## PR / Patch Reference

local-merge:47e4423

## RED-GREEN TDD Plan

### RED

Add failing REST contract tests for body validation, max IDs, delete scope, and
mixed archived/failed response.

### GREEN

Import the service, add schema and route, call `bulkArchiveEntities`, and return
the service payload.

### REFACTOR

Keep validation constants close to existing REST schemas; reuse existing UUID
regex convention.

## Implementation Notes

- Worker must inspect named files before broad discovery.
- Worker must start in the assigned worktree path provided by the controller.
- Worker must confirm this task file and current orchestration state exist in
  the assigned worktree before editing.
- Worker must not switch branches in the controller checkout.
- Worker must stay within this task scope.
- Worker must not start dependent tasks.

## Durable Memory Notes To Consider

- Record any final response-shape deviation in shared context.

## Task-Level Definition of Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] No unresolved P1/P2 review findings remain.
- [x] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm test -- tests/contract/rest-api.test.ts`

## Verification Evidence

- RED: `npm test -- tests/contract/rest-api.test.ts` failed with 5 expected
  missing-route assertions for `POST /api/entities/bulk/archive` returning
  `404` before implementation; 17 existing tests passed.
- GREEN: `npm test -- tests/contract/rest-api.test.ts` passed with 22 tests.
- `npm run typecheck` passed.
- `git diff --check` passed after moving this task file to `review/`.
- Reviewer Banach (`019ec624-e246-78a3-b8eb-c6c1073da2fe`) returned
  `REVIEW_PASS` with no P1/P2/P3 findings.
- Controller merged branch `codex/task/TASK-002-rest-bulk-archive-endpoint`
  into `codex/epic/search-cleanup-basket` in `47e4423`.
- Controller merged-branch verification passed:
  `npm test -- tests/contract/rest-api.test.ts` (22 tests),
  `npm run typecheck`, and `git diff --check HEAD~2..HEAD`.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added `POST /api/entities/bulk/archive` REST validation and route wiring in
  `src/transport/rest.ts`, consuming the existing `bulkArchiveEntities`
  service.
- Added REST contract coverage for invalid body shapes, UUID validation,
  max-500 IDs, auth/delete-scope behavior, and mixed archived/failed payloads.
- No shared-context contract updates are needed; implementation matches the
  existing explicit-ID archive contract.
- Final status: merged and done.
