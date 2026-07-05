---
id: TICKET-003-admin-api-foundation
kind: ticket
epic: EPIC-admin-configuration-frontend
slug: admin-api-foundation
title: Admin API Foundation
status: planned
task_count: 2
depends_on:
  - TASK-005-admin-session-routes
conflict_domains:
  - src/transport/**
  - src/services/**
  - src/auth/**
  - tests/contract/**
  - tests/integration/**
adapter_links:
  github_issue: null
---

# Admin API Foundation

## Summary

Create the dedicated admin API namespace and first safe operational endpoints.

## Objective

Provide typed admin endpoints for diagnostics, API-key management, audit, and
stats without accepting ordinary bearer auth.

## Scope

- Included: admin route module, middleware integration, read diagnostics,
  key/audit/stats services and endpoints.
- Excluded: runtime settings and long-running maintenance jobs.

## Non-Scope

- Do not expose raw SQL, shell execution, or broad destructive operations.

## Shared Context References

- `../shared-context/resources/api-contracts.md`
- `../shared-context/resources/admin-surface-inventory.md`
- `../shared-context/resources/testing-validation.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-007-admin-api-shell-diagnostics | todo | WAVE-005 | Add admin API shell and read-only diagnostics |
| TASK-008-admin-key-audit-stats-api | todo | WAVE-006 | Add API-key management, audit, and stats endpoints |

## Dependencies

- Depends on: TASK-005-admin-session-routes.
- Blocks: admin dashboard UI and no-CLI first-run validation.

## Conflict Domains

- `src/transport/**`
- `src/services/**`
- `tests/contract/**`
- `tests/integration/**`

## Validation Expectations

- Contract tests prove session-only access and bearer-token rejection.

## Review Focus

- Authorization boundaries, response redaction, audit coverage, and parity with
  safe CLI behavior.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.
