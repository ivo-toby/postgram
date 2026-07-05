---
id: EPIC-admin-configuration-frontend-RESOURCE-security-model
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: security-model
updated_at: 2026-07-05
---

# Shared Context Resource: Security Model

## Purpose

Seed the threat model and hard requirements for the admin frontend.

## Summary

The admin frontend is a high-value target because it can create API keys,
change providers and secrets, trigger expensive jobs, mutate memory/graph data,
and potentially affect every agent connected to the instance. Treat the admin
plane like an operations console, not a convenience page.

WAVE-001 inspected:

- `docker-compose.yml`
- `src/auth/*`
- `src/transport/oauth.ts`
- `src/index.ts`
- `README.md`
- Current UI API-key login/localStorage behavior

The current application has ordinary `/api/*` bearer auth and optional MCP
connector OAuth. Neither is an admin-login boundary. Admin auth, sessions,
MFA, CSRF, bootstrap, and sensitive mutation controls must be new admin-plane
constructs.

## RED Findings Resolved By This Model

- The seed model named bootstrap risk but did not choose a first
  implementation posture.
- The seed model did not define the trust boundaries between admin sessions,
  API-key bearer auth, and MCP connector OAuth precisely enough for later
  route work.
- Later implementation tasks needed concrete review gates for bootstrap,
  session cookies, CSRF, MFA, secrets, destructive operations, and Docker
  exposure.

## Threats To Cover

- First-run takeover by a remote visitor before the real operator creates an
  admin user.
- Brute-force or credential-stuffing against the admin login.
- Session theft or fixation.
- CSRF against destructive admin endpoints.
- XSS leading to admin action execution.
- Ordinary API key or OAuth token being accepted as admin authority.
- MFA bypass, reset abuse, or weak recovery path.
- Secret disclosure through API responses, logs, browser storage, audit rows,
  or backups.
- Dangerous operation misuse: broad purge, reembedding, reextraction, edge
  pruning, model migration, or memory grooming.
- Long-running job confusion: repeated clicks, duplicate jobs, lost progress,
  unclear partial failure, or hidden cost.
- Public exposure through Docker/reverse proxy defaults.

## Assets And Trust Boundaries

Primary assets:

- Admin user identities, password hashes, MFA factors, recovery/reset state,
  and admin sessions.
- Bootstrap token material and first-admin setup state.
- Runtime provider settings and encrypted provider secrets.
- Postgram API keys, OAuth connector tokens, and the source API keys from which
  OAuth tokens derive authority.
- Entity, chunk, edge, task, audit, and runtime settings data.
- Long-running maintenance jobs and their progress/results.

Trust boundaries:

- Public browser to admin routes: untrusted until an admin session, CSRF token,
  and any required step-up state are verified.
- Browser admin session to ordinary `/api/*`: admin sessions do not imply
  ordinary API-key access unless a specific admin operation creates or displays
  an API key.
- Ordinary API-key bearer auth to admin routes: must always be rejected.
- MCP OAuth bearer auth to admin routes: must always be rejected.
- Reverse proxy to backend: headers are not trusted for auth unless explicitly
  configured and normalized by admin middleware in a later, reviewed design.
- Backend to database: database mutations must preserve audit attribution and
  redaction invariants.
- Backend to provider APIs/Ollama/OpenAI-compatible endpoints: external calls
  can fail, hang, leak prompts to configured providers, or create cost.
- Docker host/local operator channel to browser setup: possession of the
  bootstrap token proves local operator access; web reachability alone does
  not.

Attacker-controlled inputs include admin login fields, bootstrap token entry,
MFA codes, CSRF-bearing forms, all admin JSON request bodies, query filters,
provider/base URLs, model names, secrets, maintenance selectors, OAuth
registration/authorize/token inputs, API keys, and entity content processed by
maintenance jobs.

## Hard Requirements

- Admin auth must not use localStorage API keys.
- Admin sessions should use HttpOnly, SameSite cookies with secure settings
  when served over HTTPS.
- Mutating admin endpoints must require CSRF protection.
- Login, MFA, and sensitive mutation endpoints must be rate-limited.
- Passwords must be hashed with Argon2id or an equivalently strong password
  hashing strategy.
- Password policy must reject obviously weak passwords.
- MFA must be required for the supported production/admin posture.
- Step-up auth or recent re-auth must protect secret changes, key creation,
  key revocation, destructive maintenance, and broad data operations.
- Ordinary API keys and OAuth access tokens must receive 401/403 on admin
  endpoints.
- Secrets must be write-only after storage and redacted in logs, audit, API
  responses, and UI.
- Every admin mutation must write an audit event with actor, operation, target,
  request summary, result, and failure where appropriate.
- Raw SQL and shell execution must not be web-exposed.

## Chosen Bootstrap Posture

WAVE-001 chooses a generated one-time bootstrap token delivered through a
trusted local operator channel as the first implementation path.

Required behavior:

- On an unbootstrapped instance, the backend creates a high-entropy one-time
  bootstrap token if no unexpired token exists.
- Only a hash of the token is stored in the database or bootstrap state.
- The plaintext token is displayed exactly through a trusted local channel,
  initially container logs and/or a local-only operator command, not through
  the public browser page.
- The web setup flow requires the bootstrap token before creating the first
  admin account.
- First admin setup must enroll MFA before the account becomes fully active.
- The bootstrap token is single-use, expires, is rate-limited, is audited, and
  is invalidated once an admin account is active.
- Once an active admin exists, bootstrap routes return locked/configured status
  and cannot create another first admin.
- If token generation/storage fails, the UI shows a locked/misconfigured state
  rather than an unauthenticated setup form.
- A future Docker task may add an explicit Docker secret/env override for
  operators who do not want log-delivered bootstrap tokens, but public web
  reachability alone must never be enough to claim setup.

Rationale:

- Loopback-only setup is not sufficient because a reverse proxy can expose the
  setup page publicly.
- A generated one-time token keeps the supported Docker path simple while
  proving local operator control.
- Hash-only storage keeps database backups from containing a usable bootstrap
  token.
- Requiring MFA in the first-admin flow avoids a weak no-MFA bootstrap gap that
  later tasks would have to close under live admin access.

Rejected as first implementation paths:

- Browser-only "no admin exists, show setup wizard" because it is vulnerable to
  public first-run takeover.
- Permanent static default credentials because they create known-secret risk.
- Treating an existing Postgram API key as bootstrap authority because API keys
  are agent/user credentials, not admin identities.
- Treating MCP connector OAuth authorization as admin login because that flow
  intentionally inherits ordinary API-key authority.

## Bootstrap Requirements

The bootstrap implementation must prove:

- Only the legitimate operator can create the first admin account.
- Setup cannot be claimed remotely just because no admin exists yet.
- The bootstrap token or equivalent secret expires or is invalidated after use.
- Bootstrap attempts are logged and rate-limited.
- The UI clearly signals whether the instance is unbootstrapped, locked,
  configured, or misconfigured.

Implementation notes for later workers:

- Add a bootstrap status endpoint that reveals state only:
  `unbootstrapped`, `locked`, `configured`, or `misconfigured`.
- Do not return the bootstrap token from any HTTP endpoint.
- Do not store the plaintext token in audit rows.
- Rate-limit failed bootstrap attempts by IP and token hash bucket where
  feasible, without logging the raw token.
- Require password policy validation and MFA enrollment before marking the
  first admin active.

Implementation ownership split:

- TASK-004 owns bootstrap token persistence and service contracts: hash-only
  token storage, expiry, single-use consumption, invalidation after use, and
  the atomic persistence contract that consumes the token while creating the
  first admin in a non-active/pending-MFA state.
- TASK-005 owns bootstrap route behavior: public status state, setup request
  parsing, safe HTTP errors for missing/invalid/expired/used tokens, session
  cookie behavior, CSRF semantics, and bearer-token denial on admin routes.
- TASK-006 owns MFA completion and activation: TOTP enrollment/verification,
  session MFA state, step-up helpers, and the testable transition proving the
  first admin is not active until MFA is verified.

## WAVE-002 Reconciled Auth Persistence

TASK-004 implemented the persistence side of the admin auth boundary in PR #79
and merged it in `0f96769`.

Persisted security state:

- Admin users start as `pending_mfa`; ordinary creation cannot create active
  non-MFA admins.
- Admin sessions store hash-only high-entropy tokens with expiry, revocation,
  optional `mfa_verified_at`, and last-used tracking.
- Bootstrap tokens are hash-only, expiring, single-use, and record failed
  attempts without storing plaintext token material.
- First-admin creation locks/serializes the setup path, consumes the bootstrap
  token, creates a non-active `pending_mfa` admin, and invalidates remaining
  bootstrap tokens in one transaction.
- MFA factors are represented as TOTP records with pending/verified/disabled
  states; TASK-006 owns secret encryption, verification, and activation flow.
- Admin auth attempts record login/bootstrap/MFA/step-up attempt history for
  later lockout/rate-limit and audit behavior.

Carry-forward security gates:

- TASK-005 route handlers must not leak username or bootstrap token validity in
  HTTP errors.
- TASK-005 must reject ordinary Postgram API-key bearer auth and MCP OAuth
  bearer tokens on all admin routes.
- TASK-005 may create sessions, but a pending-MFA first admin must not receive
  full admin authority until TASK-006 verifies MFA and performs activation.
- TASK-006 must transition first-admin state from `pending_mfa` to `active`
  only after verified MFA enrollment/challenge, and must keep TOTP secrets
  write-only/redacted.

## WAVE-003 Reconciled Admin Session Routes

TASK-005 implemented the admin HTTP session boundary in PR #80 and merged it in
`ecfe9ac`.

Implemented security behavior:

- Admin auth routes live under `/admin/api/*` and are registered separately
  from ordinary `/api/*` bearer routes and MCP OAuth routes.
- Bootstrap status exposes only coarse state and never returns token material.
- Bootstrap setup uses the TASK-004 `createFirstAdminWithBootstrapToken`
  transaction and maps missing, invalid, expired, used, malformed, validation,
  and rate-limited token failures to safe route errors without token-validity
  leakage.
- Login uses the TASK-004 password verifier and safe generic sign-in errors.
  The service keeps the dummy Argon2 verification path for missing-user timing
  resistance, and route-level lockout checks include a global failure budget as
  well as identifier-specific checks.
- Admin sessions are carried by the HttpOnly `pgm_admin_session` cookie with
  SameSite `Lax`, `/admin` path scope, and environment-aware `Secure` behavior.
- Mutating admin session routes require `X-CSRF-Token`; missing or invalid CSRF
  receives `403`.
- Session and bootstrap responses set no-store/no-cache headers and vary on
  `Cookie`.
- Ordinary Postgram API-key bearer tokens and MCP OAuth bearer tokens do not
  satisfy admin session middleware.

Carry-forward security gates:

- A `pending_mfa` session created by bootstrap/setup or login is not full admin
  authority. Until TASK-006 lands, it should be treated as setup/current/csrf/
  logout-capable only.
- TASK-006 must add the active-admin/MFA completion check and step-up helper.
  Later business admin routes must compose that gate with the WAVE-003 session
  and CSRF middleware.
- If later proxy/TLS work changes trusted-header handling, it must retest
  cookie `Secure` behavior; loopback HTTP remains for local development only.

## WAVE-004 Reconciled MFA And Secret Controls

TASK-006 and TASK-009 completed the MFA/step-up and settings/secret-store
security foundations in PR #82 and PR #81.

Implemented MFA controls:

- TOTP factor seeds are encrypted before persistence using
  `ADMIN_MFA_SECRET_KEY`; plaintext seeds are returned only during enrollment.
- MFA verification is the only path that transitions the first bootstrap admin
  from `pending_mfa` to `active`.
- `admin_sessions.mfa_verified_at` is the step-up marker. The default freshness
  window is ten minutes through `ADMIN_STEP_UP_TTL_MS`.
- `createActiveAdminMiddleware` denies pending-MFA sessions, inactive users,
  missing MFA verification, and stale step-up state when `requireStepUp` is
  enabled.
- MFA enrollment, verification, challenge, and step-up attempts are audited.
  When `audit_log.admin_user_id` exists, MFA audit rows populate it
  structurally instead of hiding actor attribution only in JSON details.
- MFA verification and step-up routes have direct rate-limit regression
  coverage.

Implemented settings and secret controls:

- `admin_runtime_settings` stores typed non-secret JSON values only. Secret-
  shaped keys such as provider API keys are rejected from plain settings paths.
- `admin_runtime_secrets` stores provider secrets as AES-256-GCM ciphertext,
  nonce, auth tag, key version, provider, purpose, and validation status using
  the installation key supplied through `ADMIN_SETTINGS_ENCRYPTION_KEY`.
- Secret read/list paths return configured metadata only. They never return
  plaintext, ciphertext, hashes, auth tags, reusable token prefixes, or
  caller-provided validation metadata.
- Secret validation metadata is normalized/redacted to `{}` before persistence
  and on readback so provider responses, authorization headers, token prefixes,
  or other attacker-supplied metadata cannot leak through redacted reads.
- Settings and secret saves write admin audit rows with structured
  `audit_log.admin_user_id` attribution where available.

Carry-forward security gates:

- Every privileged admin API added after WAVE-004 should compose
  `createAdminSessionMiddleware` with `createActiveAdminMiddleware`. Secret
  writes, key create/revoke, dangerous config apply, maintenance apply, and
  migration jobs must require recent step-up.
- TASK-010 must treat admin-configured provider URLs as attacker-controlled and
  define/test the egress/SSRF policy before running connection tests.
- UI tasks must never store admin session tokens, bootstrap tokens, TOTP seeds,
  provider secrets, or admin bearer credentials in localStorage.

## OAuth/OIDC Boundary

Existing OAuth/DCR is for native remote MCP connectors. It lets external clients
obtain OAuth tokens that resolve to an API-key-derived `AuthContext`.

Admin OAuth/OIDC login, if implemented, must be separate:

- Different tables or clearly separate records.
- Different routes and issuer/client semantics as needed.
- Different session creation flow.
- No path where MCP connector OAuth grants become admin sessions.

## Admin Session And Mutation Controls

Minimum session posture:

- HttpOnly session cookie.
- SameSite cookie policy. Use `Lax` as the default browser posture unless an
  explicit cross-site deployment mode is designed and reviewed.
- `Secure` cookies when the request is HTTPS or the deployment is configured
  behind trusted TLS termination.
- Server-side session records with expiry, rotation on login, revocation on
  logout/password/MFA reset, and last-used tracking.
- CSRF token required on every unsafe admin method.
- Login, bootstrap, MFA, CSRF refresh, and step-up endpoints rate-limited.

Step-up required for:

- Provider secret changes.
- API-key creation and revocation.
- Bootstrap/admin-user recovery flows.
- Destructive maintenance operations.
- Embedding migrations and data purge.
- Durable memory rewrite/archive actions.

## Docker Exposure Requirements

Current Compose defaults bind backend and UI to `127.0.0.1`, with optional
`PORT_BIND_HOST=0.0.0.0` and `UI_BIND_HOST=0.0.0.0` exposure. That is a safer
default, but it is not the admin security boundary.

Later Docker/admin tasks must:

- Keep loopback defaults unless a reviewed public/reverse-proxy deployment mode
  is documented.
- Document that reverse proxies can expose first-run setup and therefore still
  require the bootstrap token.
- Require TLS for production admin sessions.
- Ensure admin cookie `Secure` behavior works behind the recommended proxy.
- Ensure setup status pages do not leak secrets, provider tokens, environment
  values, or whether a guessed token prefix was valid.

## Security Review Gates

Before implementation tasks are considered safe, tests/review must prove:

- Public setup without a bootstrap token cannot create an admin.
- Used, expired, or missing bootstrap tokens cannot create an admin.
- First-admin setup creates at most a non-active/pending-MFA admin until TASK-006
  verifies MFA and performs the active transition.
- Ordinary API keys and MCP OAuth bearer tokens receive 401/403 from admin
  routes.
- Admin mutations reject missing/invalid CSRF tokens.
- Session cookies are HttpOnly and have the expected SameSite/Secure behavior.
- Login/bootstrap/MFA/step-up attempts are rate-limited or locked out.
- Secrets are write-only and redacted from responses, logs, audit rows, and UI.
- Sensitive mutations require step-up and write audit rows with admin actor
  attribution.
- Destructive operations require dry-run or explicit confirmation according to
  the command inventory.

## Open Security Questions

- WAVE-003 implemented HMAC-signed CSRF tokens presented via `X-CSRF-Token` for
  admin session routes. Later route design may replace this only with a
  reviewed, cross-route migration and tests.
- The exact MFA recovery/reset path is still open. Do not add a weak recovery
  shortcut in the first implementation.
- Trusted reverse-proxy header handling is still open and should not be assumed
  until Docker/proxy deployment docs are updated.

## Durable Memory

### First-Run Bootstrap Is The Highest-Risk UX

- Source task: epic creation
- Source PR/branch: none
- Status: planning
- Summary: The first admin setup flow must prevent public takeover before any
  admin user exists.
- Why it matters: A web setup wizard that appears safe on localhost can become
  dangerous when deployed behind a public reverse proxy.
- Affected files or areas: Docker defaults, admin auth routes, setup UI,
  documentation, deployment guidance.
- Follow-up implications: Bootstrap design should be a first-wave gate.
