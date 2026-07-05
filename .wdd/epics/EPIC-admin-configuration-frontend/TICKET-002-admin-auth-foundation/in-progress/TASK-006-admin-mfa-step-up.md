---
id: TASK-006-admin-mfa-step-up
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-004
slug: admin-mfa-step-up
title: Admin MFA And Step-Up
status: in_progress
depends_on:
  - TASK-004-admin-auth-persistence
  - TASK-005-admin-session-routes
conflict_domains:
  - src/auth/**
  - src/transport/**
  - tests/contract/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-006-admin-mfa-step-up
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-006-admin-mfa-step-up
worktree_status: clean_local_unpushed
pr: https://github.com/ivo-toby/postgram/pull/82
worker_thread_id: 019f3333-4033-7463-9819-aa3dec286b4c
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: needs_fixes
branch_freshness: local_current_unpushed_requires_push
verification:
  - npm test -- tests/contract/admin-mfa-routes.test.ts
  - npm test -- tests/integration/admin-auth-service.test.ts
  - npm run typecheck
---

# TASK-006-admin-mfa-step-up: Admin MFA And Step-Up

## Status

in_progress

## Parent Ticket

TICKET-002-admin-auth-foundation

## Wave

WAVE-004

## Objective

Add TOTP MFA enrollment/challenge and step-up enforcement for sensitive admin
actions, including the first-admin transition from pending setup state to
active admin access.

## Scope

- Included:
  - TOTP enrollment, verification, disable/reset guardrails if in first scope.
  - Session state indicating MFA completion.
  - First-admin setup completion: verify MFA enrollment/challenge and atomically
    transition the TASK-004 pending first admin to active status.
  - Recent re-auth or step-up marker for sensitive actions.
  - Middleware/helper for endpoints requiring step-up.
  - Tests for bypass attempts and for the inactive/pending first admin before
    MFA completion.
- Excluded:
  - WebAuthn unless Wave 1 explicitly made it first scope.
  - UI screens.

## Non-Scope

- Do not allow production/admin posture without MFA unless Wave 1 records a
  deliberate exception.

## Relevant Context

### Local Context

- `src/auth/admin-service.ts`
- `src/db/migrations/010_admin_auth.sql`
- `src/transport/admin.ts`
- `tests/contract/admin-auth-routes.test.ts`
- `tests/integration/admin-auth-service.test.ts`

### Shared Context References

- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/auth/admin-mfa-service.ts`
- `src/auth/admin-middleware.ts`
- `src/transport/admin.ts`
- `tests/contract/admin-mfa-routes.test.ts`

## Dependencies

- TASK-004-admin-auth-persistence
- TASK-005-admin-session-routes

## Conflict Domains

- `src/auth/**`
- `src/transport/**`
- `tests/contract/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-006-admin-mfa-step-up

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-006-admin-mfa-step-up

Assigned by WAVE-004 activation. The controller must create and verify this
isolated worktree before dispatch.

Verified and dispatched at 2026-07-05T16:47:34Z with worker Tesla
(`019f3333-4033-7463-9819-aa3dec286b4c`) on branch
`codex/task/TASK-006-admin-mfa-step-up`.

## PR / Patch Reference

Draft PR #82: https://github.com/ivo-toby/postgram/pull/82

Review requested from Lorentz (`019f322c-02e7-7590-8b8e-ebdd1e9c52ac`) at
2026-07-05T17:32:34Z with submission
`019f3357-e7f4-7dd1-a1cf-afa9616d4a26`.

## RED-GREEN TDD Plan

### RED

Add tests for MFA enrollment, challenge failure/success, session before MFA,
pending first-admin denial before MFA completion, active first-admin transition
after verified MFA, step-up required on sensitive placeholder endpoint, and
replay/expired step-up.

### GREEN

Implement TOTP service, MFA routes, session updates, and step-up middleware.

### REFACTOR

Keep MFA helpers isolated from ordinary API-key auth.

## Implementation Notes

- Use well-reviewed primitives or small focused implementation for TOTP.
- Never return stored TOTP secret after enrollment.
- Audit MFA enrollment and step-up sensitive operations.
- TASK-004 owns bootstrap token persistence and pending first-admin state;
  TASK-005 owns route/session/CSRF behavior; this task owns the testable
  transition that a first admin is not active until MFA is verified.
- Use the merged `admin_mfa_factors` table and `admin_sessions.mfa_verified_at`
  state from TASK-004. Do not introduce a second MFA/session state model.
- The first-admin activation path must update the `pending_mfa` admin to
  `active` only after verified TOTP enrollment/challenge, and must not return
  stored TOTP secrets after enrollment.
- TASK-005 now provides `/admin/api/session/current`,
  `/admin/api/session/csrf`, and `/admin/api/session/logout` for a valid
  `pgm_admin_session` cookie, plus CSRF enforcement through `X-CSRF-Token`.
  Keep those setup/session routes usable for pending-MFA sessions, but add a
  separate active-admin/MFA guard for privileged admin operations.
- `createAdminSessionMiddleware` currently proves a valid session and CSRF
  token; it does not by itself prove the admin user is `active` or MFA-verified.
  This task must add the helper/middleware that future admin APIs compose on
  top of it.
- Tests should explicitly prove ordinary API-key bearer tokens, MCP OAuth
  bearer tokens, and pending-MFA sessions cannot bypass the MFA/active-admin
  gate.

## Durable Memory Notes To Consider

- Store durable memory if the MFA requirement or step-up model becomes a stable
  project convention.

## Task-Level Definition of Done

- [ ] MFA enrollment and challenge are covered.
- [ ] First admin remains non-active/pending until MFA enrollment and
      verification complete.
- [ ] First admin becomes active only through the MFA completion path.
- [ ] Sensitive action step-up helper exists and is tested.
- [ ] API-key bearer tokens cannot bypass MFA/admin auth.
- [ ] Secrets are redacted.

## Validation Steps

- `npm test -- tests/contract/admin-mfa-routes.test.ts`
- `npm test -- tests/integration/admin-auth-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- Tesla reported:
  - `npm test -- tests/contract/admin-mfa-routes.test.ts` passed with 5 tests.
  - `npm test -- tests/integration/admin-auth-service.test.ts` passed with 14
    tests.
  - `npm run typecheck` passed.
  - touched-file `npx eslint ...` passed.
  - `git diff --check` passed.
  - Codex review found no introduced correctness/security issues after P2
    fixes.

## Review Feedback

### P1

- None.

### P2

- `P2-mfa-audit-structured-admin-actor` routed to Tesla at
  2026-07-05T17:48:34Z (`019f3366-7cfd-7ee1-b852-1d20abe022d8`): Lorentz
  found `writeAdminMfaAudit` hides `adminUserId` only in JSON details, while
  the shared contract requires structured admin actor attribution. Reconcile
  MFA audit rows with structured admin actor attribution without duplicating
  migration ownership.
- `P2-branch-freshness-task-file-conflict` routed to Tesla at
  2026-07-05T17:48:34Z (`019f3366-7cfd-7ee1-b852-1d20abe022d8`): PR #82 is
  not mergeable against the latest epic branch. Reviewer says conflicts are
  WDD task-file only and product code auto-merges; refresh against latest epic
  after code fix and before merge.

### P3

- `P3-mfa-route-rate-limit-regression` routed to Tesla at
  2026-07-05T17:48:34Z: add a direct 429/rate-limit route regression for
  MFA/step-up if straightforward, or record why deferred as non-blocking.

## Completion Notes

- WAVE-004 activation started at 2026-07-05T16:47:34Z as the MFA/step-up
  hybrid bundle. Branch/worktree creation is pending the pushed activation
  artifact commit.
- Controller verified the worktree and dispatched worker Tesla
  (`019f3333-4033-7463-9819-aa3dec286b4c`). No PR or patch exists yet.
- 2026-07-05T17:12:04Z controller heartbeat observed active uncommitted work
  in `src/auth/admin-middleware.ts`, `src/transport/admin.ts`,
  `src/auth/admin-mfa-service.ts`, `tests/contract/admin-mfa-routes.test.ts`,
  and `tests/integration/admin-auth-service.test.ts`. No PR or patch exists
  yet; branch remains current with the epic branch at `f9bbc0f`.
- 2026-07-05T17:32:34Z controller heartbeat observed Tesla `DONE`, draft PR
  #82 open at `3cfca6e9da0d1f5b675616e28546302a6fcad7f4`, GitHub
  `mergeStateStatus=CLEAN`, and the worktree clean/pushed. The worker branch
  moved its task copy to `review/`; this epic-side task copy records the review
  gate while the PR is open. Lorentz review is in progress.
- After controller checkpoint `0eb4472` was pushed, GitHub reports PR #82
  `mergeStateStatus=UNKNOWN` and the task branch is behind the epic branch
  (`rev-list origin/codex/epic/admin-configuration-frontend...HEAD` = `1 3`).
  Refresh against the latest epic branch and rerun freshness verification
  before merge.
- 2026-07-05T17:48:34Z Lorentz returned `REVIEW_BLOCKED` for PR #82 with two
  P2 findings and one P3 suggestion. Controller routed the fixes to Tesla in
  submission `019f3366-7cfd-7ee1-b852-1d20abe022d8`; gate is `needs_fixes`.
- 2026-07-05T17:59:04Z controller observed local clean TASK-006 fix commits
  through `392313355f802679128daee2680bd01d016059df`, including
  `7d3bfee fix: structure admin mfa audit actor`, and task evidence for the
  P3 route-rate-limit regression. The branch is current with the epic branch
  locally, but still ahead of origin and PR #82 remains at old head
  `3cfca6e9da0d1f5b675616e28546302a6fcad7f4`. Controller nudged Tesla for the
  missing push, PR update, and final status token in
  `019f3371-0282-78d3-83fd-b9b8ba1aac24`.
