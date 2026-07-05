---
id: TASK-003-runtime-config-feasibility
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-001-feasibility-security-design
wave: WAVE-001
slug: runtime-config-feasibility
title: Runtime Config Feasibility
status: review
depends_on: []
conflict_domains:
  - .wdd/epics/EPIC-admin-configuration-frontend/shared-context/**
  - docs/superpowers/specs/**
assigned_model_class: planning
review_model_class: review
branch: codex/task/WAVE-001-admin-feasibility-gate
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/WAVE-001-admin-feasibility-gate
worktree_status: verified
pr: null
worker_thread_id: 019f3215-2eb6-75f2-81f0-bf527e73258b
review_thread_id: null
current_gate: ready_for_review
branch_freshness: current
verification:
  - git diff --check
---

# TASK-003-runtime-config-feasibility: Runtime Config Feasibility

## Status

review

## Parent Ticket

TICKET-001-feasibility-security-design

## Wave

WAVE-001

## Objective

Classify runtime settings and choose the DB-backed configuration, secret, and
apply/reload strategy for the first implementation scope.

## Scope

- Included:
  - Inventory current env settings from `src/config.ts` and `docker-compose.yml`.
  - Classify settings as bootstrap-only, runtime editable,
    restart/reinitialize required, or dangerous migration.
  - Decide initial secret storage and key-management approach.
  - Decide provider validation and apply/reload strategy.
- Excluded:
  - Migrations or product code.

## Non-Scope

- Do not declare "no env values ever" unless the secret/encryption-key story is
  safe.

## Relevant Context

### Local Context

- `src/config.ts`
- `src/index.ts`
- `src/services/embeddings/providers.ts`
- `src/services/llm-provider.ts`
- `docker-compose.yml`
- `README.md`

### Shared Context References

- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/architecture.md`
- `../../shared-context/resources/security-model.md`

## Likely Files / Areas

- `.wdd/epics/EPIC-admin-configuration-frontend/shared-context/resources/migration-config-notes.md`
- Optional `docs/superpowers/specs/*runtime-config*`

## Dependencies

- None.

## Conflict Domains

- `.wdd/epics/EPIC-admin-configuration-frontend/shared-context/**`
- `docs/superpowers/specs/**`

## Assigned Model Class

planning

## Branch

codex/task/WAVE-001-admin-feasibility-gate

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/WAVE-001-admin-feasibility-gate

Assigned as part of bundled WAVE-001. The controller created and verified this
isolated worktree before dispatch.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Text-only planning task. Start by listing settings without a safe UI-backed
classification.

### GREEN

Record classifications, secret strategy, apply behavior, and blocked settings.

### REFACTOR

Condense repeated setting notes into a table.

## Implementation Notes

- Treat embedding dimensions and chunk storage as migration-sensitive.
- Decide whether a minimal encryption key remains an env or Docker secret.

## Durable Memory Notes To Consider

- Store durable memory if a stable runtime configuration architecture decision
  is made.

## Task-Level Definition of Done

- [x] Current config surface is classified.
- [x] Secret storage strategy is chosen or marked blocking.
- [x] Apply/reload/restart strategy is chosen.
- [x] Later implementation tasks have clear scope.

## Validation Steps

- `git diff --check`

## Verification Evidence

- 2026-07-05: `git diff --check` passed.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Inspected `src/config.ts`, `src/index.ts`,
  `src/services/embeddings/providers.ts`, `src/services/llm-provider.ts`,
  `docker-compose.yml`, `.env.example`, and `README.md`.
- Updated `shared-context/resources/migration-config-notes.md` with the
  per-setting lifecycle classification, DB-backed settings model, encrypted
  write-only secret strategy, and save/validate/apply behavior.
- Recorded follow-on Docker/config drift for `LLM_REQUEST_TIMEOUT_MS` and
  extraction tuning settings before admin UI ownership.
