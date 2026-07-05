---
id: TICKET-005-admin-frontend
kind: ticket
epic: EPIC-admin-configuration-frontend
slug: admin-frontend
title: Admin Frontend
status: planned
task_count: 3
depends_on:
  - TASK-006-admin-mfa-step-up
  - TASK-008-admin-key-audit-stats-api
  - TASK-010-provider-config-apply
conflict_domains:
  - ui/src/App.tsx
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
adapter_links:
  github_issue: null
---

# Admin Frontend

## Summary

Build the browser admin experience for bootstrap/login/MFA, operational
dashboard, API-key management, audit/stats, and runtime configuration.

## Objective

Give operators a usable admin frontend that avoids API-key localStorage for
admin auth and uses safe operational UI patterns.

## Scope

- Included: admin auth screens, route protection, admin navigation, key/audit
  UI, stats/health, configuration forms.
- Excluded: maintenance job UI until maintenance APIs exist.

## Non-Scope

- Do not create a marketing landing page or self-service SaaS signup flow.

## Shared Context References

- `../shared-context/resources/architecture.md`
- `../shared-context/resources/api-contracts.md`
- `../shared-context/resources/security-model.md`
- `../shared-context/resources/testing-validation.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-011-admin-auth-ui | todo | WAVE-007 | Add bootstrap/login/MFA UI and protected admin shell |
| TASK-012-admin-ops-dashboard-ui | todo | WAVE-008 | Add API key, audit, stats, health, and queue admin pages |
| TASK-013-admin-config-ui | todo | WAVE-008 | Add runtime configuration UI with validation and redaction |

## Dependencies

- Depends on: TASK-006-admin-mfa-step-up, TASK-008-admin-key-audit-stats-api,
  TASK-010-provider-config-apply.
- Blocks: maintenance UI and final no-CLI validation.

## Conflict Domains

- `ui/src/App.tsx`
- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`
- `ui/src/styles/**`

## Validation Expectations

- UI tests cover auth flow, route protection, redaction, error states, and core
  admin pages.

## Review Focus

- Admin session handling, no localStorage secret use, UX friction for dangerous
  settings, responsive operational layout.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.
