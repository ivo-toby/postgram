# Proposal: 004 phase 4, CLI and hooks

Status: accepted (Ivo, 2026-11-01: decisions D1-D12 and the 12-slice plan)

## Outcome

The `pgm` CLI gets the commands of `contracts/cli.md`, so the tracking works
without calling the API by hand:

- `pgm here`: registers the current workspace and session, from a flag call or
  from a Claude Code hook (stdin JSON), within the 2 s budget, always exit 0.
- `pgm hooks install|uninstall`: writes the four Claude Code hook entries
  (idempotent), proposes `cleanupPeriodDays`, and with `--pi` installs the pi
  extension `cli/integrations/pi/postgram.ts`.
- `pgm where`: the stage and actions views, phone-friendly, with the local disk
  check (FR-030) and rendered resume commands (FR-028).
- `pgm feature add|stage|pr|link|unlink`, `pgm machine set|list`,
  `pgm repo set`.
- `pgm worktree new`: a feature worktree with its marker, in the documented
  order of side effects (FR-025).
- `pgm scan`: finds worktrees and Claude/pi sessions under the scan roots and
  records accepted ones (FR-033-FR-037).

Preserved: every existing `pgm` command, option and output; `~/.pgmrc`
credential precedence; the server, its routes and tools (no server change).

Out of scope: transcript backup (R4 follow-up), any server change.

## Source facts

- `specs/004-workspace-session-tracking/contracts/cli.md`: all commands,
  helpers, resume rendering, hooks, scan, exit codes, config.
- `specs/004-workspace-session-tracking/research.md` R2, R3, R5-R9: hook
  events, pi events, resume templates, boot id, git commands, marker, scan
  encoding.
- `specs/004-workspace-session-tracking/contracts/rest.md`: the endpoints the
  CLI calls (accepted in phase 3).
- `cli/src/pgm.ts:237-263,407-412`: `runWithClient`, the program and `--json`.
- `cli/src/client.ts:80-132`: the private `request` helper and its error
  mapping.
- `cli/src/shared.ts`: `resolvePgmConfig`, `printJson`, `printHuman`,
  `handleCliFailure`.
- `src/util/git-remote.ts` and `src/services/workspace-report-schema.ts:219`:
  the server normalizes every reported remote.
- `src/transport/rest.ts:621-650`: `GET /api/tasks` (paged, `limit`,
  `offset`, `include_archived`).

## Proposed decisions

- D1: New code lives in `cli/src/tracking/`, one file per slice. Each command
  file exports `register<Name>Commands(program)`. Only the wiring slice edits
  `pgm.ts`, to call them.
- D2: `cli/src/client.ts` exports its existing `request` helper unchanged, so
  `cli/src/tracking/api.ts` can build the tracking client on the same auth and
  error mapping.
- D3: The CLI sends `repo_remote` and `--repo` as git reports them. The server
  already normalizes remotes, so the CLI has no copy of that rule.
- D4: Title matching for `pgm worktree new` pages through `GET /api/tasks`
  (limit 100) and keeps tasks with `metadata.kind === 'feature'` whose title
  (first content line, trimmed, cut at 80) equals the argument
  case-insensitively. No new endpoint.
- D5: The scan's "top 3 search hits" use the existing `POST /api/search` with
  `type: 'task'`, `limit: 3`.
- D6: `~/.pgm/here.log` rotation: before appending, a file of 1 MB or more is
  renamed to `here.log.1` (replacing it). One line per failure:
  `<ISO time> <event|-> <message>`.
- D7: The macOS boot id is the sha256 hex of the `{ sec = …, usec = … }` part
  of `sysctl -n kern.boottime`. Linux uses the file as is, trimmed.
- D8: Usage errors in the new commands (bad values, missing arguments) exit 2
  with a message on stderr. Commander parse errors of the new commands also
  exit 2 (`exitOverride` on those commands only). Runtime errors use the
  existing `handleCliFailure` (exit 1, JSON envelope in `--json`).
- D9: The pi extension has no dependency on pi packages. It declares the few
  members it uses (`pi.on`, `pi.exec`, `ctx.sessionManager.getSessionId()`,
  `ctx.cwd`) as a local type. `cli/tsconfig.json` includes
  `integrations/**/*.ts` so it is linted and type-checked; `package.json`
  `files` lists `integrations`.
- D10: Interactive prompts read one line from stdin. When stdin is not a TTY
  and no answer arrives, the prompt counts as "no" (`n` for confirm, `s` for
  scan). The feature tests drive commands through flags (`--yes`,
  `--yes-exact`, `--create`) and piped answers.
- D11: Pure helpers (`shq`, `slug`, resume rendering, ages, the where layout,
  hook parsing, settings merge, scan assignment) take their inputs and a `now`
  where needed, so unit tests need no clock, server or home directory.
- D12: The protected feature tests run the real `pgm` entrypoint through `tsx`
  against `createApp` on loopback with a real database, with `HOME`,
  `CLAUDE_CONFIG_DIR` and `PI_CODING_AGENT_DIR` in temporary directories and
  real git repositories there.

## Unknowns and stop conditions

- Stop if a command needs a server change or a new endpoint.
- Stop if `git` is not runnable in the worker sandbox; then the git slices get
  an injected command runner and the controller runs the git tests.

## Requirements

See `deltas/cli-hooks.json`.

## Acceptance criteria

- C1: `pgm here` (flag and hook mode) reports the workspace and session,
  prints the SessionStart feature line only when linked, honours the budget
  rules and always exits 0 in hook mode.
- C2: `pgm hooks install|uninstall` writes, replaces and removes only the
  postgram hook entries, handles `cleanupPeriodDays`, and `--pi` installs the
  extension with the placeholders replaced.
- C3: `pgm where` renders both views, the risks, sessions and resume line,
  runs the disk check, and `--json` adds `resume` and `transcript_gone`.
- C4: `pgm feature`, `pgm machine` and `pgm repo` call the documented
  endpoints, keep the marker in step on link and unlink, and print ids.
- C5: `pgm worktree new` resolves the feature, refuses an existing path or
  branch without side effects, creates the worktree and marker, reports it and
  prints only the path.
- C6: `pgm scan` finds worktrees and sessions with the documented assignment
  and cwd rules, proposes in order, records accepted ones with `source: scan`
  and lists known workspaces.
