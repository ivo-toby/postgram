---
id: EPIC-admin-configuration-frontend-WAVES
kind: wave_plan
epic: EPIC-admin-configuration-frontend
status: in_progress
created_at: 2026-07-05
updated_at: 2026-07-06
---

# Wave Plan: EPIC-admin-configuration-frontend

## Task Inventory

| Task | Ticket | Depends On | Conflict Domains | Status |
|------|--------|------------|------------------|--------|
| TASK-001-admin-surface-inventory | TICKET-001-feasibility-security-design | None | `src/cli/admin/pgm-admin.ts`, admin service boundaries, shared context | done |
| TASK-002-threat-model-bootstrap | TICKET-001-feasibility-security-design | None | admin auth architecture, Docker exposure model, shared context | done |
| TASK-003-runtime-config-feasibility | TICKET-001-feasibility-security-design | None | `src/config.ts`, `src/index.ts`, provider lifecycle, Docker docs | done |
| TASK-004-admin-auth-persistence | TICKET-002-admin-auth-foundation | TASK-001, TASK-002 | migrations, `src/auth/**`, admin auth services, integration tests | done |
| TASK-005-admin-session-routes | TICKET-002-admin-auth-foundation | TASK-004 | admin routes, cookies, CSRF, lockout, auth contract tests | done |
| TASK-006-admin-mfa-step-up | TICKET-002-admin-auth-foundation | TASK-004, TASK-005 | MFA tables, TOTP service, step-up middleware, sensitive action gates | done |
| TASK-007-admin-api-shell-diagnostics | TICKET-003-admin-api-foundation | TASK-005, TASK-006 | admin transport, diagnostics routes, admin middleware | done |
| TASK-008-admin-key-audit-stats-api | TICKET-003-admin-api-foundation | TASK-007 | key service, audit querying, stats service, admin API contracts | done |
| TASK-009-settings-secret-store | TICKET-004-runtime-configuration | TASK-003, TASK-005 | settings migrations, secret encryption, config service | done |
| TASK-010-provider-config-apply | TICKET-004-runtime-configuration | TASK-009 | provider lifecycle, validation flows, config tests, worker reload semantics | done |
| TASK-011-admin-auth-ui | TICKET-005-admin-frontend | TASK-006 | React auth shell, admin session client, MFA UI, UI routing | done |
| TASK-012-admin-ops-dashboard-ui | TICKET-005-admin-frontend | TASK-008, TASK-011 | API key UI, audit/stats/health pages, admin API client | done |
| TASK-013-admin-config-ui | TICKET-005-admin-frontend | TASK-010, TASK-011 | runtime config UI, secret redaction, provider validation UI | done |
| TASK-014-admin-job-foundation | TICKET-006-maintenance-jobs | TASK-006, TASK-009 | job tables, job service, audit integration, progress state | done |
| TASK-015-maintenance-admin-api | TICKET-006-maintenance-jobs | TASK-008, TASK-010, TASK-014 | graph/memory/embedding services, dry-run/apply admin APIs, CLI regressions | done |
| TASK-016-maintenance-admin-ui | TICKET-006-maintenance-jobs | TASK-011, TASK-015 | maintenance UI, confirmations, progress polling, admin API client | done |
| TASK-017-docker-first-run-no-cli | TICKET-007-docker-e2e-validation | TASK-012, TASK-013, TASK-016 | Docker Compose, `.env.example`, README/deployment docs, smoke tests | review |
| TASK-018-security-epic-validation | TICKET-007-docker-e2e-validation | TASK-017 | security review, broad validation, final handoff artifacts | todo |

## Dependency Grid

| Task | Blocks | Blocked By |
|------|--------|------------|
| TASK-001-admin-surface-inventory | TASK-004-admin-auth-persistence | None |
| TASK-002-threat-model-bootstrap | TASK-004-admin-auth-persistence | None |
| TASK-003-runtime-config-feasibility | TASK-009-settings-secret-store | None |
| TASK-004-admin-auth-persistence | TASK-005-admin-session-routes, TASK-006-admin-mfa-step-up | TASK-001-admin-surface-inventory, TASK-002-threat-model-bootstrap |
| TASK-005-admin-session-routes | TASK-006-admin-mfa-step-up, TASK-007-admin-api-shell-diagnostics, TASK-009-settings-secret-store | TASK-004-admin-auth-persistence |
| TASK-006-admin-mfa-step-up | TASK-007-admin-api-shell-diagnostics, TASK-011-admin-auth-ui, TASK-014-admin-job-foundation | TASK-004-admin-auth-persistence, TASK-005-admin-session-routes |
| TASK-007-admin-api-shell-diagnostics | TASK-008-admin-key-audit-stats-api | TASK-005-admin-session-routes, TASK-006-admin-mfa-step-up |
| TASK-008-admin-key-audit-stats-api | TASK-012-admin-ops-dashboard-ui, TASK-015-maintenance-admin-api | TASK-007-admin-api-shell-diagnostics |
| TASK-009-settings-secret-store | TASK-010-provider-config-apply, TASK-014-admin-job-foundation | TASK-003-runtime-config-feasibility, TASK-005-admin-session-routes |
| TASK-010-provider-config-apply | TASK-013-admin-config-ui, TASK-015-maintenance-admin-api | TASK-009-settings-secret-store |
| TASK-011-admin-auth-ui | TASK-012-admin-ops-dashboard-ui, TASK-013-admin-config-ui, TASK-016-maintenance-admin-ui | TASK-006-admin-mfa-step-up |
| TASK-012-admin-ops-dashboard-ui | TASK-017-docker-first-run-no-cli | TASK-008-admin-key-audit-stats-api, TASK-011-admin-auth-ui |
| TASK-013-admin-config-ui | TASK-017-docker-first-run-no-cli | TASK-010-provider-config-apply, TASK-011-admin-auth-ui |
| TASK-014-admin-job-foundation | TASK-015-maintenance-admin-api | TASK-006-admin-mfa-step-up, TASK-009-settings-secret-store |
| TASK-015-maintenance-admin-api | TASK-016-maintenance-admin-ui | TASK-008-admin-key-audit-stats-api, TASK-010-provider-config-apply, TASK-014-admin-job-foundation |
| TASK-016-maintenance-admin-ui | TASK-017-docker-first-run-no-cli | TASK-011-admin-auth-ui, TASK-015-maintenance-admin-api |
| TASK-017-docker-first-run-no-cli | TASK-018-security-epic-validation | TASK-012-admin-ops-dashboard-ui, TASK-013-admin-config-ui, TASK-016-maintenance-admin-ui |
| TASK-018-security-epic-validation | None | TASK-017-docker-first-run-no-cli |

## Conflict Grid

| Task Pair | Conflict Domains | Risk | Decision |
|-----------|------------------|------|----------|
| TASK-001 / TASK-002 / TASK-003 | Shared architecture docs and feasibility conclusions | medium | Bundle in WAVE-001 so security, CLI surface, and config decisions reconcile before implementation |
| TASK-004 / TASK-005 | Admin auth persistence and route/session contract | high | Sequential; routes wait for tested persistence |
| TASK-005 / TASK-009 | Admin session middleware and settings/secret admin access | medium | Settings foundation waits for session route contract |
| TASK-006 / TASK-009 | Migrations, secret/security state, test helpers | high | Same wave with full profile; reconcile migration ordering carefully |
| TASK-007 / TASK-010 | Admin namespace versus runtime provider configuration | medium | Same wave is acceptable with clear file boundaries; use full profile |
| TASK-008 / TASK-014 | Admin API surfaces and job/audit state | medium | Same wave with separate service ownership and shared audit reconciliation |
| TASK-011 / TASK-015 | UI auth shell versus backend maintenance API | low | Can run in parallel after shared admin contracts exist |
| TASK-012 / TASK-013 | Admin UI routes, API client types, shared admin layout | medium | Same wave with explicit component boundaries and shared client reconciliation |
| TASK-015 / TASK-016 | Maintenance API and UI contract | high | Sequential; UI waits for approved API contract |
| TASK-017 / TASK-018 | Docker first-run evidence and final security validation | high | Sequential; validation waits for deploy-smoke evidence |

## Waves

### WAVE-001

Status: done

Tasks:

- TASK-001-admin-surface-inventory
- TASK-002-threat-model-bootstrap
- TASK-003-runtime-config-feasibility

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: Ivo via Codex request on 2026-07-05

Rationale:

- This is the feasibility and security gate for the whole epic.
- The three tasks produce coupled decisions: what is safe to expose, how first
  admin bootstrap is protected, and which runtime settings can move out of env.
- A bundled wave avoids diverging assumptions between CLI-surface, auth, and
  runtime-configuration research.

Activation rule:

- Activate only after the user accepts this full-profile bundled feasibility
  gate.
- No implementation tasks may start before WAVE-001 is reviewed and reconciled.

Stop condition:

- `shared-context/resources/admin-surface-inventory.md`,
  `security-model.md`, `api-contracts.md`, and `migration-config-notes.md` are
  updated with final findings.
- The epic has an explicit go/no-go for bootstrap posture, secret storage, and
  runtime provider reload strategy.
- Wave reconciliation completed on 2026-07-05.
- WAVE-002 is ready for user confirmation; no implementation wave was started
  during reconciliation.

Completion evidence:

- Worker fix commit: `4ef5792`.
- Merge commit: `1f11365`.
- Closeout commit: `5856d75`.
- Remote PR-state commit: `bd1c1dc`.
- PR #78: merged by GitHub at 2026-07-05T12:39:56Z.
- Review: Lorentz `REVIEW_PASS`, no remaining P1/P2.
- Verification passed:
  - `git diff --check`
  - `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
  - `gh pr view 78`

Reconciled decisions:

- Go: implementation may proceed with a separate admin auth/session/MFA plane.
- First-run bootstrap uses a generated one-time token from a trusted local
  operator channel, stored hash-only, single-use, expiring, audited, and
  completed only after MFA-backed first-admin activation.
- Runtime settings use installation-wide DB-backed settings plus encrypted
  write-only secrets, while one minimal installation encryption key may remain
  outside the DB through env or Docker secret.
- Provider applies use save/validate/apply states; embedding identity changes
  are migration-sensitive and must use dry-run/apply job handling.

Drift notes:

- TASK-004 owns bootstrap token persistence and non-active/pending-MFA
  first-admin state.
- TASK-005 owns route/session/CSRF behavior and safe bootstrap HTTP semantics.
- TASK-006 owns MFA completion and first-admin activation.
- TASK-010 must include explicit provider URL/egress/SSRF safety tests.

### WAVE-002

Status: done

Tasks:

- TASK-004-admin-auth-persistence

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: high
- Requires user confirmation: yes
- Confirmed by: Ivo via Codex request on 2026-07-05

Rationale:

- Admin identity, password hashing, sessions, and MFA persistence are
  security-critical and migration-heavy.
- A single bundled task keeps the persistence contract small before route work.

Activation rule:

- Activate after WAVE-001 reconciliation confirms the bootstrap/auth design.
- Ready for user confirmation after WAVE-001 reconciliation on 2026-07-05.
- Activated after Ivo requested the next wave on 2026-07-05.

Stop condition:

- Admin auth persistence tests pass.
- No ordinary API-key bearer path can be confused with admin identity.

Completion evidence:

- PR #79: merged by GitHub at 2026-07-05T15:04:08Z.
- Task branch freshness merge: `16122c0`.
- Epic merge commit: `0f96769`.
- Closeout commit: `cac43dd`.
- Review: Lorentz `REVIEW_PASS`, no P1/P2 findings.
- Verification passed:
  - `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
  - `npm test -- tests/integration/admin-auth-service.test.ts` (11 tests)
  - `npm run typecheck`
  - `npx eslint src/auth/admin-service.ts tests/integration/admin-auth-service.test.ts tests/helpers/postgres.ts`
  - `npm test -- tests/integration/key-service.test.ts tests/integration/migration.test.ts tests/integration/auth-middleware.test.ts` (8 tests)

Reconciled decisions:

- Admin auth persistence lives in `src/auth/admin-service.ts` and should be
  reused by route/MFA tasks instead of duplicating token/password logic.
- Admin users begin in `pending_mfa`; active admin state is reserved for
  TASK-006 after verified MFA completion.
- Admin sessions and bootstrap tokens are hash-only, with expiry/revocation
  state and safe single-use bootstrap semantics.

Drift notes:

- `admin_mfa_factors` exists as persistence scaffolding for TASK-006, but TOTP
  secret encryption/verification remains future work.
- `admin_auth_attempts` exists for later route lockout/rate-limit behavior.

### WAVE-003

Status: done

Tasks:

- TASK-005-admin-session-routes

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: high
- Requires user confirmation: yes
- Confirmed by: Ivo via Codex sequential-waves request on 2026-07-05

Rationale:

- This creates the browser admin boundary: bootstrap, login, logout, session
  checks, CSRF, lockout, and audit attribution.
- Route behavior should be proven before adding MFA, admin APIs, or UI work.

Activation rule:

- Activate after TASK-004 is done and reconciled.
- Ready after WAVE-002 reconciliation on 2026-07-05.
- Activated after Ivo requested sequential waves on 2026-07-05.
- Branch/worktree verified and worker Leibniz
  (`019f32d9-051d-7c40-8daf-2e05d9888901`) dispatched at
  2026-07-05T15:15:57Z.

Stop condition:

- Admin auth contract tests pass.
- Ordinary API keys and existing MCP OAuth tokens cannot call admin routes.
- WAVE-003 reconciliation completed on 2026-07-05.

Completion evidence:

- PR #80: merged by GitHub at 2026-07-05T16:25:30Z.
- Worker branch freshness merge: `e3dd76a`.
- Epic merge commit: `ecfe9ac`.
- Closeout commit: `ff338b1`.
- Review: Lorentz `REVIEW_PASS`, no P1/P2 findings.
- Verification passed:
  - `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`
  - `npm test -- tests/contract/admin-auth-routes.test.ts` (9 tests)
  - `npm run typecheck`
  - `npm test -- tests/unit/errors.test.ts tests/integration/admin-auth-service.test.ts tests/integration/auth-middleware.test.ts tests/contract/oauth-routes.test.ts tests/contract/mcp-oauth.test.ts tests/contract/rest-api.test.ts` (50 tests)
  - touched-file ESLint for the admin route, middleware, service, index, error,
    contract-test, and adjacent auth-service test files

Reconciled decisions:

- Admin auth routes are dedicated `/admin/api/*` browser-session routes, not
  ordinary `/api/*` bearer routes.
- `pgm_admin_session` is the admin session cookie; `X-CSRF-Token` is the unsafe
  method CSRF header.
- Bootstrap status exposes only state; setup/login failures use generic safe
  errors.
- Bootstrap setup creates only `pending_mfa` admin/session state. Full admin
  authority still waits for TASK-006 MFA activation.

Drift notes:

- TASK-006 must add active-admin/MFA and step-up middleware on top of the
  WAVE-003 session/CSRF middleware.
- TASK-007 now explicitly depends on TASK-006 so read-only diagnostics cannot
  treat pending-MFA sessions as privileged admin access.
- TASK-011 must consume cookie/CSRF routes and avoid admin bearer-token
  localStorage patterns.

### WAVE-004

Status: done

Tasks:

- TASK-006-admin-mfa-step-up
- TASK-009-settings-secret-store

Recommended strategy:

- Profile: full
- Execution mode: hybrid
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: Ivo via Codex sequential-waves request on 2026-07-05; start
  step still pending

Rationale:

- MFA/step-up and settings/secret storage both depend on the admin session
  boundary and both touch security-sensitive migrations.
- They can proceed as two subgroups if migration ordering and shared test
  helpers are reconciled.

Activation rule:

- Activate after WAVE-003 reconciliation.
- Dispatch as two subgroups: auth/MFA and settings/secrets.
- Ready after WAVE-003 reconciliation on 2026-07-05; activation is left to the
  next `wdd-start-wave` step.
- Activated at 2026-07-05T16:47:34Z. TASK-006 and TASK-009 are assigned as
  separate hybrid bundles with dedicated branches and worktrees.
- Reconciled on 2026-07-05 after both bundles merged and WAVE-004 worktrees
  were cleaned up.

Stop condition:

- MFA/step-up tests pass.
- Settings and secret storage tests pass.
- Migration ordering and rollback posture are documented in shared context.

Completion evidence:

- PR #81: merged by GitHub at 2026-07-05T18:13:59Z.
- PR #82: merged by GitHub at 2026-07-05T18:17:48Z.
- TASK-009 task-branch freshness merge: `ca9c96f`.
- TASK-009 epic merge commit: `b63ad08`.
- TASK-006 task-branch freshness merge: `8c04680`.
- TASK-006 epic merge commit: `6666508`.
- Review: Lorentz `REVIEW_PASS` for both PRs after P2 fixes.
- Verification passed:
  - `git diff --check`
  - `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`
  - `npm test -- tests/integration/admin-settings-service.test.ts` (8 tests)
  - `npm test -- tests/contract/admin-mfa-routes.test.ts` (6 tests)
  - `npm test -- tests/integration/admin-auth-service.test.ts` (15 tests)
  - `npm run typecheck`

Reconciled decisions:

- Admin TOTP seeds are encrypted with `ADMIN_MFA_SECRET_KEY` and are
  write-only after enrollment.
- The first bootstrap admin becomes active only through MFA verification.
- `createActiveAdminMiddleware` is the active/MFA/step-up gate that future
  privileged admin APIs should compose after session/CSRF middleware.
- Runtime settings persist as typed JSON in `admin_runtime_settings`.
- Provider secrets persist as AES-256-GCM encrypted rows in
  `admin_runtime_secrets` using `ADMIN_SETTINGS_ENCRYPTION_KEY`.
- Secret validation metadata is normalized/redacted to `{}` so redacted reads
  cannot leak provider responses, bearer tokens, or reusable prefixes.
- `audit_log.admin_user_id` is now the structured admin actor attribution path.

Drift notes:

- TASK-007 must require active-MFA admin sessions for diagnostics; pending-MFA
  sessions remain setup/session/MFA-only.
- TASK-010 must reuse `admin-settings-service`, preserve secret redaction, and
  add explicit provider URL/egress/SSRF policy tests.
- TASK-014 and later mutation/job work should use structured
  `audit_log.admin_user_id` plus recent step-up for sensitive operations.
- TASK-017 must make Docker/operator handling for both admin encryption keys
  explicit.

### WAVE-005

Status: done

Tasks:

- TASK-007-admin-api-shell-diagnostics
- TASK-010-provider-config-apply

Recommended strategy:

- Profile: full
- Execution mode: hybrid
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: Ivo via Codex finish-all-waves request on 2026-07-06

Rationale:

- The admin API shell and provider apply/reload flow share the admin boundary
  but are separable into transport and runtime-config subgroups.
- Both are high-risk because they touch public admin contracts and provider
  lifecycle behavior.

Activation rule:

- Activate after WAVE-004 reconciliation.
- Activated at 2026-07-06T05:51:49Z as two hybrid bundles:
  TASK-007-admin-api-shell-diagnostics and TASK-010-provider-config-apply.

Stop condition:

- Read-only diagnostics route tests pass.
- Provider validation/apply tests pass.
- Shared context records any changes that require restart rather than hot reload.
- Wave reconciliation completed on 2026-07-06.

Completion evidence:

- TASK-007 shipped in PR #83 and merged into the epic branch in
  `16985ef684213569ec6748065b390c9ab5e89b1a`; GitHub marked PR #83
  `MERGED` at 2026-07-06T06:27:29Z.
- TASK-010 shipped in PR #84 and merged into the epic branch in
  `f5efbc0eef0394abb22576221f50491eab86660a`; GitHub marked PR #84
  `MERGED` at 2026-07-06T11:31:10Z after the freshness fix commit
  `515cfa5a16b213f4fda78a0c536fb1806daf8b68`.
- Lorentz returned REVIEW_PASS for both bundles. TASK-010's P2 freshness
  blocker was resolved by refreshing against the latest epic branch while
  preserving both TASK-007 diagnostics wiring and TASK-010 provider-config
  wiring.
- Controller verification passed for the merged wave: TASK-007 admin API
  contract tests, TASK-010 provider-config/admin-api tests, typecheck, JSON
  parsing, and diff whitespace checks.

Reconciled decisions:

- `/admin/api/diagnostics/*` is the read-only diagnostics namespace and
  requires an active-MFA admin session. Pending-MFA sessions receive `403`;
  ordinary API-key and MCP OAuth bearer tokens receive `401`.
- `/admin/api/provider-config/*` is the provider configuration namespace.
  Secret writes and provider apply require recent step-up.
- Provider runtime configuration uses DB-backed pending and applied values.
  Pending edits do not change runtime state until validation/apply succeeds,
  and env fallback remains the operator-controlled baseline.
- Admin-configured provider URLs are attacker-controlled input and must pass
  the egress/SSRF policy before save/runtime use.
- Restart-required and reembed-required outcomes are explicit API state. The
  first implementation does not add a new required Docker runtime value beyond
  the existing `ADMIN_SETTINGS_ENCRYPTION_KEY`.

Drift notes:

- TASK-008 should extend the same `/admin/api/*` admin transport and preserve
  the diagnostics route contract while adding key, audit, and stats routes.
- TASK-014 and TASK-015 must not store provider secrets, ciphertext, token
  prefixes, arbitrary validation metadata, or provider response bodies in job
  payloads/results.
- TASK-013 should consume the provider-config API's pending/applied,
  restart-required, and reembed-required state rather than inventing UI-only
  lifecycle rules.

### WAVE-006

Status: done

Tasks:

- TASK-008-admin-key-audit-stats-api
- TASK-014-admin-job-foundation

Recommended strategy:

- Profile: full
- Execution mode: hybrid
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: Ivo via Codex finish-all-waves request on 2026-07-06

Rationale:

- API-key/audit/stats endpoints and job foundation share audit semantics but
  can remain separate service subgroups.
- Both create privileged admin-facing behavior and require full contract review.

Activation rule:

- Activate after WAVE-005 reconciliation.
- Activated at 2026-07-06T11:39:24Z as two hybrid bundles:
  TASK-008-admin-key-audit-stats-api and TASK-014-admin-job-foundation.

Stop condition:

- Admin key/audit/stats contract tests pass.
- Job service persistence/progress tests pass.
- Audit attribution covers admin actor and operation.

Completion evidence:

- PR #85: merged by GitHub at 2026-07-06T13:19:57Z.
- PR #86: merged by GitHub at 2026-07-06T13:54:55Z.
- Merge commits: `13465eb` for TASK-008 and `c5edbfc` for TASK-014.
- Review: Lorentz `REVIEW_PASS` for both tasks; TASK-014 P2 route-conflict
  freshness feedback resolved at task head `0e08630`.
- Verification passed:
  - `npm test -- tests/contract/admin-key-audit-stats.test.ts`
  - `npm test -- tests/integration/key-service.test.ts`
  - `npm test -- tests/integration/admin-job-service.test.ts`
  - `npm test -- tests/contract/admin-api.test.ts`
  - `npm run typecheck`
  - scoped ESLint for touched admin key/audit/stats/job files
  - `git diff --check`

Reconciled decisions:

- Admin API-key create/list/revoke, audit query, and stats now live in the
  existing `/admin/api/*` browser-session namespace.
- Key create/revoke require CSRF and recent step-up; plaintext API keys are
  create-response-only.
- Audit query and stats return redacted/safe data and write structured admin
  actor audit entries.
- Long-running/dangerous maintenance work must use `admin_jobs` and
  `admin_job_events` for lifecycle, progress, idempotency, and audit instead
  of blocking request handlers.

Drift notes:

- TASK-011 and TASK-012 should consume the concrete key/audit/stats admin API
  shapes and preserve cookie/CSRF admin-session behavior.
- TASK-015 must build concrete maintenance dry-run/apply routes on top of
  `admin-job-service`, with operation-specific confirmation, step-up,
  idempotency, cancellation/status, and CLI regression coverage.
- TASK-016 must poll job status/progress rather than assume synchronous
  maintenance completion.

### WAVE-007

Status: done

Tasks:

- TASK-011-admin-auth-ui
- TASK-015-maintenance-admin-api

Recommended strategy:

- Profile: full
- Execution mode: parallel
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: Ivo via Codex finish-all-waves request on 2026-07-06

Rationale:

- The protected admin UI shell can proceed while approved maintenance APIs are
  implemented because the file ownership is mostly frontend versus backend.
- The wave still needs full review because both tasks expose sensitive flows.

Activation rule:

- Activate after WAVE-006 reconciliation.
- Activated at 2026-07-06T14:08:16Z as two parallel bundles:
  TASK-011-admin-auth-ui and TASK-015-maintenance-admin-api.

Stop condition:

- Admin auth UI tests pass.
- Maintenance API dry-run/apply tests and CLI regression tests pass.
- Shared admin API client contracts are reconciled before later UI work.

Progress:

- TASK-011 passed Lorentz review, was refreshed against the epic branch, merged
  locally in `4e77a6b`, marked merged remotely as PR #87, and cleaned up.
- TASK-015 passed Lorentz follow-up review after a WDD task-file freshness fix,
  was refreshed against the epic branch, merged locally in `78f0f43`, marked
  merged remotely as PR #88, and cleaned up.

Completion evidence:

- PR #87: merged by GitHub at 2026-07-06T15:48:11Z.
- PR #88: merged by GitHub at 2026-07-06T17:02:28Z.
- Merge commits: `4e77a6b` for TASK-011 and `78f0f43` for TASK-015.
- Reviews: Lorentz `REVIEW_PASS` for both tasks; TASK-015 P2 freshness blocker
  resolved before merge.
- Verification passed:
  - `npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx`
  - `npm --prefix ui run typecheck`
  - `npm test -- tests/contract/admin-maintenance-api.test.ts`
  - `npm test -- tests/integration/cli-admin.test.ts`
  - `npm run typecheck`
  - scoped ESLint for maintenance touched files
  - `git diff --check`
  - `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`

Reconciled decisions:

- The shared frontend admin API client lives in `ui/src/lib/adminApi.ts` and
  owns same-origin cookie requests plus in-memory CSRF handling.
- Admin auth UI now covers bootstrap, login, MFA enrollment/challenge, step-up,
  logout, and protected shell behavior without localStorage admin credentials.
- Maintenance admin APIs expose only typed dry-run/apply routes for reextract,
  reembed, and constrained `llm-extraction` edge pruning.
- Maintenance applies require recent step-up, scoped idempotency, and fresh
  matching dry-run preview evidence; job status remains the progress contract.

Drift notes:

- TASK-012 and TASK-013 should extend the existing admin API client rather than
  creating another auth/client boundary.
- TASK-016 must consume the concrete maintenance route family, require
  preview-before-apply in UI, prompt step-up before apply, and poll job status.
- The first maintenance UI should not expose CLI-only broad edge pruning or
  synchronous completion assumptions.

### WAVE-008

Status: done

Tasks:

- TASK-012-admin-ops-dashboard-ui
- TASK-013-admin-config-ui

Recommended strategy:

- Profile: full
- Execution mode: hybrid
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: no
- Confirmed by: Ivo via Codex finish-all-waves request on 2026-07-06

Rationale:

- These are both frontend admin surfaces with shared layout/client concerns.
- They can run as two subgroups if shared admin client/types are reconciled
  early and secrets remain redacted.

Activation rule:

- Activate after WAVE-007 reconciliation.
- Ready after WAVE-007 reconciliation on 2026-07-06.
- Activated at 2026-07-06T17:17:56Z in checkpoint `f4bf3d2` after WAVE-007
  reconciliation checkpoint `27f4903` was pushed.

Progress:

- TASK-012-admin-ops-dashboard-ui moved to `in-progress/`; dedicated branch
  `codex/task/TASK-012-admin-ops-dashboard-ui` and worktree
  `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-012-admin-ops-dashboard-ui`
  created and pushed from activation head `7e5c49c`.
- TASK-013-admin-config-ui moved to `in-progress/`; dedicated branch
  `codex/task/TASK-013-admin-config-ui` and worktree
  `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-013-admin-config-ui`
  created and pushed from activation head `7e5c49c`.
- Workers dispatched at 2026-07-06T17:29:45Z: Sagan for
  TASK-012-admin-ops-dashboard-ui and Parfit for TASK-013-admin-config-ui.
  Both bundles are in `no_pr` monitoring.
- 2026-07-06T17:47:01Z controller poll: both workers are active with
  uncommitted implementation changes and no PRs yet. Both tracked diffs pass
  `git diff --check`; both branches are behind the epic branch by one
  controller monitoring checkpoint.
- 2026-07-06T18:02:01Z controller poll: both workers remain active with no PRs
  yet. Both tracked diffs pass `git diff --check`; both branches are behind
  the epic branch by two controller monitoring checkpoints.
- 2026-07-06T18:17:01Z controller poll: both workers remain active with no PRs
  yet. Both tracked diffs pass `git diff --check`; both branches are behind
  the epic branch by three controller monitoring checkpoints.
- 2026-07-06T18:24:15Z controller poll: Sagan completed TASK-012 and opened
  draft PR #89 at head `b9a1043`; Schrodinger was assigned to review. PR #89 is
  `DIRTY` against the epic branch and must refresh before merge. TASK-013
  remains active with Parfit and no PR or patch yet.
- 2026-07-06T18:28:44Z review result: Schrodinger returned `REVIEW_BLOCKED`
  for PR #89 with one P2 branch-freshness/WDD task-file conflict only;
  product/security review passed. Feedback was routed to Sagan for refresh and
  a non-blocking TASK-013 dashboard-shell integration note was routed to Parfit.
- 2026-07-06T18:38:02Z controller poll: Sagan pushed TASK-012 fix attempt
  `928ea35`, but controller verification still finds PR #89 stale against
  current epic head `cb1c1ae` with the WDD task-file merge-tree conflict. The
  freshness P2 remains open and was rerouted to Sagan. TASK-013 remains active
  with no PR or patch.
- 2026-07-06T18:45:07Z controller poll: Sagan pushed TASK-012 head `3933ff2`.
  PR #89 is GitHub `CLEAN` and merge-tree passes; Schrodinger follow-up review
  was requested with final controller-checkpoint freshness still required
  before merge. TASK-013 remains active with no PR or patch.
- 2026-07-06T18:48:29Z review result: Schrodinger returned `REVIEW_PASS` for
  PR #89 at `3933ff2`; final freshness remains required before merge.
- 2026-07-06T18:55:02Z controller merge: TASK-012 was refreshed against the
  latest epic checkpoint, pushed at final task head `298804f`, verified with
  branch freshness, merge-tree, diff-check, AdminOps/AdminAuth UI tests, and UI
  typecheck, then merged into the epic branch in `ef54876`. GitHub marked
  PR #89 `MERGED` at 2026-07-06T18:54:38Z and the clean TASK-012 worktree was
  removed. TASK-013 remains active with no PR or patch.
- 2026-07-06T19:15:01Z controller poll: TASK-013 remains active with Parfit
  and no PR or patch. The worktree has fresh AdminConfig edits from this
  heartbeat window, `git diff --check` passes, and no nudge was sent. TASK-013
  will need freshness refresh before review/merge because the epic branch is 14
  checkpoints ahead.
- 2026-07-06T19:30:01Z controller poll: TASK-013 remains active with Parfit
  and no PR or patch. The worktree has fresh AdminConfig edits from this
  heartbeat window, `git diff --check` passes, and no nudge was sent. TASK-013
  will need freshness refresh before review/merge because the epic branch is 15
  checkpoints ahead at observation time.
- 2026-07-06T19:45:01Z controller review handoff: Parfit returned
  `DONE_WITH_CONCERNS` and opened draft PR #90 at `fe1a454`. Worker evidence
  passed targeted AdminConfig/UI/backend checks, broad UI tests, typechecks,
  build with the existing Vite warning, scoped lint/prettier/diff-check, and
  codex review after worker P1/P2 fixes. Controller requested Schrodinger
  review in submission `019f38f7-8d65-74e3-8a30-5e4edc7c1b32`. PR #90 is
  `DIRTY`; merge-tree conflicts in TASK-013 WDD metadata, AdminAuth
  test/component, AdminDashboard, and adminApi must be resolved before merge.
- 2026-07-06T19:45:01Z review result: Schrodinger returned `REVIEW_BLOCKED`
  for PR #90 with one P2 branch-freshness/product-integration blocker and no
  additional product/security P1/P2 findings. Feedback was routed to Parfit in
  submission `019f38fd-830e-7743-889d-ab73a8729989`; TASK-013 is in
  `needs_fixes` until PR #90 refreshes against the latest epic branch and
  integrates `AdminConfig` into the merged TASK-012 operations dashboard shell
  without dropping existing operations panels.
- 2026-07-06T19:57:31Z controller poll: PR #90 still has unchanged head
  `fe1a454` and remains `DIRTY`, but Parfit's assigned worktree is active in
  merge-conflict resolution across TASK-013 WDD metadata, AdminAuth,
  AdminDashboard, and adminApi. No duplicate nudge was sent. Final freshness
  against latest epic head `4901173` is still required before follow-up review
  or merge.
- 2026-07-06T20:06:22Z controller verification: PR #90 was pushed to head
  `57799dd` and GitHub reports it `CLEAN`. Controller verification passed
  branch freshness `0 7`, merge-tree, diff-check, AdminConfig tests 22/22,
  AdminOps tests 11/11, AdminAuth tests 16/16, UI typecheck, and root
  typecheck. Schrodinger follow-up review was requested in submission
  `019f3909-49a4-7902-bf82-5ea9a1c7468d`.
- 2026-07-06T20:09:32Z controller merge: Schrodinger returned
  `REVIEW_PASS` for PR #90 with no findings. Controller refreshed TASK-013 to
  task head `2efc58f`, verified final freshness `0 8`, merge-tree and
  diff-check, merged TASK-013 into the epic branch in `9974b29`, reran
  AdminConfig/AdminOps/AdminAuth UI tests plus UI/root typecheck, moved the
  task file to `done/`, removed the clean TASK-013 worktree, and pushed the
  epic branch. GitHub marked PR #90 `MERGED` at 2026-07-06T20:15:58Z. WAVE-008
  is ready for reconciliation.
- 2026-07-06T20:18:32Z reconciliation: WAVE-008 shared context now records the
  `AdminDashboard` operations shell, `AdminConfig` Config-tab integration,
  shared `adminApi` client consumption, UI secret redaction/write-only
  controls, validation/apply warnings, and downstream TASK-016/TASK-017/TASK-018
  handoffs. TASK-012/TASK-013 are done, PR #89/#90 are merged, and both
  worktrees are cleaned up.

Stop condition:

- Operations dashboard UI tests pass.
- Runtime configuration UI tests pass.
- Secret fields are write-only/redacted and destructive controls require clear
  confirmation states.

### WAVE-009

Status: done

Tasks:

- TASK-016-maintenance-admin-ui

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: high
- Requires user confirmation: no
- Confirmed by: Ivo via Codex finish-all-waves request on 2026-07-06

Rationale:

- Maintenance UI is a single coherent surface for dry-run, apply, confirmation,
  progress, and audit feedback.
- It should wait for the approved backend maintenance API contract.

Activation rule:

- Activate after WAVE-008 reconciliation.
- Ready after WAVE-008 reconciliation on 2026-07-06.
- Activated at 2026-07-06T20:30:02Z after WAVE-008 reconciliation checkpoint
  `ff2a873` was pushed.

Progress:

- TASK-016-maintenance-admin-ui moved to `in-progress/`; dedicated branch
  `codex/task/TASK-016-maintenance-admin-ui` and worktree
  `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-016-maintenance-admin-ui`
  are assigned and pending creation from the pushed activation checkpoint.
- Activation checkpoint `b34d0eb` was pushed to the epic branch. The TASK-016
  task branch/worktree were created from that checkpoint, pushed to origin, and
  verified clean/current with the in-progress task file and WDD state present.
- Worktree-state checkpoint `bf06360` was pushed and fast-forwarded into the
  task branch. Singer (`019f3926-c2c5-7290-9c2f-9a4cca19e6ae`) is dispatched;
  current gate is `no_pr`.
- 2026-07-06T20:56:02Z heartbeat: no PR exists yet; Singer is still active in
  the expected maintenance UI/client files, branch freshness is current, and no
  nudge was sent.
- 2026-07-06T21:11:02Z heartbeat: no PR exists yet; Singer remains active in
  expected maintenance UI/client files with fresh `AdminMaintenance` file
  activity, branch freshness is current, and no nudge was sent.
- 2026-07-06T21:26:02Z heartbeat: Singer returned `DONE` and opened draft PR
  #91. Controller verified PR #91 was clean/current before the review
  checkpoint and requested Hypatia review; final branch freshness refresh is
  required before merge.
- 2026-07-06T21:35:02Z heartbeat: Hypatia returned `REVIEW_PASS`; controller
  refreshed TASK-016 to task head `1885b64`, verified freshness and required UI
  checks, merged PR #91 into the epic branch in `10b2738`, cleaned up the
  worktree, and queued WAVE-009 for reconciliation.
- 2026-07-06T21:42:32Z reconciliation: WAVE-009 shared context now records the
  `AdminMaintenance` dashboard panel, concrete maintenance dry-run/apply client
  methods, preview-before-apply/step-up/idempotency/job-polling behavior, safe
  job summary rendering, and TASK-017/TASK-018 Docker/security handoffs. PR #91
  is merged, the task file is in `done/`, the worktree is cleaned up, and
  WAVE-010 is ready to start.

Stop condition:

- Maintenance UI tests pass.
- Dangerous actions remain frictioned and progress/error states are visible.

### WAVE-010

Status: in_progress

Tasks:

- TASK-017-docker-first-run-no-cli

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: no
- Confirmed by: Ivo via Codex finish-all-waves request on 2026-07-06

Rationale:

- This wave proves the main product hypothesis: a single Docker setup can be
  bootstrapped and operated without normal CLI or env-file editing.
- Docker, docs, and smoke validation should be reconciled in one task.

Activation rule:

- Activate after WAVE-009 reconciliation.
- Ready after WAVE-009 reconciliation on 2026-07-06.
- Activated at 2026-07-06T21:51:22Z after WAVE-009 reconciliation checkpoint
  `8b7f6c3` was pushed.

Progress:

- TASK-017-docker-first-run-no-cli moved to `in-progress/`; dedicated branch
  `codex/task/TASK-017-docker-first-run-no-cli` and worktree
  `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-017-docker-first-run-no-cli`
  are assigned and pending creation from the pushed activation checkpoint.
- 2026-07-06T21:54:35Z: branch/worktree were created from pushed activation
  checkpoint `d43f7df`, verified current with divergence `0 0`, and pushed.
- 2026-07-06T21:57:06Z: Bacon
  (`019f396f-3da8-7d11-94a0-3d84d26f490b`) was dispatched; current gate is
  `no_pr`.
- 2026-07-06T22:14:02Z: Bacon remains active with uncommitted Docker/docs/
  backend setup changes and smoke evidence files, no PR exists yet, and
  `git diff --check` passes. Final branch freshness is required before
  review/merge because the task branch is behind controller checkpoints.

Stop condition:

- Docker Compose config validates.
- UI build and typecheck pass.
- First-run no-CLI smoke evidence is recorded in shared context.

### WAVE-011

Status: planned

Tasks:

- TASK-018-security-epic-validation

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: high
- Requires user confirmation: no
- Confirmed by: null

Rationale:

- Final validation is a single security-focused review and evidence task.
- It should only run after Docker first-run evidence exists.

Activation rule:

- Activate after WAVE-010 reconciliation.

Stop condition:

- Security review has no unresolved P1/P2 issues.
- Broad backend, frontend, Docker, and smoke validation has run or explicit
  blockers are documented.
- Final handoff is ready for WDD epic validation and final PR preparation.
