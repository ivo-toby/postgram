---
id: EPIC-admin-configuration-frontend-SHARED-CONTEXT
kind: shared_context_index
epic: EPIC-admin-configuration-frontend
updated_at: 2026-07-06
---

# Shared Context: EPIC-admin-configuration-frontend

## Overview

This epic explores and implements a hardened web administration plane for
Postgram. The central risk is that admin UI convenience could turn Postgram into
an unsafe web-exposed single point of failure, so workers should read the
security and architecture resources before changing auth, admin APIs,
configuration, maintenance jobs, or Docker behavior.

## Resource Index

| Resource | Summary | Read When |
|----------|---------|-----------|
| resources/admin-surface-inventory.md | Current `pgm-admin` command inventory and initial web eligibility | Planning or implementing admin API/UI scope |
| resources/architecture.md | Proposed admin-plane architecture, config model, and service boundaries | Touching backend, config, Docker, or UI architecture |
| resources/api-contracts.md | Admin API route and response conventions for this epic | Adding or consuming admin endpoints |
| resources/migration-config-notes.md | Persistence, runtime settings, secret storage, and Docker config notes | Touching migrations, settings, secrets, or deployment |
| resources/security-model.md | Threat model seed and hard security requirements | Touching auth, sessions, MFA, admin APIs, secrets, or bootstrap |
| resources/testing-validation.md | Verification strategy and expected test coverage | Planning tasks, writing tests, or validating the epic |

## Key Decisions

- Epic profile is `full` because the work touches auth, secrets, privileged
  mutations, persistence, Docker, and broad UI.
- Admin auth must be separate from ordinary Postgram API-key bearer auth.
- Existing MCP connector OAuth is not an admin-login system. If admin
  OAuth/OIDC is added, it must be modeled separately.
- Web admin implementation should refactor shared services from `pgm-admin`
  behavior rather than shelling out to the CLI.
- Raw SQL and generic shell command execution are out of scope for the web UI.
- WAVE-001 first-scope admin surface is diagnostics plus API-key
  create/list/revoke, audit query, stats/health, read-only model list, and
  safe config read/validate. Destructive maintenance operations wait for job,
  dry-run, confirmation, step-up, and audit foundations.
- First-run bootstrap posture is a generated one-time token delivered through a
  trusted local operator channel, stored hash-only, required before first admin
  creation, and invalidated after first active MFA-backed admin setup.
- Admin route/session posture is now implemented under `/admin/api/*` with a
  dedicated `pgm_admin_session` HttpOnly cookie, `X-CSRF-Token` CSRF header,
  safe bootstrap/login errors, and no reuse of ordinary API-key or MCP OAuth
  bearer credentials as admin identity.
- Admin MFA/step-up posture is now implemented with encrypted TOTP factors via
  `ADMIN_MFA_SECRET_KEY`, active-admin middleware, a ten-minute step-up window,
  and first-admin activation only after MFA verification.
- Runtime configuration should be installation-wide DB-backed settings plus
  encrypted write-only secrets. One minimal installation encryption key may
  remain outside the DB through env/Docker secret.
- Settings and secret persistence is now implemented with
  `admin_runtime_settings`, `admin_runtime_secrets`,
  `ADMIN_SETTINGS_ENCRYPTION_KEY`, structured admin audit attribution, and
  secret validation metadata normalized/redacted to `{}`.
- Provider/config applies use explicit save/validate/apply states. Extraction
  tuning can reload the worker once implemented; embedding identity changes are
  migration-sensitive and require dedicated dry-run/apply jobs.
- Admin diagnostics are now implemented under `/admin/api/diagnostics/*` for
  active-MFA admin sessions only, with aggregate-only config-status redaction.
- Provider configuration is now implemented under
  `/admin/api/provider-config/*`, with DB-backed pending/applied values,
  write-only encrypted secrets, explicit validation/apply, SSRF-aware provider
  URL policy, recent step-up for secret writes/apply, and explicit
  restart/reembed impacts.
- Admin API-key management, audit query, and stats are now implemented under
  `/admin/api/keys`, `/admin/api/audit`, and `/admin/api/stats`, with active
  MFA admin sessions, CSRF on mutations, recent step-up for key create/revoke,
  one-time plaintext key display only on create, structured admin audit
  attribution, and audit-detail redaction.
- Admin job foundation is now implemented with `admin_jobs` and
  `admin_job_events`, read-only `/admin/api/jobs` status routes, idempotent
  apply-job creation semantics in the service layer, active-MFA/step-up
  authority checks for job creation, structured job audit events, and summary
  safety guards that reject secrets, ciphertext, token prefixes, arbitrary
  validation metadata, and provider response/body containers.
- Admin auth UI is now implemented in the frontend with a cookie-session admin
  API client, in-memory CSRF handling, bootstrap/login/MFA/step-up flows, a
  protected admin shell, and tests proving admin session/bootstrap/TOTP/provider
  secret material is not stored in localStorage.
- Maintenance admin APIs are now implemented under
  `/admin/api/maintenance/{reextract,reembed,prune-edges}/{dry-run,apply}`.
  Dry-runs and applies create admin jobs, apply requires recent step-up plus
  matching fresh preview evidence, and job summaries remain redacted safe JSON.

## Key Warnings

- First-run bootstrap is a takeover risk if exposed publicly before an admin
  user exists.
- Runtime provider settings are currently env-driven and constructed at
  startup; DB-backed config needs explicit lifecycle design.
- Embedding dimension changes are data migrations, not simple settings edits.
- Same-dimension embedding provider/model changes still invalidate existing
  embedding spaces and require migration/reembedding treatment.
- Secrets stored through the UI create backup, encryption, and rotation
  obligations.
- `LLM_REQUEST_TIMEOUT_MS` is documented/Docker-wired but currently read
  directly from `process.env`; formalize it before admin UI ownership.
- Maintenance operations in TASK-015 must build on the WAVE-006 job service
  instead of creating blocking HTTP maintenance requests. Apply jobs require a
  scoped idempotency key and recent step-up; job payload/result summaries must
  store only safe selectors and redacted summaries.

## Known Constraints

- `docker-compose.yml` currently starts Postgres, backend, and UI separately.
- The existing UI stores API keys in localStorage and cannot be reused as an
  admin auth boundary.
- Current Compose binds backend/UI to loopback by default, but reverse proxies
  can still expose setup. Loopback binding is not the admin security boundary.
- Runtime configuration value changes must update Docker and deployment-facing
  docs in the same change.
- The epic branch convention is `codex/epic/admin-configuration-frontend`.
- Wave 1 is a bundled feasibility/security gate. Broad implementation should
  start only after its reconciled decisions are read and the next wave is
  explicitly confirmed.

## Reconciliation History

### WAVE-001 Feasibility And Security Gate

- Status: done and reconciled on 2026-07-05.
- PR: https://github.com/ivo-toby/postgram/pull/78, merged at
  2026-07-05T12:39:56Z.
- Go/no-go: go for implementation, with a separate admin auth/session/MFA plane
  and no reuse of ordinary API-key bearer auth as admin identity.
- First implementation wave: TASK-004-admin-auth-persistence is ready for user
  confirmation as WAVE-002.
- Required carry-forward gates: TASK-004/TASK-005/TASK-006 must preserve the
  bootstrap ownership split, and TASK-010 must prove provider URL/egress/SSRF
  safety for admin-configured provider endpoints.

### WAVE-002 Admin Auth Persistence

- Status: merged and reconciled on 2026-07-05.
- PR: https://github.com/ivo-toby/postgram/pull/79, merged at
  2026-07-05T15:04:08Z.
- Merge commit: `0f96769`; freshness merge on task branch: `16122c0`.
- Review: Lorentz `REVIEW_PASS`, no P1/P2 findings.
- Implemented persistence contract:
  - `admin_users` with `pending_mfa`, `active`, and `disabled` status.
  - `admin_sessions` with hash-only session tokens, expiry, revocation, MFA
    completion timestamp, and last-used tracking.
  - `admin_mfa_factors` for pending/verified/disabled TOTP factor state.
  - `admin_bootstrap_tokens` with hash-only tokens, expiry, consumed/invalidated
    state, attempt counters, and single-use semantics.
  - `admin_auth_attempts` for login/bootstrap/MFA/step-up attempt history.
- Carry-forward gates:
  - TASK-005 must map route errors safely without leaking token or username
    validity, issue/clear HttpOnly cookies, enforce CSRF on mutations, reject
    ordinary API-key and MCP OAuth bearer auth on admin routes, and keep first
    admin `pending_mfa` until TASK-006 completes activation.
  - TASK-006 must use `admin_mfa_factors` and session MFA state to perform the
    active first-admin transition only after verified MFA.

### WAVE-003 Admin Session Routes

- Status: merged and reconciled on 2026-07-05.
- PR: https://github.com/ivo-toby/postgram/pull/80, merged at
  2026-07-05T16:25:30Z.
- Merge commit: `ecfe9ac`; task-branch freshness merge: `e3dd76a`.
- Review: Lorentz `REVIEW_PASS`, no P1/P2 findings.
- Implemented route/session contract:
  - `src/transport/admin.ts` registers `/admin/api/bootstrap/status`,
    `/admin/api/bootstrap/setup`, `/admin/api/session/login`,
    `/admin/api/session/current`, `/admin/api/session/csrf`, and
    `/admin/api/session/logout`.
  - `src/auth/admin-middleware.ts` validates `pgm_admin_session`, issues and
    verifies `X-CSRF-Token`, and sets no-store session response headers.
  - Bootstrap setup creates only a `pending_mfa` admin session; full admin
    authority still waits for TASK-006 MFA activation.
  - Bootstrap/login errors are intentionally generic, and ordinary Postgram API
    keys or MCP OAuth bearer tokens do not authorize admin routes.
- Carry-forward gates:
  - TASK-006 must treat pending-MFA sessions as setup/MFA-only and add the
    active/MFA/step-up guard for privileged admin operations.
  - TASK-007 and later admin APIs must compose the WAVE-003 session/CSRF
    middleware with the WAVE-004 active/MFA gate instead of adding another auth
    boundary.
  - TASK-011 must use cookie-based admin sessions and CSRF refresh, not
    localStorage admin bearer tokens.

### WAVE-004 Admin MFA And Settings Secret Store

- Status: merged and reconciled on 2026-07-05.
- PRs: https://github.com/ivo-toby/postgram/pull/81 and
  https://github.com/ivo-toby/postgram/pull/82, merged at
  2026-07-05T18:13:59Z and 2026-07-05T18:17:48Z.
- Merge commits: `b63ad08` for TASK-009 settings/secrets and `6666508` for
  TASK-006 MFA/step-up.
- Reviews: Lorentz `REVIEW_PASS` after P2 fixes for secret validation metadata
  redaction and structured MFA audit actor attribution.
- Implemented MFA/security contract:
  - `src/auth/admin-mfa-service.ts` stores TOTP factors encrypted with
    `ADMIN_MFA_SECRET_KEY`; plaintext seeds are write-only after enrollment.
  - `/admin/api/session/mfa/enroll`, `/mfa/verify`, `/mfa/challenge`, and
    `/session/step-up` extend the existing session/CSRF route family.
  - `createActiveAdminMiddleware` gates privileged routes on active admin
    status, MFA completion, and optional recent step-up.
- Implemented settings/secret contract:
  - `src/db/migrations/011_admin_settings.sql` adds
    `admin_runtime_settings`, `admin_runtime_secrets`, and
    `audit_log.admin_user_id`.
  - `src/services/admin-settings-service.ts` stores non-secret settings as
    typed JSON and provider secrets as AES-256-GCM ciphertext using
    `ADMIN_SETTINGS_ENCRYPTION_KEY`.
  - Secret read/list paths return configured metadata only; plaintext,
    ciphertext, hashes, reusable prefixes, and arbitrary validation metadata
    stay out of redacted reads.
- Carry-forward gates:
  - TASK-007 and later admin APIs must compose the WAVE-003 session/CSRF
    middleware with `createActiveAdminMiddleware`; sensitive mutations must set
    `requireStepUp: true`.
  - TASK-010 must build provider validation/apply on the merged settings
    service, preserve secret validation metadata redaction, and still prove
    provider URL/egress/SSRF safety.
  - TASK-011/TASK-013 frontend work must treat admin sessions as cookie/CSRF
    state, keep secret fields write-only, and never persist admin session,
    bootstrap, TOTP, or provider secret material in localStorage.

### WAVE-005 Admin API Diagnostics And Provider Config Apply

- Status: merged and reconciled on 2026-07-06.
- PRs: https://github.com/ivo-toby/postgram/pull/83 and
  https://github.com/ivo-toby/postgram/pull/84, merged at
  2026-07-06T06:27:29Z and 2026-07-06T11:31:10Z.
- Merge commits: `16985ef` for TASK-007 diagnostics and `f5efbc0` for
  TASK-010 provider config apply.
- Reviews: Lorentz `REVIEW_PASS`; TASK-010 required one P2 freshness fix after
  TASK-007 merged, resolved at task head `515cfa5`.
- Implemented admin API diagnostics contract:
  - `/admin/api/diagnostics/health`, `/queue`, `/models`, and
    `/config-status` live in the existing admin transport.
  - Diagnostics require active-MFA admin sessions and reject pending-MFA
    sessions plus ordinary API-key/MCP OAuth bearer credentials.
  - Config-status returns aggregate counts only for runtime settings/secrets.
- Implemented provider configuration contract:
  - `/admin/api/provider-config` supports redacted read, pending setting save,
    provider secret write, validate, and apply.
  - `src/services/admin-provider-config-service.ts` owns DB-over-env runtime
    resolution, validation freshness, connection tests, apply, and guarded
    runtime fetches for DB-applied provider URLs.
  - `src/db/migrations/012_admin_settings_applied_values.sql` stores
    last-applied values so pending edits do not change runtime behavior before
    apply.
  - Provider base URLs are treated as attacker-controlled admin input; unsafe
    schemes, credentials, query strings, fragments, private/reserved/link-local
    hosts, metadata endpoints, redirects, and DNS rebinding are rejected.
  - Secret writes and provider apply require recent step-up and structured
    `audit_log.admin_user_id` attribution.
- Carry-forward gates:
  - TASK-008 should extend the same admin transport and preserve diagnostics
    coexistence, active-MFA access, step-up for key create/revoke, one-time
    plaintext key display, and bearer rejection.
  - TASK-014/TASK-015 job and maintenance APIs must not persist provider
    plaintext, ciphertext, token prefixes, auth headers, or arbitrary
    validation metadata in job payloads or results.
  - TASK-013 should consume provider-config route warnings and keep secret
    fields write-only and blank on load.

### WAVE-006 Admin Key/Audit/Stats API And Job Foundation

- Status: merged and reconciled on 2026-07-06.
- PRs: https://github.com/ivo-toby/postgram/pull/85 and
  https://github.com/ivo-toby/postgram/pull/86, merged at
  2026-07-06T13:19:57Z and 2026-07-06T13:54:55Z.
- Merge commits: `13465eb` for TASK-008 key/audit/stats and `c5edbfc` for
  TASK-014 job foundation.
- Reviews: Lorentz `REVIEW_PASS`; TASK-014 required one P2 freshness fix to
  reconcile `src/transport/admin.ts` additively with TASK-008 routes.
- Implemented admin key/audit/stats contract:
  - `/admin/api/keys` supports list and create; create returns plaintext only
    in the one-time response.
  - `/admin/api/keys/:id/revoke` revokes an existing key.
  - `/admin/api/audit` supports filtered, paginated audit queries with
    redacted details and without self-observation pagination drift.
  - `/admin/api/stats` returns safe aggregate counts and database size/uptime.
  - Key create/revoke require CSRF and recent step-up; list/audit/stats require
    active MFA.
- Implemented admin job foundation:
  - `admin_jobs` and `admin_job_events` persist queued/running/cancel-requested
    and terminal states, progress, requested scope, request summaries, result
    summaries, idempotency keys, and admin actor attribution.
  - `src/services/admin-job-service.ts` owns create/read/list/start/progress,
    cancel-request, and terminal completion helpers with audit events.
  - `/admin/api/jobs` and `/admin/api/jobs/:jobId` expose read-only status
    under active-MFA admin sessions.
- Carry-forward gates:
  - TASK-011 and TASK-012 must consume the admin session/CSRF model and the
    WAVE-006 key/audit/stats response shapes without storing admin credentials
    or plaintext API keys beyond the one-time display flow.
  - TASK-015 must create concrete maintenance operations by using
    `admin-job-service` for dry-run/apply lifecycle, idempotency, progress,
    cancellation, result summaries, step-up, and audit. It must not store
    provider secrets, ciphertext, token prefixes, auth headers, or raw provider
    responses in job payloads/results.
  - TASK-016 must use job status polling rather than assuming maintenance
    operations complete synchronously.

### WAVE-007 Admin Auth UI And Maintenance Admin API

- Status: merged and reconciled on 2026-07-06.
- PRs: https://github.com/ivo-toby/postgram/pull/87 and
  https://github.com/ivo-toby/postgram/pull/88, merged at
  2026-07-06T15:48:11Z and 2026-07-06T17:02:28Z.
- Merge commits: `4e77a6b` for TASK-011 admin auth UI and `78f0f43` for
  TASK-015 maintenance admin API.
- Reviews: Lorentz `REVIEW_PASS`; TASK-015 required one P2 WDD task-file
  freshness fix, resolved at task head `ea88af4`.
- Implemented admin auth UI contract:
  - `ui/src/lib/adminApi.ts` is the browser admin API client. It uses
    same-origin credentials, keeps CSRF in memory, sends `X-CSRF-Token` on
    unsafe methods, and does not store admin bearer/session credentials.
  - `ui/src/components/admin/AdminAuth.tsx` implements bootstrap setup,
    login, MFA enrollment/challenge, step-up, logout, and a protected admin
    shell.
  - Admin UI tests prove route protection, MFA-error handling, and no
    localStorage persistence for admin session, bootstrap, TOTP, provider
    secret, or bearer credential material.
- Implemented maintenance API contract:
  - `src/services/admin-maintenance-service.ts` owns reextract, reembed, and
    constrained `llm-extraction` edge-prune preview/apply operations shared by
    web admin and `pgm-admin`.
  - `src/transport/admin-maintenance.ts` registers dry-run/apply routes for
    reextract, reembed, and prune-edges under the existing admin route
    boundary.
  - Dry-runs require active MFA and return `202` job responses with safe
    request metadata.
  - Applies require active MFA, recent step-up, a scoped idempotency key, and a
    fresh matching `previewJobId`. Retry with the same idempotency key returns
    the existing matching job.
  - Web edge pruning is intentionally constrained to the approved
    `llm-extraction` source instead of CLI's broader `any` selector.
- Carry-forward gates:
  - TASK-012/TASK-013 should extend `ui/src/lib/adminApi.ts` rather than adding
    another admin client or storing credentials outside the in-memory CSRF
    helper.
  - TASK-012 must keep one-time API-key plaintext display unrecoverable and not
    put key material into localStorage.
  - TASK-013 must keep provider secret fields write-only/blank on load and use
    WAVE-005 provider-config warnings for restart/reembed impacts.
  - TASK-016 must call the concrete maintenance dry-run/apply endpoints, require
    preview-before-apply UI flow, prompt step-up before apply, poll
    `/admin/api/jobs/:jobId`, and render only safe job summaries.

## Recent Durable Memory

- Durable memory `1f10a9c4-432b-42a2-a5f0-32505100e756`: this full-profile
  epic exists to prove whether `pgm-admin` and env-file operations can move
  into a hardened web admin plane without an unsafe single point of failure.
- Postgram's commercial direction favors managed private instances and private
  knowledge-base / private-intranet positioning.
- Existing OAuth/DCR support is opt-in for native remote MCP connectors and is
  live-bound to source API keys.
- Search-cleanup work added audited backend mutations plus API-key-scoped UI
  localStorage patterns, but localStorage is not a security boundary for admin.
