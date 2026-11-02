# Design: change 004-ui-where

## Shape

Four slices. Three build new files bottom-up; the fourth wires the page into
the app and is the only one that touches `App.tsx` and `TopBar.tsx`.

| Slice | Builds | Slice test |
|-------|--------|------------|
| `ui-u1` | `ui/src/lib/where.ts`: the response types, `shq`, `formatAge`, `resumeDirectory`, `renderResume`, `pullRequestNumber`, `groupCount`, `isGroupEmpty` | `ui/src/lib/where.test.ts` |
| `ui-u2` | `ui/src/hooks/useWhere.ts` and the `getWhere` method in `ui/src/lib/api.ts` | `ui/src/hooks/useWhere.test.ts` |
| `ui-u3` | `ui/src/components/WherePage.tsx` | `ui/src/components/WherePage.test.tsx` |
| `ui-w1` | the `where` page in `ui/src/App.tsx` and the tab in `ui/src/components/TopBar.tsx` | `ui/src/components/TopBar.test.tsx` (existing, extended) |

Dependencies: `ui-u2` on `ui-u1`; `ui-u3` on `ui-u1` and `ui-u2`; `ui-w1` on
`ui-u3`.

## Why these boundaries

- `where.ts` holds everything pure: types, quoting, ages and the resume
  rendering. It is testable without React and mirrors
  `cli/src/tracking/resume.ts`, so the shared vectors in `contracts/ui.md` can
  be asserted directly.
- `useWhere.ts` owns the fetching: the query it builds, the 60 s poll, the
  refresh and the "keep the last good data on an error" rule. The component
  stays free of timers.
- `WherePage.tsx` is rendering plus the local UI state (view, toggle, copy
  feedback). One file; sub-components live inside it.
- `ui-w1` is the wiring slice, so no earlier slice cites a line range in a
  file it edits. That was the failure in change 004-cli-hooks, where slice
  `cli-t3` cited `cli/src/pgm.ts:237-263` and the wiring slice shifted those
  lines, which made the accepted review stale.

## Fixed decisions

1. **Own types.** The UI copies the response types instead of importing from
   `src/`. The server stays the single source of the rules; the types are a
   boundary, like `cli/src/tracking/types.ts`.
2. **Always ssh.** `renderResume` takes only the workspace. There is no
   `localAlias`, no `templates` argument and no transcript check, because a
   browser has no machine and no filesystem.
3. **One endpoint.** Only `GET /api/where`. The page sends no write request,
   so a read-only API key is enough.
4. **Empty groups disappear**, like the CLI. When every group is empty the
   page shows `Nothing to do`.
5. **Poll without flicker.** A poll or refresh keeps the previous data
   rendered; `loading` is true only while there is no data yet.
6. **Error without loss.** On an error the banner appears and the last good
   data stays. `Retry` refetches.
7. **Copy without a library.** `navigator.clipboard.writeText`, with the
   command always visible as selectable text for the case where the clipboard
   is unavailable (Safari on http, a phone).

## Checks

- Slice check: `node changes/004-ui-where/slice-check.mjs <files>` runs Vitest
  with `--root ui` on the slice test, ESLint on the listed `.ts` files and
  `tsc --noEmit -p ui/tsconfig.json`. No Docker and no database.
- Feature check: `ui/tests/where-page.feature.test.tsx`, the protected
  test that asserts the contract end to end against a stubbed API client, plus
  the `Where` tab in `TopBar`.
- `App.tsx` wiring is covered by `tsc` and `vite build`, not by a render test:
  booting the whole app in jsdom would drag in Sigma and Three.
