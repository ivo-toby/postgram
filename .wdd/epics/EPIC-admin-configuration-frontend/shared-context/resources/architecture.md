---
id: EPIC-admin-configuration-frontend-RESOURCE-architecture
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: architecture
updated_at: 2026-07-06
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

## WAVE-003 Implemented Admin Transport Boundary

PR #80 added the first admin transport layer and merged it in `ecfe9ac`.

Concrete backend surface:

- `src/transport/admin.ts` registers the `/admin/api/bootstrap/*` and
  `/admin/api/session/*` route family.
- `src/auth/admin-middleware.ts` centralizes admin session cookie lookup,
  session validation, no-store response headers, CSRF token issuance, and CSRF
  enforcement for unsafe methods.
- `src/index.ts` wires `registerAdminRoutes(app, pool)` beside the existing
  REST, OAuth, and MCP transports without reusing ordinary bearer auth.
- TASK-005 route handlers call the WAVE-002 admin persistence services rather
  than duplicating password, bootstrap-token, or session-token logic.

Architecture implication:

- Future admin API files should extend the existing admin transport or split it
  behind the same `/admin/api/*` namespace; they should not create a second
  admin auth boundary.
- The current middleware verifies session and CSRF only. Privileged admin
  operations need the TASK-006 active-MFA and step-up middleware layered on top.
- Frontend work should call these routes with cookies and CSRF headers, not
  localStorage admin tokens or ordinary Postgram API keys.

## WAVE-004 Implemented MFA And Runtime Settings Boundaries

PR #82 completed the first active-admin boundary:

- `src/auth/admin-mfa-service.ts` owns TOTP enrollment, verification,
  challenge, step-up, encrypted factor seeds, and first-admin activation.
- `src/auth/admin-middleware.ts` now separates session/CSRF proof from active
  MFA proof. `createAdminSessionMiddleware` remains the cookie/CSRF layer;
  `createActiveAdminMiddleware` is the business-admin authorization layer.
- `src/transport/admin.ts` keeps MFA and step-up routes inside the existing
  `/admin/api/session/*` route family.

PR #81 completed the first runtime settings persistence boundary:

- `src/db/migrations/011_admin_settings.sql` extends `audit_log` with
  `admin_user_id` and adds `admin_runtime_settings` plus
  `admin_runtime_secrets`.
- `src/services/admin-settings-service.ts` owns settings/secret persistence,
  classification, validation state, redacted secret metadata, and audit writes.
- `ADMIN_SETTINGS_ENCRYPTION_KEY` and `ADMIN_MFA_SECRET_KEY` are minimal
  outside-database installation keys. Later Docker work must make their
  generation/persistence path explicit.

Architecture implication:

- TASK-007 should reuse the existing admin transport and compose
  `createAdminSessionMiddleware` with `createActiveAdminMiddleware`; read-only
  diagnostics are still privileged admin APIs and must not accept pending-MFA
  sessions.
- TASK-010 should build provider validation/apply around
  `admin-settings-service` rather than introducing a parallel settings store.
- TASK-014 and later maintenance work can rely on structured
  `audit_log.admin_user_id` for admin actor attribution.

## WAVE-005 Implemented Admin API And Provider Config Boundaries

PR #83 added the first read-only admin diagnostics service and routes:

- `src/services/admin-diagnostics-service.ts` owns safe diagnostics projection
  for health, queue, embedding model, and runtime config status.
- `src/transport/admin.ts` registers `/admin/api/diagnostics/*` inside the
  existing admin transport.
- Diagnostics compose session proof with active-MFA proof but do not require
  CSRF or step-up because they are read-only.
- Config diagnostics are intentionally aggregate-only so later ops dashboards
  cannot accidentally depend on secret names or arbitrary validation metadata.

PR #84 added the provider configuration service and focused route module:

- `src/services/admin-provider-config-service.ts` owns provider setting reads,
  pending saves, secret writes, validation, connection tests, apply, runtime
  resolution, and DB-over-env overlay behavior.
- `src/transport/admin-provider-config.ts` registers
  `/admin/api/provider-config/*` from the existing admin transport instead of
  creating a second admin namespace.
- `src/db/migrations/012_admin_settings_applied_values.sql` extends runtime
  settings with applied-value tracking so pending edits can coexist with the
  last applied runtime state.
- `src/index.ts` passes provider-config runtime options alongside diagnostics
  options when registering admin routes.

Runtime configuration implication:

- Env settings remain bootstrap/fallback values until an admin DB value is
  explicitly applied.
- Last-applied DB values continue to drive runtime behavior while pending edits
  wait for validation/apply.
- Provider base URLs from DB-backed settings use the reviewed egress policy and
  guarded fetch path at runtime; operator-controlled env fallback remains the
  existing deployment boundary.
- The first implementation reports restart-required and reembed-required
  impacts rather than pretending all provider changes can hot-reload.

Future architecture implications:

- TASK-008 should add API-key/audit/stats routes beside diagnostics/provider
  config in the same admin transport and keep response shapes typed.
- TASK-014 should add job persistence without overloading provider-config apply
  for long-running migration or maintenance work.
- TASK-013 should consume the provider-config routes as the source of truth for
  redacted secret state, validation state, and apply warnings.

## WAVE-006 Implemented Admin Key/Audit/Stats And Job Boundaries

PR #85 added the privileged API-key/audit/stats admin surface:

- `src/services/admin-key-service.ts` wraps existing API-key primitives for
  admin list/create/revoke, keeps plaintext API keys one-time only, and writes
  structured `audit_log.admin_user_id` attribution.
- `src/services/admin-audit-service.ts` owns filtered audit queries and
  redacts common secret aliases plus secret-looking values in details.
- `src/services/admin-stats-service.ts` owns safe aggregate count, database
  size, and uptime projection.
- `src/transport/admin.ts` registers `/admin/api/keys`, `/admin/api/audit`, and
  `/admin/api/stats` beside diagnostics/provider-config routes in the existing
  admin namespace.

PR #86 added the generic admin job foundation:

- `src/db/migrations/013_admin_jobs.sql` creates `admin_jobs` and
  `admin_job_events`.
- `src/services/admin-job-service.ts` owns job create/read/list/start/progress,
  cancel-request, terminal completion, idempotency, safe summary validation,
  and audit events.
- `src/transport/admin-jobs.ts` registers read-only `/admin/api/jobs` and
  `/admin/api/jobs/:jobId` status routes under the existing active-MFA admin
  boundary.
- `src/transport/admin.ts` now wires diagnostics, key/audit/stats, jobs, and
  provider-config routes additively.

Future architecture implications:

- TASK-011 and TASK-012 should build UI/API-client code against these concrete
  route shapes rather than inventing a separate admin client boundary.
- TASK-015 should implement maintenance operations as typed service functions
  that create and drive `admin_jobs`; it should not run long maintenance work
  synchronously in request handlers.
- TASK-015 should reference provider/runtime state by safe setting or secret
  identifiers and safe summaries only. Job payloads/results are not a secret
  storage or provider-response capture mechanism.

## WAVE-007 Implemented Admin Auth UI And Maintenance Boundaries

PR #87 added the first frontend admin auth shell:

- `ui/src/lib/adminApi.ts` is now the shared browser admin API client. It owns
  same-origin cookie requests, in-memory CSRF token handling, and typed auth/MFA
  calls.
- `ui/src/components/admin/AdminAuth.tsx` implements bootstrap setup, login,
  MFA enrollment/challenge, step-up, logout, and protected admin shell behavior.
- `ui/src/App.tsx` and `ui/src/components/TopBar.tsx` expose the admin entry
  without reusing the existing API-key localStorage auth path.

PR #88 added the first concrete admin maintenance service boundary:

- `src/services/admin-maintenance-service.ts` extracts maintenance operations
  from `pgm-admin` into shared typed service functions for reextract, reembed,
  and constrained edge pruning.
- `src/transport/admin-maintenance.ts` registers the maintenance route family
  from the existing admin transport.
- `src/services/admin-job-service.ts` gained helper behavior needed for
  preview evidence, idempotent apply retries, progress, cancellation, and safe
  terminal summaries.
- `src/transport/admin.ts` wires maintenance routes additively beside
  diagnostics, keys/audit/stats, jobs, and provider-config routes.

Future architecture implications:

- TASK-012/TASK-013 should extend `ui/src/lib/adminApi.ts` for dashboard and
  config calls rather than creating a second admin client or auth store.
- TASK-016 should build against the concrete
  `/admin/api/maintenance/{operation}/{dry-run,apply}` route family and the
  existing `/admin/api/jobs/:jobId` polling contract.
- Future maintenance or migration operations should add typed operation modules
  around shared services; they should not add CLI passthrough, raw SQL, or
  synchronous long-running request handlers.

## Open Architecture Questions

- Can extraction provider settings be hot-reloaded safely after the first
  provider-config implementation, or should the UI continue to mark them
  restart-required until a worker reload service is proven?
- Should the UI and backend continue as separate Docker services, or should the
  backend serve the built UI for simpler deployment?
- What is the Docker-secret generation and persistence path for
  `ADMIN_SETTINGS_ENCRYPTION_KEY` and `ADMIN_MFA_SECRET_KEY`?

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
