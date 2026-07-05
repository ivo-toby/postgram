---
id: TASK-017-docker-first-run-no-cli
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-007-docker-e2e-validation
wave: WAVE-010
slug: docker-first-run-no-cli
title: Docker First Run No CLI
status: todo
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
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - docker compose config
  - npm run typecheck
  - npm --prefix ui run build
---

# TASK-017-docker-first-run-no-cli: Docker First Run No CLI

## Status

todo

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

None assigned yet.

## PR / Patch Reference

None yet.

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
- `npm --prefix ui run build`

## Verification Evidence

- Not run yet.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.
