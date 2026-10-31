# Data Model: Workspace & Agent-Session Tracking

**Feature**: 004-workspace-session-tracking
**Migration**: `src/db/migrations/018_workspace_tracking.sql`. It is forward-only, needs no backfill, and does not touch the `entities` table.

## Overview

```text
entities (type='task', metadata.kind='feature')   ← existing, semantic, versioned
   ▲ feature_id (nullable, ON DELETE SET NULL)
   │
workspaces ──► machines
   ▲
   │ workspace_id (ON DELETE CASCADE)
agent_sessions

repositories  (keyed by normalized remote, per-repo settings)
```

Machines, workspaces, agent sessions and repositories are **operational records**, not knowledge entries. They have no version column, no chunks and no embeddings, and are never picked up by extraction. Writing to them never touches `entities` (FR-016, SC-006).

---

## Feature (existing `entities` row)

A feature is a `task` entity whose metadata carries these keys. No schema change is needed.

| Key | Type | Rules |
|-----|------|-------|
| `kind` | `'feature'` | Marks the task as a feature (FR-001). |
| `stage` | enum | `building` · `review` · `functional_test` · `ready_to_merge` · `awaiting_release` · `released`. Defaults to `building` when `kind` is set without a stage (FR-002). |
| `stage_source` | `'manual' \| 'derived'` | Who set the current stage. |
| `stage_set_at` | ISO timestamp | When the stage last changed. |
| `pull_requests` | array of `{ url, state, updated_at }` | `state` ∈ `open` · `merged` · `closed`. Unique by `url` (FR-004). |

Stage changes go through `updateEntity`. That bumps the version and writes an audit entry, but the content is unchanged, so there is no re-embedding. The service does the version read-modify-write internally, with one retry on conflict, so agents never need to pass a version for stage or PR updates.

### Stage transitions

Manual moves (FR-003) can go from any stage to any stage and set `stage_source = 'manual'`.

Derived moves (FR-005) only go forward and only fire on these PR events:

| Event | From | To |
|-------|------|----|
| PR `open` added or reported | `building` | `review` |
| PR `merged` | any stage before `awaiting_release` | `awaiting_release`, or `released` if the repository has `release_on_merge` |
| PR `closed` (not merged) | – | no change |

A derived move is skipped when it would not move the stage forward in the order above. A forward derived move is still allowed after a manual stage: for example, a manual `functional_test` followed by a PR merge goes to `awaiting_release`.

Stage order: `building < review < functional_test < ready_to_merge < awaiting_release < released`.

Reaching `released` never changes the task `status` (FR-006).

---

## machines

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `alias` | text NOT NULL UNIQUE | Configured alias, falling back to the hostname (FR-007). Lowercase, `[a-z0-9._-]{1,64}`. |
| `hostname` | text NOT NULL | The last reported hostname. |
| `connect_target` | text NULL | Used in resume commands. NULL means use the alias (FR-011). |
| `boot_id` | text NULL | The last reported boot identifier (FR-014). |
| `last_seen_at` | timestamptz NOT NULL | Server time of the last report. |
| `created_at`, `updated_at` | timestamptz | |

Machines are upserted by `alias` on every report.

## workspaces

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | |
| `machine_id` | uuid NOT NULL FK → machines | |
| `path` | text NOT NULL | Absolute, normalized, with no trailing slash. This is the worktree root when inside git, otherwise the cwd. |
| `repo_remote` | text NULL | Normalized remote identity, e.g. `github.com/ivo-toby/postgram`. |
| `repo_root` | text NULL | The main worktree path, from `git rev-parse --git-common-dir`. |
| `branch` | text NULL | NULL when detached or not a git repo. |
| `git_dirty_count` | int NULL | Uncommitted entries, counting both modified and untracked files. |
| `git_unpushed_count` | int NULL | Commits ahead of upstream, or not on any remote when there is no upstream. |
| `git_has_upstream` | boolean NULL | |
| `git_state_at` | timestamptz NULL | When the git snapshot was taken. Server time. |
| `feature_id` | uuid NULL FK → entities ON DELETE SET NULL | At most one feature (FR-009). Must reference a `task`. |
| `missing_since` | timestamptz NULL | Set when a local check finds the path gone. Cleared when the workspace reports again (FR-030). |
| `last_activity_at` | timestamptz NOT NULL | |
| `created_at`, `updated_at` | timestamptz | |

- Unique on `(machine_id, path)`.
- Indexes on `feature_id` and `repo_remote`.

**Visibility** (FR-040) is computed, not stored. A linked workspace follows its feature's visibility. An unlinked workspace counts as `personal`. Reads filter on `auth.allowedVisibility`.

## agent_sessions

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | |
| `workspace_id` | uuid NOT NULL FK → workspaces ON DELETE CASCADE | |
| `agent_kind` | text NOT NULL | CHECK in `claude-code` · `pi` · `talon` · `other` |
| `agent_session_id` | text NULL | The agent's own id. |
| `status` | text NOT NULL | CHECK in `running` · `idle` · `ended` · `interrupted` (FR-013) |
| `boot_id` | text NULL | The machine boot id when the session last reported. |
| `started_at` | timestamptz NOT NULL | |
| `last_activity_at` | timestamptz NOT NULL | |
| `ended_at` | timestamptz NULL | |
| `end_reason` | text NULL | Free text from the hook (e.g. `logout`, `clear`), or `reboot` when set by boot detection. |

- Partial unique index on `(workspace_id, agent_kind, agent_session_id) WHERE agent_session_id IS NOT NULL`.
- Index on `(status)` and on `(workspace_id, last_activity_at DESC)`.

**Dormant** (FR-015) is computed at read time: `status IN ('running','idle') AND last_activity_at < now() - DORMANT_AFTER`. It is never stored.

### Session state machine

```text
            start/activity             stop
   (new) ───────────────► running ───────────► idle
                            ▲  │                 │
                 activity   │  │ end             │ end
                 /start     │  ▼                 ▼
                            └── idle         ended
   running|idle ──(boot_id changed on machine)──► interrupted
   interrupted ──(same agent_session_id reports again)──► running
   ended       ──(same agent_session_id reports start again, e.g. resume)──► running
```

Events: `start` and `activity` set `running`, `stop` sets `idle`, `end` sets `ended` and records `ended_at` and `end_reason`.

## repositories

| Column | Type | Rules |
|--------|------|-------|
| `remote` | text PK | Normalized remote identity. |
| `release_on_merge` | boolean NOT NULL DEFAULT false | Used by derived stage moves (FR-005). |
| `updated_at` | timestamptz | |

---

## Report transaction (FR-014, FR-017)

One `POST /api/workspaces/report` runs inside a single transaction:

1. Upsert the machine by `alias` and read the previous `boot_id`.
2. If the reported `boot_id` differs from the previous non-null value, mark every `running` or `idle` session on that machine whose `boot_id` differs as `interrupted`, with `end_reason = 'reboot'`. Return the count.
3. Upsert the workspace by `(machine_id, path)`, refresh its git snapshot, set `last_activity_at = now()` and clear `missing_since`.
4. Set or keep the feature link:
   - If `feature_id` came from a marker, set it. The feature must exist, be a `task`, and be visible to the caller. Otherwise the link stays as it is and the response carries a warning.
   - If no `feature_id` was reported, keep the existing link (FR-019).
5. If the report includes a session, upsert it by `(workspace_id, agent_kind, agent_session_id)` and apply the event transition. A session without an id gets a new row on `start`. On later events it updates the most recent id-less session of that kind in the workspace.
6. Write an audit entry only when something structural changed: a new machine, new workspace, link change, new session, `ended`, or `interrupted`. Pure activity refreshes write no audit entry. See the Complexity Tracking section in plan.md.

## Local-only data (CLI)

The following lives only in `~/.pgmrc`, a JSON file that already exists. New optional keys:

| Key | Type | Default |
|-----|------|---------|
| `machine.alias` | string | the hostname, lowercased |
| `machine.connect_target` | string | the alias |
| `scan_roots` | string[] | `[]` (`pgm scan` asks for at least one) |
| `worktree_root` | string | `<repo_root>.worktrees` |
| `resume` | `{ [agentKind]: string }` | see research.md R5 |
| `here_timeout_ms` | number | `2000` |

**Feature marker**: `<worktree>/.postgram/feature.json`

```json
{ "feature_id": "uuid", "created_at": "ISO" }
```

It sits next to `<worktree>/.postgram/.gitignore`, which contains `*`, so the directory ignores itself and is never committed (FR-024).
