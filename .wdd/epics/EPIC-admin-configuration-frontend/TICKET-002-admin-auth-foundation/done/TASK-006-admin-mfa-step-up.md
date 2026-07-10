---
id: TASK-006-admin-mfa-step-up
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-004
slug: admin-mfa-step-up
title: Admin MFA And Step-Up
status: done
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
worktree_status: cleaned_up
pr: https://github.com/ivo-toby/postgram/pull/82
worker_thread_id: 019f3333-4033-7463-9819-aa3dec286b4c
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: reconciled
branch_freshness: current_at_merge
verification:
  - npm test -- tests/contract/admin-mfa-routes.test.ts
  - npm test -- tests/integration/admin-auth-service.test.ts
  - npm run typecheck
  - npx eslint src/auth/admin-mfa-service.ts src/auth/admin-middleware.ts src/transport/admin.ts src/index.ts src/config.ts tests/contract/admin-mfa-routes.test.ts tests/integration/admin-auth-service.test.ts
  - git diff --check
---

# TASK-006-admin-mfa-step-up: Admin MFA And Step-Up

## Status

done

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

Feedback fix requested in submission `019f3366-7cfd-7ee1-b852-1d20abe022d8`
after Lorentz returned `REVIEW_BLOCKED`.

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

- [x] MFA enrollment and challenge are covered.
- [x] First admin remains non-active/pending until MFA enrollment and
      verification complete.
- [x] First admin becomes active only through the MFA completion path.
- [x] Sensitive action step-up helper exists and is tested.
- [x] API-key bearer tokens cannot bypass MFA/admin auth.
- [x] Secrets are redacted.

## Validation Steps

- `npm test -- tests/contract/admin-mfa-routes.test.ts`
- `npm test -- tests/integration/admin-auth-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- RED: `npm test -- tests/contract/admin-mfa-routes.test.ts` failed before
  implementation with 5 route-level failures because MFA endpoints returned
  404.
- RED: `npm test -- tests/integration/admin-auth-service.test.ts` failed before
  implementation because `src/auth/admin-mfa-service.ts` did not exist.
- Review-fix RED: contract coverage proved premature `/admin/api/session/step-up`
  returned 200 before the session had completed MFA; integration coverage
  proved future-dated step-up timestamps were incorrectly fresh.
- GREEN: `npm test -- tests/contract/admin-mfa-routes.test.ts` passed
  (5 tests).
- GREEN: `npm test -- tests/integration/admin-auth-service.test.ts` passed
  (14 tests).
- `npm run typecheck` passed.
- Direct touched-file lint passed:
  `npx eslint src/auth/admin-mfa-service.ts src/auth/admin-middleware.ts src/transport/admin.ts src/index.ts src/config.ts tests/contract/admin-mfa-routes.test.ts tests/integration/admin-auth-service.test.ts`.
- `git diff --check` passed.
- Codex review gate `codex review --uncommitted` initially reported P1/P2
  findings for rolled-back failed-attempt audit rows, plaintext TOTP seed
  storage, missing MFA/step-up audit rows, premature step-up access, and
  future-dated step-up freshness. All P1/P2 findings were fixed.
- Final Codex review gate reported no introduced correctness or security
  issues in the changed files.
- Feedback-fix RED: `npm test -- tests/integration/admin-auth-service.test.ts`
  failed because MFA audit rows left `audit_log.admin_user_id` null when the
  #81 audit schema column was present.
- Feedback-fix GREEN: `npm test -- tests/integration/admin-auth-service.test.ts`
  passed with 15 tests after `writeAdminMfaAudit` populated
  `audit_log.admin_user_id` when available.
- Feedback-fix coverage: `npm test -- tests/contract/admin-mfa-routes.test.ts`
  passed with 6 tests, including a direct 429 regression for MFA verification
  and step-up route rate-limit branches.
- Post-refresh verification after merging latest
  `origin/codex/epic/admin-configuration-frontend`: `npm test --
  tests/contract/admin-mfa-routes.test.ts` passed with 6 tests; `npm test --
  tests/integration/admin-auth-service.test.ts` passed with 15 tests; `npm run
  typecheck` passed; touched-file `npx eslint ...` passed; `git diff --check`
  passed.
- Reconciliation: WAVE-004 shared context and downstream task briefs were
  updated on 2026-07-05, and the clean pushed worktree was removed with
  `git worktree remove` followed by `git worktree prune`.

## Review Feedback

### P1

- Resolved: failed MFA attempts are now committed as `admin_auth_attempts` rows
  instead of being rolled back with the failed verification transaction.
- Resolved: TOTP seeds are now stored encrypted in `admin_mfa_factors` using
  `ADMIN_MFA_SECRET_KEY`, and plaintext secrets are write-only after enrollment.

### P2

- Resolved: MFA enrollment, verification, challenge, and step-up success paths
  now append audit rows without exposing TOTP secrets.
- Resolved: `/admin/api/session/step-up` now requires an already MFA-verified
  active admin session before using the separate step-up rate-limit bucket.
- Resolved: step-up freshness rejects future-dated `mfa_verified_at`
  timestamps.
- Resolved: `P2-mfa-audit-structured-admin-actor` now writes
  `audit_log.admin_user_id` when the structured actor column exists. This task
  does not duplicate #81 migration ownership; until #81 lands, the legacy audit
  schema remains compatible and actor attribution also remains in safe details.
- Resolved: `P2-branch-freshness-task-file-conflict` by merging latest
  `origin/codex/epic/admin-configuration-frontend`; product code auto-merged
  and the only conflict was this TASK-006 task file.

### P3

- Resolved: added direct contract coverage that five failed MFA verification
  attempts make the next MFA verification return 429, and five failed step-up
  attempts make the next step-up return 429.

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
- Implemented TOTP enrollment/verification/challenge/step-up routes on the
  existing admin session and MFA tables, added encrypted TOTP seed storage, and
  kept `pgm_admin_session` plus `X-CSRF-Token` as the admin mutation contract.
- Merged the latest epic heartbeat commit into the task branch before opening
  PR #82 so the draft PR targets the current
  `codex/epic/admin-configuration-frontend` state.
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
  submission `019f3366-7cfd-7ee1-b852-1d20abe022d8`; gate was `needs_fixes`.
- Feedback fix adds structured MFA audit actor attribution when the #81
  `audit_log.admin_user_id` column exists, preserves compatibility before that
  migration lands, adds direct MFA/step-up 429 route coverage, and refreshes
  the branch against the latest epic state.
- 2026-07-05T17:59:04Z controller observed local clean TASK-006 fix commits
  through `392313355f802679128daee2680bd01d016059df`, including
  `7d3bfee fix: structure admin mfa audit actor`, and task evidence for the
  P3 route-rate-limit regression. The branch is current with the epic branch
  locally, but still ahead of origin and PR #82 remains at old head
  `3cfca6e9da0d1f5b675616e28546302a6fcad7f4`. Controller nudged Tesla for the
  missing push, PR update, and final status token in
  `019f3371-0282-78d3-83fd-b9b8ba1aac24`.
- 2026-07-05T18:05:13Z controller observed Tesla `DONE` and PR #82 updated to
  `392313355f802679128daee2680bd01d016059df`. Controller verification passed:
  `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`,
  orchestration JSON parse, `npm test -- tests/contract/admin-mfa-routes.test.ts`
  with 6 tests, `npm test -- tests/integration/admin-auth-service.test.ts` with
  15 tests, and `npm run typecheck`. Follow-up review requested from Lorentz in
  `019f3375-9922-7283-8c64-702aceaae82f`.
- 2026-07-05T18:10Z Lorentz returned `REVIEW_PASS` for PR #82 follow-up review.
- 2026-07-05T18:14Z controller merged latest epic checkpoint `e626ec9` into
  the task branch for final freshness; only this WDD task file conflicted, and
  the resolution preserved Tesla's fix evidence plus Lorentz `REVIEW_PASS`.
- 2026-07-05T18:16Z controller merged TASK-006 into the epic branch in
  `6666508a56bbbb083100c86a0b57ff767fcb30a6` after Lorentz `REVIEW_PASS`,
  final branch freshness, and passing verification. Task moved to `done/`;
  worktree cleanup is deferred until WAVE-004 reconciliation.
