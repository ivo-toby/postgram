---
id: EPIC-search-cleanup-basket-SHARED-CONTEXT
kind: shared_context_index
epic: EPIC-search-cleanup-basket
updated_at: 2026-06-14
---

# Shared Context: EPIC-search-cleanup-basket

## Overview

Shared context for implementing the Search cleanup basket epic. Workers should
read the approved design spec and the focused resource that matches their task
before editing code.

## Resource Index

| Resource | Summary | Read When |
|----------|---------|-----------|
| resources/architecture.md | Current and target architecture for search cleanup, backend bulk archive, and UI basket flow | Touching backend/API/UI integration boundaries |
| resources/api-contract.md | Bulk archive REST contract and UI client payload expectations | Touching backend routes, REST tests, or UI API client |
| resources/discovered-conventions.md | Repo conventions discovered during epic start | Starting any implementation task |
| resources/testing-strategy.md | Focused test expectations and likely commands | Writing tests or choosing validation |
| resources/validation-strategy.md | Epic-level validation and manual browser pass | Closing tasks or validating the epic |
| resources/task-findings.md | Running notes for worker discoveries | Reconciling waves or recording implementation discoveries |

## Key Decisions

- Cleanup is archive-only; no hard delete.
- Cleanup mutation is explicit-ID based; no archive-all-query action.
- The UI owns selection and persistent basket state.
- The backend owns final authorization and archive mutation through a bulk
  archive-by-IDs endpoint.
- Basket persistence uses localStorage scoped to the active API key context.
- A review drawer is required before archive.

## Key Warnings

- `SearchPage.tsx` is already large and is likely the highest frontend conflict
  hotspot.
- Bulk archive touches auth/delete semantics; backend tests must cover partial
  failures and inaccessible entities.
- The basket stores display snapshots only; backend must not trust stored UI
  snapshots as entity truth.

## Known Constraints

- Target branch: `main`.
- Epic branch: `codex/epic/search-cleanup-basket`.
- WDD profile: `standard`.
- Review mode: `risk_based`.
- Monitoring mode: `adaptive`.
- WAVE-001 is done and reconciled.
- Planned structure: 4 tickets, 7 tasks, 4 waves.
- WAVE-001 was confirmed by user override as `standard parallel` and merged in
  local merge commit `a593403`.
- WAVE-002 is done and reconciled. The REST bulk archive endpoint and Search
  result selection are merged into the epic branch.
- WAVE-003 is active and contains the cleanup basket review drawer task.

## Recent Durable Memory

- Postgram Search cleanup basket design specification completed and committed
  at `37e088d` in
  `docs/superpowers/specs/2026-06-14-search-cleanup-basket-design.md`.
  Approved design includes persistent localStorage cleanup basket, checkbox /
  select-all-loaded / shift-click selection, review drawer, archive-only soft
  delete, and a REST bulk archive-by-IDs endpoint with partial failure
  reporting.
