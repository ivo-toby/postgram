---
id: TASK-017-docker-first-run-no-cli
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-007-docker-e2e-validation
wave: WAVE-010
slug: docker-first-run-no-cli
title: Docker First Run No CLI
status: in_progress
depends_on:
  - TASK-012-admin-ops-dashboard-ui
  - TASK-013-admin-config-ui
  - TASK-016-maintenance-admin-ui
conflict_domains:
  - docker-compose.yml
  - README.md
  - docs/**
  - tests/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-017-docker-first-run-no-cli
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-017-docker-first-run-no-cli
worktree_status: pending_creation
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: pending_worktree
branch_freshness: not_started
verification:
  - docker compose config
  - npm run typecheck
  - npm --prefix ui run typecheck
  - npm --prefix ui run build
---

# TASK-017-docker-first-run-no-cli: Docker First Run No CLI

## Status

in_progress

## Parent Ticket

TICKET-007-docker-e2e-validation

## Wave

WAVE-010

## Objective

Verify and document the clean-volume Docker Compose path where supported setup
and maintenance require no normal `pgm-admin` usage or manual env-file edits.

## Scope

- Included:
  - Docker Compose updates needed for the supported first-run flow.
  - README/deployment docs for bootstrap, admin login, configuration, and
    fallback CLI.
  - Smoke test evidence for clean first run.
  - Documentation of any remaining minimal bootstrap/encryption env value.
- Excluded:
  - External production deployment changes.

## Non-Scope

- Do not claim no CLI is required for emergency recovery if `pgm-admin` remains
  the documented fallback.

## Relevant Context

### Local Context

- `docker-compose.yml`
- `README.md`
- `docs/manual-test-plan.md`
- `Dockerfile`
- `ui/Dockerfile`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminConfig.tsx`
- `ui/src/components/admin/AdminMaintenance.tsx`
- `ui/src/lib/adminApi.ts`

### Shared Context References

- `../../shared-context/resources/testing-validation.md`
- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/security-model.md`

## Likely Files / Areas

- `docker-compose.yml`
- `.env.example`
- `README.md`
- `docs/manual-test-plan.md`
- Optional smoke test docs or scripts if existing project patterns support them.

## Dependencies

- TASK-012-admin-ops-dashboard-ui
- TASK-013-admin-config-ui
- TASK-016-maintenance-admin-ui

## Conflict Domains

- `docker-compose.yml`
- `README.md`
- `docs/**`
- `tests/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-017-docker-first-run-no-cli

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-017-docker-first-run-no-cli

## PR / Patch Reference

None yet.

WAVE-010 activation recorded at 2026-07-06T21:51:22Z. The controller assigned
branch `codex/task/TASK-017-docker-first-run-no-cli` and the isolated worktree
path above; task branch/worktree creation and worker dispatch follow only after
this activation checkpoint is pushed to the epic branch.

## RED-GREEN TDD Plan

### RED

Document or script a clean-volume smoke path that currently fails or requires
manual CLI/env edits.

### GREEN

Update Docker/docs and run the smoke path until the supported happy path works.

### REFACTOR

Keep docs honest about emergency CLI fallback and public exposure risks.

## Implementation Notes

- Preserve loopback-safe defaults unless Wave 1 chose otherwise.
- Include exact evidence commands and results in task completion notes.
- WAVE-004 introduced two outside-database installation keys:
  `ADMIN_MFA_SECRET_KEY` for encrypted TOTP factors and
  `ADMIN_SETTINGS_ENCRYPTION_KEY` for provider secret storage. The Docker
  happy path must document how these are generated, persisted, rotated or
  backed up, and supplied without putting usable secrets in database backups.
- The clean-volume smoke should prove setup fails closed when required admin
  encryption keys are absent or invalid, and succeeds when the documented
  Docker/operator path provides them.
- WAVE-008 added the real browser admin shell and Config tab. The smoke path
  should exercise the protected `AdminDashboard`, the `AdminConfig` provider
  configuration panel, API-key creation from the admin UI, and dashboard
  health/queue/stats/config-model/jobs/audit visibility rather than only
  backend routes.
- WAVE-009 added `AdminMaintenance` inside the same `AdminDashboard` shell.
  The clean-volume browser smoke should include one safe maintenance dry-run
  from the UI, prove `/admin/api/jobs/:jobId` polling is visible, and confirm
  the health, queue, stats, config/models/jobs, API keys, audit, Config, and
  Maintenance panels remain reachable after login/MFA.
- Provider secrets configured through the UI must remain write-only/redacted
  after reload/restart. Do not document any Docker path that requires putting
  provider plaintext, TOTP seeds, session tokens, or bootstrap tokens into
  browser storage or database backups.
- Keep emergency `pgm-admin` recovery documented separately from the supported
  happy path. The supported happy path should not require normal `pgm-admin`
  use after Docker startup/bootstrap.

## Durable Memory Notes To Consider

- Store durable memory if the Docker first-run procedure becomes stable and
  useful for future agents.

## Task-Level Definition of Done

- [ ] Clean Docker first-run path is verified.
- [ ] Docs match the verified path.
- [ ] Remaining env requirements are explicit.
- [ ] No-CLI claim is scoped and truthful.

## Validation Steps

- `docker compose config`
- Clean-volume Docker smoke command set from the task evidence
- `npm run typecheck`
- `npm --prefix ui run typecheck`
- `npm --prefix ui run build`

## Verification Evidence

- Activation pending task branch/worktree creation from the pushed epic
  checkpoint.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.
