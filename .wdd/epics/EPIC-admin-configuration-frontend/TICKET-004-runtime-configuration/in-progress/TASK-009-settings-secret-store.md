---
id: TASK-009-settings-secret-store
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-004-runtime-configuration
wave: WAVE-004
slug: settings-secret-store
title: Settings And Secret Store
status: in_progress
depends_on:
  - TASK-003-runtime-config-feasibility
  - TASK-005-admin-session-routes
conflict_domains:
  - src/db/migrations/**
  - src/config.ts
  - src/services/**
  - tests/helpers/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-009-settings-secret-store
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-009-settings-secret-store
worktree_status: clean_pushed
pr: https://github.com/ivo-toby/postgram/pull/81
worker_thread_id: 019f3333-4104-7b02-b1aa-1fce6978e410
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: followup_reviewing
branch_freshness: stale_needs_freshness_refresh
verification:
  - npm test -- tests/integration/admin-settings-service.test.ts
  - npm run typecheck
---

# TASK-009-settings-secret-store: Settings And Secret Store

## Status

in_progress

## Parent Ticket

TICKET-004-runtime-configuration

## Wave

WAVE-004

## Objective

Add persistence and services for runtime settings and stored secrets according
to the Wave 1 feasibility decision.

## Scope

- Included:
  - Runtime settings tables.
  - Secret storage or secret metadata tables.
  - Service APIs for read, write, redacted read, validation metadata, and audit
    hooks.
  - Test helper updates and integration tests.
- Excluded:
  - Provider connection tests and apply/reload behavior.
  - UI.

## Non-Scope

- Do not expose stored secret values through read APIs.

## Relevant Context

### Local Context

- `src/config.ts`
- `src/db/migrations/*`
- `tests/helpers/postgres.ts`
- `tests/unit/config.test.ts`

### Shared Context References

- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/services/admin-settings-service.ts`
- `src/db/migrations/*admin_settings*.sql`
- `tests/integration/admin-settings-service.test.ts`
- `tests/helpers/postgres.ts`

## Dependencies

- TASK-003-runtime-config-feasibility
- TASK-005-admin-session-routes

## Conflict Domains

- `src/db/migrations/**`
- `src/config.ts`
- `src/services/**`
- `tests/helpers/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-009-settings-secret-store

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-009-settings-secret-store

Assigned by WAVE-004 activation. The controller must create and verify this
isolated worktree before dispatch.

Verified and dispatched at 2026-07-05T16:47:34Z with worker Euclid
(`019f3333-4104-7b02-b1aa-1fce6978e410`) on branch
`codex/task/TASK-009-settings-secret-store`.

## PR / Patch Reference

Draft PR #81: https://github.com/ivo-toby/postgram/pull/81

Review requested from Lorentz (`019f322c-02e7-7590-8b8e-ebdd1e9c52ac`) at
2026-07-05T17:32:34Z with submission
`019f3357-e7f4-7dd1-a1cf-afa9616d4a26`.

## RED-GREEN TDD Plan

### RED

Add tests for saving settings, redacted reads, secret write-only behavior,
validation errors, and audit metadata.

### GREEN

Implement migrations and settings service.

### REFACTOR

Keep generic setting storage separate from provider-specific validation.

## Implementation Notes

- Follow the selected secret key-management strategy from TASK-003.
- Update Docker/docs only if a new required runtime config value is introduced.
- This task should build persistence/service APIs, not a separate admin auth
  layer. Any HTTP exposure must use the WAVE-003 `/admin/api/*` session/CSRF
  boundary and, for secret writes or reads of sensitive metadata, the TASK-006
  active-MFA/step-up guard.
- Service read APIs may return safe metadata such as `configured`, validation
  state, timestamps, and provider identity, but must never return plaintext
  secrets, token hashes, ciphertext, or reusable prefixes.
- Tests should include a handoff assertion or service contract note that
  ordinary API-key bearer auth and MCP OAuth bearer auth are not accepted as
  admin authority for settings/secrets routes when those routes are added.

## Durable Memory Notes To Consider

- Record durable memory if the secret storage strategy becomes final.

## Task-Level Definition of Done

- [ ] Settings persistence exists.
- [ ] Secret readback is redacted.
- [ ] Tests cover validation and reset helpers.
- [ ] New config values are documented if added.

## Validation Steps

- `npm test -- tests/integration/admin-settings-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- Euclid reported:
  - `npm test -- tests/integration/admin-settings-service.test.ts` passed.
  - `npm run typecheck` passed.
  - `git diff --check` passed.
  - touched-file `eslint` passed.
  - `npm test -- tests/unit/config.test.ts` passed.
  - `npm test -- tests/integration/migration.test.ts` passed.
  - `npm test -- tests/integration/admin-auth-service.test.ts` passed.
  - `codex review --uncommitted` found no blocking issues after fixing the P1
    secret-bypass finding.

## Review Feedback

### P1

- None.

### P2

- `P2-secret-validation-metadata-redaction` fix pushed by Euclid at
  `e03421a7327555d8711a8c9fb68a8a8d10c1f39a`; controller verified and
  requested Lorentz follow-up review at 2026-07-05T17:59:04Z
  (`019f3371-9537-7962-925b-b69f1cea2fa6`). Originally routed at
  2026-07-05T17:48:34Z (`019f3366-7c9b-7b33-9d93-0009fa0ec291`): Lorentz
  found `saveRuntimeSecret` accepts arbitrary `validation.metadata` and
  redacted secret metadata reads return `mapValidation(row)` unchanged,
  allowing plaintext/token/auth/provider response metadata to leak. Fix by
  schema-limiting/sanitizing secret validation metadata or not returning
  arbitrary metadata, with a malicious metadata regression.
- `P2-branch-freshness-task-file-conflict` partially addressed by Euclid via
  task-branch refresh at `e03421a7327555d8711a8c9fb68a8a8d10c1f39a`; final
  freshness is still required before merge because the controller branch
  advanced again. Originally routed at
  2026-07-05T17:48:34Z (`019f3366-7c9b-7b33-9d93-0009fa0ec291`): PR #81 is
  not mergeable against the latest epic branch. Reviewer says conflicts are
  WDD task-file only and product code auto-merges; refresh against latest epic
  after code fix and before merge.

### P3

- None.

## Completion Notes

- WAVE-004 activation started at 2026-07-05T16:47:34Z as the
  settings/secret-store hybrid bundle. Branch/worktree creation is pending the
  pushed activation artifact commit.
- Controller verified the worktree and dispatched worker Euclid
  (`019f3333-4104-7b02-b1aa-1fce6978e410`). No PR or patch exists yet.
- 2026-07-05T17:12:04Z controller heartbeat observed active uncommitted work
  in `.env.example`, `README.md`, `docker-compose.yml`, `src/config.ts`,
  `src/db/migrations/011_admin_settings.sql`,
  `src/services/admin-settings-service.ts`, `tests/helpers/postgres.ts`,
  `tests/unit/config.test.ts`, and
  `tests/integration/admin-settings-service.test.ts`. No PR or patch exists
  yet; branch remains current with the epic branch at `f9bbc0f`.
- 2026-07-05T17:32:34Z controller heartbeat observed Euclid `DONE`, draft PR
  #81 open at `b96ca9d5b0ff3445aa8a8231451998f86ce23e5c`, and the worktree
  clean/pushed. GitHub reports `mergeStateStatus=DIRTY`; the branch is one
  epic controller commit behind (`rev-list origin/codex/epic/admin-configuration-frontend...HEAD`
  = `1 2`) and needs a branch-freshness refresh after review and before merge.
  The worker branch moved its task copy to `review/`; this epic-side task copy
  records the review gate while the PR is open. Lorentz review is in progress.
- After controller checkpoint `0eb4472` was pushed, GitHub reports PR #81
  `mergeStateStatus=UNKNOWN` and the task branch is behind the epic branch
  (`rev-list origin/codex/epic/admin-configuration-frontend...HEAD` = `2 2`).
  Refresh against the latest epic branch and rerun freshness verification
  before merge.
- 2026-07-05T17:48:34Z Lorentz returned `REVIEW_BLOCKED` for PR #81 with two
  P2 findings. Controller routed the fixes to Euclid in submission
  `019f3366-7c9b-7b33-9d93-0009fa0ec291`; gate is `needs_fixes`.
- 2026-07-05T17:59:04Z controller observed PR #81 pushed at
  `e03421a7327555d8711a8c9fb68a8a8d10c1f39a`. Controller verification passed:
  `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`,
  orchestration JSON parse, `npm test --
  tests/integration/admin-settings-service.test.ts` with 8 tests, and
  `npm run typecheck`. Follow-up review requested from Lorentz in
  `019f3371-9537-7962-925b-b69f1cea2fa6`; gate is `followup_reviewing`.
