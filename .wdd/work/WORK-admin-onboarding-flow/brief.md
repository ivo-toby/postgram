---
id: WORK-admin-onboarding-flow
kind: work_packet
profile: micro
slug: admin-onboarding-flow
title: Admin Onboarding Flow
status: planned
created_at: 2026-07-08
updated_at: 2026-07-08
target_branch: codex/epic/admin-configuration-frontend
base_branch: codex/work/admin-onboarding-flow
schema_version: 1
task_count: 3
adapter_links:
  github_issue: null
  jira_issue: null
---

# Admin Onboarding Flow

## Summary

Add a resumable first-run admin onboarding flow for fresh Docker installs. The
flow should guide an operator through the existing admin setup, runtime provider
configuration, validation/apply, backup/restore safety, and maintenance
concepts with plain explanations. It must resume after logout, refresh, Docker
restart, or browser close without resetting the existing Postgres volume.

## Goal

Operators who install Postgram from Docker should be able to open the admin UI,
create the first admin, enroll MFA, and then follow a guided setup path that
explains each decision before they make it. If they abort, the admin dashboard
should resume at the latest incomplete onboarding step.

## Scope

- Included:
  - Persistent onboarding state owned by the admin subsystem.
  - Admin API routes to read, update, skip, and complete onboarding progress.
  - Admin UI onboarding flow that reuses existing Config, Backup, Maintenance,
    and Help concepts instead of duplicating every setting screen.
  - Resume behavior after browser reload, logout/login, and container restart.
  - Docker-safe test/docs path that preserves existing `pgdata`.
- Excluded:
  - A destructive database reset path.
  - Multi-admin role management.
  - Real-time per-step progress metrics.
  - Replacing existing Config, Backup, Maintenance, or Help tabs.

## Non-Scope

- Shipping a hosted SaaS onboarding service.
- Changing provider validation semantics beyond what onboarding needs to call
  existing APIs safely.
- Reworking the final admin epic PR structure except for adding this work.

## Relevant Context

- `src/transport/admin.ts`
- `src/services/admin-provider-config-service.ts`
- `src/db/migrations/010_admin_auth.sql`
- `src/db/migrations/011_admin_settings.sql`
- `ui/src/components/admin/AdminAuth.tsx`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminConfig.tsx`
- `ui/src/components/admin/AdminBackup.tsx`
- `ui/src/components/admin/AdminMaintenance.tsx`
- `ui/src/components/admin/AdminHelp.tsx`
- `ui/src/lib/adminApi.ts`
- `tests/contract/admin-auth-routes.test.ts`
- `tests/integration/admin-provider-config.test.ts`
- `ui/src/components/AdminAuth.test.tsx`
- `ui/src/components/AdminConfig.test.tsx`
- `ui/src/components/AdminBackup.test.tsx`
- `README.md`
- `docker-compose.yml`

## Parallelization Notes

The work can split conceptually into persistence/API, guided UI, and Docker/docs
validation, but the code touches shared admin API client types and dashboard
wiring. Use bundled execution for this micro-wave to avoid branch conflicts and
make the UX/API contract evolve together. Require separate review because the
work touches persistence, auth-adjacent admin routes, and first-run UX.

## Validation Strategy

- Backend contract tests for onboarding state read/update/skip/complete routes.
- Migration-level verification that onboarding state persists in Postgres.
- UI tests for first-run prompt, resume behavior, skip/complete behavior, and
  onboarding navigation into Config/Backup/Maintenance guidance.
- Existing admin UI regression tests for Auth, Config, Backup, Maintenance, and
  Ops dashboard.
- Typechecks and builds for root and UI.
- Docker guidance must explicitly preserve the `pgdata` volume and avoid
  `docker compose down -v`.

## Definition of Done

- [ ] Scope is complete.
- [ ] Onboarding progress persists server-side and resumes after reload/login.
- [ ] The UI guides a fresh operator through setup in plain language.
- [ ] Operators can skip or mark onboarding complete deliberately.
- [ ] Existing Postgres volume preservation is documented for local testing.
- [ ] Verification evidence is recorded.
- [ ] Required review is complete.
- [ ] Final handoff is ready.

## Open Questions

- None. Default behavior: show onboarding automatically after active MFA login
  until it is completed or skipped, and keep it available from the dashboard.

## Finish Notes

- Planned tasks:
  - `TASK-001-onboarding-state-api`
  - `TASK-002-onboarding-guided-ui`
  - `TASK-003-onboarding-validation-docs`
