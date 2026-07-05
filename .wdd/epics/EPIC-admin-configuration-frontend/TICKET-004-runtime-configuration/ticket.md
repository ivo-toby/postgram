---
id: TICKET-004-runtime-configuration
kind: ticket
epic: EPIC-admin-configuration-frontend
slug: runtime-configuration
title: Runtime Configuration And Secrets
status: planned
task_count: 2
depends_on:
  - TASK-003-runtime-config-feasibility
  - TASK-005-admin-session-routes
conflict_domains:
  - src/config.ts
  - src/index.ts
  - src/services/**
  - src/db/migrations/**
  - docker-compose.yml
  - README.md
adapter_links:
  github_issue: null
---

# Runtime Configuration And Secrets

## Summary

Move approved provider and runtime settings into a safe DB-backed configuration
model with secret handling and apply/reload semantics.

## Objective

Make the supported first configuration scope manageable through the admin plane
without manual env-file edits.

## Scope

- Included: runtime settings persistence, secret handling, validation,
  provider connection tests, apply strategy, docs.
- Excluded: full enterprise secret management and external vault integrations.

## Non-Scope

- Do not silently change embedding dimensions or discard chunks.

## Shared Context References

- `../shared-context/resources/migration-config-notes.md`
- `../shared-context/resources/security-model.md`
- `../shared-context/resources/testing-validation.md`

## Task Inventory

| Task | Status | Wave | Summary |
|------|--------|------|---------|
| TASK-009-settings-secret-store | todo | WAVE-004 | Add runtime settings and secret storage foundation |
| TASK-010-provider-config-apply | todo | WAVE-005 | Add provider validation and apply/reload flow |

## Dependencies

- Depends on: TASK-003-runtime-config-feasibility, TASK-005-admin-session-routes.
- Blocks: configuration UI and Docker no-CLI validation.

## Conflict Domains

- `src/config.ts`
- `src/index.ts`
- `src/db/migrations/**`
- `src/services/embeddings/**`
- `src/services/llm-provider.ts`
- `docker-compose.yml`
- `README.md`

## Validation Expectations

- Tests cover redaction, provider validation, persistence, and safe apply
  behavior.

## Review Focus

- Secret leakage, encryption/key management, startup/runtime lifecycle,
  embedding dimension safety, Docker docs.

## Completion Criteria

- [ ] All child tasks have resolved review and verification gates.
- [ ] Shared context updates were reconciled.
- [ ] Ticket status matches child task state.
