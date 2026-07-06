---
id: TASK-010-provider-config-apply
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-004-runtime-configuration
wave: WAVE-005
slug: provider-config-apply
title: Provider Config Apply
status: review
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
worktree_status: pushed
pr: https://github.com/ivo-toby/postgram/pull/84
worker_thread_id: 019f35ff-a193-7ae0-a4b8-1ec53faabb74
review_thread_id: 019f3708-a5ce-7053-97df-8703bcfbb90c
current_gate: review
branch_freshness: current_at_dispatch
verification:
  - npm test -- tests/integration/admin-provider-config.test.ts
  - npm test -- tests/unit/config.test.ts
  - npm run typecheck
---

# TASK-010-provider-config-apply: Provider Config Apply

## Status

review

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

https://github.com/ivo-toby/postgram/pull/84

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

- [x] Provider config APIs are covered.
- [x] Secrets are redacted.
- [x] Provider URL validation has explicit egress/SSRF-safety coverage, not
      only generic connection-test success/failure coverage.
- [x] Apply/reload behavior is explicit and safe.
- [x] Docker/docs reflect new runtime configuration. No new required runtime
      configuration value was introduced; the existing
      `ADMIN_SETTINGS_ENCRYPTION_KEY` runtime dependency remains unchanged.

## Validation Steps

- `npm test -- tests/integration/admin-provider-config.test.ts`
- `npm test -- tests/unit/config.test.ts`
- `npm run typecheck`

## Verification Evidence

- RED: `npm test -- tests/integration/admin-provider-config.test.ts -t "rejects provider base URLs with query strings or fragments before save"` failed before implementation because provider base URLs with query strings were accepted.
- GREEN: `npm test -- tests/integration/admin-provider-config.test.ts -t "rejects provider base URLs with query strings, fragments, or credentials before save"` passed after save-time URL normalization rejected query strings, fragments, and credentials.
- RED: `npm test -- tests/integration/admin-provider-config.test.ts -t "keeps zero-version applied provider settings active while edits are pending"` failed before the backfill predicate fix because zero-version applied rows were not resolved as applied settings.
- GREEN: `npm test -- tests/integration/admin-provider-config.test.ts -t "keeps zero-version applied provider settings active while edits are pending"` passed after applied-setting predicates included rows with `applied_value`.
- GREEN: `npm test -- tests/integration/admin-provider-config.test.ts` passed, 39 tests.
- GREEN: `npm test -- tests/unit/config.test.ts` passed, 26 tests.
- GREEN: `npm test -- tests/integration/admin-settings-service.test.ts` passed, 8 tests.
- GREEN: `npm test -- tests/contract/admin-mfa-routes.test.ts tests/contract/admin-auth-routes.test.ts` passed, 15 tests.
- GREEN: `npm run typecheck` passed.
- GREEN: `npm run build` passed.
- GREEN: targeted lint passed with `npx eslint src/config.ts src/index.ts src/services/admin-settings-service.ts src/services/embeddings/providers.ts src/services/llm-provider.ts src/transport/admin.ts src/services/admin-provider-config-service.ts src/transport/admin-provider-config.ts tests/unit/config.test.ts tests/integration/admin-provider-config.test.ts`.
- GREEN: `git diff --check` passed.
- REVIEW: `codex review --uncommitted` review thread `019f3708-a5ce-7053-97df-8703bcfbb90c` reported no actionable correctness, security, or maintainability issues.
- NOTE: Full repo lint with `npm run lint -- --max-warnings=0` still fails on existing unrelated files outside TASK-010 scope; targeted lint for all touched TASK-010 files passed.

## Review Feedback

### P1

- None.

### P2

- Fixed review finding: provider base URL save validation now rejects query strings, fragments, and credentials before persistence.
- Fixed review finding: applied provider settings backfilled with zero applied version remain active while pending edits exist.

### P3

- None.

## Completion Notes

- Added provider configuration service and focused admin routes for read, save, secret save, validate, and apply operations.
- Provider config mutations use admin sessions, CSRF for mutations, recent step-up for secret writes and apply operations, bearer rejection through the admin transport, and structured `audit_log.admin_user_id` attribution.
- Runtime settings and secrets use `admin_runtime_settings`, `admin_runtime_secrets`, and `ADMIN_SETTINGS_ENCRYPTION_KEY`; secret validation metadata remains `{}` on save and readback.
- DB-applied provider base URLs are treated as attacker-controlled input. The validation and runtime egress policy rejects unsafe schemes, query strings, fragments, credentials, private/link-local/metadata/reserved IPs, unsafe hostnames, and redirects, with local-provider exceptions scoped to local hosts.
- Apply semantics preserve env fallback until DB settings are explicitly applied, preserve last-applied values while pending edits exist, make restart-required and reembed-required states explicit, and block embedding identity changes that require reembedding.
