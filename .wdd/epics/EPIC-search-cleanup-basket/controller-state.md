---
id: EPIC-search-cleanup-basket-CONTROLLER
kind: controller_state
epic: EPIC-search-cleanup-basket
active_wave: WAVE-001
status: in_progress
updated_at: 2026-06-14
---

# Controller State: EPIC-search-cleanup-basket

## Controller Rule

The controller manages waves, workers, reviewers, PRs or patches, feedback,
verification evidence, stale-branch checks, merges or merge-ready decisions,
shared-context reconciliation, and wave reconciliation. The controller does not
implement task code. Before any worker starts, the controller creates or
verifies the epic branch and syncs activation artifact changes to it. Before
dispatching repository-writing workers, the controller creates or verifies one
isolated worktree per task from that synced epic state and tells each worker its
assigned path. Workers must not switch branches in the controller checkout.

## Active Wave

Wave: WAVE-001.

Activation: parallel dispatch of every eligible WAVE-001 task after activation
artifacts are committed to the epic branch and task worktrees are created from
that state.

## Active Wave Strategy

Profile: standard

Review mode: risk_based

Monitoring mode: adaptive

Execution mode: parallel

Confidence: medium

Strategy confirmation: confirmed by user override on 2026-06-14 with
`override WAVE-001 standard parallel`

## Pending Waves

| Wave | Tasks | Strategy | Confirmation | Status |
|------|-------|----------|--------------|--------|
| WAVE-001 | TASK-001-bulk-archive-service, TASK-003-ui-bulk-archive-api-client, TASK-004-cleanup-basket-state | standard / parallel / risk_based / adaptive | confirmed override | in_progress |
| WAVE-002 | TASK-002-rest-bulk-archive-endpoint, TASK-005-search-result-selection | full / parallel / risk_based / adaptive | required, not confirmed | planned |
| WAVE-003 | TASK-006-cleanup-basket-review-drawer | standard / bundled / risk_based / adaptive | not required | planned |
| WAVE-004 | TASK-007-search-cleanup-flow-integration | standard / bundled / risk_based / adaptive | not required | planned |

## Monitoring

Mode: manual

Cadence: adaptive

Status: inactive until worker dispatch

Last check: None

Next check due: None

Scheduler reference: None

Fallback prompt:

```text
Run subagent-pr-orchestration for EPIC-search-cleanup-basket WAVE-001. Read orchestration.json and controller-state.md, verify the epic branch codex/epic/search-cleanup-basket contains current activation artifact state before assigned worker worktrees branch from it, inspect every active worker and reviewer reference, update task gates, and stop when all active tasks are merged, blocked, cancelled, or ready for wdd-reconcile-wave.
```

Stop condition: all active-wave tasks are merged, blocked, cancelled, or ready
for `wdd-reconcile-wave`.

## Active Task Gates

| Task | Ticket | Branch | Worktree | PR/Patch | Gate | Worker | Reviewer |
|------|--------|--------|----------|----------|------|--------|----------|
| TASK-001-bulk-archive-service | TICKET-001-backend-bulk-archive | codex/task/TASK-001-bulk-archive-service | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-001-bulk-archive-service` | None | not_started | None | None |
| TASK-003-ui-bulk-archive-api-client | TICKET-002-cleanup-basket-foundation | codex/task/TASK-003-ui-bulk-archive-api-client | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-003-ui-bulk-archive-api-client` | None | not_started | None | None |
| TASK-004-cleanup-basket-state | TICKET-002-cleanup-basket-foundation | codex/task/TASK-004-cleanup-basket-state | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-004-cleanup-basket-state` | None | not_started | None | None |

## Worker Worktrees

| Task | Worktree Path | Branch | Status | Required Action |
|------|---------------|--------|--------|-----------------|
| TASK-001-bulk-archive-service | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-001-bulk-archive-service` | codex/task/TASK-001-bulk-archive-service | pending_creation | Create or verify before dispatch |
| TASK-003-ui-bulk-archive-api-client | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-003-ui-bulk-archive-api-client` | codex/task/TASK-003-ui-bulk-archive-api-client | pending_creation | Create or verify before dispatch |
| TASK-004-cleanup-basket-state | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-004-cleanup-basket-state` | codex/task/TASK-004-cleanup-basket-state | pending_creation | Create or verify before dispatch |

## Gate Definitions

- not_started: task has not been dispatched.
- no_pr: implementation has not produced a PR or equivalent patch.
- needs_review: PR or patch exists and review is not complete.
- reviewing: review is active.
- needs_fixes: unresolved P1/P2 feedback exists.
- merge_ready: verification, branch freshness, and P1/P2 gates are clear.
- merged: task is merged into the epic branch or accepted according to policy.
- blocked: controller cannot progress without user or external input.
- cancelled: task was intentionally abandoned or replaced.

## Branch Freshness

| Task | Epic Branch | Task Branch | Freshness | Required Action |
|------|-------------|-------------|-----------|-----------------|
| TASK-001-bulk-archive-service | codex/epic/search-cleanup-basket | codex/task/TASK-001-bulk-archive-service | unknown | Check before merge |
| TASK-003-ui-bulk-archive-api-client | codex/epic/search-cleanup-basket | codex/task/TASK-003-ui-bulk-archive-api-client | unknown | Check before merge |
| TASK-004-cleanup-basket-state | codex/epic/search-cleanup-basket | codex/task/TASK-004-cleanup-basket-state | unknown | Check before merge |

## Open P1/P2 Feedback

- None.

## Verification Status

| Task | Verification | Result | Evidence |
|------|--------------|--------|----------|
| TASK-001-bulk-archive-service | `npm test -- tests/integration/entity-service.test.ts` | not_run | None |
| TASK-003-ui-bulk-archive-api-client | `npm --workspace ui run test -- --run ui/src/lib/api.test.ts` | not_run | None |
| TASK-004-cleanup-basket-state | focused hook tests and `npm --workspace ui run typecheck` | not_run | None |

## Shared Context Reconciliation

- No pending shared-context updates.
- Reconcile `shared-context/resources/task-findings.md` after WAVE-001.
- Do not start WAVE-002 until WAVE-001 is reconciled.

## Event Log

- 2026-06-14: Epic planned with 4 tickets, 7 tasks, and 4 waves.
- 2026-06-14: User confirmed WAVE-001 override
  `standard / parallel / risk_based / adaptive`.
- 2026-06-14: WAVE-001 activation artifacts prepared; task worktrees pending
  creation from the synced epic branch.

## Next Action

- Commit activation artifacts to `codex/epic/search-cleanup-basket`, create or
  verify isolated task worktrees from that state, verify task files and
  orchestration state inside each worktree, then dispatch WAVE-001 workers.
