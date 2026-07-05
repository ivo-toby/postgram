---
id: TASK-010-provider-config-apply
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-004-runtime-configuration
wave: WAVE-005
slug: provider-config-apply
title: Provider Config Apply
status: todo
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
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/integration/admin-provider-config.test.ts
  - npm test -- tests/unit/config.test.ts
  - npm run typecheck
---

# TASK-010-provider-config-apply: Provider Config Apply

## Status

todo

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
- `src/services/embeddings/providers.ts`
- `src/services/embeddings/admin.ts`
- `src/services/llm-provider.ts`
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

None assigned yet.

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

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.
