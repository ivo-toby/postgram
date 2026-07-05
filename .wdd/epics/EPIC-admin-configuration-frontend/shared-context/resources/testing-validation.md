---
id: EPIC-admin-configuration-frontend-RESOURCE-testing-validation
kind: shared_context_resource
epic: EPIC-admin-configuration-frontend
resource: testing-validation
updated_at: 2026-07-05
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
