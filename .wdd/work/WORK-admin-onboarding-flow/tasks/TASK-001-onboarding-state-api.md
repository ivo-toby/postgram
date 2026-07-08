---
id: TASK-001-onboarding-state-api
kind: micro_task
work: WORK-admin-onboarding-flow
slug: onboarding-state-api
title: Onboarding State API
status: done
depends_on: []
conflict_domains:
  - src/db/migrations/**
  - src/transport/admin.ts
  - src/services/admin-onboarding-service.ts
  - tests/contract/admin-onboarding-api.test.ts
  - ui/src/lib/adminApi.ts
risk: high
review_required: true
branch: codex/task/WORK-admin-onboarding-flow-bundle
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/WORK-admin-onboarding-flow-bundle
current_gate: merged
verification:
  - npx vitest run tests/contract/admin-onboarding-api.test.ts
  - npx tsc -p tsconfig.json --noEmit
---

# TASK-001-onboarding-state-api: Onboarding State API

## Objective

Add persistent, admin-authenticated onboarding state APIs that allow the UI to
load, update, skip, complete, and resume onboarding progress.

## Scope

- Included:
  - Add a migration for onboarding state with safe defaults.
  - Add a focused onboarding service for state transitions.
  - Add admin routes for read/update/skip/complete.
  - Add API client types/methods in `ui/src/lib/adminApi.ts`.
  - Add contract tests for auth, persistence, resume, skip, and complete.
- Excluded:
  - UI rendering beyond API client types.
  - Provider validation behavior changes unrelated to onboarding.

## Context To Read

- `src/transport/admin.ts`
- `src/auth/admin-service.ts`
- `src/services/admin-provider-config-service.ts`
- `src/db/migrations/010_admin_auth.sql`
- `src/db/migrations/011_admin_settings.sql`
- `tests/contract/admin-auth-routes.test.ts`
- `tests/contract/admin-backups-api.test.ts`
- `ui/src/lib/adminApi.ts`

## Likely Files

- `src/db/migrations/014_admin_onboarding.sql`
- `src/services/admin-onboarding-service.ts`
- `src/transport/admin.ts`
- `tests/contract/admin-onboarding-api.test.ts`
- `ui/src/lib/adminApi.ts`

## Dependencies

- None.

## Conflict Domains

- `src/transport/admin.ts`
- `ui/src/lib/adminApi.ts`

## Validation

- `npx vitest run tests/contract/admin-onboarding-api.test.ts`
- `npx tsc -p tsconfig.json --noEmit`

## Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] Required review is complete or explicitly not required.

## Evidence

- 2026-07-08: Bundle worker started on `codex/task/WORK-admin-onboarding-flow-bundle`; first backend RED test added in `tests/contract/admin-onboarding-api.test.ts`.
- 2026-07-08 RED: `npx vitest run tests/contract/admin-onboarding-api.test.ts` failed with expected 404s before the onboarding API existed.
- 2026-07-08 GREEN: `npx vitest run tests/contract/admin-onboarding-api.test.ts` passed: 3 tests.
- 2026-07-08: `npx tsc -p tsconfig.json --noEmit` passed.
- 2026-07-08: Manual review-style diff audit found no P0/P1/P2 issues; dedicated `/codex` review hook was unavailable in this tool surface, so review remains pending for the draft PR.
- 2026-07-08: PR #95 review found one P2 around out-of-order progress and stale update reopening.
- 2026-07-08: Fix `75e0760dbcababf1c8e4f93bbbb598b90009915a` enforced ordered-prefix progress, first-incomplete `currentStep`, and terminal-state update rejection.
- 2026-07-08: Follow-up review `019f430b-2835-7de3-94e2-b4774714b5eb` returned `REVIEW_PASS`.
- 2026-07-08: Controller verification passed: `npx vitest run tests/contract/admin-onboarding-api.test.ts` passed 5/5, freshness was current, merge-tree was clean, and diff-check passed.
- 2026-07-08: Merged locally into `codex/epic/admin-configuration-frontend` in `e698d9ab317b60d822963d69b182bc57f16448ab`.
