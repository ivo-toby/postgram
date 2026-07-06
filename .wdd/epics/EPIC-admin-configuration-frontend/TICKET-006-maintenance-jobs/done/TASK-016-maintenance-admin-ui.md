---
id: TASK-016-maintenance-admin-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-006-maintenance-jobs
wave: WAVE-009
slug: maintenance-admin-ui
title: Maintenance Admin UI
status: done
depends_on:
  - TASK-011-admin-auth-ui
  - TASK-012-admin-ops-dashboard-ui
  - TASK-013-admin-config-ui
  - TASK-015-maintenance-admin-api
conflict_domains:
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-016-maintenance-admin-ui
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-016-maintenance-admin-ui
worktree_status: cleaned_up
pr: https://github.com/ivo-toby/postgram/pull/91
worker_thread_id: 019f3926-c2c5-7290-9c2f-9a4cca19e6ae
review_thread_id: 019f3954-7e17-7652-8673-c2304fd7c54a
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm --prefix ui run test -- --run src/components/AdminMaintenance.test.tsx
  - npm --prefix ui run test -- --run src/components/AdminOps.test.tsx src/components/AdminConfig.test.tsx src/components/AdminAuth.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-016-maintenance-admin-ui: Maintenance Admin UI

## Status

done

## Parent Ticket

TICKET-006-maintenance-jobs

## Wave

WAVE-009

## Objective

Add admin UI for approved maintenance dry-run, apply, confirmation, progress,
and result review flows.

## Scope

- Included:
  - Maintenance page for approved graph/memory/embedding/extraction operations.
  - Scope controls, dry-run preview, danger summary, step-up prompt, apply, job
    progress, and result/failure display.
  - Tests for confirmation and partial failure states.
- Excluded:
  - Unapproved commands and raw SQL.

## Non-Scope

- Do not make destructive actions one-click from the dashboard.

## Relevant Context

### Local Context

- `ui/src/components/admin/*`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminConfig.tsx`
- `src/transport/admin-maintenance.ts`
- `ui/src/components/CleanupBasketDrawer.tsx`
- `ui/src/components/tasks/BulkActionBar.tsx`

### Shared Context References

- `../../shared-context/resources/admin-surface-inventory.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `ui/src/components/admin/AdminMaintenance.tsx`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/lib/adminApi.ts`
- `ui/src/components/AdminMaintenance.test.tsx`

## Dependencies

- TASK-011-admin-auth-ui
- TASK-012-admin-ops-dashboard-ui
- TASK-013-admin-config-ui
- TASK-015-maintenance-admin-api

## Conflict Domains

- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-016-maintenance-admin-ui

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-016-maintenance-admin-ui

## PR / Patch Reference

Draft PR: https://github.com/ivo-toby/postgram/pull/91

Singer (`019f3926-c2c5-7290-9c2f-9a4cca19e6ae`) was dispatched at
2026-07-06T20:30:02Z on branch
`codex/task/TASK-016-maintenance-admin-ui`.

## RED-GREEN TDD Plan

### RED

Add UI tests for dry-run, confirmation disabled until preview, step-up prompt,
job progress, completion, and failure retention.

### GREEN

Implement maintenance UI components against admin API client.

### REFACTOR

Share confirmation/progress components with config UI if useful.

## Implementation Notes

- Keep dangerous actions visually distinct but not theatrical.
- Preserve dense operational layout for repeated use.
- Extend the WAVE-007 admin API client in `ui/src/lib/adminApi.ts`; do not add
  a parallel admin auth store or localStorage-backed admin credential path.
- Build into the WAVE-008 `AdminDashboard` shell. Add maintenance navigation or
  panels without dropping health, queue, stats, config/models/jobs, API keys,
  audit, or the `AdminConfig` Config tab.
- Preserve the WAVE-008 shared admin client contract: same-origin cookie
  requests, in-memory CSRF, no admin bearer header, and no localStorage
  persistence for admin, API-key, TOTP, bootstrap, provider secret, or job
  secret-derived material.
- Use the WAVE-007 maintenance API routes:
  `/admin/api/maintenance/reextract/dry-run`,
  `/admin/api/maintenance/reextract/apply`,
  `/admin/api/maintenance/reembed/dry-run`,
  `/admin/api/maintenance/reembed/apply`,
  `/admin/api/maintenance/prune-edges/dry-run`, and
  `/admin/api/maintenance/prune-edges/apply`.
- Dry-run responses return `202` job objects. Apply requests must reference a
  fresh matching `previewJobId`, include a scoped idempotency key, and require
  the existing step-up flow.
- Poll `/admin/api/jobs/:jobId` for progress and terminal state. Do not assume
  maintenance operations complete synchronously in the apply response.
- Render only safe job summaries. Do not surface provider bodies, auth headers,
  token prefixes, ciphertext, arbitrary validation metadata, or hidden secret
  material from job payloads/results.
- Web edge-prune UI must keep the reviewed `llm-extraction` source constraint;
  do not expose CLI's broader `any` source selector.
- If edits touch `AdminDashboard` or `ui/src/lib/adminApi.ts`, include
  AdminOps/AdminConfig/AdminAuth regression checks in freshness evidence so the
  WAVE-008 dashboard/config panels stay intact.

## Durable Memory Notes To Consider

- Record durable memory if maintenance UI establishes stable guardrail patterns.

## Task-Level Definition of Done

- [x] Maintenance UI covers approved operations.
- [x] Dry-run before apply is enforced in UI.
- [x] Step-up and job progress states are handled.
- [x] UI typecheck passes.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/AdminMaintenance.test.tsx`
- `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx src/components/AdminConfig.test.tsx src/components/AdminAuth.test.tsx`
- `npm --prefix ui run typecheck`

## Verification Evidence

- Controller dispatch verification: TASK-016 worktree and branch were clean,
  pushed, and current with `origin/codex/epic/admin-configuration-frontend`
  before worker dispatch; branch divergence was `0 0`.
- 2026-07-06T20:56:02Z controller heartbeat: no PR exists yet; Singer is
  still running, the worktree has active uncommitted changes in expected
  TASK-016 UI/client files, branch divergence remains `0 0`, and
  `git diff --check` passed.
- 2026-07-06T21:11:02Z controller heartbeat: no PR exists yet; Singer is
  still running, the worktree remains active in expected TASK-016 UI/client
  files, branch divergence remains `0 0`, `git diff --check` passed, and
  `AdminMaintenance.tsx` plus `AdminMaintenance.test.tsx` changed during this
  heartbeat window.
- 2026-07-06T21:13Z worker verification passed:
  `npm --prefix ui run test -- --run src/components/AdminMaintenance.test.tsx`
  (9 tests), `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx src/components/AdminConfig.test.tsx src/components/AdminAuth.test.tsx`
  (49 tests), `npm --prefix ui run typecheck`, and `git diff --check`.
- 2026-07-06T21:18Z final local Codex review pass reported no P0/P1/P2
  findings. During review, the full UI suite also passed: `npm test` from
  `ui` (125 tests).
- 2026-07-06T21:19:39Z draft PR opened:
  https://github.com/ivo-toby/postgram/pull/91
- 2026-07-06T21:35:02Z Hypatia review returned `REVIEW_PASS` with no P1/P2/P3.
  Review verification passed: merge-tree, branch diff whitespace,
  AdminMaintenance tests 9/9, AdminOps/AdminConfig/AdminAuth regressions 49/49,
  and UI typecheck.
- 2026-07-06T21:35:02Z controller refreshed the task branch against latest
  `origin/codex/epic/admin-configuration-frontend`; final divergence was
  `0 3`, merge-tree and diff whitespace passed, AdminMaintenance tests 9/9,
  AdminOps/AdminConfig/AdminAuth regressions 49/49, and UI typecheck passed.
- TASK-016 merged into the epic branch in `10b27384545cb450e6d3c5c10460af1bc22c5667`.
  PR #91 was marked `MERGED` by GitHub at 2026-07-06T21:37:31Z, and the clean
  pushed worktree was removed.

## Review Feedback

### P1

- None.

### P2

- Resolved: reused/idempotent apply responses that return only a terminal job
  reference now fetch full job detail before rendering result evidence.
- Resolved: request-shaping controls are locked while preview/apply jobs are
  non-terminal so in-flight polling and idempotency context are preserved.
- Resolved: preview and apply polling retry after transient job-status fetch
  failures and clear stale polling errors after successful refresh.

### P3

- None.

## Completion Notes

- Added `AdminMaintenance` for approved reextract, reembed, and constrained
  `llm-extraction` edge-prune maintenance flows inside the WAVE-008 dashboard.
- Extended the shared admin API client with maintenance dry-run/apply and job
  detail methods using the existing same-origin cookie and in-memory CSRF
  request path.
- Added focused UI coverage for preview-before-apply, step-up/apply evidence,
  job progress and completion, failure retention, safe result rendering,
  same-origin route usage, dashboard preservation, in-flight edit locking, and
  polling recovery.
