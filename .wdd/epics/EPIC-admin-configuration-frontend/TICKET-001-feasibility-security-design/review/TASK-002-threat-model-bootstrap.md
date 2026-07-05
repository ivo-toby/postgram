---
id: TASK-002-threat-model-bootstrap
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-001-feasibility-security-design
wave: WAVE-001
slug: threat-model-bootstrap
title: Threat Model And Bootstrap
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

# TASK-002-threat-model-bootstrap: Threat Model And Bootstrap

## Status

review

## Parent Ticket

TICKET-001-feasibility-security-design

## Wave

WAVE-001

## Objective

Produce the threat model and choose the first-run bootstrap posture for admin
setup.

## Scope

- Included:
  - Threat model admin auth, sessions, MFA, CSRF, bootstrap, secrets,
    destructive operations, and Docker exposure.
  - Compare bootstrap patterns and choose one first implementation path.
  - Define required mitigations and review gates.
- Excluded:
  - Auth code, UI, or migration implementation.

## Non-Scope

- Do not assume loopback-only is safe when a reverse proxy exposes the UI.

## Relevant Context

### Local Context

- `docker-compose.yml`
- `src/auth/*`
- `src/transport/oauth.ts`
- `src/index.ts`
- `README.md`

### Shared Context References

- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/migration-config-notes.md`

## Likely Files / Areas

- `.wdd/epics/EPIC-admin-configuration-frontend/shared-context/resources/security-model.md`
- Optional `docs/superpowers/specs/*admin-security*`

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

Text-only planning task. Start by enumerating unanswered bootstrap and admin
auth threats.

### GREEN

Update security context with chosen bootstrap pattern, required controls, and
security review gates.

### REFACTOR

Separate concise shared context from longer rationale if needed.

## Implementation Notes

- Explicitly distinguish admin login from MCP connector OAuth.
- Include failure modes for public exposure before first admin creation.
- Define what must be tested before implementation can be considered safe.

## Durable Memory Notes To Consider

- Store durable memory if the chosen bootstrap pattern becomes a stable project
  decision.

## Task-Level Definition of Done

- [x] Threat model covers all hard requirements in shared context.
- [x] Bootstrap posture is chosen with rationale.
- [x] Open security questions are either resolved or marked blocking.
- [x] Later task gates are updated if decisions change dependencies.

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

- Inspected `docker-compose.yml`, `src/auth/*`, `src/transport/oauth.ts`,
  `src/index.ts`, `README.md`, and current UI API-key login/localStorage
  behavior.
- Updated `shared-context/resources/security-model.md` with assets, trust
  boundaries, attacker-controlled inputs, admin session/mutation controls,
  Docker exposure requirements, and security review gates.
- Chose generated one-time bootstrap token via trusted local operator channel,
  with hash-only storage, single-use expiry, rate limiting, audit, and MFA
  enrollment before active first-admin access.
