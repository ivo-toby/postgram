# Slice brief: ui-w1 (wiring)

Status: draft

## Outcome and boundaries

Wire the page into the app. This is the only slice that edits `App.tsx` and
`TopBar.tsx`.

1. **`ui/src/components/TopBar.tsx`**: add `'where'` to the exported `Page`
   union and a `Where` tab between `Tasks` and `Admin`, in the same
   `TabButton` style as the others.
2. **`ui/src/App.tsx`**:
   - `readStoredRegularPage` also accepts the stored value `'where'`.
   - A branch for `currentPage === 'where'` that renders, in the same shell as
     the `tasks` branch (`<div className="flex flex-col h-full bg-gray-950">`,
     `TopBar`, `<div className="flex-1 min-h-0">`), `<WherePage api={api} />`.
   - Import `WherePage` directly, not lazily.
   - Nothing else changes: no other page, no graph loading effect, no
     `localStorage` key.

Extend the existing `ui/src/components/TopBar.test.tsx` with the `Where` tab:
it renders, it is not active for another page, and clicking it calls
`onNavigate('where')`. Keep every existing assertion in that file passing.

After this slice the protected feature test
`ui/tests/where-page.feature.test.tsx` must pass in full, and
`npm --prefix ui run typecheck`, `npm --prefix ui run build` and
`npm --prefix ui test` must be clean.

You may create or modify other ordinary project files when the implementation
needs them; the listed paths are expected outputs, not a hard limit. Do not
delete files, and do not edit `ui/tests/where-page.feature.test.tsx`,
`changes/004-ui-where/slice-check.mjs`, `ui/src/lib/where.ts`,
`ui/src/hooks/useWhere.ts`, `ui/src/components/WherePage.tsx` (accepted in
earlier slices), `specs/constitution.md`,
`specs/constitution.approval.json`, anything else under `changes/` or
`.tinysdd/`.

## Sources and interfaces

`specs/004-workspace-session-tracking/contracts/ui.md` and
`changes/004-ui-where/interfaces.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| the top bar on any page | a `Where` tab between Tasks and Admin, every existing tab unchanged | ui-wiring | ui-w1 |
| clicking the Where tab | `onNavigate('where')` | ui-wiring | ui-w1 |
| a stored page `where` and a reload | the where page opens | ui-wiring | ui-w1 |
| the whole UI test suite, typecheck and build | clean, including the protected feature test | ui-wiring | ui-where |
