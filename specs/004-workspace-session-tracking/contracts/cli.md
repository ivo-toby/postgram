# CLI Contract: Workspace & Agent-Session Tracking

New commands in `pgm` (package `@ivotoby/postgram-cli`).

## General rules

- **Output**: every command except `here` honours the existing `--json` mode. Prompts and messages go to **stderr**. Data goes to stdout.
- **Exit codes**:

  | Code | Meaning |
  |------|---------|
  | `0` | success |
  | `1` | runtime error (server error, not in a git repo, ambiguous match) |
  | `2` | usage error or refused operation (bad flags, path or branch already exists) |

  `pgm here` has its own rule (below).
- **Configuration**: `~/.pgmrc` is nested JSON. Credentials (`api_url`, `api_key`) keep their existing precedence: environment `PGM_API_URL`/`PGM_API_KEY` first, then `~/.pgmrc`. The new keys below are **always** read from `~/.pgmrc`, wherever the credentials came from.

  ```json
  {
    "api_url": "…", "api_key": "…",
    "machine": { "alias": "codebox", "connect_target": "codebox" },
    "scan_roots": ["~/src", "~/wt"],
    "worktree_root": null,
    "here_timeout_ms": 2000,
    "resume": {
      "claude-code": { "with_id": "claude --resume {session_id}", "without_id": "claude" },
      "pi":          { "with_id": "pi --session {session_id}",     "without_id": "pi" },
      "talon":       { "with_id": null, "without_id": null },
      "other":       { "with_id": null, "without_id": null }
    }
  }
  ```

  | Key | Default |
  |-----|---------|
  | `machine.alias` | `os.hostname()` lowercased, cut at the first `.`, with characters outside `[a-z0-9._-]` replaced by `-` |
  | `machine.connect_target` | the alias |
  | `worktree_root` | `null`, meaning `<repo_root>.worktrees` |
  | `resume` | the values shown above. User values are merged per agent kind and per field |

  `~` is expanded in paths.

## Shared helpers (unit-tested with these exact vectors)

### `shq(s)`

POSIX single-quote escaping: `"'" + s.replaceAll("'", "'\\''") + "'"`.

### `slug(title)`

```js
title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'feature'
```

Example: `"Keyword rank fusion!"` → `"keyword-rank-fusion"`.

### Resume rendering (FR-028)

Input: a workspace object (rest.md) and the local machine alias.

1. **Directory**: `dir = resume_session.cwd` when it equals `path` or lies under `path + '/'`. Otherwise `dir = path`.
2. **Template**:
   - Use `with_id` when `resume_session` is not null, `with_id` is not null, and the transcript is not known to be gone. Replace `{session_id}` with `shq(agent_session_id)`.
   - Otherwise use `without_id` for the agent kind of `resume_session`, or `claude-code` when it is null.
   - When the chosen template is null, render only the `cd`.
3. **Local command**: `local = "cd " + shq(dir) + (tpl ? " && " + tpl : "")`.
4. **Remote or local**: the workspace's `machine` equals the local alias → print `local`. Otherwise → `"ssh -t " + connect_target + " " + shq(local)`.
5. **Transcript gone**: known only on the local machine. It applies when `resume_session.agent_kind === 'claude-code'`, `transcript_path` is non-null, and that file does not exist.

| Case | Output |
|------|--------|
| Local, claude-code, id `8f3c`, path `/w/a` | `cd '/w/a' && claude --resume '8f3c'` |
| Remote `codebox`, path `/home/ivo/wt/a b`, id `x'y` | `ssh -t codebox 'cd '\''/home/ivo/wt/a b'\'' && claude --resume '\''x'\''\'\'''\''y'\'''` |
| Remote shell receives (verified) | `cd '/home/ivo/wt/a b' && claude --resume 'x'\''y'` |
| Local, talon session, path `/w/a` | `cd '/w/a'` |
| Local, claude-code, transcript gone | `cd '/w/a' && claude` |

---

## pgm here

```text
pgm here [--agent claude-code|pi|talon|other] [--session-id <id>]
         [--event start|activity|stop|end] [--reason <text>]
         [--cwd <dir>] [--transcript <path>] [--hook] [--quiet]
```

### Inputs

**In `--hook` mode**, the Claude Code hook JSON is read from stdin. Stdin values override flags, and stdin `cwd` overrides the process cwd. `--agent` defaults to `claude-code`.

| Hook field | Becomes |
|------------|---------|
| `session_id` | `--session-id` |
| `cwd` | `--cwd` |
| `transcript_path` | `--transcript` |
| `source` (SessionStart) or `reason` (SessionEnd) | `--reason` |

| `hook_event_name` | Event |
|-------------------|-------|
| `SessionStart` | `start` |
| `UserPromptSubmit` | `activity` |
| `Stop` | `stop` |
| `SessionEnd` | `end` |
| anything else | exit 0, no report |

Invalid or empty stdin also means exit 0 with no report, plus a log line.

**Without `--hook`**:

- No `--session-id` and no `--event` → a workspace-only report (no session).
- Otherwise a session is sent, with `--event` defaulting to `activity` and `--agent` to `claude-code`.

### Local resolution

Details are in research R6, R7 and R8.

| Item | How |
|------|-----|
| Machine | alias and hostname from config, boot id (`null` when unavailable) |
| Workspace path | `realpath(git worktree root)`, or `realpath(cwd)` outside git |
| Git data | remote, repo root, branch, git counts |
| Feature | the marker file |

### Time budget (FR-020)

- Git resolution gets a total of **800 ms**. Any git value not resolved in time makes the CLI **omit** the `git` key (unknown), rather than sending `null`.
- The HTTP call gets `here_timeout_ms − elapsed − 100 ms`, with a minimum of 100 ms.

### Exit code and output

- **Exit code**: server errors, timeouts and missing config are logged to `~/.pgm/here.log` (rotated at 1 MB, one line per failure). The command still exits **0** in every mode. Only bad flags outside `--hook` mode exit 2.
- **Stdout in `--hook` mode** is empty, with one exception: on `SessionStart` with a linked, visible feature, it prints exactly one line, which Claude Code adds to the agent's context:

  ```text
  Postgram: this worktree belongs to feature <8-hex> "<title>" (stage: <stage>).
  ```

  `--quiet` suppresses it.
- **Stdout without `--hook`**: one human line, for example `registered codebox:/w/a → feature 1a2b3c4d (review)` or `registered codebox:/w/a (unassigned)`. Nothing on timeout.

## pgm hooks install / uninstall

```text
pgm hooks install [--settings <path>] [--yes] [--keep-transcripts <days>] [--pi]
pgm hooks uninstall [--settings <path>] [--pi]
```

**Settings file**: `--settings`, else `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`. It is created if absent.

**Hook command**:

```text
<shq(process.execPath)> <shq(realpath(process.argv[1]))> here --hook
```

The absolute `node` path is used because hook processes may lack `PATH` (nvm, Homebrew).

**Hook entries**:

- One per event: `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`.
- Each has `{ "type": "command", "command": <cmd>, "timeout": 5 }`.
- No matcher, so they match all sources.

**Idempotency**: an existing hook entry whose `command` contains `pgm` and matches `/\bhere --hook\b/` is replaced, never duplicated. Other hooks are left untouched.

**Transcript retention**: `--keep-transcripts <days>` proposes `cleanupPeriodDays = <days>`. Without the flag, the installer proposes 365 interactively. It never lowers an existing larger value. `--yes` without `--keep-transcripts` does **not** change retention.

**Confirmation**: the installer shows a unified diff on stderr and asks before writing, unless `--yes`.

**Credentials warning**: if `~/.pgmrc` lacks `api_url` or `api_key`, the installer warns on stderr, because hooks may not inherit `PGM_API_*`.

**`--pi`**:

- Copies `integrations/pi/postgram.ts` from the CLI package to `${PI_CODING_AGENT_DIR:-~/.pi/agent}/extensions/postgram.ts`, overwriting a file with that name.
- The copy embeds the same absolute `pgm` command.

**Uninstall** removes only entries matching the idempotency rule, or the extension file with `--pi`.

## pgm worktree new

```text
pgm worktree new <feature> [--base <ref>] [--path <dir>] [--create]
```

**Resolving `<feature>`**, in this order:

1. Full UUID.
2. `^[0-9a-f]{8}$` as a short id.
3. Case-insensitive exact title match among non-archived tasks with `kind = feature`.

More than one match → exit 1, listing the candidates on stderr. No match → needs `--create`, or a `y` answer to the interactive prompt; otherwise exit 1.

**Base**: `--base`, else `refs/remotes/origin/HEAD` if it exists, else `HEAD`.

**Branch and path**:

- Branch: `feat/<8-hex>-<slug(title)>`.
- Path: `--path`, else `<worktree_root>/<8-hex>-<slug>`.

**Order of side effects** (FR-025, "changes nothing"):

1. Must be inside a git repo, else exit 1.
2. If the path exists or the branch exists → exit 2, with nothing created.
3. Create the feature (only when `--create` was used or confirmed).
4. `git worktree add -b <branch> <path> <base>`.
5. Write `.postgram/feature.json` and `.postgram/.gitignore`.
6. Report as a workspace-only report with `feature_id`.

A report failure in step 6 keeps the worktree, warns on stderr, and exits 0.

**Stdout** is only the absolute path, so `cd "$(pgm worktree new …)"` works.

## pgm where

```text
pgm where [--actions] [--machine <alias>] [--repo <remote>]
          [--all] [--include-ended] [--json]
```

**Flags**:

- `--actions` sets `view=actions`.
- `--all` sets both `include_released` and `include_done`.
- `--include-ended` passes `include_ended`.

**Local disk check** (FR-030): before rendering, for each workspace on the local machine:

- If the path does not exist and `missing_since` is null → `PATCH {missing:true}`.
- If the path exists and `missing_since` is set → `PATCH {missing:false}`.

Then render the refreshed data.

**`--json`** prints the server response with `resume` added to each workspace (the rendered string) and `transcript_gone: boolean`.

**Human layout** (phone-friendly):

- Group header: `== <Label> (<n>) ==`. Empty groups are skipped in human mode.
- Feature line: `<8-hex> <title>  [<stage>]` plus ` PR:<state>` for each PR.
- Per workspace:
  - Line 1: `  <machine>  <branch|->  <risks joined by ' '>`
  - Line 2: `  <path>  <latest session agent_kind>/<status> <age>`. The age looks like `3h` or `12d`; add ` dormant` when dormant, or ` transcript gone`.
  - Line 3: `  resume: <rendered command>`
- Lines 1–2 are cut with `…` to 60 columns. Line 3 is never cut.
- Ages use `m` under 1 hour, `h` under 48 hours, otherwise `d`.

## pgm scan

```text
pgm scan [--root <dir>]... [--depth <n>] [--yes-exact] [--dry-run]
```

**Roots**: from `--root`, else `scan_roots`. When neither is set → exit 2, with a hint.

**Finding worktrees**: a directory is a repository when it contains `.git`. Discovery stops descending at a repository, uses `--depth` (default 3), and skips `node_modules` and dot-directories. For each repository it runs `git worktree list --porcelain`, and each worktree is deduplicated by realpath.

**Finding sessions** (never decode directory names; see research R9):

- **Claude**: let `enc(p) = p.replace(/[^a-zA-Z0-9]/g, '-')`. Search the directory `~/.claude/projects/<enc(worktree)>` and every directory whose name starts with `enc(worktree) + '-'`, which covers sessions launched in a subdirectory. Each `*.jsonl` file is a session: id = file stem, `observed_at` = mtime, `transcript_path` = the file.
- **pi**: the directory is `~/.pi/agent/sessions/--<worktree without leading '/', with '/' → '-'>--/`. Each `*.jsonl` file is a session: id from the header line `id`, `cwd` from the header line `cwd`, `observed_at` = mtime.

**Proposals** (FR-035), in this order:

1. The marker.
2. A unique short id in the branch.
3. The top 3 search hits for `slug(branch without 'feat/')` among tasks.

**Prompt** per worktree, on stderr: `[a]ccept`, `[1-3]` pick a hit, `[n]ew feature` (titled from the branch slug, with `-` → space), `[s]kip`.

**Flags**:

- `--yes-exact` auto-accepts marker and unique-short-id proposals, and skips the rest (FR-036).
- `--dry-run` sends nothing.

**Recording**: an accepted worktree is sent as one report with `source: "scan"`, `feature_id`, and `sessions: [...]`. Accepting also writes the marker.

**Known workspaces**: worktrees already registered on this machine are found by fetching `GET /api/workspaces?machine=<alias>` first. They are listed as `known` and not prompted (FR-037).

## pgm feature

```text
pgm feature add "<title>" [--tags a,b] [--visibility personal|work|shared]   # prints id
pgm feature stage <id> <stage>
pgm feature pr <id> <url> [--state open|merged|closed]                       # --state defaults to open
pgm feature link <id> [--path <dir>]
pgm feature unlink [--path <dir>]
```

`<id>` accepts a UUID or an 8-hex short id.

**`link` / `unlink`**:

1. Resolve the workspace by lookup with (local alias, realpath of `--path` or cwd). If there is no workspace yet, send a workspace-only report first.
2. PATCH `feature_id`.
3. Rewrite the marker (`link`) or delete it (`unlink`), so the next hook report keeps the change (FR-010 and FR-019).

## pgm machine

```text
pgm machine set [--alias <alias>] [--connect <target>]
pgm machine list
```

**`set`**:

1. Writes `~/.pgmrc`.
2. Sends a workspace-less registration so the machine exists. This is a report for `realpath(cwd)` with no session.
3. Sends `PUT /api/machines/:alias {connect_target}`.

Changing an existing alias prints a warning that history stays under the old alias.

**`list`** prints `GET /api/machines`.

## pgm repo

```text
pgm repo set <remote> --release-on-merge true|false
```
