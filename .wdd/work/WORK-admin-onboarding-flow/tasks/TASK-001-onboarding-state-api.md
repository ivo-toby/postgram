---
id: TASK-001-onboarding-state-api
kind: micro_task
work: WORK-admin-onboarding-flow
slug: onboarding-state-api
title: Onboarding State API
status: todo
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
worker_worktree: null
current_gate: not_started
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

- [ ] Objective is complete.
- [ ] Verification evidence is recorded.
- [ ] Required review is complete or explicitly not required.

## Evidence

- Not run yet.
