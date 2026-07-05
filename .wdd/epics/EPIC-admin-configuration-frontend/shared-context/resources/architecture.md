---
id: EPIC-admin-configuration-frontend-RESOURCE-architecture
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: architecture
updated_at: 2026-07-05
---

# Shared Context Resource: Architecture

## Purpose

Capture the initial architecture direction for a safe admin configuration
frontend.

## Summary

The admin frontend should be a separate admin plane inside the Postgram app,
not an extension of the current API-key-authenticated user UI. The backend
needs dedicated admin auth, dedicated admin API routes, a runtime settings
store, secret handling, and service-layer admin operations shared with
`pgm-admin` where appropriate.

## Proposed Boundaries

Backend:

- Add a dedicated admin route module, likely `src/transport/admin.ts`.
- Add admin auth/session services, likely under `src/auth/admin-*` or
  `src/admin/*`.
- Add admin operation services that wrap existing key, memory, graph,
  embedding, model, audit, stats, and queue logic.
- Keep `/api/*` bearer auth for ordinary user and agent workflows.
- Keep OAuth/DCR connector routes separate from admin login.
- Add a bootstrap/status flow that never returns bootstrap token material over
  HTTP.

Persistence:

- Add tables for admin users, sessions, MFA factors, login attempts or lockout
  state, runtime settings, secret metadata, and possibly admin job/progress
  state.
- Extend audit attribution so admin operations identify the admin actor even
  when `audit_log.api_key_id` is null.
- Add typed migrations and migration tests for all new tables.

Configuration:

- Current provider setup is env-driven in `src/config.ts` and `src/index.ts`.
- WAVE-001 chose installation-wide DB-backed runtime settings for UI-managed
  provider/config values.
- Secret values should be write-only after creation and encrypted at the
  application layer with an installation encryption key kept outside the DB.
- Provider/model changes need explicit save/validate/apply states. Extraction
  settings should reload the worker/factory when safe; embedding identity
  changes require migration job handling.
- Bootstrap-only deployment values such as `DATABASE_URL`, ports, bind hosts,
  and the installation encryption key stay outside browser editing.

Frontend:

- Add admin authentication screens separate from API-key login.
- Add an admin navigation surface distinct from Search, Graph, Projector, and
  Tasks.
- Use dense operational UI patterns: tables, forms, dry-run panels, explicit
  confirmation dialogs, progress states, and audit context.
- Do not rely on localStorage for admin secrets or sessions.

Docker:

- The desired operator path is `docker compose up`, then browser-based setup.
- Safe first-run bootstrap uses a generated one-time token delivered through a
  trusted local operator channel. Avoid a public unauthenticated setup screen
  that anyone can claim.
- Any new runtime configuration values must be reflected in Docker setup and
  docs.

## Service Extraction Notes

Prefer moving CLI behavior into shared services that both CLI and admin API can
call. This avoids:

- Shell command injection.
- Parsing human or JSON CLI output inside the server.
- CLI timeout and process-management edge cases.
- Hidden differences between CLI and web behavior.

Start with one low-risk read operation and one dangerous dry-run/apply operation
as proof before broad refactors.

## WAVE-001 Resolved Architecture Questions

- Runtime settings are global installation settings for the first version.
- Long-running maintenance and migration operations need explicit job records
  before web exposure.
- Admin bootstrap must prove local operator control with a one-time token; no
  admin account can be created merely because no admin exists yet.
- API-key bearer auth and MCP OAuth bearer tokens are rejected from admin
  routes.
- The current user UI API-key localStorage pattern is not reusable for admin
  sessions.

## WAVE-002 Implemented Persistence Boundary

PR #79 added the admin auth persistence layer and merged it in `0f96769`.

Concrete backend surface:

- `src/db/migrations/010_admin_auth.sql` creates `admin_users`,
  `admin_sessions`, `admin_mfa_factors`, `admin_bootstrap_tokens`, and
  `admin_auth_attempts`.
- `src/auth/admin-service.ts` exports service functions for admin user
  creation, password verification, session create/find/invalidate, bootstrap
  token create/consume, and atomic first-admin setup through
  `createFirstAdminWithBootstrapToken`.
- The route layer should use these services rather than duplicating password,
  session-token, bootstrap-token, or first-admin transaction logic.
- No HTTP routes, UI, OIDC admin login, or TOTP verification were added in
  WAVE-002; those remain owned by TASK-005/TASK-006.

Route/API implication:

- TASK-005 should add the dedicated admin transport and middleware around this
  persistence service.
- TASK-006 should add MFA/step-up behavior on top of the existing
  `admin_mfa_factors` and `admin_sessions.mfa_verified_at` state.

## Open Architecture Questions

- Can extraction provider settings be hot-reloaded safely in the first
  implementation, or should the UI initially mark them restart-required until a
  worker reload service is proven?
- Should the UI and backend continue as separate Docker services, or should the
  backend serve the built UI for simpler deployment?
- What is the exact installation encryption key name/format and Docker-secret
  generation path?

## Durable Memory

### Admin Plane Must Be Separate From User API Plane

- Source task: epic creation
- Source PR/branch: none
- Status: planning
- Summary: Admin auth, admin API routes, and admin sessions must be separate
  from ordinary API-key bearer auth.
- Why it matters: API keys are intentionally easy for agents to use; admin
  operations need stronger browser-session security and MFA.
- Affected files or areas: `src/auth/*`, `src/transport/rest.ts`,
  `src/transport/oauth.ts`, `ui/src/App.tsx`, Docker docs.
- Follow-up implications: Plan an auth foundation before exposing any admin
  mutation in the UI.
