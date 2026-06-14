---
id: EPIC-search-cleanup-basket
kind: epic
type: feature
slug: search-cleanup-basket
title: Search Cleanup Basket
status: in_progress
created_at: 2026-06-14
updated_at: 2026-06-14
target_branch: main
epic_branch: codex/epic/search-cleanup-basket
profile: standard
review_mode: risk_based
monitoring_mode: adaptive
schema_version: 1
ticket_count: 4
task_count: 7
adapter_links:
  github_issue: null
  jira_epic: null
---

# Search Cleanup Basket

## Summary

Build an archive-only cleanup workflow in the Postgram Search UI. Users can
collect stale memories, unwanted interactions, duplicate persons, and other
entities from search results into a persistent cleanup basket, review the
basket, and archive the reviewed IDs through a backend bulk archive endpoint
with per-ID authorization and partial failure reporting.

## Goal

Make mass cleanup of unwanted Postgram entities fast, explicit, and reversible.
Search remains the discovery surface, the cleanup basket is the review surface,
and the backend remains the authority for which entity IDs can be archived.

## Background

The approved design spec is
`docs/superpowers/specs/2026-06-14-search-cleanup-basket-design.md`, committed
at `37e088d`. The user wants this design to become a WDD epic.

Current Search supports filters, semantic/list loading, result cards, detail
panels, and single-entity soft delete. Single delete already archives by
setting `status = 'archived'`. The missing workflow is a safe way to collect
many search results across searches and archive them in one reviewed action.

## Product Context

Primary user workflow:

1. Search or browse for stale/unwanted entities.
2. Select visible results with checkboxes, select-all-loaded, or shift-click
   ranges.
3. Add selected entities to a persistent cleanup basket.
4. Continue searching and adding across multiple searches if needed.
5. Review the basket in a drawer.
6. Archive the reviewed basket.

The workflow must feel fast enough for cleanup sessions, but should not make a
broad query destructive. This is why query-level archive is excluded.

## Technical Context

Relevant current areas:

- `ui/src/components/SearchPage.tsx`: search filters, loading, result cards,
  detail panel, and existing single delete state updates.
- `ui/src/lib/api.ts`: typed UI API client, currently has `deleteEntity`.
- `ui/src/App.tsx`: stores the active API key in localStorage as
  `pgm_api_key`.
- `ui/src/components/TasksPage.tsx` and
  `ui/src/components/tasks/BulkActionBar.tsx`: precedent for bulk selection,
  partial failures, and action bars.
- `src/services/entity-service.ts`: `softDeleteEntity`, access checks,
  entity mapping, audit entry writing, and list/recall/update services.
- `src/transport/rest.ts`: Zod request schemas and REST route registration.
- `tests/integration/entity-service.test.ts`: entity service integration
  coverage, including soft delete behavior.
- `tests/contract/rest-api.test.ts`: REST contract coverage.
- `ui/src/lib/api.test.ts` and `ui/src/components/TasksPage.test.tsx`: UI API
  and component test style.

## Deliverables

- Backend service:
  - Add `bulkArchiveEntities` to `src/services/entity-service.ts`.
  - Deduplicate explicit UUID IDs.
  - Require delete scope and apply existing type/visibility access per entity.
  - Archive allowed entities by setting `status = 'archived'`.
  - Return mixed `archived` and `failed` results.
  - Append audit entries for archived entities.
- REST API:
  - Add `POST /api/entities/bulk/archive`.
  - Validate body shape, UUID IDs, non-empty arrays, and max batch size of 500.
  - Return partial success/failure payloads.
- UI API client:
  - Add typed `bulkArchiveEntities(ids)` helper.
- Search selection:
  - Add result-card checkboxes.
  - Add select-all-loaded.
  - Add shift-click range selection in visible result order.
  - Keep normal card click behavior for opening detail.
  - Add selected-results action bar.
- Cleanup basket:
  - Add `useCleanupBasket` or equivalent state layer.
  - Persist basket snapshots in localStorage using a versioned API-key-scoped
    key.
  - Deduplicate basket items by entity ID.
  - Tolerate malformed localStorage.
- Review drawer:
  - Show basket totals and counts by type/status/visibility.
  - List basket items with removal controls.
  - Support clear basket.
  - Archive reviewed IDs through the bulk endpoint.
  - Remove successful archive IDs from basket and visible results.
  - Keep failed IDs in basket with error messages.
- Tests and validation:
  - Backend service and REST contract tests.
  - UI API and component tests for selection, basket persistence, review
    drawer, success cleanup, and partial failure retention.
  - Manual/browser validation of the complete cleanup flow.

## Non-Goals

- No permanent hard delete.
- No archive-all-current-query or archive-all-filter-matches action.
- No MCP or CLI bulk archive command in this epic.
- No graph edge deletion or cleanup beyond current soft-delete behavior.
- No changes to semantic search scoring.
- No changes to list pagination behavior except selection acts only on loaded
  visible results.
- No new entity status taxonomy.

## Assumptions

- The constitution defaults apply: `standard` profile, `risk_based` review,
  `adaptive` monitoring, target branch `main`, and epic branch
  `codex/epic/search-cleanup-basket`.
- The WDD constitution draft/open questions are not blocking for this epic;
  this epic follows the branch conventions already written in the constitution.
- API-key-scoped localStorage is a local collision-avoidance mechanism, not a
  security boundary.
- Partial archive success is acceptable and preferable to all-or-nothing
  behavior.
- Existing archived visibility behavior is sufficient for reversibility.

## Constraints

- All archive mutations must be explicit-ID based.
- Backend authorization remains authoritative.
- The first version must not expose hard delete.
- The first version must not expose query-based archive.
- Search result selection must not make card body clicks ambiguous: card body
  still opens detail, checkbox toggles selection.
- The basket stores display snapshots only, not a second source of entity truth.
- Planning artifacts and task files are text-only WDD control state; product
  code implementation starts only after `wdd-start-wave` dispatches workers.

## Risks

- `SearchPage.tsx` is already large; adding selection, basket, and drawer logic
  directly could make it brittle. Tasks should extract focused components or
  hooks.
- Bulk archive touches authorization and deletion semantics; tests must cover
  mixed visibility/type access and missing IDs.
- localStorage persistence can go stale if entities change after being added to
  the basket. The backend must still archive by ID only after authorization;
  the drawer can display stored snapshots.
- Shift-click selection can be awkward if results reload between clicks. The
  selection helper should use the current visible order and reset stale anchors
  when appropriate.
- UI copy must make clear that this archives, not hard-deletes.

## Dependencies

- Approved design spec:
  `docs/superpowers/specs/2026-06-14-search-cleanup-basket-design.md`.
- Existing REST auth middleware and API key scopes.
- Existing `softDeleteEntity` behavior and audit utility.
- Existing UI test setup with Vitest and Testing Library.
- Existing archived visibility behavior in search/list.

## Affected Areas

- Backend service layer: `src/services/entity-service.ts`.
- REST transport: `src/transport/rest.ts`.
- API types if shared payload types are added: `src/types/api.ts`.
- UI API client: `ui/src/lib/api.ts`, `ui/src/lib/api.test.ts`.
- Search UI: `ui/src/components/SearchPage.tsx` plus new focused components or
  hooks.
- UI tests: new or existing tests under `ui/src/components` and `ui/src/lib`.
- Backend tests: `tests/integration/entity-service.test.ts` and
  `tests/contract/rest-api.test.ts`.
- Documentation/spec references if implementation decisions change materially.

## Validation Strategy

Use RED/GREEN TDD per task. Focused validation should include:

- `npm test -- tests/integration/entity-service.test.ts`
- `npm test -- tests/contract/rest-api.test.ts`
- `npm --prefix ui run test -- --run` or focused UI Vitest files as
  appropriate.
- `npm --prefix ui run typecheck`
- Broader `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build`
  when integrating backend and frontend work into the epic branch.
- Manual browser validation of search, selection, basket persistence, review,
  archive success, and partial failure behavior.

## Definition of Done

- [x] Backend bulk archive service is implemented and covered.
- [x] REST bulk archive endpoint is implemented and covered.
- [x] UI API client supports the endpoint and is covered.
- [x] Search result selection supports checkbox, select-all-loaded, and
      shift-click visible range selection.
- [x] Persistent cleanup basket is implemented and covered.
- [x] Review drawer supports counts, item removal, clear basket, final archive,
      success cleanup, and failure retention.
- [ ] No hard delete or query-level archive path exists.
- [ ] Focused and broad verification commands pass for the changed areas.
- [ ] Manual/browser validation evidence is recorded.
- [ ] Task reviews have no unresolved P1/P2 findings.
- [ ] Epic validation passes.
- [ ] Final PR is ready for human review.

## Open Questions

- None blocking. Planning can proceed.

## Planning Notes

Activation update:

- 2026-06-14: WAVE-001 activated with user override from `full parallel` to
  `standard parallel`.

Suggested ticket boundaries:

- Backend bulk archive service and REST contract.
- UI API client plus cleanup basket state/persistence.
- Search result selection and selected-results action bar.
- Review drawer and archive integration.
- End-to-end UI polish, tests, and manual validation.

Likely sequencing:

1. Backend API foundation first so UI integration has a stable contract.
2. UI basket state and selection helpers can proceed in parallel with backend
   if workers avoid touching the same SearchPage sections.
3. Review drawer and final integration should follow the API client and basket
   state.
4. Final validation should reconcile SearchPage behavior and verify no
   query-level destructive affordance slipped in.

Conflict risks:

- `ui/src/components/SearchPage.tsx` is a shared conflict hotspot.
- `ui/src/lib/api.ts` and `ui/src/lib/api.test.ts` are small but central.
- `src/services/entity-service.ts` and `src/transport/rest.ts` are backend
  shared-contract files.

Shared-context resources:

- `shared-context/resources/architecture.md`
- `shared-context/resources/api-contract.md`
- `shared-context/resources/discovered-conventions.md`
- `shared-context/resources/testing-strategy.md`
- `shared-context/resources/validation-strategy.md`
- `shared-context/resources/task-findings.md`
