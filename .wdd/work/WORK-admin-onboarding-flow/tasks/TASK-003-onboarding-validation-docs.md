---
id: TASK-003-onboarding-validation-docs
kind: micro_task
work: WORK-admin-onboarding-flow
slug: onboarding-validation-docs
title: Onboarding Validation and Docs
status: done
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
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/WORK-admin-onboarding-flow-bundle
current_gate: merged
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

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] Required review is complete or explicitly not required.

## Evidence

- 2026-07-08: Bundle worker started; docs and broad validation will follow API/UI implementation.
- 2026-07-08: README and Admin Help document server-side onboarding resume after refresh/logout/login/container restart and explicitly warn not to use `docker compose down -v` for resume testing because it removes the `pgdata` volume.
- 2026-07-08: `npm run build` passed.
- 2026-07-08: `npm run build --prefix ui` passed with existing Vite large-chunk warning.
- 2026-07-08: `git diff --check` passed.
- 2026-07-08: Manual review-style diff audit found no P0/P1/P2 issues; dedicated `/codex` review hook was unavailable in this tool surface, so review remains pending for the draft PR.
- 2026-07-08: Follow-up review `019f430b-2835-7de3-94e2-b4774714b5eb` returned `REVIEW_PASS`.
- 2026-07-08: Controller verification passed: freshness was current, merge-tree was clean, diff-check passed, root typecheck passed, and UI typecheck passed.
- 2026-07-08: Merged into `codex/epic/admin-configuration-frontend` in `e698d9ab317b60d822963d69b182bc57f16448ab`; GitHub marked PR #95 merged at 2026-07-08T18:49:36Z.
