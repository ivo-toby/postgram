---
id: TASK-010-provider-config-apply
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-004-runtime-configuration
wave: WAVE-005
slug: provider-config-apply
title: Provider Config Apply
status: in_progress
depends_on:
  - TASK-009-settings-secret-store
conflict_domains:
  - src/config.ts
  - src/index.ts
  - src/services/embeddings/**
  - src/services/llm-provider.ts
  - src/services/enrichment-worker.ts
  - docker-compose.yml
  - README.md
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-010-provider-config-apply
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-010-provider-config-apply
worktree_status: active_uncommitted
pr: null
worker_thread_id: 019f35ff-a193-7ae0-a4b8-1ec53faabb74
review_thread_id: null
current_gate: no_pr
branch_freshness: stale_pending_refresh_before_review
verification:
  - npm test -- tests/integration/admin-provider-config.test.ts
  - npm test -- tests/unit/config.test.ts
  - npm run typecheck
---

# TASK-010-provider-config-apply: Provider Config Apply

## Status

in_progress

## Parent Ticket

TICKET-004-runtime-configuration

## Wave

WAVE-005

## Objective

Add provider configuration validation and safe apply/reload behavior for the
approved first runtime settings scope.

## Scope

- Included:
  - Admin API/service for reading redacted provider settings.
  - Save and validate embedding/extraction provider settings.
  - Connection-test or validation endpoint.
  - Explicit URL/egress safety validation for admin-configured provider base
    URLs, especially `EXTRACTION_BASE_URL`, so connection tests cannot become a
    generic server-side request primitive.
  - Apply/reload/reinitialize behavior according to TASK-003 decision.
  - Docker and docs updates for any new required config.
- Excluded:
  - Maintenance job UI.
  - Full secret rotation if not selected for first scope.

## Non-Scope

- Do not allow embedding dimension changes without migration-safe handling.

## Relevant Context

### Local Context

- `src/config.ts`
- `src/index.ts`
- `src/services/admin-settings-service.ts`
- `src/services/embeddings/providers.ts`
- `src/services/embeddings/admin.ts`
- `src/services/llm-provider.ts`
- `src/db/migrations/011_admin_settings.sql`
- `docker-compose.yml`
- `README.md`

### Shared Context References

- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/security-model.md`

## Likely Files / Areas

- `src/services/admin-provider-config-service.ts`
- `src/transport/admin.ts`
- `src/index.ts`
- `docker-compose.yml`
- `README.md`
- `tests/integration/admin-provider-config.test.ts`

## Dependencies

- TASK-009-settings-secret-store

## Conflict Domains

- `src/config.ts`
- `src/index.ts`
- `src/services/embeddings/**`
- `src/services/llm-provider.ts`
- `docker-compose.yml`
- `README.md`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-010-provider-config-apply

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-010-provider-config-apply

Assigned by WAVE-005 activation. The controller must create and verify this
isolated worktree before dispatch.

Verified and dispatched at 2026-07-06T05:56:19Z with worker Goodall
(`019f35ff-a193-7ae0-a4b8-1ec53faabb74`) on branch
`codex/task/TASK-010-provider-config-apply`.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing tests for redacted config read, invalid provider settings,
provider URL/egress safety policy enforcement, connection-test
failure/success, and apply behavior.

### GREEN

Implement provider config service and admin endpoints with safe apply semantics.

### REFACTOR

Keep provider construction logic centralized to avoid env/DB drift.

## Implementation Notes

- Preserve current env behavior as fallback unless Wave 1 decided otherwise.
- Make restart-required or reembed-required states explicit in API responses.
- Treat provider base URLs as attacker-controlled admin input. Tests must cover
  the chosen allow/deny policy for schemes, hostnames/IPs, local-provider
  exceptions, metadata/link-local/private-network handling, redirects if
  allowed, and error redaction.
- Build on WAVE-004 `src/services/admin-settings-service.ts`; do not create a
  parallel settings or secret store. Non-secret provider settings belong in
  `admin_runtime_settings`, and provider secrets belong in
  `admin_runtime_secrets`.
- Use `ADMIN_SETTINGS_ENCRYPTION_KEY` for secret persistence. The service
  expects a 32-byte base64url key, or `base64:` prefixed base64, supplied
  outside the database.
- Secret validation metadata for secret records must remain `{}` on save and
  readback. Store only safe validation status/message for secrets; never persist
  provider response bodies, authorization headers, token prefixes, or reusable
  identifiers in redacted metadata.
- Future HTTP endpoints must honor
  `ADMIN_SETTINGS_HTTP_AUTHORITY_CONTRACT`: `/admin/api/*`, admin session
  cookie, CSRF on mutations, ordinary API-key/MCP OAuth bearer rejection, and
  recent step-up for secret writes/apply operations.
- Use structured `audit_log.admin_user_id` attribution for provider config
  mutations.

## Durable Memory Notes To Consider

- Store durable memory if env fallback or apply strategy becomes a stable
  operational convention.

## Task-Level Definition of Done

- [ ] Provider config APIs are covered.
- [ ] Secrets are redacted.
- [ ] Provider URL validation has explicit egress/SSRF-safety coverage, not
      only generic connection-test success/failure coverage.
- [ ] Apply/reload behavior is explicit and safe.
- [ ] Docker/docs reflect new runtime configuration.

## Validation Steps

- `npm test -- tests/integration/admin-provider-config.test.ts`
- `npm test -- tests/unit/config.test.ts`
- `npm run typecheck`

## Verification Evidence

- Not run yet.
- 2026-07-06T06:33:47Z controller observation: Goodall did not return a final
  status during the bounded wait, no PR exists for
  `codex/task/TASK-010-provider-config-apply`, and the assigned worktree still
  has active uncommitted changes in expected provider-config files.
- 2026-07-06T06:36:37Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted in the same expected provider-config
  files. No nudge was sent because visible implementation work is ongoing.
- 2026-07-06T06:52:07Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted, with recent local mtimes on
  `src/services/admin-provider-config-service.ts` and
  `tests/integration/admin-provider-config.test.ts`. No nudge was sent because
  visible implementation work is ongoing.
- 2026-07-06T07:07:07Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted, with recent local mtimes on
  `src/services/admin-provider-config-service.ts` and
  `tests/integration/admin-provider-config.test.ts`. No nudge was sent because
  visible implementation work is ongoing.
- 2026-07-06T07:22:07Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted, with recent local mtimes on
  `src/services/admin-provider-config-service.ts` and
  `tests/integration/admin-provider-config.test.ts`. No nudge was sent because
  visible implementation work is ongoing.
- 2026-07-06T07:37:07Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted, with recent local mtimes on
  `src/services/admin-provider-config-service.ts`,
  `src/transport/admin-provider-config.ts`, and
  `tests/integration/admin-provider-config.test.ts`. No nudge was sent because
  visible implementation work is ongoing.
- 2026-07-06T07:52:23Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted, with recent local mtimes on
  `src/services/admin-provider-config-service.ts` and
  `tests/integration/admin-provider-config.test.ts`. No nudge was sent because
  visible implementation work is ongoing.
- 2026-07-06T08:07:23Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted, now including provider construction
  changes in `src/services/embeddings/providers.ts` and
  `src/services/llm-provider.ts`. Recent local mtimes on provider service,
  provider construction, and integration test files show visible implementation
  work, so no nudge was sent. `git rev-list --left-right --count
  origin/codex/epic/admin-configuration-frontend...HEAD` returned `15 0`;
  refresh the task branch against the epic branch before review or merge.
- 2026-07-06T08:22:23Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted in the expected provider-config file set.
  Recent local mtimes on `src/services/admin-provider-config-service.ts` and
  `tests/integration/admin-provider-config.test.ts` show visible implementation
  work within this monitoring cadence, so no nudge was sent. `git rev-list
  --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD`
  returned `16 0`; refresh the task branch against the epic branch before
  review or merge.
- 2026-07-06T08:37:23Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted in the expected provider-config file set.
  Local mtimes on `src/services/admin-provider-config-service.ts` and
  `tests/integration/admin-provider-config.test.ts` moved during this heartbeat
  window, so no nudge was sent. `git rev-list --left-right --count
  origin/codex/epic/admin-configuration-frontend...HEAD` returned `17 0`;
  refresh the task branch against the epic branch before review or merge.
- 2026-07-06T08:52:24Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted in the expected provider-config file set.
  The local mtime on `tests/integration/admin-provider-config.test.ts` moved
  during this heartbeat, so no nudge was sent. `git rev-list --left-right
  --count origin/codex/epic/admin-configuration-frontend...HEAD` returned
  `18 0`; refresh the task branch against the epic branch before review or
  merge.
- 2026-07-06T09:07:24Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted in the expected provider-config file set.
  Recent local mtimes on `tests/integration/admin-provider-config.test.ts` and
  `src/services/admin-provider-config-service.ts` show visible implementation
  work, so no nudge was sent. `git rev-list --left-right --count
  origin/codex/epic/admin-configuration-frontend...HEAD` returned `19 0`;
  refresh the task branch against the epic branch before review or merge.
- 2026-07-06T09:22:24Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted in the expected provider-config file set.
  Recent local mtimes on `src/services/admin-provider-config-service.ts` and
  `tests/integration/admin-provider-config.test.ts` show visible implementation
  work, so no nudge was sent. `git rev-list --left-right --count
  origin/codex/epic/admin-configuration-frontend...HEAD` returned `20 0`;
  refresh the task branch against the epic branch before review or merge.
- 2026-07-06T09:37:24Z controller observation: Goodall still had no final
  status and no PR for `codex/task/TASK-010-provider-config-apply`; the assigned
  worktree remained active/uncommitted in the expected provider-config file set.
  A fresh local mtime on `tests/unit/config.test.ts` shows visible
  implementation work, so no nudge was sent. `git rev-list --left-right
  --count origin/codex/epic/admin-configuration-frontend...HEAD` returned
  `21 0`; refresh the task branch against the epic branch before review or
  merge.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.
