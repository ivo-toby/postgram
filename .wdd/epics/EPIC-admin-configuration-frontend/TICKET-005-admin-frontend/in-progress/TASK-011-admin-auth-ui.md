---
id: TASK-011-admin-auth-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-005-admin-frontend
wave: WAVE-007
slug: admin-auth-ui
title: Admin Auth UI
status: in_progress
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
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-011-admin-auth-ui
worktree_status: active_uncommitted
pr: null
worker_thread_id: 019f37c5-29ec-7ec3-b6fd-6aba64df3dc9
review_thread_id: null
current_gate: no_pr
branch_freshness: behind_epic_controller_checkpoint
verification:
  - npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-011-admin-auth-ui: Admin Auth UI

## Status

in_progress

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

Active at `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-011-admin-auth-ui`.

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
- Use the WAVE-003 route contract:
  `/admin/api/bootstrap/status`, `/admin/api/bootstrap/setup`,
  `/admin/api/session/login`, `/admin/api/session/current`,
  `/admin/api/session/csrf`, and `/admin/api/session/logout`.
- Use the WAVE-004 MFA route contract:
  `/admin/api/session/mfa/enroll`, `/admin/api/session/mfa/verify`,
  `/admin/api/session/mfa/challenge`, and `/admin/api/session/step-up`.
- Treat bootstrap setup and login responses that return `state: "mfa_required"`
  as pending-MFA state; full admin navigation should wait for the TASK-006
  active/MFA session signal. A successful MFA verify/challenge/step-up response
  includes `user`, `session`, and `stepUp` state.
- Send `X-CSRF-Token` on unsafe admin requests after obtaining it from setup,
  login, or `/admin/api/session/csrf`.
- UI tests should prove no admin session token, bootstrap token, TOTP seed,
  `otpauthUrl`, provider secret, or admin bearer credential is written to
  localStorage.
- Display the enrollment secret/QR setup state only during MFA enrollment; do
  not persist it after the verify flow advances.
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

- 2026-07-06T14:11:59Z: Branch/worktree setup verified at activation base
  `848b902`; worker Meitner
  (`019f37c5-29ec-7ec3-b6fd-6aba64df3dc9`) dispatched. Task implementation
  verification has not run yet.
- 2026-07-06T14:29:25Z: Meitner was still running with no PR or patch. The
  worktree has active uncommitted changes in expected frontend auth files:
  `ui/src/App.tsx`, `ui/src/components/TopBar.tsx`,
  `ui/src/components/AdminAuth.test.tsx`,
  `ui/src/components/admin/AdminAuth.tsx`, `ui/src/lib/adminApi.ts`,
  `ui/nginx.conf`, and `ui/vite.config.ts`. Tracked `git diff --check`
  passed; the branch is one controller checkpoint behind the epic branch and
  must refresh before review or merge.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.
