# Slice brief: ui-u3

Status: draft

## Outcome and boundaries

Create `ui/src/components/WherePage.tsx`, the default-exported page:

```ts
export default function WherePage(props: { api: ApiClient }): JSX.Element;
```

It owns two pieces of local state, the view (`actions` by default) and the
released-and-done toggle (off by default), passes both to `useWhere`, and
renders the result. Sub-components stay inside this file. It sends no write
request.

Read `specs/004-workspace-session-tracking/contracts/ui.md` sections
"Rendering", "Exact strings" and "Structure the feature test relies on" and
follow them literally. In particular:

1. **Controls**: the buttons `Actions` and `Stage` with `aria-pressed` on
   both, a checkbox labelled `Show released and done`, and a `Refresh` button
   wired to the hook's `refresh`.
2. **Groups** come in response order. Each one renders as a `<section>` whose
   level-2 heading is `<label> (<count>)`, counting features or, for a group
   without `features`, workspaces. A group with count 0 is not rendered. When
   every group is empty: the text `Nothing to do` and no heading at all.
3. **Feature card**: the first 8 characters of the id, the title, the stage as
   a badge, `formatAge(stage_set_at)` when it is not null, a badge with
   `task_status` only when that is `done` or `archived`, one link per pull
   request with the text `#<number> <state>` (`pullRequestNumber`),
   `target="_blank"` and `rel="noreferrer noopener"`, and the text
   `no worktrees` when `workspaces` is empty.
4. **Workspace row**: machine, branch or `-`, the path, `git <age>` from
   `git_state_at` or `git ?` when that is null (the whole element omitted when
   `git` is null), the risks in server order as `dirty <n>`, `unpushed <n>`,
   `no upstream`, `interrupted` and `missing` (a null count renders the label
   alone), and one chip per session with
   `<agent_kind>/<status> <age of last_activity_at>` plus ` dormant` when
   `dormant`, or `no sessions` when there are none. Each of those is one text
   node.
5. **Resume**: `renderResume(workspace)` as selectable monospace text that
   wraps, plus a button whose accessible name is `Copy resume command`. On
   click it calls `navigator.clipboard.writeText`. After a resolved write the
   row shows `Copied` for 2 s, then the button returns to its normal label.
   When the clipboard is missing or the write rejects, the row shows
   `Copy failed`. The command text stays visible in both cases.
6. **Error**: the message of `error` plus a `Retry` button that calls
   `refresh`, with the last good data still rendered below it.
7. **Loading**: only while the hook reports `loading`, a short line such as
   `Loading…`.

Write the slice test `ui/src/components/WherePage.test.tsx` with a stubbed
`ApiClient` (`{ getWhere: vi.fn() } as unknown as ApiClient`). Cover the copy
feedback including the 2 s reset with fake timers (the protected feature test
does not test that reset), both empty states, the controls and the risk and
session rendering.

You may create or modify other ordinary project files when the implementation
needs them; the listed paths are expected outputs, not a hard limit. Do not
delete files, and do not edit `ui/tests/where-page.feature.test.tsx`,
`changes/004-ui-where/slice-check.mjs`, `ui/src/lib/where.ts`,
`ui/src/lib/api.ts`, `ui/src/hooks/useWhere.ts` (accepted in earlier slices),
`ui/src/App.tsx`, `ui/src/components/TopBar.tsx` (slice ui-w1),
`specs/constitution.md`, `specs/constitution.approval.json`, anything else
under `changes/` or `.tinysdd/`.

## Sources and interfaces

`specs/004-workspace-session-tracking/contracts/ui.md` and
`changes/004-ui-where/interfaces.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| a response with an empty and a filled group | only non-empty groups render, header `<label> (<count>)` in an h2 inside a section | ui-groups | ui-u3 |
| every group empty | `Nothing to do`, no h2 | ui-groups | ui-u3 |
| a feature with a PR, a done feature without workspaces | short id, title, stage, age, `#42 open` link with target and rel, `done` badge, `no worktrees` | ui-feature-card | ui-u3 |
| a workspace with risks, a null git snapshot, a dormant session and no sessions | the exact single-node texts of the contract | ui-workspace-row | ui-u3 |
| copy succeeds, then 2 s pass | writeText called with the rendered command, `Copied`, then the normal label | ui-copy | ui-u3 |
| no clipboard, and a rejecting clipboard | `Copy failed`, command still visible | ui-copy | ui-u3 |
| the view buttons and the toggle | aria-pressed switches, the hook gets the new parameters | ui-query | ui-u3 |
| an error with data present | message, `Retry` calls refresh, data still rendered | ui-error | ui-u3 |
