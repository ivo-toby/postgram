---
id: EPIC-admin-configuration-frontend-CONTROLLER
kind: controller_state
epic: EPIC-admin-configuration-frontend
active_wave: null
status: planned
updated_at: 2026-07-05
---

# Controller State: EPIC-admin-configuration-frontend

## Controller Rule

The controller manages waves, workers, reviewers, PRs or patches, feedback,
verification evidence, stale-branch checks, merges or merge-ready decisions,
shared-context reconciliation, and wave reconciliation. The controller does not
implement task code. Workers must not switch branches in the controller
checkout.

## Current Outcome

Planning is complete.

Next phase: start WAVE-001 with `wdd-start-wave` after user confirmation for
the full-profile bundled feasibility gate.

## Wave Summary

| Wave | Tasks | Strategy | Status | Confirmation |
|------|-------|----------|--------|--------------|
| WAVE-001 | TASK-001, TASK-002, TASK-003 | full / bundled / risk_based / adaptive | planned | required |
| WAVE-002 | TASK-004 | full / bundled / risk_based / adaptive | planned | required |
| WAVE-003 | TASK-005 | full / bundled / risk_based / adaptive | planned | required |
| WAVE-004 | TASK-006, TASK-009 | full / hybrid / risk_based / adaptive | planned | required |
| WAVE-005 | TASK-007, TASK-010 | full / hybrid / risk_based / adaptive | planned | required |
| WAVE-006 | TASK-008, TASK-014 | full / hybrid / risk_based / adaptive | planned | required |
| WAVE-007 | TASK-011, TASK-015 | full / parallel / risk_based / adaptive | planned | required |
| WAVE-008 | TASK-012, TASK-013 | full / hybrid / risk_based / adaptive | planned | required |
| WAVE-009 | TASK-016 | full / bundled / risk_based / adaptive | planned | required |
| WAVE-010 | TASK-017 | full / bundled / risk_based / adaptive | planned | required |
| WAVE-011 | TASK-018 | full / bundled / risk_based / adaptive | planned | not required |

## Monitoring

Mode: manual

Cadence: adaptive

Status: not_started

Last check: none

Next check due: none

Scheduler reference: none

Fallback prompt:

```text
Start WAVE-001 for EPIC-admin-configuration-frontend only after user confirms
the full bundled feasibility gate. Verify epic branch artifacts are synced
before creating worker worktrees.
```

## Planned Task Gates

| Task | Ticket | Branch | Worktree | Gate | Verification |
|------|--------|--------|----------|------|--------------|
| TASK-001-admin-surface-inventory | TICKET-001-feasibility-security-design | codex/task/TASK-001-admin-surface-inventory | not_created | planned | `git diff --check` |
| TASK-002-threat-model-bootstrap | TICKET-001-feasibility-security-design | codex/task/TASK-002-threat-model-bootstrap | not_created | planned | `git diff --check` |
| TASK-003-runtime-config-feasibility | TICKET-001-feasibility-security-design | codex/task/TASK-003-runtime-config-feasibility | not_created | planned | `git diff --check` |
| TASK-004-admin-auth-persistence | TICKET-002-admin-auth-foundation | codex/task/TASK-004-admin-auth-persistence | not_created | planned | `npm test -- tests/integration/admin-auth-service.test.ts`; `npm run typecheck` |
| TASK-005-admin-session-routes | TICKET-002-admin-auth-foundation | codex/task/TASK-005-admin-session-routes | not_created | planned | `npm test -- tests/contract/admin-auth-routes.test.ts`; `npm run typecheck` |
| TASK-006-admin-mfa-step-up | TICKET-002-admin-auth-foundation | codex/task/TASK-006-admin-mfa-step-up | not_created | planned | `npm test -- tests/contract/admin-mfa-routes.test.ts`; `npm test -- tests/integration/admin-auth-service.test.ts`; `npm run typecheck` |
| TASK-007-admin-api-shell-diagnostics | TICKET-003-admin-api-foundation | codex/task/TASK-007-admin-api-shell-diagnostics | not_created | planned | `npm test -- tests/contract/admin-api.test.ts`; `npm run typecheck` |
| TASK-008-admin-key-audit-stats-api | TICKET-003-admin-api-foundation | codex/task/TASK-008-admin-key-audit-stats-api | not_created | planned | `npm test -- tests/contract/admin-key-audit-stats.test.ts`; `npm test -- tests/integration/key-service.test.ts`; `npm run typecheck` |
| TASK-009-settings-secret-store | TICKET-004-runtime-configuration | codex/task/TASK-009-settings-secret-store | not_created | planned | `npm test -- tests/integration/admin-settings-service.test.ts`; `npm run typecheck` |
| TASK-010-provider-config-apply | TICKET-004-runtime-configuration | codex/task/TASK-010-provider-config-apply | not_created | planned | `npm test -- tests/integration/admin-provider-config.test.ts`; `npm test -- tests/unit/config.test.ts`; `npm run typecheck` |
| TASK-011-admin-auth-ui | TICKET-005-admin-frontend | codex/task/TASK-011-admin-auth-ui | not_created | planned | `npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx`; `npm --prefix ui run typecheck` |
| TASK-012-admin-ops-dashboard-ui | TICKET-005-admin-frontend | codex/task/TASK-012-admin-ops-dashboard-ui | not_created | planned | `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx`; `npm --prefix ui run typecheck` |
| TASK-013-admin-config-ui | TICKET-005-admin-frontend | codex/task/TASK-013-admin-config-ui | not_created | planned | `npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx`; `npm --prefix ui run typecheck` |
| TASK-014-admin-job-foundation | TICKET-006-maintenance-jobs | codex/task/TASK-014-admin-job-foundation | not_created | planned | `npm test -- tests/integration/admin-job-service.test.ts`; `npm run typecheck` |
| TASK-015-maintenance-admin-api | TICKET-006-maintenance-jobs | codex/task/TASK-015-maintenance-admin-api | not_created | planned | `npm test -- tests/contract/admin-maintenance-api.test.ts`; `npm test -- tests/integration/cli-admin.test.ts`; `npm run typecheck` |
| TASK-016-maintenance-admin-ui | TICKET-006-maintenance-jobs | codex/task/TASK-016-maintenance-admin-ui | not_created | planned | `npm --prefix ui run test -- --run src/components/AdminMaintenance.test.tsx`; `npm --prefix ui run typecheck` |
| TASK-017-docker-first-run-no-cli | TICKET-007-docker-e2e-validation | codex/task/TASK-017-docker-first-run-no-cli | not_created | planned | `docker compose config`; `npm run typecheck`; `npm --prefix ui run build` |
| TASK-018-security-epic-validation | TICKET-007-docker-e2e-validation | codex/task/TASK-018-security-epic-validation | not_created | planned | broad backend, frontend, Docker, and smoke validation |

## Branch And Worktree State

- Epic branch: `codex/epic/admin-configuration-frontend`.
- Task branches: `codex/task/[task-id]-[task-slug]`.
- Task PR target: epic branch.
- Final PR target: `main`.
- Worker worktrees: not created.
- Worker rule: one isolated worktree per repository-writing task before
  dispatch.
- Controller checkout rule: workers must not switch branches in the controller
  checkout.
- Branch freshness: all tasks `not_started`.

## WAVE-001 Readiness

- All WAVE-001 tasks have no task dependencies.
- WAVE-001 is full-profile bundled because it is the feasibility/security gate.
- User confirmation is required before activation because confidence is medium
  and the risk is high.
- WAVE-001 stop condition requires shared-context reconciliation before
  implementation waves begin.

## Shared Context Reconciliation Rules

- Reconcile shared context after every wave.
- WAVE-001 must update the admin command classification, bootstrap posture,
  runtime configuration scope, secret storage posture, and go/no-go decision.
- Later waves must add any discovered auth, API, config, Docker, or validation
  drift to shared context before the next wave starts.

## Verification Status

- Planning artifact syntax check: passed with `git diff --check`.
- `orchestration.json` parse and dependency-wave consistency check: passed.
- Product code tests: not run; this turn planned WDD artifacts only.

## Event Log

- 2026-07-05: Epic created for safe admin configuration frontend.
- 2026-07-05: Planning artifacts created for seven tickets, eighteen tasks,
  and eleven waves.

## Next Action

Ask Ivo to confirm WAVE-001:

```text
Confirm WAVE-001 full bundled feasibility gate for EPIC-admin-configuration-frontend.
```
