---
id: TASK-011-admin-auth-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-005-admin-frontend
wave: WAVE-007
slug: admin-auth-ui
title: Admin Auth UI
status: todo
depends_on:
  - TASK-006-admin-mfa-step-up
conflict_domains:
  - ui/src/App.tsx
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-011-admin-auth-ui
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-011-admin-auth-ui: Admin Auth UI

## Status

todo

## Parent Ticket

TICKET-005-admin-frontend

## Wave

WAVE-007

## Objective

Add bootstrap, admin login, MFA, current-session, logout, and protected admin
shell UI.

## Scope

- Included:
  - Admin API client helpers for session/bootstrap/MFA.
  - UI flow for bootstrap according to selected posture.
  - Login and MFA challenge/enrollment screens.
  - Protected admin shell and navigation entry.
  - Tests for auth states and route protection.
- Excluded:
  - API-key management pages.
  - Runtime configuration forms.
  - Maintenance UI.

## Non-Scope

- Do not store admin session secrets in localStorage.

## Relevant Context

### Local Context

- `ui/src/App.tsx`
- `ui/src/components/LoginScreen.tsx`
- `ui/src/components/TopBar.tsx`
- `ui/src/lib/api.ts`
- `ui/src/components/LoginScreen.test.tsx`

### Shared Context References

- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `ui/src/lib/adminApi.ts`
- `ui/src/components/admin/*`
- `ui/src/App.tsx`
- `ui/src/components/TopBar.tsx`
- `ui/src/components/AdminAuth.test.tsx`

## Dependencies

- TASK-006-admin-mfa-step-up

## Conflict Domains

- `ui/src/App.tsx`
- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-011-admin-auth-ui

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add UI tests for bootstrap status, login, MFA challenge, protected admin route,
and logout.

### GREEN

Implement admin API client and admin auth components.

### REFACTOR

Keep admin auth UI separate from current API-key login.

## Implementation Notes

- Use cookie-based session semantics; client code should not handle admin bearer
  tokens.
- Keep operational UI dense and restrained.

## Durable Memory Notes To Consider

- Record durable memory if admin route structure becomes a stable UI
  convention.

## Task-Level Definition of Done

- [ ] Admin auth UI works against the admin session API.
- [ ] Route protection is covered.
- [ ] No admin secret is stored in localStorage.
- [ ] UI typecheck passes.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx`
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
