# Slice brief: ui-u1

Status: draft

## Outcome and boundaries

Create `ui/src/lib/where.ts`. It holds the response types of
`GET /api/where` and the pure helpers the page needs. Exactly the exports of
`changes/004-ui-where/interfaces.md`, section `ui/src/lib/where.ts`.

Rules:

1. The types mirror the server response of `contracts/rest.md`. Copy them; do
   not import anything from the server package `src/`.
2. `shq(value)`: `"'" + value.replaceAll("'", "'\\''") + "'"`.
3. `formatAge(fromIso, now)`: whole minutes under one hour (`12m`), whole
   hours under 48 hours (`5h`), else whole days (`3d`). An elapsed time below
   zero clamps to zero. Same formula as `cli/src/tracking/resume.ts`.
4. `resumeDirectory(workspace)`: `resume_session.cwd` when that equals
   `workspace.path` or starts with `workspace.path + '/'`, else
   `workspace.path`.
5. `renderResume(workspace)`: always the ssh form, because a browser is on no
   machine.
   - Templates, as module constants: `claude-code` →
     `claude --resume {session_id}` / `claude`; `pi` → `pi --session {session_id}`
     / `pi`; `talon` and `other` → neither.
   - The agent kind is `resume_session.agent_kind`, else `sessions[0].agent_kind`,
     else `claude-code`.
   - Use the `with_id` template when `resume_session` is not null and that
     template exists, replacing every `{session_id}` with
     `shq(resume_session.agent_session_id)`. Otherwise use the `without_id`
     template of the agent kind. There is no transcript check.
   - `local = 'cd ' + shq(resumeDirectory(workspace))`, plus ` && <template>`
     when a template was chosen.
   - Return `'ssh -t ' + workspace.connect_target + ' ' + shq(local)`.
6. `pullRequestNumber(url)`: the trailing number of a canonical PR url, as a
   string, or `null` when the url does not end in `/pull/<digits>`.
7. `groupCount(group)`: the number of `features`, or of `workspaces` for a
   group without `features`. `isGroupEmpty(group)` is `groupCount(group) === 0`.

Write the slice test `ui/src/lib/where.test.ts`. Assert at least these
vectors, which also appear in the contract:

| Input | Expected |
|-------|----------|
| codebox, path `/w/a`, claude-code resume session id `8f3c`, cwd `/w/a` | `ssh -t codebox 'cd '\''/w/a'\'' && claude --resume '\''8f3c'\'''` |
| nuc.lan, path `/home/ivo/wt/a b`, pi, id `x'y`, cwd `/home/ivo/wt/a b/cli` | `ssh -t nuc.lan 'cd '\''/home/ivo/wt/a b/cli'\'' && pi --session '\''x'\''\'\'''\''y'\'''` |
| jarvis, path `/w/d`, talon resume session | `ssh -t jarvis 'cd '\''/w/d'\'''` |
| codebox, path `/w/c`, no resume session, no sessions | `ssh -t codebox 'cd '\''/w/c'\'' && claude'` |
| a cwd outside the path, e.g. `/other` with path `/w/a` | the directory is `/w/a` |

Plus `formatAge` at 59 minutes, 60 minutes, 47 hours, 48 hours and 10 days,
and `pullRequestNumber` for a canonical url and for a non-PR url.

You may create or modify other ordinary project files when the implementation
needs them; the listed paths are expected outputs, not a hard limit. Do not
delete files, and do not edit `ui/tests/where-page.feature.test.tsx`,
`changes/004-ui-where/slice-check.mjs`, `specs/constitution.md`,
`specs/constitution.approval.json`, anything else under `changes/` or
`.tinysdd/`.

## Sources and interfaces

`specs/004-workspace-session-tracking/contracts/ui.md` and
`specs/004-workspace-session-tracking/contracts/rest.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| renderResume for the four vectors above | the exact ssh strings | ui-resume | ui-u1 |
| a resume session whose cwd lies outside the workspace path | the cd uses the workspace path | ui-resume | ui-u1 |
| formatAge at the hour and 48-hour boundaries | `59m`, `1h`, `47h`, `2d`, `10d` | ui-age-format | ui-u1 |
| pullRequestNumber on a canonical url and on a repo url | `42` and `null` | ui-feature-card | ui-u1 |
| groupCount and isGroupEmpty for a feature group and an unassigned group | the feature count and the workspace count | ui-groups | ui-u1 |
