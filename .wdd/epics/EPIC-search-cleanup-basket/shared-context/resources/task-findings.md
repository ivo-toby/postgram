---
id: EPIC-search-cleanup-basket-RESOURCE-task-findings
kind: shared_context_resource
epic: EPIC-search-cleanup-basket
resource: task-findings
updated_at: 2026-06-14
---

# Shared Context Resource: Task Findings

## Purpose

Collect implementation discoveries from future WDD tasks and wave
reconciliation. This file starts empty by design.

## Summary

WAVE-001 completed the backend bulk archive service, UI API helper, and cleanup
basket state hook. Add further concise confirmed facts here when later tasks
discover behavior that downstream workers, reviewers, or validators need.
WAVE-002 completed the REST endpoint and Search result selection. WAVE-003
completed the review drawer; WAVE-004 can wire the full Search cleanup flow
against the now-merged backend/UI/drawer contracts.

## Details

Initial epic-start findings:

- Approved design spec exists at
  `docs/superpowers/specs/2026-06-14-search-cleanup-basket-design.md`.
- Current Search page has single-entity archive removal state helpers.
- Current backend single delete archives by setting `status = 'archived'`.
- WDD planning created four ticket containers, seven task files, and four
  waves.
- WAVE-001 service implementation reused the single-delete archive semantics:
  delete scope, type/visibility access, `status = 'archived'`, and `delete`
  audit entries.
- UI validation in this repository uses `npm --prefix ui ...`; root
  `package.json` does not declare `ui` as an npm workspace.
- Cleanup basket storage key format is
  `pgm_cleanup_basket:v1:<api-key-fingerprint>` and does not include the raw
  API key.

Controller reconciliation rules:

- After each wave, inspect every task file, PR or patch, review outcome,
  verification result, branch freshness state, and shared-context update.
- Move confirmed cross-task discoveries into this file using the durable memory
  format below.
- Do not start the next wave while P1/P2 review feedback, failed required
  verification, stale branch state, or unresolved architecture drift remains.
- Confirm WAVE-001 and WAVE-002 strategies before activation because they use
  `full` profile and include delete-scope/public API work.

## Durable Memory

### Initial State

- Source task: epic start
- Source PR/branch: current controller worktree
- Status: confirmed
- Summary: No implementation task findings yet.
- Why it matters: Future workers should add discoveries here rather than
  bloating the shared-context index.
- Affected files or areas: all future epic work.
- Follow-up implications: Reconcile this file after each wave.

### WAVE-001 Completion

- Source task: WAVE-001 reconciliation input
- Source PR/branch: `codex/epic/search-cleanup-basket` merge commit `a593403`
- Status: confirmed
- Summary: Backend service, UI API helper, and cleanup basket state are merged
  into the epic branch with focused verification passing.
- Why it matters: WAVE-002 can build the REST route against the service and
  Search selection against the basket state/API helper.
- Affected files or areas: `src/services/entity-service.ts`,
  `tests/integration/entity-service.test.ts`, `ui/src/lib/api.ts`,
  `ui/src/lib/api.test.ts`, `ui/src/hooks/useCleanupBasket.ts`, and
  `ui/src/hooks/useCleanupBasket.test.ts`.
- Follow-up implications: Use `npm --prefix ui` commands for UI task
  validation; do not use `npm --workspace ui` unless root workspaces change.

### WAVE-002 Completion

- Source task: WAVE-002 reconciliation input
- Source PR/branch: `codex/epic/search-cleanup-basket` merge commits
  `47e4423` and `0f1c3f1`
- Status: confirmed
- Summary: REST `POST /api/entities/bulk/archive` and Search result selection
  are merged into the epic branch with focused verification and full-profile
  reviews passing.
- Why it matters: WAVE-003 can implement the review drawer against the
  committed REST/API/basket contracts, and WAVE-004 can later integrate the
  complete Search cleanup flow.
- Affected files or areas: `src/transport/rest.ts`,
  `tests/contract/rest-api.test.ts`, `ui/src/components/SearchPage.tsx`, and
  `ui/src/components/SearchPage.test.tsx`.
- Follow-up implications: Drawer/integration tasks should call
  `api.bulkArchiveEntities(ids)` for reviewed basket IDs, preserve archive-only
  language, keep failed IDs in the basket, and treat SearchPage selection as
  already owning checkbox/select-all-loaded/shift-click behavior. SearchPage
  shift-click uses the prior visible selection anchor and applies the clicked
  checkbox state across that visible range.

### WAVE-003 Completion

- Source task: WAVE-003 reconciliation input
- Source PR/branch: `codex/epic/search-cleanup-basket` merge commit `04e4c52`
- Status: confirmed
- Summary: `CleanupBasketDrawer` is merged as a standalone component with
  focused tests and no premature SearchPage integration.
- Why it matters: WAVE-004 can wire the drawer into SearchPage using the
  committed component contract without reimplementing drawer behavior.
- Affected files or areas: `ui/src/components/CleanupBasketDrawer.tsx`,
  `ui/src/components/CleanupBasketDrawer.test.tsx`, and final SearchPage
  integration.
- Follow-up implications: TASK-007 should pass `api`, `useCleanupBasket.items`,
  `remove`, `clear`, `applyArchiveResult`, and `onClose` into the drawer, then
  handle visible SearchPage result/detail/selection cleanup after successful
  archive IDs are returned.
