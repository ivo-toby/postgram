# Slice brief: ui-u2

Status: draft

## Outcome and boundaries

Add the fetching layer:

1. **`ui/src/lib/api.ts`**: one new method on the object `createApiClient`
   returns, next to the existing ones:

   ```ts
   getWhere(params: { view: WhereView; include_released?: boolean; include_done?: boolean }): Promise<WhereResponse>
   ```

   It builds `/api/where` with `URLSearchParams`: always `view`, plus
   `include_released=true` and `include_done=true` only when those params are
   `true`. It never sends `include_ended`. Import the types from
   `./where.ts`. Change nothing else in that file.

2. **`ui/src/hooks/useWhere.ts`**: `useWhere(api, { view, includeReleasedAndDone })`
   returning `{ data, loading, error, refresh }` exactly as in
   `changes/004-ui-where/interfaces.md`.

Rules for the hook:

- It fetches on mount, whenever `view` or `includeReleasedAndDone` changes, on
  `refresh()`, and every 60 s while mounted (`setInterval`, cleared on
  unmount, like `ui/src/hooks/useQueue.ts`).
- `loading` is true only while there is no data yet. A refetch that already
  has data leaves `data` and `loading` untouched until it resolves.
- On success: `data` is replaced and `error` becomes `null`.
- On failure: `error` is set and the previous `data` is kept.
- A response that arrives after unmount, or after the parameters changed, is
  ignored (a `cancelled` flag per effect run).
- `refresh` is a stable callback (`useCallback`), so a parent can pass it to a
  button without re-rendering the tree.
- The 401 handling stays in the API client; the hook adds none.

Write the slice test `ui/src/hooks/useWhere.test.ts`, using
`renderHook` from @testing-library/react and `vi.useFakeTimers()` for the
poll. Cover: the query the client gets for both toggle states and both views;
mount fetch; `refresh()`; a 60 s tick; data kept with an error after a failed
refetch; `loading` false once data is there; no state update after unmount.

You may create or modify other ordinary project files when the implementation
needs them; the listed paths are expected outputs, not a hard limit. Do not
delete files, and do not edit `ui/tests/where-page.feature.test.tsx`,
`changes/004-ui-where/slice-check.mjs`, `ui/src/lib/where.ts` (accepted in
slice ui-u1), `specs/constitution.md`, `specs/constitution.approval.json`,
anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

`specs/004-workspace-session-tracking/contracts/ui.md`,
`specs/004-workspace-session-tracking/contracts/rest.md` and
`changes/004-ui-where/interfaces.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| getWhere with view actions and the toggle off | `GET /api/where?view=actions`, no other parameter | ui-query | ui-u2 |
| getWhere with view stage and the toggle on | `view=stage&include_released=true&include_done=true` | ui-query | ui-u2 |
| mount, a parameter change, refresh and a 60 s tick | one fetch each, with the current parameters | ui-refresh | ui-u2 |
| a refetch that rejects while data is present | error set, previous data kept, loading false | ui-error | ui-u2 |
| a response resolving after unmount | no state update and no warning | ui-refresh | ui-u2 |
