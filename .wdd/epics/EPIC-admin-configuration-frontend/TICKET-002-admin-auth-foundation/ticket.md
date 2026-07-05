---
id: TICKET-002-admin-auth-foundation
kind: ticket
epic: EPIC-admin-configuration-frontend
slug: admin-auth-foundation
title: Admin Auth Foundation
status: in-progress
task_count: 3
depends_on:
  - TASK-001-admin-surface-inventory
  - TASK-002-threat-model-bootstrap
conflict_domains:
  - src/auth/**
  - src/db/migrations/**
  - tests/helpers/**
  - tests/integration/**
  - tests/contract/**
adapter_links:
  github_issue: null
---

# Admin Auth Foundation

## Summary

Build the dedicated admin identity, session, MFA, CSRF, lockout, and bootstrap
foundation required before any admin API mutation exists.

## Objective

Create a browser-session admin security boundary separate from Postgram API
keys and MCP OAuth tokens.

## Scope

- Included: migrations, services, auth routes, middleware, tests, audit actor
  model as needed.
- Excluded: admin business operations and broad UI.

## Non-Scope

- Do not expose `pgm-admin` behavior yet.
- Do not implement enterprise SSO unless Wave 1 explicitly chooses it for first
  scope.

## Shared Context References

- `../shared-context/resources/security-model.md`
- `../shared-context/resources/api-contracts.md`
- `../shared-context/resources/migration-config-notes.md`
- `../shared-context/resources/testing-validation.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-004-admin-auth-persistence | in-progress | WAVE-002 | Add admin user/session/MFA persistence and core service tests |
| TASK-005-admin-session-routes | todo | WAVE-003 | Add bootstrap/login/logout/session middleware, CSRF, and lockout |
| TASK-006-admin-mfa-step-up | todo | WAVE-004 | Add TOTP MFA and step-up enforcement for sensitive actions |

## Dependencies

- Depends on: TASK-001-admin-surface-inventory, TASK-002-threat-model-bootstrap.
- Blocks: admin APIs, admin frontend, maintenance UI, Docker no-CLI flow.

## Conflict Domains

- `src/auth/**`
- `src/transport/**`
- `src/db/migrations/**`
- `tests/helpers/**`
- `tests/integration/**`
- `tests/contract/**`

## Validation Expectations

- Focused auth, session, CSRF, MFA, and middleware tests must pass.

## Review Focus

- Session security, bootstrap takeover prevention, CSRF enforcement, MFA
  bypasses, lockout/rate limit behavior, audit actor attribution.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.
