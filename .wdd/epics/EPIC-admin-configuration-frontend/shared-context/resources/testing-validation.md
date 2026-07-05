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
