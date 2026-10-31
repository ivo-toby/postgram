# CLI Contract: Workspace & Agent-Session Tracking

New commands in `pgm` (package `@ivotoby/postgram-cli`). Every command except `here` honours the existing `--json` mode.

## pgm here

```text
pgm here [--agent claude-code|pi|talon|other] [--session-id <id>]
         [--event start|activity|stop|end] [--reason <text>]
         [--hook] [--quiet]
```

- **`--hook`**: reads the Claude Code hook JSON from stdin and maps it:
  - `session_id` → `--session-id`
  - `cwd` → working directory
  - `reason` or `source` → `--reason`
  - `hook_event_name` → event: `SessionStart` → `start`, `UserPromptSubmit` → `activity`, `Stop` → `stop`, `SessionEnd` → `end`

  `--agent` defaults to `claude-code`.
- **Resolves locally**:
  - machine alias, and boot id (Linux: `/proc/sys/kernel/random/boot_id`; macOS: `sysctl -n kern.boottime`)
  - worktree root, main repo root, normalized remote, branch
  - dirty count, unpushed count, upstream presence
  - the feature marker
- **Budget**: the whole run stays under `here_timeout_ms` (default 2000) (FR-020).
- **Exit code**: always exits `0` in `--hook` mode, so it can never block a `Stop` hook and never shows an error.
- **Failures** go to `~/.pgm/here.log`, which is rotated at 1 MB.
- **Stdout**:
  - Empty for every event except `SessionStart` with a linked feature. Then it prints one line, which Claude Code adds to the agent's context:
    `Postgram: this worktree belongs to feature <short-id> "<title>" (stage: <stage>).`
  - `--quiet` suppresses even that line.
  - Without `--hook`, prints a human summary.

## pgm hooks install

```text
pgm hooks install [--settings <path>] [--yes] [--keep-transcripts <days>]
```

- Adds `SessionStart`, `UserPromptSubmit`, `Stop` and `SessionEnd` command hooks that run `pgm here --hook` to `~/.claude/settings.json`, or to `$CLAUDE_CONFIG_DIR/settings.json` when that is set.
- Uses `timeout: 5` on each hook. This also raises the SessionEnd budget beyond the 1.5 s default.
- Is idempotent: existing `pgm here` entries are replaced, never duplicated.
- Shows a diff and asks before writing unless `--yes` (FR-021).
- Offers to raise `cleanupPeriodDays`, default proposal 365, so old sessions stay resumable. See research R4.

`pgm hooks uninstall` removes only the entries it added.

## pgm worktree new

```text
pgm worktree new <feature-id|short-id|"new title"> [--base <ref>] [--path <dir>] [--create]
```

- Must run inside a git repository.
- Creates the branch `feat/<short-id>-<slug>` from `--base` (default: the current branch's upstream default, falling back to `HEAD`) in `<worktree_root>/<short-id>-<slug>`.
- Writes `.postgram/feature.json` and `.postgram/.gitignore`, then calls the report endpoint (FR-023, FR-024).
- A title that matches no feature requires `--create` or an interactive confirmation (US4-2).
- Refuses an existing path or branch with exit code `2` and changes nothing (FR-025).
- Prints the path, so `cd "$(pgm worktree new …)"` works.

## pgm where

```text
pgm where [--actions] [--machine <alias>] [--repo <remote>]
          [--all] [--include-ended] [--json]
```

- Default: grouped by stage. `--actions` groups by human action (FR-026, FR-031).
- `--all` includes released features (FR-033).
- Before rendering, checks every workspace on the local machine (existence of the path) and PATCHes `missing` when it changed (FR-030).
- Per workspace prints the machine, path, branch, age of the last activity, git state with its age, risk flags, and the session list.
- Prints `resume:` for the most recent non-ended session (FR-028):

  ```text
  ssh -t <connect_target> 'cd <path> && <resume-template>'   # remote machine
  cd <path> && <resume-template>                              # local machine
  ```

- On the local machine, a Claude Code session whose transcript file no longer exists is shown as `transcript gone` and gets a plain `claude` start instead of `--resume`.
- Phone-friendly layout: each workspace takes at most 3 lines and fits in 60 columns. The resume command goes on its own line.

## pgm scan

```text
pgm scan [--root <dir>]... [--depth <n>] [--yes-exact] [--dry-run]
```

- Roots come from `--root` or `scan_roots` in `~/.pgmrc`. Repositories are found up to `--depth` (default 3).
- For each repository, reads `git worktree list --porcelain`.
- For each worktree, finds Claude Code sessions by computing the encoded project-directory name of the path under `~/.claude/projects/` (it never decodes directory names), and pi sessions under the pi session dir.
- Proposes a feature in this order: marker → short id in branch → top-3 search hits on the branch slug (FR-035).
- Prompts per worktree: `[a]ccept`, `[1-3]` pick a hit, `[n]ew feature`, `[s]kip`.
- `--yes-exact` auto-accepts marker and short-id matches only (FR-036).
- `--dry-run` records nothing.
- Recorded sessions get status `idle`, with `last_activity_at` set from the transcript file's mtime.
- Already-known workspaces are listed as `known` (FR-037).

## pgm feature

```text
pgm feature add "<title>" [--tags a,b] [--visibility personal|work|shared]
pgm feature stage <id> <stage>
pgm feature pr <id> <url> [--state open|merged|closed]
pgm feature link <id> [--path <dir>]     # link the cwd's (or path's) workspace
pgm feature unlink [--path <dir>]
```

## pgm machine

```text
pgm machine set [--alias <alias>] [--connect <ssh-target>]
pgm machine list
```

`machine set` writes `~/.pgmrc` and PUTs `connect_target` to the server.

## pgm repo

```text
pgm repo set <remote> --release-on-merge true|false
```
