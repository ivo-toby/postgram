---
id: EPIC-search-cleanup-basket-RESOURCE-discovered-conventions
kind: shared_context_resource
epic: EPIC-search-cleanup-basket
resource: discovered-conventions
updated_at: 2026-06-14
---

# Shared Context Resource: Discovered Conventions

## Purpose

Capture repo conventions relevant to this epic so workers can start from local
patterns instead of inventing new ones.

## Summary

Postgram uses TypeScript, service-layer functions returning `ServiceResult`,
Zod-validated REST routes, snake_case REST payloads, and React components with
focused Testing Library tests. Existing task bulk actions are a useful UI
precedent.

## Backend Conventions

- Service functions live under `src/services`.
- Entity service functions return `ServiceResult<T>` using `ResultAsync`.
- Convert unknown failures to `AppError` through local helpers such as
  `toAppError`.
- Auth checks use `requireScope`, `checkTypeAccess`, and
  `checkVisibilityAccess`.
- Current single delete uses `assertEntityAccess(auth, existing, 'delete')`.
- REST routes live in `src/transport/rest.ts`.
- REST validation uses Zod schemas near existing endpoint schemas.
- REST payloads use snake_case fields, while service/domain `Entity` uses
  camelCase internally.
- `toStoredEntity` in `rest.ts` maps service entities to REST payload shape.
- Existing soft-delete audit uses `operation: 'delete'`.

## Frontend Conventions

- UI API calls are centralized in `ui/src/lib/api.ts`.
- UI entity types use REST/snake_case fields from `ui/src/lib/types.ts`.
- Search page local state is hook-heavy and uses `useCallback`, `useMemo`,
  and local helper components.
- `SearchPage` already has `replaceEntity` and `removeEntity` helpers that can
  update results/fetched detail after archive.
- Existing UI styling is Tailwind in quiet dark operational UI.
- Existing bulk task behavior uses a visible action bar and keeps failed items
  selected with a failure count.
- Tests use Vitest, Testing Library, and `userEvent`.

## WDD Conventions

- Epic branch convention: `codex/epic/[epic-slug]`.
- Task branch convention: `codex/task/[task-id]-[task-slug]`.
- Tasks should use isolated worktrees before repository-writing work begins.
- WDD artifacts are text-only and local markdown/json.

## Details

Workers touching `SearchPage.tsx` should avoid unrelated visual refactors.
Useful extraction points are a basket hook, review drawer, selection bar, and
small pure selection helpers. Keep result-card click behavior intact: checkbox
selection should not steal normal detail navigation from the card body.

Workers touching backend archive behavior should keep single-delete behavior
unchanged unless task scope explicitly includes shared refactoring.

## Durable Memory

### Relevant Prior Work

- Source task: epic start context
- Source PR/branch: current controller worktree
- Status: confirmed
- Summary: GTD Tasks page recently added bulk task transitions and has tests
  for selection, partial failure, and bulk schedule behavior.
- Why it matters: The Search cleanup UI can reuse the same style of explicit
  action bar and partial failure UX without copying task-specific status logic.
- Affected files or areas: `ui/src/components/TasksPage.tsx`,
  `ui/src/components/tasks/BulkActionBar.tsx`,
  `ui/src/components/TasksPage.test.tsx`.
- Follow-up implications: The cleanup basket differs because selected items
  persist across searches and archive through a backend bulk endpoint.
