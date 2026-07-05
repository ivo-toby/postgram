---
id: EPIC-admin-configuration-frontend-WAVES
kind: wave_plan
epic: EPIC-admin-configuration-frontend
status: in_progress
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Wave Plan: EPIC-admin-configuration-frontend

## Task Inventory

| Task | Ticket | Depends On | Conflict Domains | Status |
|------|--------|------------|------------------|--------|
| TASK-001-admin-surface-inventory | TICKET-001-feasibility-security-design | None | `src/cli/admin/pgm-admin.ts`, admin service boundaries, shared context | done |
| TASK-002-threat-model-bootstrap | TICKET-001-feasibility-security-design | None | admin auth architecture, Docker exposure model, shared context | done |
| TASK-003-runtime-config-feasibility | TICKET-001-feasibility-security-design | None | `src/config.ts`, `src/index.ts`, provider lifecycle, Docker docs | done |
| TASK-004-admin-auth-persistence | TICKET-002-admin-auth-foundation | TASK-001, TASK-002 | migrations, `src/auth/**`, admin auth services, integration tests | done |
| TASK-005-admin-session-routes | TICKET-002-admin-auth-foundation | TASK-004 | admin routes, cookies, CSRF, lockout, auth contract tests | in_progress |
| TASK-006-admin-mfa-step-up | TICKET-002-admin-auth-foundation | TASK-004, TASK-005 | MFA tables, TOTP service, step-up middleware, sensitive action gates | todo |
| TASK-007-admin-api-shell-diagnostics | TICKET-003-admin-api-foundation | TASK-005 | admin transport, diagnostics routes, admin middleware | todo |
| TASK-008-admin-key-audit-stats-api | TICKET-003-admin-api-foundation | TASK-007 | key service, audit querying, stats service, admin API contracts | todo |
| TASK-009-settings-secret-store | TICKET-004-runtime-configuration | TASK-003, TASK-005 | settings migrations, secret encryption, config service | todo |
| TASK-010-provider-config-apply | TICKET-004-runtime-configuration | TASK-009 | provider lifecycle, validation flows, config tests, worker reload semantics | todo |
| TASK-011-admin-auth-ui | TICKET-005-admin-frontend | TASK-006 | React auth shell, admin session client, MFA UI, UI routing | todo |
| TASK-012-admin-ops-dashboard-ui | TICKET-005-admin-frontend | TASK-008, TASK-011 | API key UI, audit/stats/health pages, admin API client | todo |
| TASK-013-admin-config-ui | TICKET-005-admin-frontend | TASK-010, TASK-011 | runtime config UI, secret redaction, provider validation UI | todo |
| TASK-014-admin-job-foundation | TICKET-006-maintenance-jobs | TASK-006, TASK-009 | job tables, job service, audit integration, progress state | todo |
| TASK-015-maintenance-admin-api | TICKET-006-maintenance-jobs | TASK-008, TASK-010, TASK-014 | graph/memory/embedding services, dry-run/apply admin APIs, CLI regressions | todo |
| TASK-016-maintenance-admin-ui | TICKET-006-maintenance-jobs | TASK-011, TASK-015 | maintenance UI, confirmations, progress polling, admin API client | todo |
| TASK-017-docker-first-run-no-cli | TICKET-007-docker-e2e-validation | TASK-012, TASK-013, TASK-016 | Docker Compose, `.env.example`, README/deployment docs, smoke tests | todo |
| TASK-018-security-epic-validation | TICKET-007-docker-e2e-validation | TASK-017 | security review, broad validation, final handoff artifacts | todo |

## Dependency Grid

| Task | Blocks | Blocked By |
|------|--------|------------|
| TASK-001-admin-surface-inventory | TASK-004-admin-auth-persistence | None |
| TASK-002-threat-model-bootstrap | TASK-004-admin-auth-persistence | None |
| TASK-003-runtime-config-feasibility | TASK-009-settings-secret-store | None |
| TASK-004-admin-auth-persistence | TASK-005-admin-session-routes, TASK-006-admin-mfa-step-up | TASK-001-admin-surface-inventory, TASK-002-threat-model-bootstrap |
| TASK-005-admin-session-routes | TASK-006-admin-mfa-step-up, TASK-007-admin-api-shell-diagnostics, TASK-009-settings-secret-store | TASK-004-admin-auth-persistence |
| TASK-006-admin-mfa-step-up | TASK-011-admin-auth-ui, TASK-014-admin-job-foundation | TASK-004-admin-auth-persistence, TASK-005-admin-session-routes |
| TASK-007-admin-api-shell-diagnostics | TASK-008-admin-key-audit-stats-api | TASK-005-admin-session-routes |
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

Status: in_progress

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

Stop condition:

- Admin auth contract tests pass.
- Ordinary API keys and existing MCP OAuth tokens cannot call admin routes.

### WAVE-004

Status: planned

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
- Confirmed by: null

Rationale:

- MFA/step-up and settings/secret storage both depend on the admin session
  boundary and both touch security-sensitive migrations.
- They can proceed as two subgroups if migration ordering and shared test
  helpers are reconciled.

Activation rule:

- Activate after WAVE-003 reconciliation.
- Dispatch as two subgroups: auth/MFA and settings/secrets.

Stop condition:

- MFA/step-up tests pass.
- Settings and secret storage tests pass.
- Migration ordering and rollback posture are documented in shared context.

### WAVE-005

Status: planned

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
- Confirmed by: null

Rationale:

- The admin API shell and provider apply/reload flow share the admin boundary
  but are separable into transport and runtime-config subgroups.
- Both are high-risk because they touch public admin contracts and provider
  lifecycle behavior.

Activation rule:

- Activate after WAVE-004 reconciliation.

Stop condition:

- Read-only diagnostics route tests pass.
- Provider validation/apply tests pass.
- Shared context records any changes that require restart rather than hot reload.

### WAVE-006

Status: planned

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
- Confirmed by: null

Rationale:

- API-key/audit/stats endpoints and job foundation share audit semantics but
  can remain separate service subgroups.
- Both create privileged admin-facing behavior and require full contract review.

Activation rule:

- Activate after WAVE-005 reconciliation.

Stop condition:

- Admin key/audit/stats contract tests pass.
- Job service persistence/progress tests pass.
- Audit attribution covers admin actor and operation.

### WAVE-007

Status: planned

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
- Confirmed by: null

Rationale:

- The protected admin UI shell can proceed while approved maintenance APIs are
  implemented because the file ownership is mostly frontend versus backend.
- The wave still needs full review because both tasks expose sensitive flows.

Activation rule:

- Activate after WAVE-006 reconciliation.

Stop condition:

- Admin auth UI tests pass.
- Maintenance API dry-run/apply tests and CLI regression tests pass.
- Shared admin API client contracts are reconciled before later UI work.

### WAVE-008

Status: planned

Tasks:

- TASK-012-admin-ops-dashboard-ui
- TASK-013-admin-config-ui

Recommended strategy:

- Profile: full
- Execution mode: hybrid
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: null

Rationale:

- These are both frontend admin surfaces with shared layout/client concerns.
- They can run as two subgroups if shared admin client/types are reconciled
  early and secrets remain redacted.

Activation rule:

- Activate after WAVE-007 reconciliation.

Stop condition:

- Operations dashboard UI tests pass.
- Runtime configuration UI tests pass.
- Secret fields are write-only/redacted and destructive controls require clear
  confirmation states.

### WAVE-009

Status: planned

Tasks:

- TASK-016-maintenance-admin-ui

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: high
- Requires user confirmation: yes
- Confirmed by: null

Rationale:

- Maintenance UI is a single coherent surface for dry-run, apply, confirmation,
  progress, and audit feedback.
- It should wait for the approved backend maintenance API contract.

Activation rule:

- Activate after WAVE-008 reconciliation.

Stop condition:

- Maintenance UI tests pass.
- Dangerous actions remain frictioned and progress/error states are visible.

### WAVE-010

Status: planned

Tasks:

- TASK-017-docker-first-run-no-cli

Recommended strategy:

- Profile: full
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: null

Rationale:

- This wave proves the main product hypothesis: a single Docker setup can be
  bootstrapped and operated without normal CLI or env-file editing.
- Docker, docs, and smoke validation should be reconciled in one task.

Activation rule:

- Activate after WAVE-009 reconciliation.

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
