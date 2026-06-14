---
id: TASK-002-rest-bulk-archive-endpoint
kind: task
epic: EPIC-search-cleanup-basket
ticket: TICKET-001-backend-bulk-archive
wave: WAVE-002
slug: rest-bulk-archive-endpoint
title: REST Bulk Archive Endpoint
status: todo
depends_on:
  - TASK-001-bulk-archive-service
conflict_domains:
  - src/transport/rest.ts
  - tests/contract/rest-api.test.ts
  - src/services/entity-service.ts
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-002-rest-bulk-archive-endpoint
worker_worktree: null
worktree_status: unassigned
pr: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/contract/rest-api.test.ts
---

# TASK-002-rest-bulk-archive-endpoint: REST Bulk Archive Endpoint

## Status

todo

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

## Conflict Domains

- `src/transport/rest.ts`
- `tests/contract/rest-api.test.ts`
- REST entity endpoint contract

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-002-rest-bulk-archive-endpoint

## Worker Worktree

None assigned yet. The controller must create or verify an isolated worktree for
this task before dispatching a repository-writing worker, then provide that path
to the worker.

## PR / Patch Reference

None yet.

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

- [ ] Objective is complete.
- [ ] Verification evidence is recorded.
- [ ] No unresolved P1/P2 review findings remain.
- [ ] Shared-context updates, if any, are proposed for controller reconciliation.

## Validation Steps

- `npm test -- tests/contract/rest-api.test.ts`

## Verification Evidence

- Not run yet.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.
