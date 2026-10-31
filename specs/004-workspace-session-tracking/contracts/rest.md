# REST Contract: Workspace & Agent-Session Tracking

Every endpoint needs a bearer API key, like the existing `/api/*` routes. Errors use the existing `{ error: { code, message, details } }` envelope. Timestamps are server time in ISO 8601.

The scope column below is the scope the key must have.

## Write: register and change

| Method | Path | Scope | Purpose |
|--------|------|-------|---------|
| POST | `/api/workspaces/report` | write | Register activity for a machine, workspace and optional session. Called by `pgm here` and the agent tool `workspace_report` (FR-017, FR-038). |
| PATCH | `/api/workspaces/:id` | write | Link, unlink or re-link a feature, or set/clear missing (FR-010, FR-030). |
| PUT | `/api/machines/:alias` | write | Set the connection target (FR-011). |
| PUT | `/api/repositories` | write | Set `release_on_merge` for a repository. |
| POST | `/api/features` | write | Create a feature, which is a task with `kind=feature` and `stage=building`. |
| POST | `/api/features/:id/stage` | write | Set the stage by hand (FR-003). Marks a plain task as a feature if needed. |
| POST | `/api/features/:id/pull-requests` | write | Add or update a PR. May move the stage forward (FR-004, FR-005). |

### POST /api/workspaces/report

Request:

```json
{
  "machine": { "alias": "codebox", "hostname": "codebox-vm", "boot_id": "6c1e…" },
  "workspace": {
    "path": "/home/ivo/wt/pg-121",
    "repo_remote": "github.com/ivo-toby/postgram",
    "repo_root": "/home/ivo/src/postgram",
    "branch": "feat/1a2b3c4d-keyword-rank",
    "git": { "dirty_count": 2, "unpushed_count": 3, "has_upstream": true }
  },
  "feature_id": "1a2b3c4d-…",
  "session": {
    "agent_kind": "claude-code",
    "agent_session_id": "8f3c…",
    "event": "start",
    "reason": "startup"
  }
}
```

Field rules:

- `feature_id` comes from the marker. It is optional and never creates a feature.
- `session` is optional.
- `workspace.repo_*`, `workspace.branch` and `workspace.git` may be `null` outside git.
- `event` is one of `start`, `activity`, `stop`, `end`.

Response `200`:

```json
{
  "workspace": { "id": "…", "feature_id": "…|null", "…": "…" },
  "session": { "id": "…", "status": "running" },
  "feature": { "id": "…", "title": "…", "stage": "review" },
  "interrupted_sessions": 2,
  "warnings": ["feature_not_found"]
}
```

`feature` is `null` when the workspace is not linked.

### PATCH /api/workspaces/:id

Body: `{ "feature_id": "uuid" | null, "missing": true | false }`. Both fields are optional.

- Linking requires visibility access to the feature.
- Returns `404` when the workspace does not exist or is not visible to the caller.

### POST /api/features/:id/stage

Body: `{ "stage": "functional_test" }`

Returns `{ entity }`, using the existing stored-entity shape. The stage is in `entity.metadata`.

### POST /api/features/:id/pull-requests

Body: `{ "url": "https://github.com/…/pull/121", "state": "open" | "merged" | "closed" }`

Returns `{ entity, stage_changed: boolean, from, to }`.

## Read: views and lookup

| Method | Path | Scope | Purpose |
|--------|------|-------|---------|
| GET | `/api/workspaces/lookup?machine=&path=` | read | Find which feature this workspace belongs to (FR-039). |
| GET | `/api/workspaces?machine=&repo=&feature_id=&unassigned=` | read | List workspaces with their sessions. |
| GET | `/api/where?view=stage\|actions&machine=&repo=&include_released=&include_ended=` | read | Grouped recovery view or action view (FR-026, FR-029, FR-031, FR-032, FR-033). |

### GET /api/where

The response is a single shape for both views:

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
          "id": "…", "title": "…", "stage": "review", "stage_source": "derived",
          "pull_requests": [{ "url": "…", "state": "open" }],
          "workspaces": [
            {
              "id": "…", "machine": "codebox", "connect_target": "codebox",
              "path": "…", "branch": "…", "repo_remote": "…",
              "last_activity_at": "…", "git_state_at": "…",
              "git": { "dirty_count": 0, "unpushed_count": 0, "has_upstream": true },
              "missing_since": null,
              "risks": ["unpushed", "interrupted"],
              "sessions": [
                {
                  "id": "…", "agent_kind": "claude-code", "agent_session_id": "…",
                  "status": "interrupted", "dormant": false, "last_activity_at": "…"
                }
              ]
            }
          ]
        }
      ]
    },
    { "key": "unassigned", "label": "Unassigned", "workspaces": [ "…" ] }
  ]
}
```

Group keys:

- `view=stage`: `building`, `review`, `functional_test`, `ready_to_merge`, `awaiting_release` (and `released` with `include_released=true`), followed by `unassigned`.
- `view=actions`: `review` (Review), `test` (Test), `merge` (Merge), `release` (Release), `in_progress` (In progress).

Risk codes (FR-027): `dirty`, `unpushed`, `no_upstream`, `interrupted`, `missing`. Dormancy is never a risk.

By default, each workspace lists its non-ended sessions plus its most recently active session even when ended. `include_ended=true` lists all sessions. Workspaces whose features have task status `done` or `archived` are left out by default.

`title` is the first line of the feature's task content, cut at 80 characters.

The server does not build resume commands. The CLI renders them, because it knows the local machine and the user's resume templates.
