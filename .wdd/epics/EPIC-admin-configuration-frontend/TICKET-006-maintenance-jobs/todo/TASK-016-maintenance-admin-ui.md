---
id: TASK-016-maintenance-admin-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-006-maintenance-jobs
wave: WAVE-009
slug: maintenance-admin-ui
title: Maintenance Admin UI
status: todo
depends_on:
  - TASK-011-admin-auth-ui
  - TASK-015-maintenance-admin-api
conflict_domains:
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-016-maintenance-admin-ui
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm --prefix ui run test -- --run src/components/AdminMaintenance.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-016-maintenance-admin-ui: Maintenance Admin UI

## Status

todo

## Parent Ticket

TICKET-006-maintenance-jobs

## Wave

WAVE-009

## Objective

Add admin UI for approved maintenance dry-run, apply, confirmation, progress,
and result review flows.

## Scope

- Included:
  - Maintenance page for approved graph/memory/embedding/extraction operations.
  - Scope controls, dry-run preview, danger summary, step-up prompt, apply, job
    progress, and result/failure display.
  - Tests for confirmation and partial failure states.
- Excluded:
  - Unapproved commands and raw SQL.

## Non-Scope

- Do not make destructive actions one-click from the dashboard.

## Relevant Context

### Local Context

- `ui/src/components/admin/*`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/CleanupBasketDrawer.tsx`
- `ui/src/components/tasks/BulkActionBar.tsx`

### Shared Context References

- `../../shared-context/resources/admin-surface-inventory.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `ui/src/components/admin/AdminMaintenance.tsx`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/AdminMaintenance.test.tsx`

## Dependencies

- TASK-011-admin-auth-ui
- TASK-015-maintenance-admin-api

## Conflict Domains

- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-016-maintenance-admin-ui

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add UI tests for dry-run, confirmation disabled until preview, step-up prompt,
job progress, completion, and failure retention.

### GREEN

Implement maintenance UI components against admin API client.

### REFACTOR

Share confirmation/progress components with config UI if useful.

## Implementation Notes

- Keep dangerous actions visually distinct but not theatrical.
- Preserve dense operational layout for repeated use.

## Durable Memory Notes To Consider

- Record durable memory if maintenance UI establishes stable guardrail patterns.

## Task-Level Definition of Done

- [ ] Maintenance UI covers approved operations.
- [ ] Dry-run before apply is enforced in UI.
- [ ] Step-up and job progress states are handled.
- [ ] UI typecheck passes.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/AdminMaintenance.test.tsx`
- `npm --prefix ui run typecheck`

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
