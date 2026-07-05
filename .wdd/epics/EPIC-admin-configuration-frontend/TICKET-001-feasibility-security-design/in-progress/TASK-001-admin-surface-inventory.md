---
id: TASK-001-admin-surface-inventory
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-001-feasibility-security-design
wave: WAVE-001
slug: admin-surface-inventory
title: Admin Surface Inventory
status: in_progress
depends_on: []
conflict_domains:
  - .wdd/epics/EPIC-admin-configuration-frontend/shared-context/**
  - docs/superpowers/specs/**
assigned_model_class: planning
review_model_class: review
branch: codex/task/WAVE-001-admin-feasibility-gate
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/WAVE-001-admin-feasibility-gate
worktree_status: pending_creation
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: activation_pending_worktree
branch_freshness: pending_creation
verification:
  - git diff --check
---

# TASK-001-admin-surface-inventory: Admin Surface Inventory

## Status

in_progress

## Parent Ticket

TICKET-001-feasibility-security-design

## Wave

WAVE-001

## Objective

Produce the authoritative `pgm-admin` to web-admin feasibility inventory for
this epic.

## Scope

- Included:
  - Inspect every `pgm-admin` command and supporting services.
  - Classify each command as first-scope web candidate, later web candidate,
    dangerous/manual-only, or excluded.
  - Identify service extraction required to avoid CLI shell-out.
  - Update shared context and, if useful, add a design/spec doc.
- Excluded:
  - Product code implementation.
  - UI mockups.

## Non-Scope

- Do not expose `sql` or generic command execution as web candidates.

## Relevant Context

### Local Context

- `src/cli/admin/pgm-admin.ts`
- `README.md`
- `docs/manual-test-plan.md`
- `tests/integration/cli-admin.test.ts`

### Shared Context References

- `../../shared-context/index.md`
- `../../shared-context/resources/admin-surface-inventory.md`
- `../../shared-context/resources/api-contracts.md`

## Likely Files / Areas

- `.wdd/epics/EPIC-admin-configuration-frontend/shared-context/resources/admin-surface-inventory.md`
- Optional `docs/superpowers/specs/*admin*`

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

Assigned as part of bundled WAVE-001. The controller must create and verify this
isolated worktree before dispatch.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Text-only planning task. Start by listing missing command classifications in
the inventory.

### GREEN

Fill the inventory with command-by-command decisions, risks, service extraction
needs, and first-scope recommendation.

### REFACTOR

Keep the shared-context file scannable; move long details into a focused spec
if needed.

## Implementation Notes

- Treat CLI behavior as trusted-local operator behavior, not automatically safe
  web behavior.
- Mark commands requiring jobs, step-up auth, dry-run, or exclusion.

## Durable Memory Notes To Consider

- Store a concise durable memory only if this task changes first-scope strategy
  or excludes a major surface.

## Task-Level Definition of Done

- [ ] Every current `pgm-admin` command is classified.
- [ ] First-scope admin web surface is explicit.
- [ ] Exclusions and reasons are explicit.
- [ ] Service extraction risks are recorded.

## Validation Steps

- `git diff --check`

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
