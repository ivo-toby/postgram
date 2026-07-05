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

Persistence:

- Add tables for admin users, sessions, MFA factors, login attempts or lockout
  state, runtime settings, secret metadata, and possibly admin job/progress
  state.
- Extend audit attribution so admin operations identify the admin actor even
  when `audit_log.api_key_id` is null.
- Add typed migrations and migration tests for all new tables.

Configuration:

- Current provider setup is env-driven in `src/config.ts` and `src/index.ts`.
- Feasibility work must decide which values move into a DB-backed settings
  service.
- Secret values should be write-only after creation and encrypted or otherwise
  protected according to the chosen key-management strategy.
- Provider/model changes need validation before save and an apply strategy:
  hot reload, worker reinitialization, controlled restart, or queued
  maintenance.

Frontend:

- Add admin authentication screens separate from API-key login.
- Add an admin navigation surface distinct from Search, Graph, Projector, and
  Tasks.
- Use dense operational UI patterns: tables, forms, dry-run panels, explicit
  confirmation dialogs, progress states, and audit context.
- Do not rely on localStorage for admin secrets or sessions.

Docker:

- The desired operator path is `docker compose up`, then browser-based setup.
- Safe first-run bootstrap is the hardest Docker question. Avoid a public
  unauthenticated setup screen that anyone can claim.
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

## Open Architecture Questions

- Should runtime settings be global installation settings only, or scoped by
  profile/environment?
- Should long-running maintenance jobs be stored as explicit job records?
- Can provider settings be hot-reloaded safely, or should the UI drive a
  controlled restart/reinitialize flow?
- Should the UI and backend continue as separate Docker services, or should the
  backend serve the built UI for simpler deployment?

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
