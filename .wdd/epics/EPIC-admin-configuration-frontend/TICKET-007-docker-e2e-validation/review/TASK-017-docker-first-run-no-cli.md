---
id: TASK-017-docker-first-run-no-cli
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-007-docker-e2e-validation
wave: WAVE-010
slug: docker-first-run-no-cli
title: Docker First Run No CLI
status: review
depends_on:
  - TASK-012-admin-ops-dashboard-ui
  - TASK-013-admin-config-ui
  - TASK-016-maintenance-admin-ui
conflict_domains:
  - docker-compose.yml
  - README.md
  - docs/**
  - tests/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-017-docker-first-run-no-cli
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-017-docker-first-run-no-cli
worktree_status: clean_pushed
pr: https://github.com/ivo-toby/postgram/pull/92
worker_thread_id: null
review_thread_id: null
current_gate: ready_for_review
branch_freshness: current
verification:
  - docker compose config
  - npm run typecheck
  - npm --prefix ui run typecheck
  - npm --prefix ui run build
---

# TASK-017-docker-first-run-no-cli: Docker First Run No CLI

## Status

review

## Parent Ticket

TICKET-007-docker-e2e-validation

## Wave

WAVE-010

## Objective

Verify and document the clean-volume Docker Compose path where supported setup
and maintenance require no normal `pgm-admin` usage or manual env-file edits.

## Scope

- Included:
  - Docker Compose updates needed for the supported first-run flow.
  - README/deployment docs for bootstrap, admin login, configuration, and
    fallback CLI.
  - Smoke test evidence for clean first run.
  - Documentation of any remaining minimal bootstrap/encryption env value.
- Excluded:
  - External production deployment changes.

## Non-Scope

- Do not claim no CLI is required for emergency recovery if `pgm-admin` remains
  the documented fallback.

## Relevant Context

### Local Context

- `docker-compose.yml`
- `README.md`
- `docs/manual-test-plan.md`
- `Dockerfile`
- `ui/Dockerfile`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminConfig.tsx`
- `ui/src/components/admin/AdminMaintenance.tsx`
- `ui/src/lib/adminApi.ts`

### Shared Context References

- `../../shared-context/resources/testing-validation.md`
- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/security-model.md`

## Likely Files / Areas

- `docker-compose.yml`
- `.env.example`
- `README.md`
- `docs/manual-test-plan.md`
- Optional smoke test docs or scripts if existing project patterns support them.

## Dependencies

- TASK-012-admin-ops-dashboard-ui
- TASK-013-admin-config-ui
- TASK-016-maintenance-admin-ui

## Conflict Domains

- `docker-compose.yml`
- `README.md`
- `docs/**`
- `tests/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-017-docker-first-run-no-cli

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-017-docker-first-run-no-cli

## PR / Patch Reference

Draft PR: https://github.com/ivo-toby/postgram/pull/92

WAVE-010 activation recorded at 2026-07-06T21:51:22Z. The controller assigned
branch `codex/task/TASK-017-docker-first-run-no-cli` and the isolated worktree
path above. At 2026-07-06T21:54:35Z the task branch/worktree were created from
the pushed epic activation checkpoint, verified clean/current, and the task
branch was pushed to GitHub.

## RED-GREEN TDD Plan

### RED

Document or script a clean-volume smoke path that currently fails or requires
manual CLI/env edits.

Evidence:

- `npm test -- tests/unit/docker-first-run.test.ts` initially failed because
  `docker/postgram-ensure-secrets.sh` and `docker/postgram-entrypoint.sh` did
  not exist.
- `npm test -- tests/integration/admin-auth-service.test.ts` initially failed
  because `ensureFirstRunBootstrapToken` did not exist.
- First Docker smoke with `PORT=3217 UI_PORT=3317` exposed a Compose bug: the
  server listened on `3217` inside the container while the port mapping still
  targeted `3100`. Fixed by adding `POSTGRAM_API_PORT` for host binding and
  keeping container `PORT=3100`.

### GREEN

Update Docker/docs and run the smoke path until the supported happy path works.

Evidence:

- `npm test -- tests/unit/docker-first-run.test.ts` passed: 3 tests.
- `npm test -- tests/integration/admin-auth-service.test.ts` passed: 18 tests.
- Clean-volume Docker smoke passed with fixed ports and browser admin flow.

### REFACTOR

Keep docs honest about emergency CLI fallback and public exposure risks.

## Implementation Notes

- Preserve loopback-safe defaults unless Wave 1 chose otherwise.
- Include exact evidence commands and results in task completion notes.
- WAVE-004 introduced two outside-database installation keys:
  `ADMIN_MFA_SECRET_KEY` for encrypted TOTP factors and
  `ADMIN_SETTINGS_ENCRYPTION_KEY` for provider secret storage. The Docker
  happy path must document how these are generated, persisted, rotated or
  backed up, and supplied without putting usable secrets in database backups.
- The clean-volume smoke should prove setup fails closed when required admin
  encryption keys are absent or invalid, and succeeds when the documented
  Docker/operator path provides them.
- WAVE-008 added the real browser admin shell and Config tab. The smoke path
  should exercise the protected `AdminDashboard`, the `AdminConfig` provider
  configuration panel, API-key creation from the admin UI, and dashboard
  health/queue/stats/config-model/jobs/audit visibility rather than only
  backend routes.
- WAVE-009 added `AdminMaintenance` inside the same `AdminDashboard` shell.
  The clean-volume browser smoke should include one safe maintenance dry-run
  from the UI, prove `/admin/api/jobs/:jobId` polling is visible, and confirm
  the health, queue, stats, config/models/jobs, API keys, audit, Config, and
  Maintenance panels remain reachable after login/MFA.
- Provider secrets configured through the UI must remain write-only/redacted
  after reload/restart. Do not document any Docker path that requires putting
  provider plaintext, TOTP seeds, session tokens, or bootstrap tokens into
  browser storage or database backups.
- Keep emergency `pgm-admin` recovery documented separately from the supported
  happy path. The supported happy path should not require normal `pgm-admin`
  use after Docker startup/bootstrap.

## Durable Memory Notes To Consider

- Store durable memory if the Docker first-run procedure becomes stable and
  useful for future agents.

## Task-Level Definition of Done

- [x] Clean Docker first-run path is verified.
- [x] Docs match the verified path.
- [x] Remaining env requirements are explicit.
- [x] No-CLI claim is scoped and truthful.

## Validation Steps

- `docker compose config`
- Clean-volume Docker smoke command set from the task evidence
- `npm run typecheck`
- `npm --prefix ui run typecheck`
- `npm --prefix ui run build`

## Verification Evidence

- Activation verification passed: task branch/worktree created from pushed
  epic checkpoint `d43f7df`, in-progress TASK-017 file present, orchestration
  activeWave present, branch divergence from epic was `0 0`, and the task
  branch was pushed to origin.
- `docker compose config`: passed with
  `COMPOSE_PROJECT_NAME=pg-task017-smoke POSTGRAM_API_PORT=3217 UI_PORT=3317`;
  rendered config written to `/tmp/task017-docker-compose-config.yml`.
- Clean-volume Docker smoke command set:
  - `playwright-cli close-all || true`
  - `COMPOSE_PROJECT_NAME=pg-task017-smoke POSTGRAM_API_PORT=3217 UI_PORT=3317 docker compose down -v --remove-orphans`
  - `COMPOSE_PROJECT_NAME=pg-task017-smoke POSTGRAM_API_PORT=3217 UI_PORT=3317 LOG_LEVEL=info docker compose up -d --build`
  - `curl -fsS http://127.0.0.1:3217/health`
  - `curl -fsS http://127.0.0.1:3317/health`
  - `COMPOSE_PROJECT_NAME=pg-task017-smoke POSTGRAM_API_PORT=3217 UI_PORT=3317 docker compose logs --no-color --tail=80 mcp-server postgram-secrets`
- Clean-volume Docker smoke evidence:
  - `postgram-secrets` generated `postgres-password`,
    `admin-mfa-secret-key`, and `admin-settings-encryption-key` in the
    persistent `postgram_secrets` volume.
  - `mcp-server` generated one first-run token with prefix
    `pgm-admin-bootstrap-...` and expiry `2026-07-07T22:16:30.343Z`.
  - API health returned
    `{"status":"ok","version":"0.1.0","postgres":"connected","embedding_model":"bge-m3"}`.
  - UI health returned the same status payload through the frontend proxy.
  - Browser smoke at `http://127.0.0.1:3317/admin` completed first admin
    setup for `docker-smoke-final@example.com`, MFA enrollment, and protected
    dashboard access.
  - Overview showed Health, Queue, Stats, Config status, Models, Jobs, API
    keys, and Audit surfaces.
  - Admin UI created API key `docker-smoke-final-key` for client
    `docker-smoke-final-client`; the one-time plaintext key was shown only in
    the create result and the key table listed it as active.
  - Config tab saved fake provider secret `sk-smoke-final-redaction-secret`.
    After `docker compose restart mcp-server postgram-ui` and reload, Config
    showed `OPENAI_API_KEY` as configured metadata, the replacement input was
    blank, page snapshot did not contain the fake secret, and both
    `playwright-cli localstorage-list` and `playwright-cli sessionstorage-list`
    returned no items.
  - Direct DB check returned `OPENAI_API_KEY|openai|provider|v1|0|t` for:
    `SELECT name, provider, purpose, key_version, position('sk-smoke-final-redaction-secret' in ciphertext::text), octet_length(ciphertext) > 0 FROM admin_runtime_secrets WHERE name = 'OPENAI_API_KEY';`
  - Maintenance tab ran re-extract memory dry-run job
    `f26886e9-77ff-4708-906e-d5865cfbd8d4`, completed with `dryRun true`,
    `wouldMark 0`, and `wouldDeleteEdges 0`.
  - `playwright-cli requests` showed
    `POST /admin/api/maintenance/reextract/dry-run => 202` and two
    `GET /admin/api/jobs/f26886e9-77ff-4708-906e-d5865cfbd8d4 => 200` polls.
- `npm test -- tests/unit/docker-first-run.test.ts`: passed, 5 tests after
  review fixes for legacy `POSTGRES_PASSWORD` seeding, dynamic Compose
  embedding defaults, and strict settings-key format validation.
- `npm test -- tests/integration/admin-auth-service.test.ts`: passed, 18 tests.
- `npm run typecheck`: passed.
- `npm --prefix ui run typecheck`: initially failed because local
  `ui/node_modules` was missing React/dependency packages; after
  `npm --prefix ui ci`, passed.
- `npm --prefix ui run build`: initially failed for the same missing local UI
  dependencies; after `npm --prefix ui ci`, passed with the existing Vite
  chunk-size warning.
- `git diff --check`: passed.
- `jq empty .wdd/epics/EPIC-admin-configuration-frontend/orchestration.json`:
  passed.
- `codex review --base origin/codex/epic/admin-configuration-frontend`:
  reported two P1 upgrade findings, both fixed in follow-up changes.
- Post-review clean startup smoke:
  `COMPOSE_PROJECT_NAME=pg-task017-reviewfix POSTGRAM_API_PORT=3217 UI_PORT=3317 LOG_LEVEL=info docker compose up -d --build`
  passed from clean volumes. API and UI health returned OK, the entrypoint
  chose Ollama for a no-key clean boot, and the bootstrap token log appeared.
- Post-review `docker compose config` with an empty environment showed
  `EMBEDDING_PROVIDER: ""` for the app entrypoint to resolve and
  `POSTGRES_PASSWORD: ""` unless a legacy override is supplied.

## Review Feedback

### P1

- Fixed: new `postgram_secrets/postgres-password` could diverge from an
  existing Docker install's old `${POSTGRES_PASSWORD}` while `pgdata` kept the
  old role password. The init service now receives `POSTGRES_PASSWORD` and
  seeds the secret file from it when present and the secret is absent.
- Fixed: Compose's initial Ollama default would break existing OpenAI/chunked
  installs by tripping embedding identity validation. Compose now passes
  blank `EMBEDDING_PROVIDER`; the entrypoint selects `openai` when
  `OPENAI_API_KEY` is present and `ollama` only when no provider/key override
  is supplied.

### P2

- None.

### P3

- None.

## Completion Notes

- Implemented a Docker-first-run secret volume initializer for Postgres,
  admin MFA, and admin settings encryption keys.
- Added an image entrypoint that loads/validates those secret files and fails
  closed before server bind when required key material is missing or invalid.
- Added server-side first-run bootstrap token generation on startup when no
  admin and no usable unexpired bootstrap token exist.
- Documented the supported happy path as browser Admin UI bootstrap,
  provider configuration, API-key creation, diagnostics, and safe maintenance
  dry-runs, with `pgm-admin` scoped to emergency/advanced operator work.
- Updated Docker/manual test docs to cover backup, restore, and failure
  behavior for `ADMIN_MFA_SECRET_KEY` and
  `ADMIN_SETTINGS_ENCRYPTION_KEY`.
- Preserved existing Docker upgrades by seeding the new Postgres secret from
  legacy `POSTGRES_PASSWORD` and keeping OpenAI as the implicit provider when
  a legacy `OPENAI_API_KEY` exists.
