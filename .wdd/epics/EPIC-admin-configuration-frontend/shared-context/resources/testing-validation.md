---
id: EPIC-admin-configuration-frontend-RESOURCE-testing-validation
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: testing-validation
updated_at: 2026-07-06
---

# Shared Context Resource: Testing And Validation

## Purpose

Record expected test and validation coverage for the admin configuration
frontend epic.

## Summary

This epic needs more than happy-path UI tests. Auth, bootstrap, CSRF, MFA,
secret handling, admin API authorization, destructive operation guardrails,
runtime configuration, and Docker first-run behavior all require focused
coverage.

## Backend Test Areas

- Admin user creation, password hashing, password policy, login, logout,
  sessions, session expiry, and lockout.
- Bootstrap token generation, hash-only persistence, expiry, single-use
  behavior, rate limiting, and public setup refusal without the token.
- MFA enrollment, challenge, recovery or reset behavior, and enforcement for
  production/admin posture.
- CSRF token issuance and enforcement for admin mutations.
- Admin middleware rejecting missing sessions, expired sessions, ordinary API
  keys, and MCP OAuth bearer tokens.
- Admin API route validation using Zod or equivalent schemas.
- Audit attribution for admin mutations.
- API-key management endpoints: create/list/revoke and one-time plaintext key
  display.
- Runtime settings save, validation, secret redaction, and provider connection
  tests.
- Provider URL/egress safety tests for admin-configured base URLs such as
  `EXTRACTION_BASE_URL`, including the chosen scheme/host/IP allow-deny policy
  and proof that connection tests cannot be used as generic blind SSRF.
- Installation encryption key failure/missing-key behavior for stored secrets.
- Provider apply/reload behavior for extraction settings and embedding
  migration refusal for unsafe identity changes.
- Maintenance dry-run/apply flows and destructive confirmation behavior.
- Long-running job creation, status, idempotency, cancellation if supported,
  and partial failure behavior.
- Migration tests for every new table.

## Frontend Test Areas

- Admin login flow.
- MFA enrollment and challenge.
- Admin navigation and route protection.
- API-key management page.
- Runtime configuration forms, validation errors, redacted secret display, and
  test-connection feedback.
- Audit and stats tables.
- Queue/system health views.
- Dry-run preview panels and destructive confirmation controls.
- Error handling for 401, 403, CSRF failure, validation errors, job failures,
  and partial failures.

## Docker And Smoke Validation

Expected smoke path:

1. Start the single Docker Compose setup from a clean volume.
2. Visit the UI.
3. Complete the supported first-run bootstrap flow.
4. Log in as admin with MFA.
5. Configure a supported embedding/extraction provider path.
6. Create a Postgram API key from the admin UI.
7. Use the normal UI/API with the generated key.
8. Inspect audit/stats/queue from the admin UI.
9. Run one safe dry-run maintenance operation.
10. Restart the stack and prove admin/session/config persistence behaves as
    designed.

## Broad Verification Commands

Use focused commands per task, then scale up for integration:

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm --prefix ui run typecheck`
- `npm --prefix ui run test -- --run`
- `npm --prefix ui run build`
- `git diff --check`

If Docker behavior changes, add a Compose-based smoke check and document exact
commands in the relevant task evidence.

## Security Review Gates

Require review before merging tasks that touch:

- Admin auth/session/MFA.
- Bootstrap.
- CSRF/rate limiting.
- Secret storage.
- Admin API middleware.
- Destructive maintenance endpoints.
- Docker exposure defaults.

P1/P2 security findings block merge by default.

WAVE-001 specific gates for later waves:

- TASK-004 must prove bootstrap token persistence is hash-only, expiring,
  single-use, and consumed atomically with creation of a non-active/pending-MFA
  first admin.
- TASK-005 must prove bootstrap routes reject missing, invalid, expired, used,
  and rate-limited tokens safely; enforce route/session/CSRF semantics; and
  reject API-key bearer auth and MCP OAuth bearer tokens on admin routes.
- TASK-006 must prove the first admin cannot become active until MFA enrollment
  and verification complete, then prove the MFA completion path performs the
  active transition and step-up state correctly.
- TASK-009/TASK-010 must prove provider secrets are write-only/redacted and
  that embedding identity changes use the migration job path.
- TASK-010 must prove provider URL validation enforces the chosen egress/SSRF
  safety policy for `EXTRACTION_BASE_URL` and other provider base URLs, not
  just generic connection-test failure/success.
- TASK-014/TASK-015/TASK-016 must prove destructive operations have dry-run or
  explicit confirmation, step-up, audit, and job/progress evidence.
- TASK-017 must run a clean-volume Docker smoke for the no-normal-CLI setup
  claim.

## WAVE-002 Verification Evidence

TASK-004 merged in PR #79 with Lorentz `REVIEW_PASS` and no P1/P2 findings.

Passed before merge:

- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `npm test -- tests/integration/admin-auth-service.test.ts` (11 tests)
- `npm run typecheck`
- `npx eslint src/auth/admin-service.ts tests/integration/admin-auth-service.test.ts tests/helpers/postgres.ts`
- `npm test -- tests/integration/key-service.test.ts tests/integration/migration.test.ts tests/integration/auth-middleware.test.ts` (8 tests)

Coverage added:

- Admin user creation and password policy/hash behavior.
- Admin session creation, lookup, expiry, invalidation, and race regressions
  for revoked/disabled sessions during last-used updates.
- Bootstrap token hash-only persistence, expiry, single-use consumption, failed
  attempt tracking, and invalidation after first-admin creation.
- Atomic first-admin creation that consumes a valid bootstrap token and leaves
  the account `pending_mfa`/non-active.
- Regression coverage that ordinary Postgram API keys are not admin
  credentials.

Carry-forward test expectations:

- TASK-005 route tests should assert safe HTTP status/errors for missing,
  invalid, expired, used, and rate-limited bootstrap tokens without exposing
  token validity.
- TASK-006 tests should assert the pending first admin cannot become active
  except through verified MFA completion.

## WAVE-003 Verification Evidence

TASK-005 merged in PR #80 with Lorentz `REVIEW_PASS` and no P1/P2 findings.

Passed before merge after task-branch freshness merge `e3dd76a`:

- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `npm test -- tests/contract/admin-auth-routes.test.ts` (9 tests)
- `npm run typecheck`
- `npm test -- tests/unit/errors.test.ts tests/integration/admin-auth-service.test.ts tests/integration/auth-middleware.test.ts tests/contract/oauth-routes.test.ts tests/contract/mcp-oauth.test.ts tests/contract/rest-api.test.ts` (50 tests)
- `npx eslint src/auth/admin-middleware.ts src/auth/admin-service.ts src/transport/admin.ts src/index.ts src/util/errors.ts tests/contract/admin-auth-routes.test.ts tests/integration/admin-auth-service.test.ts tests/unit/errors.test.ts`

Coverage added:

- Public bootstrap status returns only state and no bootstrap token material.
- Bootstrap setup rejects missing, invalid, expired, used, and rate-limited
  tokens with safe generic route errors.
- Successful bootstrap setup creates a `pending_mfa` admin, sets the admin
  session cookie, and returns a CSRF token without granting full admin authority.
- Login/logout/current-session/CSRF refresh routes use the admin session cookie
  and no-store response headers.
- Mutating session routes reject missing or invalid CSRF tokens.
- Ordinary Postgram API keys and MCP OAuth bearer tokens do not authorize
  admin routes.

Carry-forward test expectations:

- TASK-006 must add tests that pending-MFA sessions cannot reach privileged
  admin APIs and can become active only through verified MFA.
- TASK-007 and later admin API tests must prove session+CSRF middleware is
  composed with the active/MFA gate for privileged endpoints.
- TASK-011 UI tests must cover cookie-based sessions and CSRF refresh without
  storing admin bearer credentials in localStorage.

## WAVE-004 Verification Evidence

TASK-006 and TASK-009 merged after Lorentz `REVIEW_PASS` with no remaining
P1/P2 findings.

TASK-006 passed before merge after task-branch freshness merge `8c04680`:

- `git diff --check`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
- `npm test -- tests/contract/admin-mfa-routes.test.ts` (6 tests)
- `npm test -- tests/integration/admin-auth-service.test.ts` (15 tests)
- `npm test -- tests/integration/admin-settings-service.test.ts` (8 tests)
- `npm run typecheck`

TASK-009 passed before merge after task-branch freshness merge `ca9c96f`:

- `git diff --check`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
- `npm test -- tests/integration/admin-settings-service.test.ts` (8 tests)
- `npm run typecheck`
- touched-file ESLint for `src/services/admin-settings-service.ts` and the
  settings integration test

Coverage added:

- TOTP enrollment/verify/challenge/step-up routes, including pending-MFA
  denial, first-admin activation only after MFA verification, step-up freshness
  and future-date rejection, and direct MFA/step-up 429 regressions.
- TOTP factor seed encryption with `ADMIN_MFA_SECRET_KEY` and no persisted or
  post-enrollment plaintext secret readback.
- Structured `audit_log.admin_user_id` attribution for MFA audit rows when the
  column exists.
- `admin_runtime_settings` read/write/validation behavior, including rejection
  of credential-shaped keys from plain setting storage.
- `admin_runtime_secrets` encrypted write-only storage with
  `ADMIN_SETTINGS_ENCRYPTION_KEY`, redacted metadata reads, and malicious
  secret validation metadata regression coverage.

Carry-forward test expectations:

- TASK-007 must cover diagnostics denial for pending-MFA sessions and ordinary
  API-key/MCP OAuth bearer tokens, then success through session plus active-MFA
  middleware.
- TASK-010 must preserve secret metadata redaction and add explicit
  provider URL/egress/SSRF policy tests before connection-test behavior.
- TASK-011 and TASK-013 must assert that admin session, bootstrap, TOTP, and
  provider secret material are not written to localStorage.

## WAVE-005 Verification Evidence

TASK-007 and TASK-010 merged after Lorentz `REVIEW_PASS` with no remaining
P1/P2 findings.

TASK-007 passed before merge after task-branch freshness merge `f0e889e`:

- `git diff --check`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
- `npm test -- tests/contract/admin-api.test.ts` (3 tests)
- `npm run typecheck`
- focused ESLint for diagnostics/admin route files

TASK-010 passed before merge after task-branch freshness merge `515cfa5`:

- `git diff --check`
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
- `npm test -- tests/integration/admin-provider-config.test.ts` (39 tests)
- `npm test -- tests/unit/config.test.ts` (26 tests)
- `npm test -- tests/integration/admin-settings-service.test.ts` (8 tests)
- `npm test -- tests/contract/admin-auth-routes.test.ts tests/contract/admin-mfa-routes.test.ts tests/contract/admin-api.test.ts` (18 tests)
- `npm test -- tests/integration/admin-provider-config.test.ts tests/contract/admin-api.test.ts` (42 tests)
- `npm run typecheck`
- targeted ESLint for provider-config/admin route files

Coverage added:

- Diagnostics success for active MFA admin sessions and denial for pending-MFA
  sessions, ordinary API-key bearer tokens, and MCP OAuth bearer tokens.
- Diagnostics config-status redaction with aggregate runtime settings/secrets
  counts only.
- Provider config redacted reads, invalid setting batch rejection, URL
  egress/SSRF policy, redirect refusal, DNS-rebind protection, connection
  validation freshness, stored-secret redaction/decryption failure behavior,
  DB-over-env runtime resolution, pending-edit isolation, zero-version applied
  rows, explicit restart/reembed impacts, and simple-apply rejection for
  embedding identity changes.
- Provider-config route contract for admin session, CSRF, recent step-up on
  secret writes/apply, and ordinary bearer rejection.

Carry-forward test expectations:

- TASK-008 must include diagnostics coexistence when adding key/audit/stats
  routes and must preserve ordinary bearer rejection for all new admin routes.
- TASK-014 should prove job result payloads do not store provider secret
  material or arbitrary provider validation metadata.
- TASK-013 UI tests should consume provider-config API warnings and prove secret
  inputs stay blank/write-only across load, validate, and apply flows.

## WAVE-006 Verification Evidence

TASK-008 and TASK-014 merged after Lorentz `REVIEW_PASS` with no remaining
P1/P2 findings.

TASK-008 passed before merge at task head `281681b`:

- `npm test -- tests/contract/admin-key-audit-stats.test.ts` (10 tests)
- `npm test -- tests/integration/key-service.test.ts` (3 tests)
- `npm run typecheck`
- touched-file ESLint for key/audit/stats/admin route files
- `git diff --check`

TASK-014 passed before merge after freshness fix head `0e08630`:

- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
- `npm test -- tests/integration/admin-job-service.test.ts` (5 tests)
- `npm test -- tests/contract/admin-api.test.ts` (3 tests)
- `npm run typecheck`
- scoped ESLint for `src/services/admin-job-service.ts`,
  `src/transport/admin-jobs.ts`, `src/transport/admin.ts`, and related tests

Coverage added:

- Key create/list/revoke, audit query, stats, step-up requirement for key
  create/revoke, one-time plaintext create response, bearer rejection, audit
  pagination without self-observation drift, malformed UUID/offset validation,
  duplicate-key conflict handling, and audit detail redaction.
- Job service lifecycle, idempotency, active-MFA and step-up authority checks,
  progress/result summaries, cancellation request behavior, admin actor audit
  events, and safety guards rejecting sensitive summary fields/values.
- Job status route registration alongside diagnostics, key/audit/stats, and
  provider-config routes without breaking the admin API shell.

Carry-forward test expectations:

- TASK-011/TASK-012 UI tests must cover cookie/CSRF admin API calls, key
  one-time plaintext display, audit/stats rendering, bearer rejection handling,
  and no localStorage persistence for admin or secret material.
- TASK-015 must add concrete maintenance API tests for dry-run/apply,
  idempotency, step-up, operation-specific confirmation, cancellation/status
  polling, audit attribution, CLI regressions, and job summary redaction.
- TASK-016 UI tests must cover job polling/progress/error states and must not
  depend on synchronous maintenance completion.

## Durable Memory

### Docker First-Run Must Be Tested, Not Assumed

- Source task: epic creation
- Source PR/branch: none
- Status: planning
- Summary: The no-CLI/no-config-file claim must be proven with a clean-volume
  Docker smoke test.
- Why it matters: A setup flow can pass unit tests while still requiring hidden
  CLI or env-file steps in a real deployment.
- Affected files or areas: Docker Compose, README, setup UI, admin auth,
  runtime settings.
- Follow-up implications: Include Docker smoke validation in the final epic
  gate.
