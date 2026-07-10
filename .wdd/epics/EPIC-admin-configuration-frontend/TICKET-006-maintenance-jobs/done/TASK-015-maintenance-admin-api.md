---
id: TASK-015-maintenance-admin-api
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-006-maintenance-jobs
wave: WAVE-007
slug: maintenance-admin-api
title: Maintenance Admin API
status: done
depends_on:
  - TASK-008-admin-key-audit-stats-api
  - TASK-010-provider-config-apply
  - TASK-014-admin-job-foundation
conflict_domains:
  - src/cli/admin/pgm-admin.ts
  - src/services/**
  - src/transport/**
  - tests/contract/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-015-maintenance-admin-api
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-015-maintenance-admin-api
worktree_status: cleaned_up
pr: https://github.com/ivo-toby/postgram/pull/88
worker_thread_id: 019f37c5-7084-7920-916a-7fd9ac7d8cb6
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm test -- tests/contract/admin-maintenance-api.test.ts
  - npm test -- tests/integration/cli-admin.test.ts
  - npm run typecheck
---

# TASK-015-maintenance-admin-api: Maintenance Admin API

## Status

done

## Parent Ticket

TICKET-006-maintenance-jobs

## Wave

WAVE-007

## Objective

Expose the approved first maintenance operations through typed admin APIs using
shared services, dry-run previews, step-up auth, jobs, and audit.

## Scope

- Included:
  - First-scope maintenance operations selected by TASK-001.
  - Service extraction from `pgm-admin` where needed.
  - Dry-run and apply endpoints.
  - Job-backed progress where operations are long-running.
  - Regression coverage for CLI behavior where services are shared.
- Excluded:
  - Raw SQL.
  - Generic purge unless TASK-001 explicitly approves a constrained variant.

## Non-Scope

- Do not shell out to `pgm-admin` from the web server.

## Relevant Context

### Local Context

- `src/cli/admin/pgm-admin.ts`
- `src/services/memory-grooming-service.ts`
- `src/services/edge-service.ts`
- `src/services/edge-validation-service.ts`
- `src/services/embeddings/admin.ts`
- `tests/integration/cli-admin.test.ts`

### Shared Context References

- `../../shared-context/resources/admin-surface-inventory.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/services/admin-maintenance-service.ts`
- `src/transport/admin.ts`
- `src/cli/admin/pgm-admin.ts`
- `tests/contract/admin-maintenance-api.test.ts`
- `tests/integration/cli-admin.test.ts`

## Dependencies

- TASK-008-admin-key-audit-stats-api
- TASK-010-provider-config-apply
- TASK-014-admin-job-foundation

## Conflict Domains

- `src/cli/admin/pgm-admin.ts`
- `src/services/**`
- `src/transport/**`
- `tests/contract/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-015-maintenance-admin-api

## Worker Worktree

Cleaned up after PR #88 was confirmed merged.

## PR / Patch Reference

https://github.com/ivo-toby/postgram/pull/88

Implementation head before WDD handoff commits: `faab7e0`
(`feat(admin): add maintenance job APIs`).

## RED-GREEN TDD Plan

### RED

Add tests for one or more approved dry-run/apply maintenance operations,
step-up requirement, job creation/progress, audit, and CLI regression.

### GREEN

Extract service logic and wire admin endpoints to it.

### REFACTOR

Keep command-specific logic typed and bounded rather than generic.

## Implementation Notes

- Keep operation scopes explicit: all/type/id/failed/limit as applicable.
- Surface cost or destructive implications in response metadata for the UI.
- Compose WAVE-003 session/CSRF middleware with the WAVE-004 active-MFA gate.
  Apply/destructive operations require recent step-up.
- Write mutation audit rows with structured `audit_log.admin_user_id`.
- If an operation reads provider/runtime config state, use the WAVE-004
  settings service redacted metadata only; do not expose or persist provider
  secrets, ciphertext, token prefixes, or arbitrary validation metadata in
  maintenance responses or job results.
- If an operation needs provider/runtime configuration, read WAVE-005 applied
  provider state rather than pending edits. Maintenance dry-run and apply
  responses must make restart-required or reembed-required implications clear
  without copying provider secrets or unsafe validation metadata into jobs.

## Durable Memory Notes To Consider

- Record durable memory if a command is permanently excluded or if service
  extraction changes operator conventions.

## Task-Level Definition of Done

- [x] Approved maintenance endpoints are covered.
- [x] Dry-run/apply and step-up are enforced.
- [x] CLI regressions pass where services are shared.
- [x] No raw SQL or shell execution is exposed.

## Validation Steps

- `npm test -- tests/contract/admin-maintenance-api.test.ts`
- `npm test -- tests/integration/cli-admin.test.ts`
- `npm run typecheck`

## Verification Evidence

- 2026-07-06T14:11:59Z: Branch/worktree setup verified at activation base
  `848b902`; worker Helmholtz
  (`019f37c5-7084-7920-916a-7fd9ac7d8cb6`) dispatched. Task implementation
  verification has not run yet.
- 2026-07-06T14:29:25Z: Helmholtz was still running with no PR or patch. The
  worktree has active uncommitted changes in expected backend maintenance API
  files: `src/cli/admin/pgm-admin.ts`, `src/transport/admin.ts`,
  `src/services/admin-maintenance-service.ts`,
  `src/transport/admin-maintenance.ts`, and
  `tests/contract/admin-maintenance-api.test.ts`. Tracked `git diff --check`
  passed; the branch is one controller checkpoint behind the epic branch and
  must refresh before review or merge.
- 2026-07-06T14:44:25Z: Helmholtz was still running with no PR or patch. The
  worktree has active uncommitted changes in the same expected backend
  maintenance API areas, with recent service, transport, and contract-test
  activity. Tracked `git diff --check` passed; the branch is two controller
  checkpoints behind the epic branch and must refresh before review or merge.
- 2026-07-06T14:59:25Z: Helmholtz was still running with no PR or patch. The
  worktree remains active/uncommitted with expected maintenance service,
  transport, CLI, and contract/integration test changes, including
  `tests/integration/cli-admin.test.ts`. Tracked `git diff --check` passed;
  the branch is three controller checkpoints behind the epic branch and must
  refresh before review or merge.
- 2026-07-06T15:14:25Z: Helmholtz was still running with no PR or patch. The
  worktree remains active/uncommitted with expected maintenance service,
  transport, CLI, and contract/integration test changes, with recent edits to
  `src/transport/admin-maintenance.ts` and
  `tests/contract/admin-maintenance-api.test.ts`. Tracked `git diff --check`
  passed; the branch is four controller checkpoints behind the epic branch and
  must refresh before review or merge.
- 2026-07-06T15:29:25Z: Helmholtz was still running with no PR or patch. The
  worktree remains active/uncommitted with expected maintenance service,
  transport, CLI, admin-job-service, and contract/integration test changes,
  with recent edits to `src/services/admin-job-service.ts`,
  `src/transport/admin-maintenance.ts`, and
  `tests/contract/admin-maintenance-api.test.ts`. Tracked `git diff --check`
  passed; the branch is five controller checkpoints behind the epic branch and
  must refresh before review or merge.
- 2026-07-06T15:38:25Z: Helmholtz was still running with no PR or patch after
  direct worker polling timed out without final status. The worktree remains
  active/uncommitted in expected maintenance API files:
  `src/services/admin-maintenance-service.ts`,
  `src/transport/admin-maintenance.ts`,
  `tests/contract/admin-maintenance-api.test.ts`,
  `src/cli/admin/pgm-admin.ts`, `src/services/admin-job-service.ts`,
  `src/transport/admin.ts`, and `tests/integration/cli-admin.test.ts`.
  Tracked `git diff --check` passed; branch divergence was `6 0` before the
  TASK-011 closeout push. No nudge sent because the worktree still shows
  active task-owned work.
- 2026-07-06T16:08:16Z: Helmholtz was still running with no PR or patch after
  direct worker polling timed out without final status. The worktree remains
  active/uncommitted in expected maintenance API files, with recent heartbeat
  window edits to `src/transport/admin-maintenance.ts` and
  `tests/contract/admin-maintenance-api.test.ts`. Tracked `git diff --check`
  passed, no staged files were present, and branch divergence was `11 0`
  against `origin/codex/epic/admin-configuration-frontend` after TASK-011
  closeout. No nudge sent because the worktree still shows active task-owned
  work; refresh branch freshness before review or merge.
- 2026-07-06T16:31:25Z: Required review loop completed clean after fixing
  all P0/P1/P2 findings. Final `codex review --uncommitted` reported no
  actionable correctness issues; review-run targeted contract/integration
  tests, focused lint, and diff whitespace checks passed.
- 2026-07-06T16:32:01Z: Worktree is clean at local commit
  `faab7e0a71bba506f19e6b59911ac7df1f7742f1`
  (`feat(admin): add maintenance job APIs`) and was current with
  `origin/codex/epic/admin-configuration-frontend` at inspection
  (`rev-list` = `0 1`). `git diff --check
  origin/codex/epic/admin-configuration-frontend...HEAD` passed and
  merge-tree was clean. No PR or patch exists, the task branch remote remains
  at activation commit `848b902`, and this task file is still in
  `in-progress/`. Controller nudged Helmholtz in submission
  `019f3847-8b09-7863-b57d-b14ba6490702` to move the task file to `review/`
  if complete, push the task branch, open a draft PR or provide a patch, and
  return a final status token with verification evidence.
- 2026-07-06T16:33:50Z: Branch rebased onto
  `origin/codex/epic/admin-configuration-frontend` at `b9d5f34`; implementation
  commit is `faab7e0`. Fresh post-rebase verification passed:
  `npm test -- tests/contract/admin-maintenance-api.test.ts` (4/4 tests),
  `npm test -- tests/integration/cli-admin.test.ts` (37/37 tests),
  `npm run typecheck`, focused `npx eslint` on touched files, and
  `git diff --check HEAD~1..HEAD`.
- 2026-07-06T16:36:00Z: Helmholtz returned `DONE` and opened draft PR #88 at
  head `4a3e99dce019370137d9461f62201bc7a05fb7fd`. Worker-reported
  verification passed: `admin-maintenance-api` contract tests (4/4),
  `cli-admin` integration tests (37/37), `npm run typecheck`, focused ESLint,
  `git diff --check`, and final `codex review --uncommitted`. Controller
  observed PR #88 is open/draft/`DIRTY` with branch divergence `1 3` and a
  merge-tree conflict in the WDD TASK-015 review file; branch freshness must be
  fixed before merge. Lorentz review was requested in submission
  `019f384a-790e-7d12-8bee-29d351519b3b`.
- 2026-07-06T16:45:31Z: Lorentz returned `REVIEW_BLOCKED` with one P2 branch
  freshness blocker: PR #88 remains `DIRTY` and merge-tree conflicts in the WDD
  TASK-015 review file. Lorentz reported no product-code conflict and no
  additional P1/P2 implementation findings. Controller routed exact refresh
  feedback to Helmholtz in submission
  `019f3852-f2bc-7651-a502-e31ae60ac612`: refresh against the latest epic
  branch, preserve TASK-015 review/PR metadata, rerun freshness and targeted
  tests, and push the updated task branch.
- 2026-07-06T16:48:00Z: Controller observed Helmholtz actively resolving the
  freshness conflict. The worker worktree is detached at `c91fb82`, with the old
  `in-progress/` task file staged for deletion and the `review/` TASK-015 file
  in conflict. PR #88 remains open/draft/`DIRTY` at head `4a3e99d`; no final
  fix status has returned yet.
- 2026-07-06T16:54:23Z: Helmholtz returned `DONE` for the freshness fix and
  pushed PR #88 to head `86c4966`. Controller verification passed: PR #88 was
  open/draft/`CLEAN`, branch divergence was `0 3`, `git diff --check` passed,
  merge-tree passed with tree `a96b5a5`, `admin-maintenance-api` contract tests
  passed 4/4, `cli-admin` integration tests passed 37/37, and `npm run
  typecheck` passed. Lorentz follow-up review was requested.
- 2026-07-06T16:58:48Z: Lorentz follow-up review returned `REVIEW_PASS` at head
  `86c4966` with no P1/P2/P3 findings. The previous WDD task-file freshness
  blocker was resolved.
- 2026-07-06T17:02:56Z: Controller pushed review-pass checkpoint `b97cc61`,
  refreshed TASK-015 to task head `ea88af4`, and reran final freshness
  verification. Branch divergence was `0 4`, branch diff whitespace passed,
  merge-tree passed, `admin-maintenance-api` contract tests passed 4/4,
  `cli-admin` integration tests passed 37/37, `npm run typecheck` passed,
  scoped ESLint passed, and post-merge verification passed. TASK-015 merged
  into the epic branch in `78f0f43`; GitHub marked PR #88 `MERGED` at
  2026-07-06T17:02:28Z. The clean pushed worktree was removed and pruned.

## Review Feedback

### P1

- Earlier review: maintenance execution was synchronous in the request path.
  Fixed by creating/running admin jobs asynchronously and returning `202`
  job responses.
- Earlier review: CLI `--type <type> --only-failed` behavior regressed during
  service extraction. Fixed by preserving `onlyFailed` as an additional
  predicate and adding CLI regression coverage.

### P2

- `P2-task015-branch-freshness-wdd-task-file-conflict`: PR #88 was dirty and
  merge-tree conflicted in the WDD TASK-015 review file. Addressed by rebasing
  the task branch onto `origin/codex/epic/admin-configuration-frontend` at
  `97f9d53` and preserving TASK-015 review/PR metadata.
- Earlier review: `--no-edges-only` used an unqualified `id` in the edge
  subquery. Fixed by qualifying `entities.id`.
- Earlier review: apply endpoints lacked server-side dry-run proof. Fixed with
  required fresh matching `previewJobId` evidence.
- Earlier review: preview freshness and consumption needed stricter controls.
  Fixed with `finishedAt`-based freshness, idempotent retry preservation, and
  atomic preview consumption through the admin job service.
- Earlier review: cancellation handling needed to avoid destructive work after
  queued cancellation while preserving committed mutation results after
  execution starts. Fixed with pre-execution cancellation, after-execution
  success summaries, and regression coverage.
- Earlier review: web edge pruning exposed CLI's broad `source: "any"` selector.
  Fixed by restricting browser admin prune requests to the approved
  `llm-extraction` source.

### P3

- None.

## Completion Notes

- Added typed admin maintenance service functions for re-extract, re-embed, and
  constrained edge-prune previews/apply operations.
- Added `/admin/api/maintenance/*/{dry-run,apply}` routes using admin
  session/CSRF, active MFA, recent step-up for apply, dry-run preview evidence,
  idempotency, admin jobs, progress, cancellation/status behavior, and safe
  result summaries.
- Added structured mutation audit rows with `audit_log.admin_user_id` for web
  admin mutations; CLI continues to share the same service boundary without
  pretending to have a browser admin actor.
- Refactored `pgm-admin` reembed/reextract/prune-edges to use the shared
  service; preserved combined `--type` + `--only-failed` behavior and added
  dry-run/id support where needed.
- No raw SQL, CLI passthrough, generic purge, provider secrets, ciphertext,
  token prefixes, provider response bodies, or arbitrary validation metadata are
  exposed through maintenance responses or job results.
