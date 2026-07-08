---
id: TASK-003-onboarding-validation-docs
kind: micro_task
work: WORK-admin-onboarding-flow
slug: onboarding-validation-docs
title: Onboarding Validation and Docs
status: todo
depends_on:
  - TASK-001-onboarding-state-api
  - TASK-002-onboarding-guided-ui
conflict_domains:
  - README.md
  - docker-compose.yml
  - tests/**
risk: medium
review_required: true
branch: codex/task/WORK-admin-onboarding-flow-bundle
worker_worktree: null
current_gate: not_started
verification:
  - npm run build
  - npm run build --prefix ui
  - git diff --check
---

# TASK-003-onboarding-validation-docs: Onboarding Validation and Docs

## Objective

Document and verify the Docker-first onboarding path, including how to test it
locally without deleting the existing Postgres volume.

## Scope

- Included:
  - Update README/admin setup docs for the onboarding flow.
  - Document safe local testing commands that preserve `pgdata`.
  - Document how resume works after abort/reload/logout/container restart.
  - Run broad verification after API and UI tasks land.
- Excluded:
  - Full destructive fresh-install reset instructions.
  - CI workflow changes unless required by tests.

## Context To Read

- `README.md`
- `docker-compose.yml`
- `ui/src/components/admin/AdminHelp.tsx`
- `tests/contract/admin-onboarding-api.test.ts`
- `ui/src/components/AdminOnboarding.test.tsx`

## Likely Files

- `README.md`
- `ui/src/components/admin/AdminHelp.tsx`
- `.wdd/work/WORK-admin-onboarding-flow/**`

## Dependencies

- `TASK-001-onboarding-state-api`
- `TASK-002-onboarding-guided-ui`

## Conflict Domains

- `README.md`
- `.wdd/work/WORK-admin-onboarding-flow/**`

## Validation

- `npx vitest run tests/contract/admin-onboarding-api.test.ts`
- `npm run test --prefix ui -- AdminOnboarding.test.tsx AdminAuth.test.tsx AdminConfig.test.tsx AdminBackup.test.tsx AdminMaintenance.test.tsx AdminOps.test.tsx`
- `npx tsc -p tsconfig.json --noEmit`
- `npm run typecheck --prefix ui`
- `npm run build`
- `npm run build --prefix ui`
- `git diff --check`

## Done

- [ ] Objective is complete.
- [ ] Verification evidence is recorded.
- [ ] Required review is complete or explicitly not required.

## Evidence

- Not run yet.
