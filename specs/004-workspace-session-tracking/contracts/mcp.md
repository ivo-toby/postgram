# MCP Contract: Workspace & Agent-Session Tracking

Every tool is a thin adapter over the same service functions as REST (Constitution II). Every tool accepts `full_response` and `toon` where the existing tools do, and returns compact output by default.

| Tool | Scope | Input | Output (compact) |
|------|-------|-------|------------------|
| `workspace_report` | write | Same body as `POST /api/workspaces/report` | `{ workspace_id, session_id, session_status, feature: {id,title,stage}\|null, interrupted_sessions, warnings }` |
| `workspace_lookup` | read | `{ machine, path }` | `{ workspace_id\|null, feature: {id,title,stage,pull_requests}\|null }`. Same matching as `GET /api/workspaces/lookup` (a subdirectory resolves to its workspace). No match means both are `null`, not an error. |
| `workspace_link` | write | `{ workspace_id, feature_id \| null }` | `{ workspace_id, feature_id }` |
| `feature_stage` | write | `{ id (uuid or 8-hex), stage }` | `{ id, stage, previous_stage }` |
| `feature_pr` | write | `{ id (uuid or 8-hex), url, state? (default open) }` | `{ id, stage, stage_changed }` |
| `where` | read | `{ view?: 'stage'\|'actions', machine?, repo?, include_released?, include_ended? }` | The same grouped structure as `GET /api/where`. In compact mode each workspace is reduced to `machine`, `path`, `branch`, `risks` and the latest session (`agent_kind`, `agent_session_id`, `status`). |

## Tool descriptions (agent-facing)

- **workspace_report**: "Register that you are working in a directory on a machine. Call it at session start and when you finish a piece of work. It does not create features."
- **workspace_lookup**: "Find which feature the current worktree belongs to and its delivery stage."
- **feature_stage**: "Set a feature's delivery stage. Move to `review` after opening a PR. Never set `released` unless a release was actually published."
- **feature_pr**: "Attach a PR to a feature. Opening a PR moves `building` to `review`; merging moves it to `awaiting_release`."
- **where**: "List where active features live (machine, worktree, sessions, risks). Use view `actions` to see what the human needs to do."

Features themselves are created with the existing `task_create` and `metadata.kind = "feature"`. The service then sets `stage = building`. No separate tool is needed.

## Shared rules

Validation, error codes, visibility, ordering, `resume_session`, risks and audit behaviour are exactly as in `rest.md`. MCP errors use the existing tool-error mapping of `AppError` codes.
