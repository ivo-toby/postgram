---
id: TASK-013-admin-config-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-005-admin-frontend
wave: WAVE-008
slug: admin-config-ui
title: Admin Config UI
status: review
depends_on:
  - TASK-010-provider-config-apply
  - TASK-011-admin-auth-ui
conflict_domains:
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-013-admin-config-ui
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-013-admin-config-ui
worktree_status: pushed_for_review
pr: https://github.com/ivo-toby/postgram/pull/90
worker_thread_id: 019f387a-3f1d-74a0-9949-5a318a43e494
review_thread_id: 019f38ab-a97f-7462-84dc-5537e1efe934
current_gate: review
branch_freshness: refreshed_against_epic_pending_final_verification
verification:
  - git rev-list --left-right --count origin/codex/epic/admin-configuration-frontend...HEAD
  - git merge-tree --write-tree origin/codex/epic/admin-configuration-frontend HEAD
  - git diff --check origin/codex/epic/admin-configuration-frontend...HEAD
  - npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx
  - npm --prefix ui run test -- --run src/components/AdminOps.test.tsx
  - npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx
  - npm --prefix ui run typecheck
  - npm run typecheck
  - npm test -- tests/integration/admin-provider-config.test.ts
  - npm --prefix ui test -- --run
  - npm --prefix ui run build
  - git diff --check
---

# TASK-013-admin-config-ui: Admin Config UI

## Status

review

## Parent Ticket

TICKET-005-admin-frontend

## Wave

WAVE-008

## Objective

Add runtime provider/model configuration UI with redacted secrets, validation,
connection testing, and apply warnings.

## Scope

- Included:
  - Embedding and extraction configuration forms.
  - Secret write/update controls with redacted display.
  - Test connection / validate controls.
  - Apply/reload/restart-required messaging.
  - Tests for redaction, validation errors, and step-up.
- Excluded:
  - Maintenance job UI.

## Non-Scope

- Do not make embedding dimension changes look like a harmless text edit.

## Relevant Context

### Local Context

- `ui/src/lib/adminApi.ts`
- `ui/src/components/admin/*`
- `ui/src/components/StatusWidget.tsx`

### Shared Context References

- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `ui/src/components/admin/AdminConfig.tsx`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/AdminConfig.test.tsx`

## Dependencies

- TASK-010-provider-config-apply
- TASK-011-admin-auth-ui

## Conflict Domains

- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-013-admin-config-ui

## Worker Worktree

`/Users/ivo.toby/workspace/postgram/.worktrees/TASK-013-admin-config-ui`
assigned for WAVE-008 activation; created from pushed epic activation head
`7e5c49c` and pushed to origin.

Worker Parfit (`019f387a-3f1d-74a0-9949-5a318a43e494`) dispatched at
2026-07-06T17:29:45Z. Draft PR opened for review.

Controller observed active uncommitted implementation work at
2026-07-06T17:47:01Z with no PR yet. The task branch is behind the epic branch
by one controller monitoring checkpoint and will need freshness verification
before merge.

Controller observed continued active uncommitted implementation work at
2026-07-06T18:02:01Z with no PR yet. The task branch is behind the epic branch
by two controller monitoring checkpoints and will need freshness verification
before merge.

Controller observed continued active uncommitted implementation work at
2026-07-06T18:17:01Z with no PR yet. The task branch is behind the epic branch
by three controller monitoring checkpoints and will need freshness verification
before merge.

Controller observed continued active implementation work at
2026-07-06T18:28:44Z with no PR or patch yet. The task branch is behind the
epic branch by four controller monitoring checkpoints. A non-blocking
coordination note from TASK-012 review was routed to Parfit in submission
`019f38b0-6b70-7d33-9982-3c0a54b43f3f`: TASK-013 should integrate with the
TASK-012 `AdminDashboard` shell wiring and avoid reviving the older placeholder
`AdminShell` shape when reconciling overlapping AdminAuth/adminApi changes.

Controller observed continued active implementation work at
2026-07-06T19:15:01Z with no PR or patch yet. The TASK-013 worktree has
uncommitted config UI/API changes, `git diff --check` passes, and
`AdminConfig.tsx` plus `AdminConfig.test.tsx` had fresh edits around
2026-07-06T19:13Z. No nudge was sent because the worktree is active. The task
branch is behind the epic branch by 14 controller/TASK-012 merge and closeout
checkpoints and will need freshness verification before review/merge.

Controller observed continued active implementation work at
2026-07-06T19:30:01Z with no PR or patch yet. Parfit did not return a final
status during the bounded wait, but the worktree has fresh `AdminConfig.tsx`
and `AdminConfig.test.tsx` edits from this heartbeat window and `git diff
--check` passes. No nudge was sent. The task branch is behind the epic branch
by 15 controller/TASK-012 merge, closeout, and monitor checkpoints at
observation time and will need freshness verification before review/merge.

Parfit returned `DONE_WITH_CONCERNS` at 2026-07-06T19:45:01Z with draft PR #90
at head `fe1a454f545f815c35978e3c600fd101eae2893f` after feature commit
`d229df88131089c36b92d451c6adef4325d21e3a`. Worker evidence reports targeted
AdminConfig/UI/backend/provider-config verification passed, full UI test run
passed, UI build passed with the existing Vite chunk-size warning, scoped
lint/prettier/diff-check passed, and `codex review --uncommitted` passed after
worker P1/P2 fixes. Controller verified PR #90 is open/draft and `DIRTY`;
branch divergence is `16 2`; branch diff whitespace passes; merge-tree
conflicts in this review task file, `ui/src/components/AdminAuth.test.tsx`,
`ui/src/components/admin/AdminAuth.tsx`, `ui/src/components/admin/AdminDashboard.tsx`,
and `ui/src/lib/adminApi.ts`. Schrodinger review was requested in submission
`019f38f7-8d65-74e3-8a30-5e4edc7c1b32`; no review result returned during the
bounded wait.

## PR / Patch Reference

Draft PR #90: https://github.com/ivo-toby/postgram/pull/90

## RED-GREEN TDD Plan

### RED

Add UI tests for config load, redacted secret state, validation failure,
connection-test result, apply warning, and sensitive change confirmation.

### GREEN

Implement config form components and admin API client calls.

### REFACTOR

Share form validation and danger confirmation components with later
maintenance UI if useful.

## Implementation Notes

- Extend the WAVE-007 admin API client in `ui/src/lib/adminApi.ts`; do not add
  a parallel admin auth store or localStorage-backed admin credential path.
- Keep secret inputs intentionally blank unless the operator is replacing a
  value.
- Present restart/reembed/maintenance implications before apply.
- Treat redacted secret metadata from WAVE-004 as the only readable secret
  state: configured/provider/purpose/status/timestamps are okay, but plaintext,
  ciphertext, token prefixes, auth headers, and arbitrary validation metadata
  must never be displayed.
- Secret write/update and provider apply controls must require the WAVE-004
  step-up flow; use the admin API client to refresh step-up rather than adding
  another credential prompt.
- Tests should prove provider secret inputs are write-only, remain blank on
  load, and are not stored in localStorage or other browser persistence.
- Use the WAVE-005 provider-config API contract:
  `GET /admin/api/provider-config`, `PUT /admin/api/provider-config`,
  `PUT /admin/api/provider-config/secrets`,
  `POST /admin/api/provider-config/validate`, and
  `POST /admin/api/provider-config/apply`.
- Render pending versus applied provider state from the API. Pending edits must
  not look active until validation/apply succeeds.
- Surface `restartRequired` and `reembedRequired` states from the API. Do not
  present embedding identity or dimension changes as a normal apply path when
  the API says reembedding is required.
- Use the WAVE-007 step-up flow for secret write/update and provider apply.
  Step-up state should be treated as recent-auth state, not as a new admin
  password prompt.

## Durable Memory Notes To Consider

- Record durable memory if final configuration UX creates stable conventions.

## Task-Level Definition of Done

- [x] Configuration UI is implemented and covered.
- [x] Secret values are never displayed.
- [x] Dangerous provider/dimension changes are clearly warned.
- [x] UI typecheck passes.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx`
- `npm --prefix ui run typecheck`

## Verification Evidence

- Worker PASS `npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx`
  (22 tests).
- Worker PASS `npm --prefix ui run typecheck`.
- Worker PASS `npm run typecheck`.
- Worker PASS `npm test -- tests/integration/admin-provider-config.test.ts`
  (39 tests).
- Worker PASS `npm --prefix ui test -- --run` (105 tests).
- Worker PASS `npm --prefix ui run build` with the existing Vite chunk-size
  warning.
- Worker PASS scoped eslint for `tests/integration/admin-provider-config.test.ts`.
- Worker PASS scoped prettier check plus `git diff --check`.
- Worker PASS `codex review --uncommitted` after worker P1/P2 fixes.
- Controller PASS `git diff --check origin/codex/epic/admin-configuration-frontend...HEAD`.
- Follow-up IN PROGRESS: TASK-013 branch was refreshed against latest
  `origin/codex/epic/admin-configuration-frontend`; product integration
  conflicts were resolved by preserving the TASK-012 operations dashboard as
  the default Overview and adding TASK-013 provider configuration as the Config
  tab.
- Follow-up local PASS after conflict resolution:
  `npm --prefix ui run test -- --run src/components/AdminConfig.test.tsx`
  (22 tests).
- Follow-up local PASS after conflict resolution:
  `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx`
  (11 tests).
- Follow-up local PASS after conflict resolution:
  `npm --prefix ui run test -- --run src/components/AdminAuth.test.tsx`
  (16 tests).
- Follow-up local PASS after conflict resolution:
  `npm --prefix ui run typecheck`.
- Follow-up local PASS after conflict resolution: `npm run typecheck`.

## Review Feedback

### P1

- None.

### Review Result

- Schrodinger returned `REVIEW_BLOCKED` for submission
  `019f38f7-8d65-74e3-8a30-5e4edc7c1b32` with one P2 freshness/product
  integration blocker and no additional product/security P1/P2 findings.

### P2

- Fixed in follow-up: refresh TASK-013 against the latest epic branch, resolve
  PR #90 `DIRTY` conflicts, and integrate `AdminConfig` into the TASK-012
  `AdminDashboard` shell without dropping health, queue, stats, config status,
  models, jobs, API keys, or audit panels.

### P3

- None.

## Completion Notes

- PR #90 follow-up refresh preserves the current epic branch's `AdminAuth`,
  admin API client, and operations dashboard wiring. TASK-013 provider config
  is available under the dashboard Config tab while the TASK-012 operations
  overview remains the default panel.
