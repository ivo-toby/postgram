---
id: EPIC-search-cleanup-basket-FINAL-PR
kind: final_pr
epic: EPIC-search-cleanup-basket
status: created
created_at: 2026-06-14
updated_at: 2026-06-14
---

# Final PR: EPIC-search-cleanup-basket

GitHub PR: https://github.com/ivo-toby/postgram/pull/71

Draft: yes

Source: `codex/epic/search-cleanup-basket`

Target: `main`

## PR Title

[codex] Add Search cleanup basket

## Epic Summary

This PR adds an archive-only cleanup workflow to the Search UI. Users can select
search results, add them to a persistent cleanup basket, review the basket in a
drawer, and bulk archive reviewed IDs through a backend endpoint with per-ID
authorization and partial failure reporting.

The workflow is intentionally explicit-ID based. It does not add hard delete,
archive-all-query, archive-by-filter, MCP, or CLI bulk archive behavior.

## Completed Deliverables

- Backend `bulkArchiveEntities` service with dedupe, delete-scope/type/visibility
  checks, audit entries, and partial failures.
- REST `POST /api/entities/bulk/archive` with UUID/non-empty/max-500 validation.
- UI API client helper `bulkArchiveEntities(ids)`.
- API-key-scoped localStorage cleanup basket state.
- Search result checkbox/select-all-loaded/shift-click selection.
- Add-selected-to-basket action bar.
- Cleanup basket review drawer with summaries, remove, clear, archive, success
  cleanup, and partial failure retention.
- Final SearchPage integration: basket button/count, drawer open/close, archive
  success cleanup from results/detail/selection, and failed item retention.

## Definition Of Done Checklist

- [x] Backend bulk archive service is implemented and covered.
- [x] REST bulk archive endpoint is implemented and covered.
- [x] UI API client supports the endpoint and is covered.
- [x] Search result selection supports checkbox, select-all-loaded, and
      shift-click visible range selection.
- [x] Persistent cleanup basket is implemented and covered.
- [x] Review drawer supports counts, item removal, clear basket, final archive,
      success cleanup, and failure retention.
- [x] No hard delete or query-level archive path exists.
- [x] Focused and broad verification commands pass for the changed areas.
- [x] Manual/browser validation evidence is recorded.
- [x] Task reviews have no unresolved P1/P2 findings.
- [x] Epic validation passes.

## Validation Evidence

- Epic validation report:
  `.wdd/epics/EPIC-search-cleanup-basket/epic-validation.md`
- Final branch was updated with `origin/main` in `f436e95` before validation.
- Post-merge checks passed:
  - `npm --prefix ui run test -- --run src/components/SearchPage.test.tsx`
  - `npm --prefix ui run test -- --run src/components/CleanupBasketDrawer.test.tsx src/hooks/useCleanupBasket.test.ts src/lib/api.test.ts`
  - `npm test -- tests/contract/rest-api.test.ts`
  - `npm --prefix ui run typecheck`
  - `npm run typecheck`
  - `git diff --check`
- Browser smoke passed at `http://127.0.0.1:5173/`: Search rendered the cleanup
  basket header button and the empty drawer opened/closed without browser
  console errors.

## Test Results

- SearchPage tests: 8 passed.
- CleanupBasketDrawer/useCleanupBasket/UI API tests: 21 passed.
- REST contract tests: 22 passed.
- Entity service integration tests: 13 passed during wave validation.
- UI typecheck: passed.
- Root typecheck: passed.
- Diff whitespace check: passed.

## Wave Summary

| Wave | Tasks | Result |
|------|-------|--------|
| WAVE-001 | TASK-001, TASK-003, TASK-004 | done and reconciled |
| WAVE-002 | TASK-002, TASK-005 | done and reconciled |
| WAVE-003 | TASK-006 | done and reconciled |
| WAVE-004 | TASK-007 | done and reconciled |

## Task Summary

| Task | PR/Patch | Review | Verification |
|------|----------|--------|--------------|
| TASK-001-bulk-archive-service | local-merge:a593403 | REVIEW_PASS | passed |
| TASK-002-rest-bulk-archive-endpoint | local-merge:47e4423 | REVIEW_PASS | passed |
| TASK-003-ui-bulk-archive-api-client | local-merge:a593403 | controller review, no P1/P2 | passed |
| TASK-004-cleanup-basket-state | local-merge:a593403 | controller review, no P1/P2 | passed |
| TASK-005-search-result-selection | local-merge:0f1c3f1 | REVIEW_PASS | passed |
| TASK-006-cleanup-basket-review-drawer | local-merge:04e4c52 | REVIEW_PASS | passed |
| TASK-007-search-cleanup-flow-integration | local-merge:b9cdcd0 | REVIEW_PASS | passed_with_manual_limitation |

## Review Summary

- P1/P2 status: none unresolved.
- P3 follow-ups: none required.

## Known Limitations

- Full data-backed browser archive validation was not run because no local
  backend, delete-scoped API key, and disposable seed entities were available.
  The UI smoke and automated UI/API/REST tests passed.

## Risks

- SearchPage is the primary UI integration hotspot. Focused tests now cover
  selection, drawer opening, success cleanup, and partial failure retention.
- The backend remains the authority for archive authorization; the basket stores
  display snapshots only.

## Follow-Up Tasks

- Run a full data-backed browser archive pass with a local backend,
  delete-scoped API key, and disposable seed entities when that environment is
  available.

## Documentation Updates

- WDD artifacts under `.wdd/epics/EPIC-search-cleanup-basket/` were updated with
  wave reconciliation, validation, and final PR evidence.

## References

- Epic: `.wdd/epics/EPIC-search-cleanup-basket/epic.md`
- Epic validation: `.wdd/epics/EPIC-search-cleanup-basket/epic-validation.md`
- Wave plan: `.wdd/epics/EPIC-search-cleanup-basket/wave-plan.md`
- Orchestration: `.wdd/epics/EPIC-search-cleanup-basket/orchestration.json`
- Controller state: `.wdd/epics/EPIC-search-cleanup-basket/controller-state.md`
- Shared context: `.wdd/epics/EPIC-search-cleanup-basket/shared-context/index.md`
