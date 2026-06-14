---
id: EPIC-search-cleanup-basket-WAVES
kind: wave_plan
epic: EPIC-search-cleanup-basket
status: in_progress
created_at: 2026-06-14
updated_at: 2026-06-14
---

# Wave Plan: EPIC-search-cleanup-basket

## Task Inventory

| Task | Ticket | Depends On | Conflict Domains | Status |
|------|--------|------------|------------------|--------|
| TASK-001-bulk-archive-service | TICKET-001-backend-bulk-archive | None | entity-service, entity integration tests, auth/delete, audit | done |
| TASK-002-rest-bulk-archive-endpoint | TICKET-001-backend-bulk-archive | TASK-001-bulk-archive-service | REST transport, REST contract tests, entity service export | todo |
| TASK-003-ui-bulk-archive-api-client | TICKET-002-cleanup-basket-foundation | None | UI API client, UI API tests | done |
| TASK-004-cleanup-basket-state | TICKET-002-cleanup-basket-foundation | None | cleanup basket hook/types/tests, localStorage behavior | done |
| TASK-005-search-result-selection | TICKET-003-search-selection | TASK-004-cleanup-basket-state | SearchPage, SearchPage tests, result card UI | todo |
| TASK-006-cleanup-basket-review-drawer | TICKET-004-review-archive-integration | TASK-002-rest-bulk-archive-endpoint, TASK-003-ui-bulk-archive-api-client, TASK-004-cleanup-basket-state | drawer component/tests, basket archive-result behavior | todo |
| TASK-007-search-cleanup-flow-integration | TICKET-004-review-archive-integration | TASK-002-rest-bulk-archive-endpoint, TASK-005-search-result-selection, TASK-006-cleanup-basket-review-drawer | SearchPage, final integrated flow, manual validation | todo |

## Dependency Grid

| Task | Blocks | Blocked By |
|------|--------|------------|
| TASK-001-bulk-archive-service | TASK-002-rest-bulk-archive-endpoint | None |
| TASK-002-rest-bulk-archive-endpoint | TASK-006-cleanup-basket-review-drawer, TASK-007-search-cleanup-flow-integration | TASK-001-bulk-archive-service |
| TASK-003-ui-bulk-archive-api-client | TASK-006-cleanup-basket-review-drawer | None |
| TASK-004-cleanup-basket-state | TASK-005-search-result-selection, TASK-006-cleanup-basket-review-drawer | None |
| TASK-005-search-result-selection | TASK-007-search-cleanup-flow-integration | TASK-004-cleanup-basket-state |
| TASK-006-cleanup-basket-review-drawer | TASK-007-search-cleanup-flow-integration | TASK-002-rest-bulk-archive-endpoint, TASK-003-ui-bulk-archive-api-client, TASK-004-cleanup-basket-state |
| TASK-007-search-cleanup-flow-integration | None | TASK-002-rest-bulk-archive-endpoint, TASK-005-search-result-selection, TASK-006-cleanup-basket-review-drawer |

## Conflict Grid

| Task Pair | Conflict Domains | Risk | Decision |
|-----------|------------------|------|----------|
| TASK-001 / TASK-003 | None | low | Can run together |
| TASK-001 / TASK-004 | None | low | Can run together |
| TASK-003 / TASK-004 | Possible shared UI type definitions | low | Can run together; avoid broad shared type churn |
| TASK-002 / TASK-005 | None | low | Can run together after dependencies |
| TASK-005 / TASK-006 | SearchPage vs drawer/basket component boundary | medium | Do not run together; drawer waits for selection wave |
| TASK-006 / TASK-007 | SearchPage/drawer integration | high | Sequential; integration waits for drawer |
| Backend tasks / UI final integration | REST/API contract | medium | Final integration waits for backend route and UI API helper |

## Waves

### WAVE-001

Status: ready_for_reconcile

Tasks:

- TASK-001-bulk-archive-service
- TASK-003-ui-bulk-archive-api-client
- TASK-004-cleanup-basket-state

Recommended strategy:

- Profile: standard
- Execution mode: parallel
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: user override on 2026-06-14: `override WAVE-001 standard parallel`

Rationale:

- These foundation tasks have no task dependencies.
- TASK-001 touches delete-scope service behavior and audit semantics, so
  standard profile with focused risk-based review is the confirmed override.
- TASK-003 and TASK-004 are frontend foundation work in mostly independent
  files and can proceed while backend service work is underway.

Why this grouping is safe:

- Dependencies are satisfied.
- Conflict domains are mostly disjoint.
- The UI API helper can code against the approved API contract without needing
  the route implemented first.
- Basket state is UI-local and does not need backend mutation yet.

Activation rule:

- Activated after user confirmed the `standard parallel` override.
- Dispatch every eligible task in the wave from synced epic-branch artifacts.
- Create or verify one isolated worktree per task before dispatch.

Stop condition:

- All WAVE-001 tasks are done.
- Wave reconciliation is required before WAVE-002 starts.

### WAVE-002

Status: planned

Tasks:

- TASK-002-rest-bulk-archive-endpoint
- TASK-005-search-result-selection

Recommended strategy:

- Profile: full
- Execution mode: parallel
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: medium
- Requires user confirmation: yes
- Confirmed by: null

Rationale:

- TASK-002 depends on backend service behavior from TASK-001 and creates a
  public REST contract.
- TASK-005 depends on basket state from TASK-004 and touches the SearchPage
  conflict hotspot.
- The tasks are in disjoint backend/frontend conflict domains and can run in
  parallel after WAVE-001 reconciliation.

Why this grouping is safe:

- Each task has a clear prerequisite from WAVE-001.
- No shared files are expected between the REST endpoint and Search selection.
- Full profile keeps extra attention on public API/delete semantics and the
  SearchPage UX hotspot.

Activation rule:

- Activate only after WAVE-001 is reconciled and the user confirms this
  high-risk/full profile strategy.
- Dispatch both tasks if their dependencies are done and epic branch artifacts
  are synced.

Stop condition:

- Both tasks are done, blocked, cancelled, or explicitly closed.
- Wave reconciliation is complete before WAVE-003 starts.

### WAVE-003

Status: planned

Tasks:

- TASK-006-cleanup-basket-review-drawer

Recommended strategy:

- Profile: standard
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: high
- Requires user confirmation: no
- Confirmed by: null

Rationale:

- This is one coherent UI component task.
- It depends on the backend route, UI API helper, and basket state.
- Running it as a single bundled task avoids fragmented drawer and state
  contracts.

Why this grouping is safe:

- Dependencies are explicit and satisfied after WAVE-002 reconciliation.
- Conflict domains are localized to the drawer and basket state behavior.

Activation rule:

- Activate after WAVE-002 reconciliation confirms dependencies are done.

Stop condition:

- TASK-006 is done, blocked, cancelled, or explicitly closed.
- Wave reconciliation is complete before WAVE-004 starts.

### WAVE-004

Status: planned

Tasks:

- TASK-007-search-cleanup-flow-integration

Recommended strategy:

- Profile: standard
- Execution mode: bundled
- Review mode: risk_based
- Monitoring mode: adaptive
- Confidence: high
- Requires user confirmation: no
- Confirmed by: null

Rationale:

- This is the final integration and validation task.
- It intentionally waits until backend, API client, basket state, selection, and
  review drawer contracts are all complete.

Why this grouping is safe:

- All dependencies are complete before activation.
- The task is single-worker because it touches the SearchPage integration
  hotspot and manual validation evidence.

Activation rule:

- Activate after WAVE-003 reconciliation confirms the drawer task is done.

Stop condition:

- TASK-007 is done, blocked, cancelled, or explicitly closed.
- Epic validation can begin only after WAVE-004 reconciliation.

## Known Conflict Risks

- `ui/src/components/SearchPage.tsx` is the highest frontend conflict hotspot.
- `src/services/entity-service.ts` and `src/transport/rest.ts` touch backend
  delete semantics and public API routing.
- `ui/src/lib/api.ts` is small but central; avoid broad client refactors.
- UI localStorage keying should not store the raw API key.
- Query-level archive and hard delete must not appear in any wave.

## Manual Adjustments

- WAVE-001 was initially recommended as `full parallel`; user confirmed the
  `standard parallel` override on 2026-06-14.
- WAVE-002 remains marked `full` profile and requires confirmation because the
  epic includes public REST contract work and SearchPage conflict risk.
- UI work is split so basket state can land before SearchPage selection, and
  SearchPage final integration waits until review drawer behavior is ready.
