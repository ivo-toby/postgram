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
| `stage` | enum | `building` · `review` · `functional_test` · `ready_to_merge` · `awaiting_release` · `released` (FR-002). |
| `stage_source` | `'manual' \| 'derived'` | Who set the current stage. |
| `stage_set_at` | ISO timestamp | When the stage last changed. |
| `pull_requests` | array of `{ url, state, updated_at }` | `url` is canonical (see rest.md). `state` ∈ `open` · `merged` · `closed`. Unique by `url` (FR-004). Always written as the full array, because the metadata merge in `updateEntity` is shallow. |

The **title** is derived, not stored:

```js
title = content.split('\n')[0].trim().slice(0, 80)
```

There is no ellipsis. Example: `"  Keyword rank fusion\nbody"` → `"Keyword rank fusion"`.

### Feature normalization in the generic task tools

`createTask` and `updateTask` (REST `/api/tasks`, MCP `task_create`/`task_update`) normalize the metadata whenever the resulting `metadata.kind === 'feature'`:

- **Defaults when absent**: `stage = 'building'`, `stage_source = 'manual'`, `stage_set_at = now`, `pull_requests = []`.
- **Invalid values**: a present but invalid `stage`, or malformed `pull_requests`, is rejected with 400 `VALIDATION`. Values are never coerced.
- **Stage changed through `updateTask`**: sets `stage_source = 'manual'` and `stage_set_at = now`.
- **No derivation**: `updateTask` never derives a stage.
- **Other tasks**: tasks without `kind = 'feature'` are untouched.

### Writes

Stage changes go through `updateEntity`. That bumps the version and writes an audit entry, but the content is unchanged, so there is no re-embedding (verified in `entity-service.ts`). The feature service does the version read-modify-write internally, with one retry on conflict, then fails with 409. Agents never pass a version for stage or PR updates.

### Stage transitions

Stage order: `building < review < functional_test < ready_to_merge < awaiting_release < released`.

**Manual moves** (FR-003) go from any stage to any stage, and set `stage_source = 'manual'`.

**Derived moves** (FR-005):

- Run only when a PR is new to the feature, or its stored state differs from the reported state.
- Only ever move forward.
- Set `stage_source = 'derived'`.

| PR change | Current stage | Result |
|-----------|---------------|--------|
| new or changed to `open` | `building` | `review` |
| new or changed to `open` | any other stage | unchanged |
| new or changed to `merged` | before `awaiting_release` | `awaiting_release`, or `released` when the PR's repository has `release_on_merge` |
| new or changed to `merged` | `awaiting_release` or `released` | unchanged |
| new or changed to `closed` | any stage | unchanged |
| same URL, same state | any stage | unchanged (only `updated_at` refreshes) |

A forward derived move is still allowed after a manual stage. For example, a manual `functional_test` followed by a PR merge goes to `awaiting_release`.

**Worked example**:

1. A PR is added as `open` → `review` (derived).
2. The user sets `building` by hand.
3. An agent re-reports the same PR as `open` → stays `building`, because the state did not change.
4. The PR is reported `merged` → `awaiting_release`.

**Repository for `release_on_merge`**: `github.com/<owner>/<repo>` taken from the PR URL. A missing `repositories` row means `false`.

**Status**: reaching `released` never changes the task `status` (FR-006).

---

## machines

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `alias` | text NOT NULL UNIQUE | Configured alias, falling back to the hostname (FR-007). Lowercase, `[a-z0-9._-]{1,64}`. |
| `hostname` | text NOT NULL | The last reported hostname. |
| `connect_target` | text NULL | Used in resume commands. NULL means use the alias (FR-011). |
| `boot_id` | text NULL | The last reported non-null boot identifier (FR-014). A report with a null boot id never overwrites it. |
| `last_seen_at` | timestamptz NOT NULL | Server time of the last report. |
| `created_at`, `updated_at` | timestamptz | |

Machines are upserted by `alias` on every report.

## workspaces

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid PK | |
| `machine_id` | uuid NOT NULL FK → machines | |
| `path` | text NOT NULL | Absolute real path (symlinks resolved, `fs.realpathSync`), with no trailing slash. This is the worktree root when inside git, otherwise the cwd. |
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
| `boot_id` | text NULL | The machine boot id of the session's last hook report. Always NULL for sessions created by `source: scan`. |
| `cwd` | text NULL | The directory the agent was launched in (from the hook). Used as the resume directory when it lies inside the workspace. |
| `transcript_path` | text NULL | The agent transcript file, used for the "transcript gone" check. |
| `started_at` | timestamptz NOT NULL | |
| `last_activity_at` | timestamptz NOT NULL | |
| `ended_at` | timestamptz NULL | |
| `end_reason` | text NULL | Free text from the hook (e.g. `logout`, `clear`), or `reboot` when set by boot detection. |

- Partial unique index on `(workspace_id, agent_kind, agent_session_id) WHERE agent_session_id IS NOT NULL`.
- Index on `(status)` and on `(workspace_id, last_activity_at DESC)`.

**Dormant** (FR-015) is computed at read time: `status IN ('running','idle') AND last_activity_at < now() - DORMANT_AFTER`. It is never stored.

### Session state machine

| Event / rule | Resulting status | Applies from |
|--------------|------------------|--------------|
| `start` | `running` | any status, or a new record |
| `activity` | `running` | any status, or a new record |
| `stop` | `idle` | any status, or a new record |
| `end` | `ended` | any status, or a new record |
| reboot rule (report step 2) | `interrupted` | `running` or `idle` with a non-null, different `boot_id` |

Events set the status regardless of the previous status (FR-013): `start` and `activity` set `running`, `stop` sets `idle`, `end` sets `ended` and records `ended_at` and `end_reason`. Any non-`end` event clears `ended_at` and `end_reason`. Every report also sets the session's `boot_id` to the reported value. Only the reboot rule sets `interrupted`.

## repositories

| Column | Type | Rules |
|--------|------|-------|
| `remote` | text PK | Normalized remote identity. |
| `release_on_merge` | boolean NOT NULL DEFAULT false | Used by derived stage moves (FR-005). |
| `updated_at` | timestamptz | |

---

## Report transaction (FR-012a, FR-014, FR-017, FR-019)

One `POST /api/workspaces/report` runs inside a single transaction. Machine and workspace use `INSERT … ON CONFLICT … DO UPDATE`. Session rows are locked with `SELECT … FOR UPDATE`.

Let **S** be the session identified by this report: the same `workspace_id`, `agent_kind` and `agent_session_id`. Session ids may repeat across agent kinds, so the agent kind is part of the key.

1. **Machine.** Upsert the machine by `alias`. Set `hostname` and `last_seen_at = now()`. Set `boot_id` only when the reported value is non-null **and** `source = 'hook'`.
2. **Reboot rule** (only when `source = 'hook'` and the reported `boot_id` is non-null). Every session on this machine with status `running` or `idle`, a non-null `boot_id` that differs from the reported one, **and that is not S**, becomes `interrupted`, with `end_reason = 'reboot'` and `ended_at = now()`. `interrupted_sessions` is the number of rows changed. Each change writes a `session_interrupt` audit entry.
3. **Workspace.** Upsert by `(machine_id, path)`. Set `repo_remote`, `repo_root` and `branch`, apply the git rule (`git: null` clears, an omitted key keeps, an object sets; see rest.md), and clear `missing_since`.
   - `last_activity_at`: `now()` for `source = 'hook'`. For `source = 'scan'` it is `GREATEST(existing, max(sessions[].observed_at))`, or `now()` on insert without sessions.
4. **Feature link.**
   - When `feature_id` is present and resolves to a visible `task`: set the link. A marker always wins (FR-019), and `pgm feature link/unlink` keeps the marker in sync. If the task is not yet a feature, apply the feature defaults.
   - When it is unknown or invisible: warning `feature_not_found`, link unchanged.
   - When it is not a task: warning `feature_not_task`, link unchanged.
   - When `feature_id` is absent: keep the existing link. A report never creates a feature.
5. **Session(s).**
   - **`source = 'hook'`, `agent_session_id` non-null**: upsert S. The event sets the status (table below). Set `last_activity_at = now()`, `boot_id` to the reported value, and `cwd` and `transcript_path` when non-null. A non-`end` event clears `ended_at` and `end_reason`. A new row has `started_at = now()`.
   - **`source = 'hook'`, `agent_session_id` null**: `start` always inserts a new row. Other events update the most recently active id-less row of the same `agent_kind` in this workspace, or insert one when none exists.
   - **`source = 'scan'`**: for each entry in `sessions`, upsert by the same key.
     - On insert: `status = 'idle'`, `boot_id = NULL`, `started_at = last_activity_at = observed_at`.
     - On an existing row: only `last_activity_at = GREATEST(existing, observed_at)` changes, plus `cwd` and `transcript_path` when they were null.
6. **Audit.** Write an entry only for structural changes: `machine_create`, `workspace_create`, `workspace_link` (link changed), `session_create`, `session_end` (transition into `ended`), and `session_interrupt` (step 2). Activity refreshes write nothing.

**Worked example (reboot)**:

- **Before**: sessions s1 and s2 on `strongbad` are `running` with boot `A`.
- **Report**: a hook report for s1 arrives with boot `B` and event `start`.
- **After**:
  - s2 is `interrupted`, with `end_reason = 'reboot'`.
  - s1 is `running`, with boot `B`.
  - `interrupted_sessions = 1`.
  - `machines.boot_id = B`.

## Local-only data (CLI)

The new `~/.pgmrc` keys and their defaults are defined in `contracts/cli.md` ("General rules").

**Feature marker**: `<worktree>/.postgram/feature.json`

```json
{ "feature_id": "uuid", "created_at": "ISO" }
```

It sits next to `<worktree>/.postgram/.gitignore`, which contains `*`, so the directory ignores itself and is never committed (FR-024).
