# UI Contract: the Where page (v1, read-only)

Phase 5 of spec 004. A new page in the existing `ui/` app that shows where
features live, so Ivo can plan at his desk and get back into a session in one
step. It is **read-only**: it sends no write request and changes no state on
the server.

## Scope

In v1:

- A `Where` tab next to Search, Graph, Projector and Tasks.
- The **actions** view as the default list, and a switch to the **stage** view.
- Per feature its stage, pull requests and worktrees, with risks and sessions.
- A **copy resume command** button per worktree.

Out of scope (v2 and later, per the UI brainstorm):

- Any write action (moving a stage, linking a workspace, attaching a PR).
- Drag and drop.
- A chat panel. Talon is the chat.
- The local disk check for `missing` (`PATCH /api/workspaces/:id`); only `pgm
  where` does that, because only the CLI can see the disk.
- Filtering by machine or repo.

## Data

One request: `GET /api/where` (scope `read`), through the existing API client
and its bearer key. No other endpoint is called.

| UI state | Query |
|----------|-------|
| Actions view (default) | `view=actions` |
| Stage view | `view=stage` |
| "Show released and done" off (default) | *(no extra parameters)* |
| "Show released and done" on | `include_released=true&include_done=true` |

`include_ended` is never sent, so each workspace carries its open sessions plus
the single most recently active ended one.

The response shape, group keys, labels, order, risks and `resume_session` are
exactly as in `rest.md`; the UI adds no rules of its own and re-sorts nothing.

**Refresh**: on mount, every 60 s while the page is mounted, and on the
`Refresh` button. A refresh keeps the rendered page visible; it does not blank
it. Switching the view or the toggle refetches immediately.

**401** goes through the existing client, which logs the user out. Any other
error shows an error banner with a `Retry` button, and the last good data stays
on screen when there is any.

## Rendering

### Groups

- Groups come in response order. A group with no features and no workspaces is
  **not rendered** (same as `pgm where`).
- When every group is empty, the page shows `Nothing to do` instead.
- A group header is `<label>` with the count of features (for `unassigned`, of
  workspaces).

### Feature card

| Element | Value |
|---------|-------|
| Short id | the first 8 characters of `id`, monospace |
| Title | `title` |
| Stage badge | the readable label of `stage` (below), with the raw value and `derived` or `manual` from `stage_source` as its tooltip |
| Age | `stage_set_at` as a relative age (`12m`, `5h`, `3d`), omitted when null |
| Status badge | `task_status`, only when it is `done` or `archived` |
| PR chips | one per entry of `pull_requests`: `#<number> <state>`, linking to `url`, opening in a new tab with `rel="noreferrer"` |
| Worktrees | one row per entry of `workspaces`, in response order |
| No worktrees | the line `no worktrees` |

The number in a PR chip is the trailing number of the canonical URL.

### Workspace row

| Element | Value |
|---------|-------|
| Machine | `machine` |
| Branch | `branch`, or `-` when null |
| Path | `path`, monospace, wrapping allowed |
| Git age | `git_state_at` as a relative age, or `?` when null. Omitted when `git` is null |
| Risk badges | the `risks` array in server order: `dirty <n>`, `unpushed <n>`, `no upstream`, `interrupted`, `missing`. The counts come from `git`; a null count renders without a number |
| Sessions | one chip per entry of `sessions`: `<agent_kind>/<status> <age of last_activity_at>`, plus `dormant` when `dormant` is true. When `sessions` is empty: `no sessions` |
| Resume | the rendered command (below) as selectable monospace text, plus a `Copy` button |

Relative age is the same formula as the CLI: minutes under an hour, hours under
48 hours, else days.

### Resume command

The browser is not on any of the machines, so the UI always renders the **ssh**
form, and never the bare `cd` form that `pgm where` prints for the local
machine. It also cannot see whether a transcript still exists, so it never
applies the "transcript gone" fallback.

1. `dir` = `resume_session.cwd` when that equals `path` or lies under
   `path + '/'`, else `path`.
2. The agent kind is `resume_session.agent_kind`, else `sessions[0].agent_kind`,
   else `claude-code`.

   | Kind | With a session id | Without |
   |------|-------------------|---------|
   | `claude-code` | `claude --resume {session_id}` | `claude` |
   | `pi` | `pi --session {session_id}` | `pi` |
   | `talon`, `other` | – | – |

   The `with_id` template is used when `resume_session` is not null. `{session_id}`
   is replaced by the quoted `agent_session_id`. When the chosen template is
   absent, only the `cd` is rendered.
3. `local` = `cd <shq(dir)>` plus ` && <template>` when there is one.
4. The result is `ssh -t <connect_target> <shq(local)>`.

`shq(s)` is the CLI's POSIX quoting: `"'" + s.replaceAll("'", "'\\''") + "'"`.
To keep the command readable, the UI quotes `dir`, the session id and
`connect_target` only when needed: a value made only of `A-Z a-z 0-9 _ @ % + = : , . / -`
(and not starting with `=`) is left bare, anything else goes through `shq`. The
outer `local` is always quoted with `shq`. The CLI still quotes every value, so
its output differs from the UI for the same workspace, but both run the same
command. The UI is tested against these vectors:

| Case | Output |
|------|--------|
| `codebox`, path `/w/a`, claude-code, id `8f3c` | `ssh -t codebox 'cd /w/a && claude --resume 8f3c'` |
| `codebox`, path `/home/ivo/wt/a b`, id `x'y` | `ssh -t codebox 'cd '\''/home/ivo/wt/a b'\'' && claude --resume '\''x'\''\'\'''\''y'\'''` |
| `codebox`, talon session, path `/w/a` | `ssh -t codebox 'cd /w/a'` |
| `codebox`, no session, path `/w/a` | `ssh -t codebox 'cd /w/a && claude'` |

**Copy** uses `navigator.clipboard.writeText`. On success the button reads
`Copied` for two seconds. When the clipboard is unavailable or rejects, the
button reads `Copy failed` and the command text stays selectable, so it can
still be copied by hand. The command is always visible, also on a phone.

## Layout

- It works down to 360 px wide: one column, cards stacked, no horizontal
  scrolling. Paths wrap instead of overflowing.
- The page keeps the dark styling and the Tailwind classes of the existing
  pages.
- Tab state follows the existing `pgm_current_page` mechanism in `App.tsx`, so
  the page survives a reload.

## Known limitation

A cloud agent session (Claude Code on the web) has no machine you can ssh to,
so its rendered command is wrong there. v1 renders it anyway. Handling cloud
sessions is a separate change.

## Exact strings

The feature test asserts these, so they are part of the contract.

| Element | Text |
|---------|------|
| Tab | `Where` |
| View switch | the buttons `Actions` and `Stage`; the active one has `aria-pressed="true"` |
| Released toggle | a checkbox labelled `Show released and done` |
| Refresh | a button `Refresh` |
| Group header | `<label> (<count>)`, as a level-2 heading |
| Feature line | the short id and the title as separate text, plus the stage as a badge |
| Stage badge | `Building`, `Review`, `Functional test`, `Ready to merge`, `Awaiting release` or `Released` |
| Status badge | `done` or `archived` |
| PR chip | `#<number> <state>`, e.g. `#42 open` |
| No worktrees | `no worktrees` |
| Branch, null | `-` |
| Git age | `git <age>` or `git ?` |
| Risk badges | `dirty <n>`, `unpushed <n>`, `no upstream`, `interrupted`, `missing` |
| Session chip | `<agent_kind>/<status> <age>`, plus ` dormant` when dormant |
| No sessions | `no sessions` |
| Copy button | accessible name `Copy resume command`; `Copied` for 2 s after success; `Copy failed` after a rejection |
| Everything empty | `Nothing to do` |
| Error banner | the error message plus a `Retry` button |

## Structure the feature test relies on

- Each rendered group is a `<section>` that contains its level-2 heading, its
  features and their worktrees, so a test can scope queries to one group.
- These are each a **single text node**, not split across elements:
  `git <age>`, `git ?`, `dirty <n>`, `unpushed <n>`, `no upstream`,
  `interrupted`, `missing`, `<agent_kind>/<status> <age>`,
  `<agent_kind>/<status> <age> dormant`, `no sessions`, `no worktrees`,
  `#<number> <state>`, the short id, the title, the stage, the status badge,
  the age of `stage_set_at`, the branch (or `-`), the path and the resume
  command.
- The two view buttons carry `aria-pressed`, the released toggle is a real
  checkbox with the label as its accessible name, and the copy button's
  accessible name is `Copy resume command`.
