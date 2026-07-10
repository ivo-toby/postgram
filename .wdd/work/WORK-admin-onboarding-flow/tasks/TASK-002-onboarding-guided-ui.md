---
id: TASK-002-onboarding-guided-ui
kind: micro_task
work: WORK-admin-onboarding-flow
slug: onboarding-guided-ui
title: Onboarding Guided UI
status: done
depends_on:
  - TASK-001-onboarding-state-api
conflict_domains:
  - ui/src/components/admin/**
  - ui/src/components/AdminAuth.test.tsx
  - ui/src/components/AdminConfig.test.tsx
  - ui/src/components/AdminBackup.test.tsx
  - ui/src/lib/adminApi.ts
risk: high
review_required: true
branch: codex/task/WORK-admin-onboarding-flow-bundle
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/WORK-admin-onboarding-flow-bundle
current_gate: merged
verification:
  - npm run test --prefix ui -- AdminOnboarding.test.tsx AdminAuth.test.tsx AdminConfig.test.tsx AdminBackup.test.tsx AdminMaintenance.test.tsx AdminOps.test.tsx
  - npm run typecheck --prefix ui
---

# TASK-002-onboarding-guided-ui: Onboarding Guided UI

## Objective

Add an admin onboarding flow that appears after active MFA login when
onboarding is incomplete, explains each setup area in plain language, and
resumes from persisted progress after interruption.

## Scope

- Included:
  - Add an onboarding component or dashboard panel.
  - Show onboarding automatically for incomplete/unskipped installs.
  - Keep onboarding available from dashboard navigation after dismissal.
  - Guide through setup, provider config, secrets, validation/apply,
    backup/restore safety, and maintenance concepts.
  - Use clear copy for non-experts with technical familiarity.
  - Add skip and complete actions with deliberate wording.
  - Add UI tests for resume, skip, complete, and step navigation.
- Excluded:
  - Replacing existing Config/Backup/Maintenance tabs.
  - A separate marketing-style landing page.
  - Real-time job metrics or animation beyond ordinary loading states.

## Context To Read

- `ui/src/components/admin/AdminAuth.tsx`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminConfig.tsx`
- `ui/src/components/admin/AdminBackup.tsx`
- `ui/src/components/admin/AdminMaintenance.tsx`
- `ui/src/components/admin/AdminHelp.tsx`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/AdminAuth.test.tsx`
- `ui/src/components/AdminConfig.test.tsx`
- `ui/src/components/AdminBackup.test.tsx`
- `ui/src/components/AdminMaintenance.test.tsx`
- `ui/src/components/AdminOps.test.tsx`

## Likely Files

- `ui/src/components/admin/AdminOnboarding.tsx`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/AdminOnboarding.test.tsx`
- `ui/src/components/AdminAuth.test.tsx`
- `ui/src/components/AdminOps.test.tsx`

## Dependencies

- `TASK-001-onboarding-state-api` API contract.

## Conflict Domains

- `ui/src/components/admin/**`
- `ui/src/lib/adminApi.ts`

## Validation

- `npm run test --prefix ui -- AdminOnboarding.test.tsx AdminAuth.test.tsx AdminConfig.test.tsx AdminBackup.test.tsx AdminMaintenance.test.tsx AdminOps.test.tsx`
- `npm run typecheck --prefix ui`

## Done

- [x] Objective is complete.
- [x] Verification evidence is recorded.
- [x] Required review is complete or explicitly not required.

## Evidence

- 2026-07-08: Bundle worker started; UI work is waiting for the onboarding API contract to go red/green first.
- 2026-07-08 RED: `npm run test --prefix ui -- AdminOnboarding.test.tsx AdminAuth.test.tsx` failed as expected before UI implementation: missing `AdminOnboarding` module and no automatic onboarding screen.
- 2026-07-08 GREEN: `npm run test --prefix ui -- AdminOnboarding.test.tsx AdminAuth.test.tsx` passed: 19 tests.
- 2026-07-08 regression: `npm run test --prefix ui -- AdminOnboarding.test.tsx AdminAuth.test.tsx AdminConfig.test.tsx AdminBackup.test.tsx AdminMaintenance.test.tsx AdminOps.test.tsx` passed: 66 tests.
- 2026-07-08: `npm run typecheck --prefix ui` passed.
- 2026-07-08: Manual review-style diff audit found no P0/P1/P2 issues; dedicated `/codex` review hook was unavailable in this tool surface, so review remains pending for the draft PR.
- 2026-07-08: Follow-up review `019f430b-2835-7de3-94e2-b4774714b5eb` returned `REVIEW_PASS` after the backend progress-invariant fix.
- 2026-07-08: Controller verification passed: admin UI regression suite passed 66/66 and UI typecheck passed.
- 2026-07-08: Merged into `codex/epic/admin-configuration-frontend` in `e698d9ab317b60d822963d69b182bc57f16448ab`; GitHub marked PR #95 merged at 2026-07-08T18:49:36Z.
