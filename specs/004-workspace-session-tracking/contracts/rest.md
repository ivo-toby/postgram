# REST Contract: Workspace & Agent-Session Tracking

## Conventions

- **Auth**: every endpoint needs a bearer API key, like the existing `/api/*` routes.
- **Errors** use the existing envelope `{ error: { code, message, details } }`:

  | Status | Code |
  |--------|------|
  | 400 | `VALIDATION` |
  | 403 | `FORBIDDEN` |
  | 404 | `NOT_FOUND` |
  | 409 | `CONFLICT` |

- **Timestamps** are server time, in ISO 8601.

### Feature ids

`:id` path parameters for features accept either form:

- **Full UUID.**
- **8-hex short id** (`^[0-9a-f]{8}$`): matches the start of the task id. Archived tasks are excluded.

| Situation | Result |
|-----------|--------|
| Short id matches more than one task | 409 `CONFLICT` with `details.candidates: [{id, title}]` |
| Any other format | 400 |
| Unknown id, or one the caller cannot see | 404 |
| Full UUID that resolves to an entity that is not a `task` | 400 |
| Short id with no match among non-archived tasks | 404 |

### Shared rules

- **Title** of a feature: `content.split('\n')[0].trim().slice(0, 80)`, with no ellipsis. Example: `"  Keyword rank fusion\nbody"` → `"Keyword rank fusion"`.
- **Remote normalization** is one shared function, used by both server and CLI, with shared test vectors. It produces `host/owner/repo`, lowercased, without scheme, user, port or `.git`.

  | Input | Normalized |
  |-------|------------|
  | `git@github.com:Ivo-Toby/postgram.git` | `github.com/ivo-toby/postgram` |
  | `https://github.com/ivo-toby/postgram` | `github.com/ivo-toby/postgram` |
  | `ssh://git@github.com:22/ivo-toby/postgram.git` | `github.com/ivo-toby/postgram` |

- **PR URL**:
  - It must match `^https://github\.com/([^/]+)/([^/]+)/pull/(\d+)`. Anything after the number (`/files`, `#…`, `?…`) is stripped. Anything else is 400.
  - The canonical form is `https://github.com/<owner>/<repo>/pull/<n>`, with owner and repo lowercased. That is the uniqueness key.
  - The PR's repository is `github.com/<owner>/<repo>`.
  - Other git hosts are out of scope for phase 1.

### Workspace object

The same object is returned everywhere a workspace appears:

```json
{
  "id": "uuid",
  "machine": "codebox",
  "connect_target": "codebox",
  "path": "/home/ivo/wt/1a2b3c4d-kw-rank",
  "repo_remote": "github.com/ivo-toby/postgram",
  "branch": "feat/1a2b3c4d-kw-rank",
  "feature_id": "uuid|null",
  "last_activity_at": "…",
  "git": { "dirty_count": 2, "unpushed_count": 3, "has_upstream": true },
  "git_state_at": "…|null",
  "missing_since": "…|null",
  "risks": ["dirty", "unpushed"],
  "resume_session": {
    "id": "uuid", "agent_kind": "claude-code", "agent_session_id": "8f3c…",
    "status": "ended", "cwd": "/home/ivo/wt/1a2b3c4d-kw-rank/cli",
    "transcript_path": "/home/ivo/.claude/projects/…/8f3c….jsonl",
    "last_activity_at": "…"
  },
  "sessions": [
    {
      "id": "uuid", "agent_kind": "claude-code", "agent_session_id": "8f3c…",
      "status": "running", "dormant": false,
      "cwd": "…|null", "transcript_path": "…|null",
      "started_at": "…", "last_activity_at": "…", "ended_at": "…|null", "end_reason": "…|null"
    }
  ]
}
```

- **`connect_target`** is already resolved: `COALESCE(machines.connect_target, machines.alias)`.
- **`git`** is `null` when the workspace is not a git repository. The individual counts are `null` when they are unknown.
- **`resume_session`** (FR-028) is chosen by the server over **all** sessions of the workspace: the session with the highest `last_activity_at` among those with a non-null `agent_session_id`, in any status. It is `null` when no session has an id. `include_ended` does not affect it.
- **`sessions`** by default holds the non-ended sessions, plus the single most recently active session even when it has ended. With `include_ended=true` it holds all sessions. They are sorted by `last_activity_at` DESC.
- **`dormant`** is `status ∈ {running, idle}` and `last_activity_at < now() - WORKSPACE_DORMANT_AFTER_DAYS`.
- **`risks`** (FR-027) are always listed in this order. A null git field raises no git risk, and dormancy is never a risk.

  | Risk | Raised when |
  |------|-------------|
  | `dirty` | `git.dirty_count > 0` |
  | `unpushed` | `git.unpushed_count > 0` |
  | `no_upstream` | `git.has_upstream === false` and `branch !== null` |
  | `interrupted` | the workspace's most recently active session (any status, with or without id) has status `interrupted` |
  | `missing` | `missing_since !== null` |

### Visibility (FR-040)

- A **linked** workspace is visible only when the caller can see its feature: type `task` allowed, and feature visibility in `allowedVisibility`.
- An **unlinked** workspace is visible only when `personal` is in `allowedVisibility`.
- Invisible workspaces are never returned, and are treated as 404 by id.

### Audit operations

Written by structural changes only:

- `machine_create`
- `workspace_create`
- `workspace_link`
- `session_create`
- `session_end`
- `session_interrupt`
- `feature_stage`
- `feature_pr`
- `repository_update`

`entity_id` holds the workspace or feature id. Activity-only updates write no audit row.

---

## Write endpoints (scope `write`)

### POST /api/workspaces/report

Registers activity. It is called by `pgm here`, `pgm scan`, `pgm worktree new` and the MCP tool `workspace_report` (FR-017, FR-038).

```json
{
  "source": "hook",
  "machine": { "alias": "codebox", "hostname": "codebox-vm", "boot_id": "6c1e…|null" },
  "workspace": {
    "path": "/home/ivo/wt/1a2b3c4d-kw-rank",
    "repo_remote": "github.com/ivo-toby/postgram",
    "repo_root": "/home/ivo/src/postgram",
    "branch": "feat/1a2b3c4d-kw-rank",
    "git": { "dirty_count": 2, "unpushed_count": 3, "has_upstream": true }
  },
  "feature_id": "uuid",
  "session": {
    "agent_kind": "claude-code",
    "agent_session_id": "8f3c…",
    "event": "start",
    "reason": "startup",
    "cwd": "/home/ivo/wt/1a2b3c4d-kw-rank/cli",
    "transcript_path": "/home/ivo/.claude/projects/…/8f3c….jsonl"
  }
}
```

**Validation** (failures are 400):

| Field | Rule |
|-------|------|
| `source` | `hook` (default) or `scan` |
| `machine.alias` | matches `^[a-z0-9._-]{1,64}$` |
| `machine.hostname` | 1–255 characters |
| `machine.boot_id` | ≤ 128 characters, or `null` |
| `workspace` | optional. When omitted, only report steps 1–2 (machine, reboot rule) run; `session`, `sessions` and `feature_id` must then be absent (else 400), and the response has `workspace: null, feature: null` |
| `workspace.path` | absolute, ≤ 4096 characters. The server strips trailing `/` (except for `/` itself) |
| `workspace.repo_remote`, `workspace.repo_root`, `workspace.branch` | string or `null`. An **omitted** key keeps the stored value; `null` sets null. The server normalizes `repo_remote` with the shared function |
| `feature_id` | UUID, or absent. `null` is treated as absent (a report never unlinks). Short ids are not accepted here. Any other value is 400 |
| `event` | `start`, `activity`, `stop` or `end`. Required for `source: hook`; ignored for `source: scan` |
| `agent_kind` | `claude-code`, `pi`, `talon` or `other` |
| `agent_session_id` | ≤ 200 characters, or `null` |
| `session.cwd`, `session.transcript_path` | absolute, ≤ 4096 characters, or `null` |

**Git snapshot semantics** (SC-007):

| `workspace.git` | Meaning | Effect |
|-----------------|---------|--------|
| `null` | Not a git repo | Clears the snapshot. `git_state_at = now()` |
| key **omitted** | Unknown (e.g. a git timeout) | Keeps the previous snapshot and `git_state_at` |
| object | New snapshot | Stored. `git_state_at = now()` |

**Session forms**:

- `source: "hook"` accepts at most one `session`; `sessions` is 400.
- `source: "scan"` accepts only `sessions` (an array, may be empty); `session` is 400.
- With `source: "scan"`, every session must carry `observed_at` (ISO), and its `event` is ignored. The status is set to `idle` on insert and left unchanged for an existing record.

**Processing**: the transaction steps are in data-model.md, "Report transaction".

**Response 200**:

```json
{
  "workspace": { "…workspace object…": "" },
  "session": { "id": "uuid", "status": "running" },
  "sessions": [ { "id": "uuid", "status": "idle" } ],
  "feature": { "id": "uuid", "title": "Keyword rank fusion", "stage": "review" },
  "interrupted_sessions": 1,
  "warnings": ["feature_not_found"]
}
```

- `session` is present only when one was sent, and `sessions` only for scan.
- `feature` is `null` when the workspace is unlinked or its feature is not visible.
- `warnings` is drawn from `feature_not_found` (missing or invisible) and `feature_not_task`. On a warning the link is left unchanged.

### PATCH /api/workspaces/:id

Body: `{ "feature_id": "uuid|8-hex|null", "missing": true|false }`. Both fields are optional; at least one is required.

- **`feature_id`**:
  - Links or unlinks the workspace.
  - Linking to a plain task marks it as a feature and applies the feature defaults from data-model.md (`stage`, `stage_source`, `stage_set_at`, `pull_requests`).
  - An unknown or invisible feature is 404.
- **`missing: true`** sets `missing_since = now()` only if it is null. **`missing: false`** clears it.
- **Returns** `{ workspace }`. An unknown or invisible workspace is 404.

### PUT /api/machines/:alias

- **Body**: `{ "connect_target": "string|null" }`. The value must match `^[A-Za-z0-9._@:-]{1,255}$`, else 400.
- **Unknown alias**: 404. Machines are created only by reports.
- **Returns** `{ machine: {alias, hostname, connect_target, last_seen_at} }`.
- **Aliases are never renamed** in phase 1.

### PUT /api/repositories

- **Body**: `{ "remote": "any remote form", "release_on_merge": boolean }`. The server normalizes `remote`.
- **Returns** `{ repository: {remote, release_on_merge} }`.
- **A missing row** means `release_on_merge = false`.

### POST /api/features

- **Body**: `{ "content": "string (min 1)", "tags"?: string[], "visibility"?: "personal|work|shared" }`.
- **Creates** a task with status `inbox` and metadata `{kind:'feature', stage:'building', stage_source:'manual', stage_set_at:now, pull_requests:[]}`.
- **Returns** 201 `{ entity }`.

### POST /api/features/:id/stage

- **Body**: `{ "stage": "building|review|functional_test|ready_to_merge|awaiting_release|released" }`.
- **Sets** `stage`, `stage_source = 'manual'` and `stage_set_at = now()`. Marks a plain task as a feature.
- **Concurrency**: one internal retry on a version conflict, then 409.
- **Returns** `{ entity, previous_stage }`.

### POST /api/features/:id/pull-requests

- **Body**: `{ "url": "…", "state"?: "open|merged|closed" }`. `state` defaults to `open`.
- **Upserts** by canonical URL. `pull_requests` is always written as the complete array, because the metadata merge is shallow.
- **Derivation** (FR-005) runs only when the URL is new to the feature or the stored state differs from the reported one. A re-report with the same state only refreshes `updated_at`.
- **Returns** `{ entity, stage_changed: boolean, from: stage, to: stage }`. When nothing changed, `from` and `to` are both the current stage.

---

## Read endpoints (scope `read`)

### GET /api/machines

Returns `{ machines: [{alias, hostname, connect_target, last_seen_at}] }`, sorted by alias.

### GET /api/workspaces/lookup?machine=&path=

Answers "which feature is this workspace linked to" (FR-039).

- **Matching**: the server strips trailing `/`. It picks the workspace on that machine whose `path` equals `path`, or else is the longest prefix of `path` ending at a `/` boundary. For example, `/a/b/c` matches the workspace `/a/b` but not `/a/bc`.
- **Response** `200`: `{ workspace: {…workspace object…}|null, feature: {id, title, stage, pull_requests}|null }`.
- **No match**, or an unknown machine, returns 200 with both `null`, never 404.

### GET /api/workspaces?machine=&repo=&feature_id=&unassigned=true&include_ended=true

Returns `{ workspaces: [workspace object] }`, sorted by `last_activity_at` DESC.

### GET /api/where

Query parameters:

| Parameter | Values |
|-----------|--------|
| `view` | `stage` (default) or `actions`; anything else is 400 |
| `machine` | exact alias |
| `repo` | any remote form, normalized, then exact match on `repo_remote` |
| `include_released` | `true` or `false` |
| `include_done` | `true` or `false` |
| `include_ended` | `true` or `false` |

Response:

```json
{
  "view": "stage",
  "generated_at": "…",
  "dormant_after_days": 30,
  "groups": [
    {
      "key": "review",
      "label": "Review",
      "features": [
        {
          "id": "uuid", "title": "…", "stage": "review", "stage_source": "derived",
          "stage_set_at": "…", "task_status": "active",
          "pull_requests": [{ "url": "…", "state": "open", "updated_at": "…" }],
          "workspaces": [ { "…workspace object…": "" } ]
        }
      ]
    },
    { "key": "unassigned", "label": "Unassigned", "workspaces": [ { "…": "" } ] }
  ]
}
```

**Group keys, labels and order**:

- Every group in the list is always present, in this order, even when it is empty.
- `view=stage`:

  | Key | Label |
  |-----|-------|
  | `building` | Building |
  | `review` | Review |
  | `functional_test` | Functional test |
  | `ready_to_merge` | Ready to merge |
  | `awaiting_release` | Awaiting release |
  | `released` | Released (only with `include_released=true`) |
  | `unassigned` | Unassigned |

- `view=actions` (FR-031):

  | Key | Label | Stage |
  |-----|-------|-------|
  | `review` | Review | `review` |
  | `test` | Test | `functional_test` |
  | `merge` | Merge | `ready_to_merge` |
  | `release` | Release | `awaiting_release` |
  | `in_progress` | In progress | `building` |
  | `unassigned` | Unassigned | – |

  `released` is never shown in the actions view.

**Inclusion rules**:

- **Features without workspaces** are listed (with `workspaces: []`) when no `machine` or `repo` filter is set.
- **`include_done`**: features whose task status is `done` or `archived` are hidden unless `include_done=true`. Their workspaces are hidden with them and never fall into `unassigned`.
- **`machine` or `repo` set**: only matching workspaces are kept, and features left without a matching workspace are dropped. `unassigned` is filtered the same way.

**Ordering**:

- Features: newest workspace `last_activity_at` DESC (features without workspaces last), then `stage_set_at` DESC, then `id` ASC.
- Workspaces: `last_activity_at` DESC.

**Resume commands**: the server does not build them. The CLI renders them from `connect_target`, `path` and `resume_session`.
