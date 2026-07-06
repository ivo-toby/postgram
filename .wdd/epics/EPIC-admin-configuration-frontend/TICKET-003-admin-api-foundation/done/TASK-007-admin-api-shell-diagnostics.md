---
id: TASK-007-admin-api-shell-diagnostics
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-003-admin-api-foundation
wave: WAVE-005
slug: admin-api-shell-diagnostics
title: Admin API Shell And Diagnostics
status: done
depends_on:
  - TASK-005-admin-session-routes
  - TASK-006-admin-mfa-step-up
conflict_domains:
  - src/transport/**
  - src/services/**
  - tests/contract/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-007-admin-api-shell-diagnostics
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-007-admin-api-shell-diagnostics
worktree_status: clean_pushed
pr: https://github.com/ivo-toby/postgram/pull/83
worker_thread_id: 019f35ff-5f3c-7cc0-aa6e-78941a3fd7fd
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm test -- tests/contract/admin-api.test.ts
  - npm run typecheck
---

# TASK-007-admin-api-shell-diagnostics: Admin API Shell And Diagnostics

## Status

done

## Parent Ticket

TICKET-003-admin-api-foundation

## Wave

WAVE-005

## Objective

Add the authenticated admin API shell and first read-only diagnostics endpoints.

## Scope

- Included:
  - Admin API route namespace after admin middleware.
  - Read-only health, queue, model list, and safe configuration status.
  - Contract tests for session auth, CSRF behavior where relevant, and bearer
    denial.
- Excluded:
  - Mutating key/config/maintenance endpoints.

## Non-Scope

- Do not duplicate ordinary user API behavior unless admin semantics differ.

## Relevant Context

### Local Context

- `src/index.ts`
- `src/transport/rest.ts`
- `src/transport/admin.ts`
- `src/auth/admin-middleware.ts`
- `src/services/queue-service.ts`
- `src/services/embeddings/admin.ts`
- `tests/contract/rest-api.test.ts`

### Shared Context References

- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/transport/admin.ts`
- `src/services/admin-diagnostics-service.ts`
- `tests/contract/admin-api.test.ts`

## Dependencies

- TASK-005-admin-session-routes
- TASK-006-admin-mfa-step-up

## Conflict Domains

- `src/transport/**`
- `src/services/**`
- `tests/contract/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-007-admin-api-shell-diagnostics

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-007-admin-api-shell-diagnostics

Assigned by WAVE-005 activation. The controller must create and verify this
isolated worktree before dispatch.

Verified and dispatched at 2026-07-06T05:56:19Z with worker Wegener
(`019f35ff-5f3c-7cc0-aa6e-78941a3fd7fd`) on branch
`codex/task/TASK-007-admin-api-shell-diagnostics`.

## PR / Patch Reference

Draft PR: https://github.com/ivo-toby/postgram/pull/83

Review requested from Lorentz (`019f322c-02e7-7590-8b8e-ebdd1e9c52ac`) at
2026-07-06T06:14:07Z with submission
`019f3611-2a16-72d3-bd90-db911948d8c3`.

Lorentz returned `REVIEW_PASS` with no P1/P2/P3 findings after verifying the
diagnostics shell, redaction, admin-session/MFA guard composition, and branch
mergeability.

Merged locally into `codex/epic/admin-configuration-frontend` at commit
`16985ef684213569ec6748065b390c9ab5e89b1a` after refreshing the task branch
against the latest epic branch.

## RED-GREEN TDD Plan

### RED

Add contract tests for admin diagnostics success with session and failure with
ordinary API-key bearer auth.

### GREEN

Implement admin diagnostics routes and service helpers.

### REFACTOR

Keep route response shapes reusable for frontend API client.

## Implementation Notes

- Diagnostics must not reveal stored secret values.
- Prefer existing queue/health/model helpers when safe.
- Use the WAVE-003 `/admin/api/*` route family and `createAdminSessionMiddleware`
  for session/CSRF behavior; do not add a second admin auth system.
- Diagnostics should require the active-admin/MFA guard from TASK-006. A valid
  pending-MFA session is enough for setup/current/csrf/logout, but not for
  operational diagnostics.
- Compose `createAdminSessionMiddleware({ pool })` with
  `createActiveAdminMiddleware()` from `src/auth/admin-middleware.ts`.
  Diagnostics are read-only, so they should not require recent step-up unless a
  diagnostic exposes sensitive secret/config metadata beyond coarse status.
- Use `admin_settings_service` redacted metadata only for safe configuration
  status. Do not return stored provider secrets, ciphertext, token prefixes, or
  arbitrary secret validation metadata.
- Contract tests must prove ordinary Postgram API-key bearer tokens and MCP
  OAuth bearer tokens still fail on the admin diagnostics routes.
- Contract tests must also prove a pending-MFA session receives `403` from the
  diagnostics shell while an active MFA session succeeds.

## Durable Memory Notes To Consider

- Record stable admin route namespace if it becomes settled here.

## Task-Level Definition of Done

- [x] Admin diagnostics API exists.
- [x] Ordinary bearer auth is rejected.
- [x] Responses are redacted.
- [x] Contract tests pass.

## Validation Steps

- `npm test -- tests/contract/admin-api.test.ts`
- `npm run typecheck`

## Verification Evidence

- RED: `npm test -- tests/contract/admin-api.test.ts` failed before
  implementation with diagnostics routes returning `404` instead of the
  expected success or authorization responses.
- GREEN: `npm test -- tests/contract/admin-api.test.ts` passed (3 tests).
- Adjacent focused contracts:
  `npm test -- tests/contract/admin-auth-routes.test.ts tests/contract/admin-mfa-routes.test.ts tests/contract/admin-api.test.ts`
  passed (18 tests).
- `npm run typecheck` passed.
- `npx eslint src/index.ts src/transport/admin.ts src/services/admin-diagnostics-service.ts tests/contract/admin-api.test.ts`
  passed.
- `git diff --check` passed.
- Lorentz review verification passed:
  `git diff --check codex/epic/admin-configuration-frontend...HEAD`,
  `npm test -- tests/contract/admin-api.test.ts`, `npm run typecheck`, and
  `git merge-tree --write-tree codex/epic/admin-configuration-frontend HEAD`.
- Branch freshness refresh against `origin/codex/epic/admin-configuration-frontend`
  passed after resolving the WDD task-file metadata conflict:
  `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`,
  `git diff --check --cached`, `npm test -- tests/contract/admin-api.test.ts`,
  and `npm run typecheck`.
- Epic checkout post-merge verification passed:
  `npm test -- tests/contract/admin-api.test.ts` and `npm run typecheck`.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added active-admin guarded read-only diagnostics endpoints under
  `/admin/api/diagnostics/*` for health, queue, embedding models, and coarse
  runtime config status.
- Diagnostics compose `createAdminSessionMiddleware({ pool, enforceCsrf: false
  })` with `createActiveAdminMiddleware()`, so pending-MFA sessions receive
  `403` and ordinary API-key/MCP OAuth bearer tokens receive `401`.
- Config status returns only aggregate setting/secret counts by state,
  classification, purpose, and validation status. It does not return secret
  names, plaintext, ciphertext, token prefixes, or arbitrary validation
  metadata.
