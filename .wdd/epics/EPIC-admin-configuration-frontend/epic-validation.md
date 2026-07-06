---
id: EPIC-admin-configuration-frontend-VALIDATION-REPORT
kind: epic_validation
epic: EPIC-admin-configuration-frontend
status: passed
created_at: 2026-07-06
updated_at: 2026-07-06
---

# Epic Validation: EPIC-admin-configuration-frontend

## Validation Summary

Result: passed with non-blocking concerns.

The core hypothesis is proven for the supported Docker happy path: Postgram can
bootstrap a separate MFA-backed admin plane, configure provider settings and
write-only provider secrets, create API keys, inspect dashboard status, and run
safe maintenance dry-runs from the browser without normal `pgm-admin` use or
manual env-file edits after Docker startup.

The hypothesis is intentionally not broader than that path. `pgm-admin` remains
the emergency and advanced-operator fallback for embedding migrations, raw SQL
inspection, recovery, and jobs not yet exposed through reviewed typed admin
APIs.

## Epic Definition Of Done

- [x] Admin auth is separate from ordinary API-key bearer auth.
- [x] First-run bootstrap uses a one-time local-operator token and cannot be
      claimed by public browser reachability alone.
- [x] Admin sessions use HttpOnly cookies with in-memory CSRF in the frontend.
- [x] MFA and recent step-up gate sensitive admin actions.
- [x] Provider secrets are encrypted, write-only, redacted on read, and absent
      from browser storage.
- [x] Approved admin APIs are typed service routes, not CLI shell-outs.
- [x] Maintenance operations use dry-run/apply, preview evidence, idempotency,
      job polling, and safe result summaries.
- [x] Docker first-run no-normal-CLI path is documented and smoke-tested.
- [x] Final broad verification ran, with non-blocking failures recorded below.
- [x] No unresolved P1/P2 security finding remains from this validation.

## Deliverable Checklist

- [x] Feasibility/security research reconciled in WAVE-001.
- [x] Admin auth/session/MFA/step-up backend delivered in WAVES-002 through
      WAVE-004.
- [x] Admin diagnostics, provider config, API-key, audit, stats, and job APIs
      delivered in WAVES-005 and WAVE-006.
- [x] Admin auth, operations, config, and maintenance UI delivered in WAVES-007
      through WAVE-009.
- [x] Docker first-run/no-normal-CLI path delivered and smoke-tested in
      WAVE-010.
- [x] Security/epic validation and handoff artifacts prepared in WAVE-011.

## Task State Audit

| Task | Status | PR/Patch | Verification | Review |
|------|--------|----------|--------------|--------|
| TASK-001-admin-surface-inventory | done | PR #78 | passed | REVIEW_PASS |
| TASK-002-threat-model-bootstrap | done | PR #78 | passed | REVIEW_PASS after P2 fix |
| TASK-003-runtime-config-feasibility | done | PR #78 | passed | REVIEW_PASS |
| TASK-004-admin-auth-persistence | done | PR #79 | passed | REVIEW_PASS |
| TASK-005-admin-session-routes | done | PR #80 | passed | REVIEW_PASS |
| TASK-006-admin-mfa-step-up | done | PR #82 | passed | REVIEW_PASS |
| TASK-007-admin-api-shell-diagnostics | done | PR #83 | passed | REVIEW_PASS |
| TASK-008-admin-key-audit-stats-api | done | PR #85 | passed | REVIEW_PASS |
| TASK-009-settings-secret-store | done | PR #81 | passed | REVIEW_PASS |
| TASK-010-provider-config-apply | done | PR #84 | passed | REVIEW_PASS after P2 freshness fix |
| TASK-011-admin-auth-ui | done | PR #87 | passed | REVIEW_PASS |
| TASK-012-admin-ops-dashboard-ui | done | PR #89 | passed | REVIEW_PASS |
| TASK-013-admin-config-ui | done | PR #90 | passed | REVIEW_PASS after P2 freshness fix |
| TASK-014-admin-job-foundation | done | PR #86 | passed | REVIEW_PASS after P2 freshness fix |
| TASK-015-maintenance-admin-api | done | PR #88 | passed | REVIEW_PASS after P2 WDD freshness fix |
| TASK-016-maintenance-admin-ui | done | PR #91 | passed | REVIEW_PASS |
| TASK-017-docker-first-run-no-cli | done | PR #92 | passed | REVIEW_PASS after two P1 upgrade fixes |
| TASK-018-security-epic-validation | review | pending task PR | passed with concerns | pending controller review |

## Review Audit

- P1 findings: none unresolved.
- P2 findings: none unresolved.
- P3 / non-blocking concerns:
  - `npm run lint` still fails on existing repo-wide lint baseline outside
    TASK-018 product changes: unsafe assignments in older tests, async test
    helpers without `await`, missing `react-hooks/exhaustive-deps` rule setup,
    older UI floating promises/unnecessary assertions, `tailwind.config.js`
    `require` globals, and `ui/vite.config.ts` project-service inclusion.
  - Full UI audit still reports dev-tooling advisories in Vitest/Vite/esbuild
    that require `npm audit fix --force` and a breaking Vitest 4 upgrade.
    Production UI audit is clean.
  - Full root audit still reports moderate/low dev-tooling advisories in
    esbuild/testcontainers/dockerode/uuid. Production root audit is clean.

## Verification Evidence

Fresh TASK-018 validation on 2026-07-06 UTC:

- `npm ci`: completed; initial production audit reported runtime advisories.
- `npm --prefix ui ci`: completed; initial production audit reported
  markdown/linkify advisories.
- `npm audit fix`: applied non-force root dependency refresh. Runtime
  dependency evidence after fix: `@hono/node-server@1.19.14`, `hono@4.12.28`,
  `fast-uri@3.1.3`, and `path-to-regexp@8.4.2`.
- `npm --prefix ui audit fix`: applied non-force UI dependency refresh.
  Runtime markdown evidence after fix: `markdown-it@14.3.0` and
  `linkify-it@5.0.2` through `tiptap-markdown`.
- `npm audit --omit=dev --audit-level=high`: passed, 0 vulnerabilities.
- `npm --prefix ui audit --omit=dev --audit-level=high`: passed, 0
  vulnerabilities.
- `npm run typecheck`: passed, including `@ivotoby/postgram-cli` typecheck.
- `npm test`: passed, 45 test files and 491 tests.
- `npm run build`: passed.
- `npm --prefix ui run typecheck`: passed.
- `npm --prefix ui run test -- --run`: passed, 15 test files and 125 tests.
- `npm --prefix ui run build`: passed with the existing Vite large-chunk
  warning.
- `docker compose config >/tmp/task018-docker-compose-config.yml`: passed.
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`:
  passed.
- `git diff --check`: passed.
- `git rev-list --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD`:
  reported `1 0` before TASK-018 artifact commits.
- `git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD`:
  returned tree `80b719f3f2e9fdf46aae650b26c478235ac3e436`.
- `npm run lint`: failed with 22 existing repo-wide lint errors; see Review
  Audit for the categories.

## Security Surface Audit

- Admin auth/session/MFA/CSRF: reviewed `src/auth/admin-middleware.ts` and
  `src/transport/admin.ts`; business admin routes compose admin session proof
  with active-MFA middleware, unsafe methods require CSRF, and key/secret/apply
  mutations require recent step-up where expected.
- Bootstrap: reviewed server startup and route contracts. Bootstrap status
  returns state only; first-run token generation is server-side, hash-only
  after generation, logged through the trusted operator channel, and first
  admin remains pending until MFA verification.
- Ordinary bearer denial: backend tests cover ordinary API-key and MCP OAuth
  bearer rejection for auth, diagnostics, provider-config, key/audit/stats,
  and maintenance admin routes.
- Secrets/config: provider secret writes require step-up, stored secrets are
  encrypted under `ADMIN_SETTINGS_ENCRYPTION_KEY`, redacted reads exclude
  plaintext/ciphertext/token prefixes/auth headers/provider bodies, and apply
  blocks stale validation or embedding identity changes that need migration.
- Maintenance jobs: reviewed `src/transport/admin-maintenance.ts` and
  `src/services/admin-job-service.ts`; dry-runs require active MFA, applies
  require recent step-up plus a fresh matching preview job and scoped
  idempotency key, web edge pruning is constrained to `llm-extraction`, and job
  summaries reject sensitive keys/values.
- Frontend storage: reviewed `ui/src/lib/adminApi.ts` and admin UI tests. The
  admin client uses same-origin credentials, in-memory CSRF, and no
  Authorization header path. UI tests assert local/session storage does not
  retain admin session, bootstrap, TOTP, provider secret, one-time API-key, or
  bearer credential material.
- Docker first-run/no-normal-CLI: reviewed TASK-017 smoke evidence plus
  `docker/postgram-ensure-secrets.sh`, `docker/postgram-entrypoint.sh`,
  `docker-compose.yml`, and README wording. The WAVE-010 gates are satisfied:
  clean-volume browser smoke evidence, legacy `POSTGRES_PASSWORD` preservation,
  OpenAI provider default preservation, admin key fail-closed behavior, Config
  secret redaction after restart, browser storage non-persistence, and
  emergency `pgm-admin` fallback wording.

## Shared Context Audit

- Shared-context index is coherent and points to focused resources.
- Security model, API contracts, architecture, testing-validation, and
  migration/config notes all include WAVE-010 carry-forward gates.
- No large unindexed shared-context dump was introduced.
- TASK-018 should be reconciled by the controller after review/merge.

## Monitoring Audit

- Monitoring mode: adaptive.
- Monitoring status before this worker: WAVE-011 worktree ready pending
  dispatch.
- Worker outcome: TASK-018 moved to review with task PR pending creation.
- Stop condition: controller should request review; if review passes, refresh
  against `codex/epic/admin-configuration-frontend`, rerun freshness checks,
  merge TASK-018 into the epic branch, then run WDD epic validation/final PR.

## Integration Risks

- Non-blocking lint debt means `npm run lint` is not yet a reliable final gate.
  This is not introduced by the admin epic lockfile changes but remains a repo
  hygiene risk.
- UI dev-tooling audit needs a planned Vitest/Vite upgrade if the team wants a
  fully clean all-dependency audit, but production audit is clean.
- Production proxy/TLS trusted-header behavior and MFA recovery/OIDC remain
  explicitly out of this epic's first implementation scope.

## Branch State

- Target branch: `main`.
- Epic branch: `codex/epic/admin-configuration-frontend`.
- Task branch: `codex/task/TASK-018-security-epic-validation`.
- Branch freshness before artifact edits: task branch was `1 0` relative to
  `origin/codex/epic/admin-configuration-frontend`, and merge-tree was clean.

## Result

passed
