# Research: Workspace & Agent-Session Tracking

Every item resolves an unknown from the plan's Technical Context. All sources were checked on 2026-10-31.

## R1. Where activity data lives

- **Decision**: dedicated tables (`machines`, `workspaces`, `agent_sessions`, `repositories`), created in migration `018_workspace_tracking.sql`. A feature stays a `task` entity, with `metadata.kind = 'feature'`.
- **Rationale**: `updateEntity` bumps `version` and writes an audit entry on every call. Content changes also reset enrichment. With ~10 sessions reporting on every turn, putting heartbeats on entities would bury real revisions and churn the optimistic-locking versions that agents depend on (FR-016, SC-006). Feature stage changes are rare and meaningful, so they belong on the versioned entity. A metadata-only update does not re-embed (`enrichment_status` only goes to `pending` when the content changes; see `entity-service.ts` updateEntity).
- **Alternatives considered**:
  - New entity types `workspace`/`session`: rejected because of version and audit churn, and because session rows have no semantic content worth embedding.
  - JSON blobs in the feature metadata: rejected because of the same churn, and it cannot represent unlinked workspaces.

## R2. Claude Code integration

Source: https://code.claude.com/docs/en/hooks.md, https://code.claude.com/docs/en/sessions.md, https://code.claude.com/docs/en/cli-reference.md.

- **Decision**: register command hooks running `pgm here --hook` with `timeout: 5` on four events:

  | Hook event | `pgm here` event |
  |------------|------------------|
  | `SessionStart` (matcher `startup,resume,clear,compact,fork`) | `start` |
  | `UserPromptSubmit` | `activity` |
  | `Stop` | `stop` |
  | `SessionEnd` | `end` |

- **Facts relied on**:
  - The stdin JSON carries `session_id`, `cwd`, `hook_event_name`, `transcript_path`, plus `source` (SessionStart) and `reason` (SessionEnd). Git branch and worktree are not included, so they are derived from `cwd`.
  - `timeout` is in seconds. SessionEnd hooks share a 1.5 s budget by default, and a per-hook `timeout` raises it. Hence `timeout: 5` together with our own 2 s internal budget.
  - Exit code `2` on `Stop` prevents stopping and continues the turn. `pgm here --hook` must **always exit 0**.
  - Plain stdout from `SessionStart` is added to Claude's context. We print nothing, or exactly one line naming the linked feature, which is useful context for the agent. Every other event prints nothing.
  - Resume fires `SessionStart` with `source: "resume"` and the **same** `session_id`, so the upsert is keyed on the session id. `/clear` gives a new session id.
  - `SessionEnd` is not guaranteed on a crash or SIGKILL. Boot-id detection (R6) covers reboots, and dormancy covers everything else.
  - `claude --resume <id>` works from any directory, but we still `cd` into the worktree so the shell and tools start there.
- **Alternatives considered**: `async: true` hooks were rejected because their timeout is not enforced and they can pile up. A synchronous hook with a hard 2 s internal budget is predictable.

## R3. pi integration

Source: `github.com/badlogic/pi-mono` at `e4adba9`, `packages/coding-agent/docs/extensions.md`, `session-format.md`, `cli.md`, and `src/core/extensions/runner.ts`. The npm package is now `@earendil-works/pi-coding-agent`. Legacy `@mariozechner/*` imports are still mapped.

- **Decision**: ship `cli/integrations/pi/postgram.ts` (inside the CLI package, listed in its `files`). `pgm hooks install --pi` copies it to `~/.pi/agent/extensions/postgram.ts`, or under `$PI_CODING_AGENT_DIR` when set. Event mapping:

  | pi event | `pgm here` event |
  |----------|------------------|
  | `session_start` | `start` |
  | `turn_end` (throttled to 1 per 60 s) | `activity` |
  | `agent_settled` | `stop` |
  | `session_shutdown` | `end` |

- **Facts relied on**:
  - Event payloads carry no session id. Read `ctx.sessionManager.getSessionId()` and `ctx.cwd` freshly in each handler.
  - Handlers are awaited one after another. For `activity`/`stop`, use fire-and-forget (`void pi.exec('pgm', [...], { timeout: 5000 }).catch(() => {})`). On `session_shutdown`, await it (with a timeout), because that is awaited before exit.
  - The extension is re-created on `/new`, `/resume` and `/fork`, so it keeps no in-memory state.
  - Resume is `pi --session <id>`, which runs in the session's own cwd.
  - Sessions live in `~/.pi/agent/sessions/--<cwd with / → ->--/<ts>_<id>.jsonl`. The header line contains `id` and `cwd`.
- **Alternatives considered**: calling the HTTP API directly from the extension was rejected because it would duplicate git resolution and config loading. Shelling out to `pgm here` keeps one code path.

## R4. Transcript retention (risk found during research)

- **Finding**: Claude Code deletes files under `~/.claude/projects/<project>/` that are older than `cleanupPeriodDays`, which **defaults to 30 days**. The user regularly comes back to sessions after weeks, so `claude --resume` can fail even though Postgram still knows the session.
- **Decision**:
  1. `pgm hooks install` offers to set `cleanupPeriodDays` to 365, with explicit confirmation, shown in the diff.
  2. On the local machine, `pgm where` checks whether the transcript exists. When it is gone, it shows `transcript gone` and prints a fresh `claude` start instead of `--resume`.
  3. The dormancy default of 30 days lines up with Claude's default retention, so "dormant" also hints that the transcript may be expiring.
- **Alternatives considered**: backing up transcripts into Postgram was rejected for phase 1 because of size and privacy. It is noted as a possible follow-up.

## R5. Resume command templates

- **Decision**: default templates, which the user can override in `~/.pgmrc` under `resume`:

  | Agent | With session id | Without |
  |-------|-----------------|---------|
  | `claude-code` | `claude --resume {session_id}` | `claude` |
  | `pi` | `pi --session {session_id}` | `pi` |
  | `talon` | — | — (only `cd`) |
  | `other` | — | — (only `cd`) |

- **Full command**: `ssh -t {connect_target} '{cd_and_resume}'` for a remote machine, or `{cd_and_resume}` for the local one. Paths and ids are POSIX single-quote escaped.
- **Rationale**: the server returns data only. Resume rendering is a presentation concern that depends on the local machine and user templates, so it lives in the CLI (Constitution II still holds: no domain rules move into the CLI).

## R6. Reboot detection

- **Decision**: every report includes a boot id:
  - Linux: `/proc/sys/kernel/random/boot_id`.
  - macOS: `sysctl -n kern.boottime`, i.e. the `{ sec = …, usec = … }` part, hashed.

  If neither is available, send `null`; reboot detection is then disabled for that machine (spec edge case).
- **Server rule**: when a report arrives with a boot id that differs from the stored non-null one, every `running` or `idle` session on that machine whose `boot_id` differs is set to `interrupted`, with `end_reason = 'reboot'`, in the same transaction.
- **Alternatives considered**: comparing uptime was rejected because it is fragile with clock changes. Process liveness checks were rejected because they only work locally.

## R7. Git state resolution

All commands run with `cwd`, `GIT_OPTIONAL_LOCKS=0` (so `git status` never takes the index lock while an agent works), and a 500 ms per-command timeout.

| Data | Command |
|------|---------|
| Worktree root | `git rev-parse --show-toplevel` |
| Main repo root | `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` |
| Branch | `git symbolic-ref --short -q HEAD` (empty means detached, recorded as `null`) |
| Remote | `git remote get-url origin`, normalized: strip the scheme, user and `.git`, and turn `host:owner/repo` into `host/owner/repo`, lowercased host |
| Dirty count | `git status --porcelain=v1 --untracked-files=normal`, counting lines |
| Upstream and unpushed | `git rev-list --count @{upstream}..HEAD`. When there is no upstream, `has_upstream = false` and `git rev-list --count HEAD --not --remotes` |

- **Rationale**: the counts are cheap. `GIT_OPTIONAL_LOCKS=0` avoids index-lock contention with the agent running in the same worktree.

## R8. Feature identification from branch and marker

- **Decision**:
  - Marker file `.postgram/feature.json`, next to `.postgram/.gitignore` containing `*`, which makes the directory self-ignoring and needs no edit to `.gitignore` or `info/exclude`.
  - Branch pattern `feat/<8-hex short id>-<slug>`.
  - Matching regex: `(?:^|/)([0-9a-f]{8})(?:-|$)`.
  - A short id resolves through a new service lookup on `id::text LIKE $1 || '%' AND type = 'task'`, and must be unique.
- **Alternatives considered**: writing to `$GIT_COMMON_DIR/info/exclude` was rejected because it is shared by all worktrees and touches the user's repository config.

## R9. Bootstrap scan: finding sessions per worktree

- **Decision**: never decode project-directory names. The Claude encoding replaces every non-alphanumeric character with `-`, so it is lossy. Instead, encode each known worktree path forward and check whether the directory exists:
  - Claude: `~/.claude/projects/<path.replace(/[^a-zA-Z0-9]/g,'-')>/*.jsonl`. Paths whose encoding is longer than 200 characters are truncated with a hash, so skip them with a note.
  - pi: `~/.pi/agent/sessions/--<path without leading / with / → ->--/*.jsonl`. Read the header line for the id.
- The session id is the file stem for Claude, and `<ts>_<id>` for pi. Last activity comes from the file's mtime.
- `CLAUDE_CONFIG_DIR` and `PI_CODING_AGENT_DIR` are respected.

## R10. Audit volume vs. the "audit everything" constraint

- **Decision**: audit structural changes only:
  - machine created
  - workspace created
  - link changed
  - session created
  - session ended or interrupted
  - stage changed
  - PR added
  - repository setting changed

  Pure activity refreshes are not audited.
- **Rationale**: auditing every heartbeat would add tens of thousands of rows per month carrying no forensic value, which drowns the audit log. Recorded as a waiver in plan.md Complexity Tracking.

## R11. Server configuration

- **Decision**: one new server setting, `WORKSPACE_DORMANT_AFTER_DAYS` (default `30`, integer ≥ 1). Per CLAUDE.md, it is added in the same change to:
  - `src/config.ts`
  - `.env.example`
  - `docker-compose.yml` (environment pass-through)
  - the README configuration table
  - deployment docs

  Everything else is CLI-side in `~/.pgmrc`.
