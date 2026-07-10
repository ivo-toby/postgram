---
id: TICKET-006-maintenance-jobs
kind: ticket
epic: EPIC-admin-configuration-frontend
slug: maintenance-jobs
title: Maintenance Jobs
status: planned
task_count: 3
depends_on:
  - TASK-006-admin-mfa-step-up
  - TASK-010-provider-config-apply
conflict_domains:
  - src/services/**
  - src/cli/admin/pgm-admin.ts
  - src/db/migrations/**
  - src/transport/**
  - ui/src/**
adapter_links:
  github_issue: null
---

# Maintenance Jobs

## Summary

Expose approved graph, memory, embedding, and extraction maintenance flows
through safe admin jobs with dry-run, confirmation, progress, and audit.

## Objective

Prove that dangerous `pgm-admin` maintenance operations can become typed,
bounded web workflows without shelling out to the CLI.

## Scope

- Included: job model, service extraction, admin endpoints, maintenance UI.
- Excluded: raw SQL and generic shell execution.

## Non-Scope

- Do not expose destructive operations without dry-run/confirmation and
  step-up auth.

## Shared Context References

- `../shared-context/resources/admin-surface-inventory.md`
- `../shared-context/resources/api-contracts.md`
- `../shared-context/resources/security-model.md`
- `../shared-context/resources/testing-validation.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-014-admin-job-foundation | todo | WAVE-006 | Add admin job model, progress, and audit foundation |
| TASK-015-maintenance-admin-api | todo | WAVE-007 | Add approved maintenance endpoints using shared services |
| TASK-016-maintenance-admin-ui | todo | WAVE-009 | Add maintenance UI for dry-run/apply/progress flows |

## Dependencies

- Depends on: TASK-006-admin-mfa-step-up, TASK-010-provider-config-apply.
- Blocks: final Docker no-CLI validation.

## Conflict Domains

- `src/services/**`
- `src/cli/admin/pgm-admin.ts`
- `src/db/migrations/**`
- `src/transport/**`
- `ui/src/**`

## Validation Expectations

- Tests cover job creation, progress, idempotency, dry-run/apply behavior,
  step-up auth, and UI confirmations.

## Review Focus

- Service extraction safety, long-running job correctness, broad mutation
  guardrails, audit coverage.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.
