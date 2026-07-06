---
id: EPIC-admin-configuration-frontend-RESOURCE-api-contracts
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: api-contracts
updated_at: 2026-07-06
---

# Shared Context Resource: API Contracts

## Purpose

Record admin API contract conventions for this epic.

## Summary

Admin endpoints must be a dedicated browser-session API, separate from the
existing `/api/*` bearer API used by agents and the existing `/oauth/*` MCP
connector flow. Use typed request/response schemas, explicit security headers,
CSRF protection for mutations, and audit-friendly operation names.

## Route Shape

Preferred namespace:

- `/admin/api/bootstrap/*` for first-run setup and bootstrap status.
- `/admin/api/session/*` for login, MFA challenge, logout, current session, and
  CSRF token refresh.
- `/admin/api/*` for authenticated admin operations.

Avoid:

- Reusing ordinary `/api/*` bearer auth for admin operations.
- Accepting Postgram API keys as admin credentials.
- Adding generic command execution routes.
- Adding SQL routes.

WAVE-001 route implications:

- Bootstrap status may be public but must expose only state, never token
  material.
- First admin setup must require bootstrap token proof. The route layer may
  create a pending/non-active first-admin setup state through TASK-004 services,
  but active admin access is completed only by the TASK-006 MFA enrollment and
  verification transition.
- Admin routes should ignore/reject `Authorization: Bearer` API keys or MCP
  OAuth access tokens rather than treating them as admin credentials.
- Maintenance routes must be typed operation routes, not CLI command passthrough
  routes.

## WAVE-003 Implemented Auth Routes

TASK-005 merged the first concrete admin route contract in PR #80.

Implemented endpoints:

- `GET /admin/api/bootstrap/status` returns only `{ state }`, where state is
  `unbootstrapped`, `locked`, `configured`, or `misconfigured`; it never returns
  bootstrap token material.
- `POST /admin/api/bootstrap/setup` accepts `bootstrapToken`, `email`,
  `password`, and optional `displayName`; on success it creates a `pending_mfa`
  first admin, sets the admin session cookie, and returns `state:
  "mfa_required"`, `user`, `session`, and `csrfToken`.
- `POST /admin/api/session/login` accepts `email` and `password`, applies the
  login lockout checks, sets the admin session cookie, and returns `user`,
  `session`, and `csrfToken`.
- `GET /admin/api/session/current` returns the current admin `user` and
  `session` for a valid admin session cookie.
- `GET /admin/api/session/csrf` returns a fresh `csrfToken` for a valid admin
  session cookie.
- `POST /admin/api/session/logout` requires a valid admin session and CSRF
  token, invalidates the session, clears the cookie, and returns `{ ok: true }`.

Implemented client/security contract:

- The session cookie name is `pgm_admin_session`; it is HttpOnly, SameSite
  `Lax`, path-scoped to `/admin`, and `Secure` when served over HTTPS or
  non-loopback HTTP hosts.
- Unsafe admin methods use `X-CSRF-Token`; future mutating admin routes should
  use the same header unless a reviewed route task replaces it everywhere.
- Session, CSRF, and bootstrap status responses set no-store/no-cache headers
  and vary on `Cookie`.
- Missing, invalid, expired, used, or malformed bootstrap tokens map to a safe
  generic setup failure. Login failures map to a safe generic sign-in failure.
- A pending-MFA session is not full admin authority. TASK-006 must add the
  active/MFA/step-up gate before business admin APIs use the session as
  privileged authorization.

## WAVE-004 Implemented MFA And Step-Up Routes

TASK-006 extended the same `/admin/api/session/*` browser-session contract in
PR #82.

Implemented endpoints:

- `POST /admin/api/session/mfa/enroll` requires a valid admin session and CSRF
  token, creates a pending TOTP factor, stores the encrypted factor seed, and
  returns the enrollment secret and `otpauthUrl` only for immediate setup.
- `POST /admin/api/session/mfa/verify` verifies the pending TOTP factor,
  activates the first bootstrap admin when appropriate, refreshes session MFA
  state, and returns `user`, `session`, `factor`, and `stepUp`.
- `POST /admin/api/session/mfa/challenge` verifies MFA for an active admin
  session and refreshes the session step-up marker.
- `POST /admin/api/session/step-up` requires an already active, MFA-verified
  admin session, verifies a TOTP code, and refreshes recent step-up state.

Middleware contract:

- `createAdminSessionMiddleware` proves only session and CSRF.
- `createActiveAdminMiddleware()` proves active admin status plus MFA
  completion.
- `createActiveAdminMiddleware({ requireStepUp: true })` is required for
  sensitive mutations such as provider secret writes, API-key create/revoke,
  destructive maintenance apply, and migration jobs.
- A pending-MFA session remains valid only for setup/current/csrf/logout/MFA
  flows and must not authorize diagnostics or business admin APIs.

## WAVE-004 Settings Service Handoff

TASK-009 added the persistence/service contract for future settings endpoints
in PR #81. HTTP routes are still owned by TASK-010 and later tasks.

Service contract:

- `src/services/admin-settings-service.ts` stores non-secret runtime settings
  as typed JSON in `admin_runtime_settings`.
- Provider secrets are stored through `saveRuntimeSecret` in
  `admin_runtime_secrets`, encrypted with `ADMIN_SETTINGS_ENCRYPTION_KEY`.
- Secret metadata reads return configured/provider/purpose/validation status
  only. They must never expose plaintext, ciphertext, nonces, auth tags, token
  hashes, reusable prefixes, or arbitrary provider validation metadata.
- `ADMIN_SETTINGS_HTTP_AUTHORITY_CONTRACT` records that future HTTP settings
  routes belong under `/admin/api/*`, reject ordinary API-key/MCP OAuth bearer
  credentials, use the admin session cookie plus CSRF, and require step-up for
  secret writes.

## WAVE-005 Implemented Diagnostics And Provider Config Routes

TASK-007 added the first read-only business-admin diagnostics contract in PR
#83.

Implemented diagnostics endpoints:

- `GET /admin/api/diagnostics/health` returns safe service health metadata.
- `GET /admin/api/diagnostics/queue` returns safe enrichment queue status.
- `GET /admin/api/diagnostics/models` returns embedding model diagnostics.
- `GET /admin/api/diagnostics/config-status` returns aggregate runtime
  settings and secret counts by state/classification/purpose/status.

Diagnostics authorization contract:

- Diagnostics routes are read-only, so they do not require CSRF or step-up.
- They still require a valid admin session plus active MFA via
  `createAdminSessionMiddleware({ enforceCsrf: false })` and
  `createActiveAdminMiddleware()`.
- Pending-MFA sessions receive `403`.
- Ordinary Postgram API-key bearer tokens and MCP OAuth bearer tokens receive
  `401`.
- Config status responses must remain aggregate-only. They must not expose
  secret names, plaintext, ciphertext, token prefixes, auth headers, or
  arbitrary validation metadata.

TASK-010 added provider configuration routes in PR #84.

Implemented provider config endpoints:

- `GET /admin/api/provider-config` reads redacted provider settings, secret
  metadata, env fallback state, pending/applied state, validation state, and
  apply warnings.
- `PUT /admin/api/provider-config` saves pending non-secret provider settings.
- `PUT /admin/api/provider-config/secrets` writes provider secrets.
- `POST /admin/api/provider-config/validate` validates settings and optional
  provider connectivity.
- `POST /admin/api/provider-config/apply` applies the validated pending
  provider configuration.

Provider config authorization contract:

- All provider config routes live under the same `/admin/api/*` browser-session
  boundary and reject ordinary bearer credentials.
- Mutations require CSRF.
- Secret writes and apply require `createActiveAdminMiddleware({ requireStepUp:
  true })`.
- Provider config mutations write structured admin actor attribution through
  `audit_log.admin_user_id`.

Provider config response contract:

- Secret inputs are write-only. Reads return configured/provider/purpose/status
  and timestamps only.
- Validation and connection-test failures must be redacted; provider response
  bodies, tokens, auth headers, and reusable prefixes must not be persisted or
  returned.
- Apply responses must make `restartRequired` and `reembedRequired` impacts
  explicit. Embedding identity changes are refused by simple apply and must
  flow through the migration/job path.
- Pending edits do not supersede last-applied DB values until apply succeeds;
  env values remain fallback when no DB value is applied.

## WAVE-006 Implemented Key/Audit/Stats And Job Routes

TASK-008 added API-key management, audit query, and stats routes in PR #85.

Implemented endpoints:

- `GET /admin/api/keys` lists API-key metadata with pagination.
- `POST /admin/api/keys` creates a Postgram API key and returns plaintext only
  in the create response.
- `POST /admin/api/keys/:id/revoke` revokes an API key and accepts an empty
  request body.
- `GET /admin/api/audit` returns filtered, paginated audit entries.
- `GET /admin/api/stats` returns safe aggregate Postgram stats.

Authorization and response contract:

- Key create/revoke require admin session, CSRF, active MFA, and recent step-up.
- Key list, audit, and stats require active MFA and reject ordinary bearer
  credentials.
- Key hashes, reusable prefixes, and plaintext keys are never returned after
  creation.
- Audit entries include structured `adminUserId`/`adminEmail` where present and
  redact common secret aliases plus secret-looking values in details.
- Audit query writes its own audit row but excludes admin audit API
  self-observation rows from paginated query results to avoid pagination drift.

TASK-014 added the admin job foundation in PR #86.

Implemented endpoints:

- `GET /admin/api/jobs` lists jobs with optional status filter and pagination.
- `GET /admin/api/jobs/:jobId` returns one job.

Job service contract for TASK-015 and later:

- Job modes are `dry_run` and `apply`; apply jobs require a scoped idempotency
  key.
- Job statuses are `queued`, `running`, `cancel_requested`, `succeeded`,
  `failed`, and `cancelled`.
- Job create requires active MFA; apply-mode job create requires recent
  step-up.
- Job payloads and result summaries must be safe JSON only. They may reference
  setting keys or secret names as identifiers, but must not store plaintext
  secrets, ciphertext, auth headers, token prefixes, arbitrary validation
  metadata, or provider response/body containers.
- Job lifecycle events write structured audit rows with operation names such as
  `admin.jobs.create`, `admin.jobs.progress`, and `admin.jobs.succeed`.

## Response Shape

Use the existing app error response style where practical:

- Success payloads should be JSON objects with stable top-level keys.
- Validation errors should identify the invalid field where feasible.
- Mutations should include the operation result and enough metadata for UI
  confirmation, but never return stored secret values.
- Dry-run responses should be explicit: `dryRun: true`, counts, target scope,
  and candidate summaries.
- Long-running operations should return a job ID and initial status rather than
  blocking request threads.
- Secret fields must be write-only. Read responses may include
  `configured: true`, validation status, timestamps, provider identity, and
  safe metadata, but never plaintext, hashes, ciphertext, or token prefixes
  unless a later security review explicitly allows a non-sensitive prefix.

## Security Contract

Admin API clients should rely on:

- HttpOnly admin session cookie.
- CSRF token for unsafe methods.
- SameSite cookie settings.
- Optional step-up token or recent-auth marker for sensitive actions.

Endpoints should reject:

- Missing admin session.
- Expired admin session.
- Missing or invalid CSRF token on mutation.
- Ordinary Postgram API-key bearer token.
- MCP OAuth bearer token.
- Missing or stale step-up state for sensitive mutations.

## Audit Contract

Every admin mutation should record:

- Admin actor ID.
- Operation name.
- Target ID or target scope.
- Safe request summary.
- Result summary.
- Failure summary where relevant.
- Whether the request was dry-run, apply, retry, cancel, or rollback where that
  applies.

Existing `audit_log` can be extended or complemented, but admin actor
attribution must not be hidden inside free-form details only.

## Open Contract Questions

- Should the admin route namespace be served by the backend only, or should the
  UI have a separate `/admin` build route?
- What job response model is needed for maintenance operations?

## WAVE-001 Contract Preferences

- Prefer a synchronizer CSRF token stored with the server-side admin session
  unless a later route task chooses and tests a different pattern.
- Prefer job responses for any operation that calls providers, scans many rows,
  deletes data, changes embedding identity, or may outlive a short HTTP
  request.
- Prefer separate dry-run and apply endpoints or an explicit `mode` field with
  strict enum validation. Apply requests should reference recent dry-run/job
  evidence where practical.
