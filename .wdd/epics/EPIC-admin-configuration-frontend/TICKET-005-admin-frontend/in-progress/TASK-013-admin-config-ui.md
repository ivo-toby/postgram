---
id: TASK-013-admin-config-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-005-admin-frontend
wave: WAVE-008
slug: admin-config-ui
title: Admin Config UI
status: in_progress
depends_on:
  - TASK-010-provider-config-apply
  - TASK-011-admin-auth-ui
conflict_domains:
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-013-admin-config-ui
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-013-admin-config-ui
worktree_status: clean_pushed
pr: null
worker_thread_id: 019f387a-3f1d-74a0-9949-5a318a43e494
review_thread_id: null
current_gate: no_pr
branch_freshness: current_at_activation
verification:
  - npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-013-admin-config-ui: Admin Config UI

## Status

in_progress

## Parent Ticket

TICKET-005-admin-frontend

## Wave

WAVE-008

## Objective

Add runtime provider/model configuration UI with redacted secrets, validation,
connection testing, and apply warnings.

## Scope

- Included:
  - Embedding and extraction configuration forms.
  - Secret write/update controls with redacted display.
  - Test connection / validate controls.
  - Apply/reload/restart-required messaging.
  - Tests for redaction, validation errors, and step-up.
- Excluded:
  - Maintenance job UI.

## Non-Scope

- Do not make embedding dimension changes look like a harmless text edit.

## Relevant Context

### Local Context

- `ui/src/lib/adminApi.ts`
- `ui/src/components/admin/*`
- `ui/src/components/StatusWidget.tsx`

### Shared Context References

- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `ui/src/components/admin/AdminConfig.tsx`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/AdminConfig.test.tsx`

## Dependencies

- TASK-010-provider-config-apply
- TASK-011-admin-auth-ui

## Conflict Domains

- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-013-admin-config-ui

## Worker Worktree

`/Users/ivo.toby/workspace/postgram/.worktrees/TASK-013-admin-config-ui`
assigned for WAVE-008 activation; created from pushed epic activation head
`7e5c49c` and pushed to origin.

Worker Parfit (`019f387a-3f1d-74a0-9949-5a318a43e494`) dispatched at
2026-07-06T17:29:45Z. Await PR or patch reference.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add UI tests for config load, redacted secret state, validation failure,
connection-test result, apply warning, and sensitive change confirmation.

### GREEN

Implement config form components and admin API client calls.

### REFACTOR

Share form validation and danger confirmation components with later
maintenance UI if useful.

## Implementation Notes

- Extend the WAVE-007 admin API client in `ui/src/lib/adminApi.ts`; do not add
  a parallel admin auth store or localStorage-backed admin credential path.
- Keep secret inputs intentionally blank unless the operator is replacing a
  value.
- Present restart/reembed/maintenance implications before apply.
- Treat redacted secret metadata from WAVE-004 as the only readable secret
  state: configured/provider/purpose/status/timestamps are okay, but plaintext,
  ciphertext, token prefixes, auth headers, and arbitrary validation metadata
  must never be displayed.
- Secret write/update and provider apply controls must require the WAVE-004
  step-up flow; use the admin API client to refresh step-up rather than adding
  another credential prompt.
- Tests should prove provider secret inputs are write-only, remain blank on
  load, and are not stored in localStorage or other browser persistence.
- Use the WAVE-005 provider-config API contract:
  `GET /admin/api/provider-config`, `PUT /admin/api/provider-config`,
  `PUT /admin/api/provider-config/secrets`,
  `POST /admin/api/provider-config/validate`, and
  `POST /admin/api/provider-config/apply`.
- Render pending versus applied provider state from the API. Pending edits must
  not look active until validation/apply succeeds.
- Surface `restartRequired` and `reembedRequired` states from the API. Do not
  present embedding identity or dimension changes as a normal apply path when
  the API says reembedding is required.
- Use the WAVE-007 step-up flow for secret write/update and provider apply.
  Step-up state should be treated as recent-auth state, not as a new admin
  password prompt.

## Durable Memory Notes To Consider

- Record durable memory if final configuration UX creates stable conventions.

## Task-Level Definition of Done

- [ ] Configuration UI is implemented and covered.
- [ ] Secret values are never displayed.
- [ ] Dangerous provider/dimension changes are clearly warned.
- [ ] UI typecheck passes.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx`
- `npm --prefix ui run typecheck`

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
