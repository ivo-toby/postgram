---
id: EPIC-search-cleanup-basket-CONTROLLER
kind: controller_state
epic: EPIC-search-cleanup-basket
active_wave: WAVE-002
status: wave_002_active
updated_at: 2026-06-14
---

# Controller State: EPIC-search-cleanup-basket

## Controller Rule

The controller manages waves, workers, reviewers, PRs or patches, feedback,
verification evidence, stale-branch checks, merges or merge-ready decisions,
shared-context reconciliation, and wave reconciliation. The controller does not
implement task code. Workers must not switch branches in the controller
checkout.

## Current Outcome

WAVE-002 is active.

Current phase: create or verify WAVE-002 task worktrees, dispatch both workers
in parallel, then monitor manually because the heartbeat tool is not callable in
this thread.

## Wave Summary

| Wave | Tasks | Strategy | Status |
|------|-------|----------|--------|
| WAVE-001 | TASK-001-bulk-archive-service, TASK-003-ui-bulk-archive-api-client, TASK-004-cleanup-basket-state | standard / parallel / risk_based / adaptive | done |
| WAVE-002 | TASK-002-rest-bulk-archive-endpoint, TASK-005-search-result-selection | full / parallel / risk_based / adaptive | active |
| WAVE-003 | TASK-006-cleanup-basket-review-drawer | standard / bundled / risk_based / adaptive | planned |
| WAVE-004 | TASK-007-search-cleanup-flow-integration | standard / bundled / risk_based / adaptive | planned |

## Monitoring

Mode: manual

Cadence: adaptive 20 minutes until PR or patch

Status: manual_fallback_active

Last check: 2026-06-14T14:24:41+02:00

Next check due: 2026-06-14T14:45:00+02:00

Scheduler reference: none:automation_update_unavailable

Fallback prompt:

```text
Poll WAVE-002 workers directly: TASK-002-rest-bulk-archive-endpoint and TASK-005-search-result-selection. If complete, run reviews, verify, merge to epic branch, then reconcile WAVE-002 before starting WAVE-003.
```

## WAVE-001 Task Gates

| Task | Ticket | Branch | Result | Worker | Review | Verification |
|------|--------|--------|--------|--------|--------|--------------|
| TASK-001-bulk-archive-service | TICKET-001-backend-bulk-archive | codex/task/TASK-001-bulk-archive-service | merged in `a593403` | Gauss (`019ec5db-dc36-7c70-8e8d-a34629d5c1da`) | Halley `REVIEW_PASS` | backend tests passed |
| TASK-003-ui-bulk-archive-api-client | TICKET-002-cleanup-basket-foundation | codex/task/TASK-003-ui-bulk-archive-api-client | merged in `a593403` | Singer (`019ec5db-dc95-7521-9ad5-873cb2398c2c`) | controller review, no P1/P2 | UI API tests and typecheck passed |
| TASK-004-cleanup-basket-state | TICKET-002-cleanup-basket-foundation | codex/task/TASK-004-cleanup-basket-state | merged in `a593403` | Kant (`019ec5db-dcf3-7cd2-90b5-44ce10a46b67`) | controller review, no P1/P2 | basket tests and typecheck passed |

## WAVE-002 Task Gates

| Task | Ticket | Branch | Worktree | Worker | Gate | Verification |
|------|--------|--------|----------|--------|------|--------------|
| TASK-002-rest-bulk-archive-endpoint | TICKET-001-backend-bulk-archive | codex/task/TASK-002-rest-bulk-archive-endpoint | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-002-rest-bulk-archive-endpoint` | Curie (`019ec61b-5e6f-7e60-8cd9-79177615cae7`) | worker_dispatched | pending |
| TASK-005-search-result-selection | TICKET-003-search-selection | codex/task/TASK-005-search-result-selection | `/Users/ivo.toby/.codex/worktrees/dabec7ed-521f-42fd-b18e-0c0d542e7ccc/postgram-TASK-005-search-result-selection` | Erdos (`019ec61b-5ecc-7293-be12-93dfe9846204`) | worker_dispatched | pending |

## Verification Status

- `npm test -- tests/integration/entity-service.test.ts`: passed, 1 file, 13
  tests.
- `npm --prefix ui run test -- --run src/lib/api.test.ts src/hooks/useCleanupBasket.test.ts`:
  passed, 2 files, 16 tests.
- `npm --prefix ui run typecheck`: passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.

## Shared Context Reconciliation

- Reconciled UI validation command: use `npm --prefix ui ...`, not
  `npm --workspace ui ...`.
- Reconciled storage key format:
  `pgm_cleanup_basket:v1:<api-key-fingerprint>`.
- Reconciled backend archive semantics: bulk archive reuses single-delete
  archive behavior and audit operation.

## Future Wave Readiness

- TASK-002 dependency `TASK-001-bulk-archive-service` is done and merged.
- TASK-005 dependency `TASK-004-cleanup-basket-state` is done and merged.
- WAVE-002 confirmation is recorded as user on 2026-06-14:
  `ok, full parallel for wave 2`.
- WAVE-003 remains blocked until WAVE-002 is complete and reconciled.

## Event Log

- 2026-06-14: WAVE-001 activated with user override
  `standard / parallel / risk_based / adaptive`.
- 2026-06-14: WAVE-001 workers completed TASK-001, TASK-003, and TASK-004.
- 2026-06-14: WAVE-001 task branches merged into epic branch in `a593403`.
- 2026-06-14: WAVE-001 closeout artifacts committed in `69bb6ff`.
- 2026-06-14: WAVE-001 reconciled and marked done.
- 2026-06-14: WAVE-002 confirmed by user as
  `full / parallel / risk_based / adaptive` and activated.
- 2026-06-14: Heartbeat automation was attempted again; no dedicated
  automation/heartbeat tool was exposed, so WAVE-002 uses manual direct polling.
- 2026-06-14: WAVE-002 worktrees were created and workers Curie and Erdos were
  assigned for parallel dispatch.

## Next Action

- Create or verify WAVE-002 task worktrees, dispatch both workers, then poll
  manually at the recorded cadence.
