# Proposal: 004 phase 5, the Where page in the UI

Status: accepted (Ivo, 2026-11-02: read-only planning board in `ui/`, the ssh
form for every resume command)

## Outcome

The existing UI gets a `Where` page that answers "where does my work live and
how do I get back into it". It is read-only and calls one endpoint,
`GET /api/where`.

- A `Where` tab next to Search, Graph, Projector and Tasks.
- The actions view (Review / Test / Merge / Release / In progress /
  Unassigned) by default, with a switch to the stage view.
- Per feature: short id, title, stage, age, pull-request links, and its
  worktrees with risks and sessions.
- Per worktree a `Copy resume command` button, which copies the ssh form.
- A `Show released and done` toggle, a `Refresh` button and a 60 s poll.

Preserved: every existing page, the api-key login, the tab persistence in
`localStorage` and the dark styling.

## Out of scope

- Any write request. No stage moves, no linking, no PR attaching (that is v2).
- Drag and drop, and a chat panel (Talon is the chat).
- The local disk check that sets or clears `missing`; only `pgm where` can see
  a disk.
- Filtering by machine or repo.
- Cloud agent sessions, which have no machine to ssh into. The command is
  rendered anyway; a proper answer is a later change.

## Source facts

- `specs/004-workspace-session-tracking/contracts/ui.md`: this contract,
  including the exact strings.
- `specs/004-workspace-session-tracking/contracts/rest.md`: `GET /api/where`,
  the group keys and order, the workspace object and the risks.
- `src/types/workspaces.ts` and `src/services/where-rules.ts`: the response
  types the UI mirrors.
- `cli/src/tracking/resume.ts`: the resume rendering the UI copies, minus the
  local-machine and transcript-gone cases.
- `ui/src/lib/api.ts`: `createApiClient`, its bearer auth and the 401 logout.
- `ui/src/hooks/useQueue.ts`: the existing poll pattern.
- `ui/src/components/TopBar.tsx` and `ui/src/App.tsx`: the `Page` union, the
  tab bar and `pgm_current_page`.

## Proposed decisions

- D1: The UI gets its own copy of the where/workspace types in
  `ui/src/lib/where.ts`. The UI does not import from the server package `src/`
  (it has its own tsconfig and bundler), exactly as the CLI keeps its own copy
  in `cli/src/tracking/types.ts`.
- D2: The resume command is always the ssh form, because a browser is on no
  machine. The templates are constants in `ui/src/lib/where.ts`; they are not
  read from `~/.pgmrc`, which the browser cannot see.
- D3: No transcript check. The browser cannot stat a file, so the `with_id`
  template is used whenever there is a `resume_session`.
- D4: One request per render, `GET /api/where`. The UI never calls
  `/api/workspaces` and never patches `missing`.
- D5: The page keeps its own state (view, toggle, data). No router and no
  global store are added.
- D6: Only the wiring slice touches `App.tsx` and `TopBar.tsx`, so no earlier
  slice cites a line range in a file that a later slice edits (the lesson from
  change 004-cli-hooks).
