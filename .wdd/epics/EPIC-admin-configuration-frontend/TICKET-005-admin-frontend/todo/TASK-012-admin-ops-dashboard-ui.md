---
id: TASK-012-admin-ops-dashboard-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-005-admin-frontend
wave: WAVE-008
slug: admin-ops-dashboard-ui
title: Admin Ops Dashboard UI
status: todo
depends_on:
  - TASK-008-admin-key-audit-stats-api
  - TASK-011-admin-auth-ui
conflict_domains:
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-012-admin-ops-dashboard-ui
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm --prefix ui run test -- --run src/components/AdminOps.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-012-admin-ops-dashboard-ui: Admin Ops Dashboard UI

## Status

todo

## Parent Ticket

TICKET-005-admin-frontend

## Wave

WAVE-008

## Objective

Add admin dashboard pages for API-key management, audit logs, stats, health,
queue, and read-only model status.

## Scope

- Included:
  - Admin dashboard layout inside protected shell.
  - API-key list/create/revoke UI with one-time key display.
  - Audit log filters and table.
  - Stats, health, queue, and model summary panels.
  - Tests for success, errors, redaction, and step-up prompts.
- Excluded:
  - Runtime configuration edit UI.
  - Maintenance job UI.

## Non-Scope

- Do not display key hashes or stored secrets.

## Relevant Context

### Local Context

- `ui/src/lib/api.ts`
- `ui/src/components/TasksPage.tsx`
- `ui/src/components/StatusWidget.tsx`
- `ui/src/components/tasks/*`

### Shared Context References

- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `ui/src/lib/adminApi.ts`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminApiKeys.tsx`
- `ui/src/components/admin/AdminAudit.tsx`
- `ui/src/components/AdminOps.test.tsx`

## Dependencies

- TASK-008-admin-key-audit-stats-api
- TASK-011-admin-auth-ui

## Conflict Domains

- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-012-admin-ops-dashboard-ui

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add UI tests for dashboard loading, key create/revoke, one-time key display,
audit filters, and stats/health error states.

### GREEN

Implement dashboard components against admin API client.

### REFACTOR

Extract reusable dense table and confirmation patterns if they reduce
duplication.

## Implementation Notes

- Keep text within compact controls and avoid marketing-style layout.
- Key create/revoke should surface step-up requirement clearly.

## Durable Memory Notes To Consider

- Record durable memory only for stable UI/admin workflow conventions.

## Task-Level Definition of Done

- [ ] Dashboard pages are implemented and covered.
- [ ] Key plaintext appears only immediately after create.
- [ ] Audit/stats/queue states are usable.
- [ ] UI typecheck passes.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx`
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
