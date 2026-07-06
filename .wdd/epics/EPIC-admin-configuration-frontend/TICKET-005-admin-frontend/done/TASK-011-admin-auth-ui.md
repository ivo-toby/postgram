---
id: TASK-011-admin-auth-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-005-admin-frontend
wave: WAVE-007
slug: admin-auth-ui
title: Admin Auth UI
status: done
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
worktree_status: cleanup_deferred
pr: https://github.com/ivo-toby/postgram/pull/87
worker_thread_id: 019f37c5-29ec-7ec3-b6fd-6aba64df3dc9
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-011-admin-auth-ui: Admin Auth UI

## Status

done

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

Cleanup deferred at `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-011-admin-auth-ui`
until the epic branch push confirms PR #87 is merged.

## PR / Patch Reference

https://github.com/ivo-toby/postgram/pull/87

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

- [x] Admin auth UI works against the admin session API.
- [x] Route protection is covered.
- [x] No admin secret is stored in localStorage.
- [x] UI typecheck passes.

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
- 2026-07-06T14:44:25Z: Meitner was still running with no PR or patch. The
  worktree has active uncommitted changes in the same expected frontend auth
  areas, with current-tick edits to `ui/src/App.tsx`,
  `ui/src/components/AdminAuth.test.tsx`, and
  `ui/src/components/admin/AdminAuth.tsx`. Tracked `git diff --check` passed;
  the branch is two controller checkpoints behind the epic branch and must
  refresh before review or merge.
- 2026-07-06T14:59:25Z: Meitner was still running with no PR or patch. The
  worktree remains active/uncommitted with current-tick edits to
  `ui/src/App.tsx` and `ui/src/components/AdminAuth.test.tsx`. Tracked
  `git diff --check` passed; the branch is three controller checkpoints behind
  the epic branch and must refresh before review or merge.
- 2026-07-06T15:14:25Z: Meitner was still running with no PR or patch. The
  worktree remains active/uncommitted with current-tick edits to
  `ui/src/components/AdminAuth.test.tsx` and
  `ui/src/components/admin/AdminAuth.tsx`. Tracked `git diff --check` passed;
  the branch is four controller checkpoints behind the epic branch and must
  refresh before review or merge.
- 2026-07-06T15:20Z: Worker refreshed branch with
  `git fetch origin codex/epic/admin-configuration-frontend` and fast-forwarded
  through epic checkpoint `ce93519`; `git rev-list --left-right --count
  origin/codex/epic/admin-configuration-frontend...HEAD` returned `0 0`.
- 2026-07-06T15:20Z: `npm --prefix ui run test -- --run
  src/components/AdminAuth.test.tsx` passed with 16 tests.
- 2026-07-06T15:20Z: `npm --prefix ui run typecheck` passed.
- 2026-07-06T15:20Z: `git diff --check` passed.
- 2026-07-06T15:20Z: `codex review --uncommitted` reported no discrete
  correctness, security, or maintainability issues after the P2 MFA-error
  handling fix. The reviewer also ran the full UI test suite (`npm --prefix ui
  test`, 83 tests) and `npm --prefix ui run build`; build passed with the
  existing Vite large-chunk warning.
- 2026-07-06T15:23Z: Draft PR opened against
  `codex/epic/admin-configuration-frontend`:
  https://github.com/ivo-toby/postgram/pull/87.
- 2026-07-06T15:38:25Z: Lorentz returned `REVIEW_PASS` for PR #87 with no
  P1/P2/P3 findings. Review verified PR state OPEN/draft/CLEAN, branch
  freshness, diff check, merge-tree, focused AdminAuth tests, UI typecheck, and
  no localStorage persistence of admin bearer/session/bootstrap/TOTP/provider
  secrets.
- 2026-07-06T15:39Z: Controller refreshed the task branch against latest epic
  branch, reran focused AdminAuth tests, UI typecheck, branch diff check,
  merge-tree, and WDD orchestration JSON parse successfully, then merged
  TASK-011 locally into the epic branch.

## Review Feedback

### P1

- None.

### P2

- Resolved: Final review found that invalid MFA codes and expired sessions both
  use HTTP 401, so treating every 401 as an expired admin session bounced
  operators out of the MFA flow. Fixed by only clearing protected auth state for
  401 messages that identify an invalid or missing admin session, and by adding
  regression coverage for invalid enrollment and challenge codes.

### P3

- None.

## Completion Notes

- Added `ui/src/lib/adminApi.ts` as a cookie-session admin API client with
  in-memory CSRF handling, same-origin credentials, and no admin bearer
  authorization header.
- Added dense, restrained admin auth UI for bootstrap, login, MFA enrollment,
  MFA challenge, current-session hydration, logout, and a protected admin shell.
- Integrated `/admin` routing so the admin flow bypasses regular API-key login
  and regular bearer API polling; normal app navigation remains separate from
  admin route history.
- Added UI proxy wiring for `/admin/api` in Vite and nginx.
- Added focused tests proving route protection, pending-MFA gating, CSRF use,
  logout behavior, invalid MFA retry behavior, and no localStorage writes for
  admin session/bootstrap/TOTP/provider-secret/admin-bearer material.
