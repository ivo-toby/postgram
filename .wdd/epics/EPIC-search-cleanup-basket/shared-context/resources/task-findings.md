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
