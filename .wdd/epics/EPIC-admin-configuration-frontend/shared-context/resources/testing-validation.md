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

## WAVE-007 Verification Evidence

TASK-011 and TASK-015 merged after Lorentz `REVIEW_PASS` with no remaining
P1/P2 findings.

TASK-011 passed before merge after freshness refresh head `344bab8`:

- `npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx` (16
  tests)
- `npm --prefix ui run typecheck`
- `git diff --check`
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`

Additional worker/review evidence for TASK-011:

- `npm --prefix ui test` (83 tests)
- `npm --prefix ui run build` passed with the existing Vite large-chunk warning
- `codex review --uncommitted` found no discrete correctness, security, or
  maintainability issues after the MFA-error handling fix

TASK-015 passed before merge after final freshness head `ea88af4`:

- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
- `npm test -- tests/contract/admin-maintenance-api.test.ts` (4 tests)
- `npm test -- tests/integration/cli-admin.test.ts` (37 tests)
- `npm run typecheck`
- scoped ESLint for `src/cli/admin/pgm-admin.ts`,
  `src/services/admin-job-service.ts`,
  `src/services/admin-maintenance-service.ts`,
  `src/transport/admin-maintenance.ts`, `src/transport/admin.ts`,
  `tests/contract/admin-maintenance-api.test.ts`, and
  `tests/integration/cli-admin.test.ts`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`

Coverage added:

- Admin auth UI route protection, bootstrap/login/MFA/step-up/logout flows,
  invalid MFA-code handling, and no localStorage persistence for admin session,
  bootstrap, TOTP, provider secret, or bearer credential material.
- Maintenance dry-run/apply route coverage for reextract, reembed, and
  constrained edge pruning.
- Preview-before-apply proof through fresh matching `previewJobId`, scoped
  idempotency keys, step-up enforcement for apply, job-backed async execution,
  queued cancellation handling, structured admin actor audit attribution, and
  safe job result summaries.
- CLI regressions for shared maintenance service extraction, including combined
  `--type` and `--only-failed` behavior.

Carry-forward test expectations:

- TASK-012/TASK-013 should reuse the admin auth client and continue proving no
  admin or secret material is persisted in browser storage.
- TASK-012 should cover one-time API-key plaintext display and unrecoverable
  post-create state.
- TASK-013 should cover provider-config validation/apply warnings, redacted
  secret display, blank secret inputs on load, and step-up prompts.
- TASK-016 should cover dry-run preview gating, apply requiring recent step-up,
  idempotent apply retry display, job polling/progress, cancellation/error
  state, and safe result rendering.

## WAVE-008 Verification Evidence

TASK-012 and TASK-013 merged after Schrodinger `REVIEW_PASS` with no remaining
P1/P2 findings.

TASK-012 passed before merge after final freshness head `298804f`:

- `git rev-list --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD`
  reported `0 5`.
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx` (11
  tests)
- `npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx` (16
  tests)
- `npm --prefix ui run typecheck`

TASK-013 passed before merge after final freshness head `2efc58f`:

- `git rev-list --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD`
  reported `0 8`.
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx` (22
  tests)
- `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx` (11
  tests)
- `npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx` (16
  tests)
- `npm --prefix ui run typecheck`
- `npm run typecheck`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
- `git diff --check HEAD^..HEAD`

Coverage added:

- Admin operations dashboard rendering for health, queue, stats,
  config/models/jobs, API keys, and audit panels through the shared admin API
  client.
- API-key create/list/revoke UI flows, one-time plaintext key display, step-up
  prompt behavior, and no localStorage persistence for key/admin credential
  material.
- Provider configuration form behavior for pending/applied values, validation,
  apply, restart/reembed warnings, stale-validation blocking, step-up prompts,
  redacted secret state, and blank/write-only provider secret inputs.
- Regression coverage that the AdminConfig UI is integrated into the
  AdminDashboard shell without dropping the existing operations panels.

Carry-forward test expectations:

- TASK-016 should add focused maintenance UI tests for dry-run preview gating,
  apply requiring recent step-up and a fresh matching preview, scoped
  idempotency-key retry display, job polling/progress, cancellation/error
  states, and safe result rendering.
- TASK-016 should keep AdminOps/AdminAuth/AdminConfig regression coverage in
  its freshness checks when touching the shared dashboard shell or admin API
  client.
- TASK-017 should run a clean-volume Docker/browser smoke that exercises
  bootstrap, login/MFA, Config tab redaction/write-only behavior, API-key
  creation, dashboard status, and one safe maintenance preview after TASK-016.
- TASK-018 should include broad UI storage assertions and final security review
  for dashboard/config/maintenance surfaces.

## WAVE-009 Verification Evidence

TASK-016 merged after Hypatia `REVIEW_PASS` with no P1/P2/P3 findings.

TASK-016 passed before merge after final freshness head `1885b64`:

- `git rev-list --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD`
  reported `0 3`.
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
  returned tree `3377f9c2f689ffdf924804d3150170c953cec12f`.
- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `npm --prefix ui run test -- --run src/components/AdminMaintenance.test.tsx`
  (9 tests)
- `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx src/components/AdminConfig.test.tsx src/components/AdminAuth.test.tsx`
  (49 tests)
- `npm --prefix ui run typecheck`
- Post-merge `git diff --check HEAD^..HEAD`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`

Additional worker/review evidence for TASK-016:

- Worker full UI suite passed from `ui` (`npm test`, 125 tests).
- Worker `codex review --uncommitted` reported no P0/P1/P2 findings after
  local fixes.
- PR #91 was marked `MERGED` at 2026-07-06T21:37:31Z after the epic branch
  push.

Coverage added:

- Maintenance UI rendering for approved reextract, reembed, and constrained
  `llm-extraction` prune-edge flows inside the existing dashboard shell.
- Dry-run preview gating before apply, recent step-up/apply evidence, scoped
  idempotency handling, reused apply job-detail fetching, and in-flight request
  locking.
- Job polling/progress, terminal completion, failure retention, and transient
  polling recovery.
- Safe maintenance result rendering and same-origin shared-admin-client route
  usage without introducing an admin bearer-header path.
- Regression coverage preserving AdminOps, AdminConfig, and AdminAuth behavior
  after the maintenance panel and client methods were added.

Carry-forward test expectations:

- TASK-017 should run a clean-volume Docker/browser smoke that exercises
  bootstrap, login/MFA, Config tab redaction/write-only behavior, API-key
  creation, dashboard status panels, and one safe maintenance dry-run with job
  polling without normal `pgm-admin` use.
- TASK-018 should include final security validation for dashboard/config/
  maintenance browser storage, preview-before-apply, recent step-up, scoped
  idempotency, safe result rendering, and the `llm-extraction` edge-prune
  constraint.

## WAVE-010 Verification Evidence

TASK-017 merged after Dewey `REVIEW_PASS` with no remaining P1/P2/P3 findings.

TASK-017 passed before merge after final freshness head `38bfe21`:

- `git rev-list --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD`
  reported `0 4`.
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`
  was clean.
- `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
- `docker compose config`
- `npm test -- tests/unit/docker-first-run.test.ts` (5 tests)
- `npm test -- tests/integration/admin-auth-service.test.ts` (18 tests)
- `npm run typecheck`
- `npm --prefix ui run typecheck`
- `npm --prefix ui run build` passed with the existing Vite chunk-size warning.

Post-merge verification for merge commit `ce0bb83` passed:

- `git diff --check HEAD^..HEAD`
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
- `docker compose config`
- `npm test -- tests/unit/docker-first-run.test.ts` (5 tests)
- `npm test -- tests/integration/admin-auth-service.test.ts` (18 tests)
- `npm run typecheck`
- `npm --prefix ui run typecheck`
- `npm --prefix ui run build` with the existing chunk-size warning.

Clean-volume Docker/browser smoke evidence:

- `postgram-secrets` generated `postgres-password`, `admin-mfa-secret-key`, and
  `admin-settings-encryption-key` in the persistent `postgram_secrets` volume.
- API and UI health checks returned OK through the configured host ports.
- Browser flow completed first admin setup, MFA enrollment, protected dashboard
  access, API-key creation, Config tab provider secret entry, restart/reload
  redaction checks, and one safe maintenance dry-run with job polling.
- After restart, Config showed provider-secret configured metadata while the
  replacement input was blank, the page did not contain the fake secret, and
  browser local/session storage had no admin or secret material.
- A direct database check found encrypted provider-secret ciphertext and did
  not contain the fake plaintext secret.

Review blockers fixed before merge:

- Existing Compose installs with initialized `pgdata` and legacy
  `POSTGRES_PASSWORD` are preserved by seeding the new `postgres-password`
  secret from `POSTGRES_PASSWORD` when the secret file is absent.
- Existing OpenAI-backed Compose installs are preserved because Compose leaves
  `EMBEDDING_PROVIDER` blank and the entrypoint selects OpenAI when
  `OPENAI_API_KEY` is present.

Carry-forward test expectations:

- TASK-018 must rerun or explicitly verify the clean-volume Docker config/smoke
  evidence that supports the no-normal-CLI claim.
- TASK-018 must include final regression checks for legacy `POSTGRES_PASSWORD`
  upgrade preservation, OpenAI provider default preservation, strict
  admin-settings key parsing/fail-closed behavior, Config secret redaction
  after restart, browser storage non-persistence, and emergency `pgm-admin`
  fallback wording.

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
