# Small-Model Tool-Use Overlay

Use this file as an additional instruction layer for smaller or local models
that are prone to mixing tool schemas (for example small OpenAI-compatible or
Ollama models). It is optional: opt in by appending this file to the model's
system prompt or agent instructions.

## Tool Schema Discipline

Before calling a tool, identify the exact tool name and use only parameters
defined by that tool.

- Do not copy parameters from a different tool, even if both tools have similar
  names.
- Start with the smallest valid call. Omit optional parameters unless they are
  clearly useful.
- If validation says `must NOT have additional properties`, remove every field
  that is not in the selected tool's schema and retry **at most once**.
- If validation says a required property is missing, add only that missing
  required property.
- Do not repeat the same invalid tool call more than once. If a second attempt
  fails, stop and explain the error instead of retrying.
- Never pass filesystem grep parameters (`pattern`, `path`, `contextLines`,
  `caseSensitive`, `includeHidden`) to Postgram. Postgram is a knowledge store,
  not a filesystem search tool.

## Quick Reference: Postgram Tools

Tool names exposed by the MCP server (prefix `postgram_` when called from a
host that namespaces MCP tools):

- `store` — store a new knowledge entity
- `store_session_context` — store short-lived working context for a conversation
- `groom_session_context` — preview or archive stale session-context memories
- `recall` — fetch one entity by id
- `search` — hybrid BM25 + vector search over stored knowledge
- `update` — update an existing entity (requires optimistic version)
- `delete` — soft-delete an entity by id
- `task_create` — create a task
- `task_list` — list tasks
- `task_update` — update a task (requires optimistic version)
- `task_complete` — mark a task done (requires optimistic version)
- `link` — create a relationship between two entities
- `unlink` — remove a relationship by edge id
- `expand` — get the graph neighborhood of an entity
- `queue` — check enrichment/extraction queue status
- `sync_push` — push a document repository manifest
- `sync_status` — read sync status for a repository

Common parameter conventions across Postgram tools:

- `visibility` is one of `personal`, `work`, `shared`.
- `type` (entities) is one of `memory`, `person`, `project`, `task`,
  `interaction`, `document`.
- `status` (tasks/entities) is one of `active`, `done`, `archived`, `inbox`,
  `next`, `waiting`, `scheduled`, `someday`.
- `version` is a positive integer used for optimistic concurrency. Read the
  current `version` from the entity you are updating before calling `update`,
  `task_update`, or `task_complete`.
- Booleans accept `true`/`false` (and the strings `"true"`/`"false"`), but
  prefer real booleans.
- Arrays of strings must be JSON arrays, not comma-separated strings.

## Per-Tool Minimal Examples

The examples below show the smallest valid call first, then optional extras.

### `postgram_search`

Searches Postgram's durable knowledge store. Not a filesystem tool.

Minimal correct call:

```json
{ "query": "frittata recipe" }
```

With useful options:

```json
{
  "query": "auth design decision",
  "type": "memory",
  "tags": ["architecture"],
  "limit": 5,
  "expand_graph": true
}
```

Allowed parameters:

- `query` string, required, minimum length 1
- `type` optional enum
- `tags` optional array of strings
- `visibility` optional enum
- `owner` optional string
- `limit` optional positive integer
- `threshold` optional number 0–1
- `recency_weight` optional number ≥ 0
- `expand_graph` optional boolean
- `include_archived` optional boolean
- `memory_role` optional enum: `durable_memory` or `session_context`
- `full_response` optional boolean
- `toon` optional boolean (return compact text instead of JSON)

Never pass these to `postgram_search`: `pattern`, `path`, `contextLines`,
`caseSensitive`, `includeHidden`.

### `postgram_store`

Minimal correct call:

```json
{
  "type": "memory",
  "content": "Decided to use pgvector for hybrid search because BM25 alone ranked recall too low."
}
```

With useful options:

```json
{
  "type": "memory",
  "content": "Decided to use pgvector for hybrid search because BM25 alone ranked recall too low.",
  "visibility": "personal",
  "tags": ["architecture", "search"],
  "source": "design-review-2026-07-04"
}
```

Allowed parameters:

- `type` enum, required
- `content` optional string (required in practice for anything you want to be
  searchable later)
- `visibility` optional enum
- `owner` optional string
- `status` optional enum
- `tags` optional array of strings
- `source` optional string
- `metadata` optional object
- `skip_extraction` optional boolean
- `full_response` optional boolean

### `postgram_store_session_context`

Minimal correct call:

```json
{ "content": "Debugging the MCP schema advertisement bug. Next step: check raw tools/list output." }
```

With useful options:

```json
{
  "content": "Debugging the MCP schema advertisement bug. Next step: check raw tools/list output.",
  "topic": "postgram-mcp-schema",
  "tags": ["postgram", "session-context"],
  "groom_after": "2026-07-05T00:00:00.000Z"
}
```

Allowed parameters:

- `content` string, required, minimum length 1
- `visibility` optional enum
- `owner` optional string
- `session_id` optional string
- `agent_id` optional string
- `topic` optional string
- `tags` optional array of strings
- `promotable` optional boolean
- `groom_after` optional timestamp string
- `expires_at` optional timestamp string
- `full_response` optional boolean

### `postgram_groom_session_context`

Minimal correct call (dry-run preview):

```json
{}
```

Useful call (archive stale context older than 7 days):

```json
{ "mode": "archive", "older_than": "7d" }
```

Allowed parameters:

- `mode` optional enum: `dry_run` (default) or `archive`
- `older_than` optional duration string (for example `7d`, `24h`)
- `limit` optional positive integer
- `topic` optional string
- `session_id` optional string
- `tags` optional array of strings

Always run a `dry_run` first when you are unsure what will be archived.

### `postgram_recall`

Minimal correct call:

```json
{ "id": "01234567-89ab-cdef-0123-456789abcdef" }
```

Allowed parameters:

- `id` string, required
- `owner` optional string

### `postgram_update`

You must read the current entity first to get its `version`.

```json
{
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "version": 3,
  "content": "Updated: pgvector chosen for hybrid search; BM25 retained for keyword recall."
}
```

Allowed parameters:

- `id` string, required
- `version` positive integer, required
- `content` optional string (or null to clear)
- `visibility` optional enum
- `status` optional enum (or null to clear)
- `tags` optional array of strings
- `source` optional string (or null to clear)
- `metadata` optional object
- `full_response` optional boolean

### `postgram_delete`

Minimal correct call:

```json
{ "id": "01234567-89ab-cdef-0123-456789abcdef" }
```

Only parameter: `id` string, required. This is a soft delete.

### `postgram_task_create`

Minimal correct call:

```json
{ "content": "Write regression test for search schema advertisement." }
```

With useful options:

```json
{
  "content": "Write regression test for search schema advertisement.",
  "status": "next",
  "tags": ["postgram", "testing"],
  "due_date": "2026-07-11"
}
```

Allowed parameters:

- `content` string, required, minimum length 1
- `context` optional string
- `status` optional enum
- `due_date` optional string
- `tags` optional array of strings
- `visibility` optional enum
- `metadata` optional object
- `full_response` optional boolean

### `postgram_task_list`

Minimal correct call:

```json
{}
```

With useful options:

```json
{ "status": "next", "limit": 10 }
```

Allowed parameters:

- `status` optional enum
- `context` optional string
- `limit` optional positive integer
- `offset` optional non-negative integer
- `include_archived` optional boolean
- `full_response` optional boolean
- `toon` optional boolean

### `postgram_task_update`

Read the task first to get its `version`.

```json
{
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "version": 2,
  "status": "active"
}
```

Allowed parameters:

- `id` string, required
- `version` positive integer, required
- `content` optional string
- `context` optional string
- `status` optional enum (or null to clear)
- `due_date` optional string
- `tags` optional array of strings
- `visibility` optional enum
- `metadata` optional object
- `full_response` optional boolean

### `postgram_task_complete`

Minimal correct call:

```json
{ "id": "01234567-89ab-cdef-0123-456789abcdef", "version": 4 }
```

Allowed parameters:

- `id` string, required
- `version` positive integer, required
- `full_response` optional boolean

### `postgram_link`

Minimal correct call:

```json
{
  "source_id": "01234567-89ab-cdef-0123-456789abcdef",
  "target_id": "fedcba98-7654-3210-fedc-ba9876543210",
  "relation": "caused_by"
}
```

Allowed parameters:

- `source_id` string, required
- `target_id` string, required
- `relation` string, required
- `confidence` optional number 0–1
- `metadata` optional object
- `full_response` optional boolean

Common relation values: `involves`, `assigned_to`, `part_of`, `blocked_by`,
`mentioned_in`, `related_to`, `depends_on`, `caused_by`.

### `postgram_unlink`

Minimal correct call:

```json
{ "id": "edge-uuid-here" }
```

Only parameter: `id` string, required (the edge id, not an entity id).

### `postgram_expand`

Get the graph neighborhood of an entity.

```json
{ "entity_id": "01234567-89ab-cdef-0123-456789abcdef" }
```

With useful options:

```json
{
  "entity_id": "01234567-89ab-cdef-0123-456789abcdef",
  "depth": 2,
  "relation_types": ["caused_by", "depends_on"]
}
```

Allowed parameters:

- `entity_id` string, required
- `depth` optional integer 1–3
- `relation_types` optional array of strings
- `owner` optional string
- `full_response` optional boolean
- `toon` optional boolean

### `postgram_queue`

Check whether stored entities have been embedded and had graph edges
extracted. Useful when search or `expand` returns empty edges.

Minimal correct call:

```json
{}
```

With failures included:

```json
{ "include_failures": true, "failure_limit": 20 }
```

Allowed parameters:

- `include_failures` optional boolean
- `failure_limit` optional integer 1–100

### `postgram_sync_push`

Push a document repository manifest. Each file needs its path, SHA-256 hash,
and full content.

```json
{
  "repo": "postgram-docs",
  "files": [
    {
      "path": "README.md",
      "sha": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "content": "# Postgram Docs\n..."
    }
  ]
}
```

Allowed parameters:

- `repo` string, required
- `files` array, required, of objects with `path`, `sha`, `content` (all
  required; `sha` must be the SHA-256 of the bytes you are sending)

### `postgram_sync_status`

```json
{ "repo": "postgram-docs" }
```

Only parameter: `repo` string, required.

## Common Mistakes To Avoid

- Calling `postgram_search` with `{"pattern": "...", "path": "."}` — Postgram
  is not a filesystem grep.
- Calling `postgram_update` or `postgram_task_complete` without `version`. Read
  the entity first, copy its `version` into the call.
- Passing `tags` or `relation_types` as a comma-separated string. Use a JSON
  array: `["a", "b"]`.
- Passing `id` to `postgram_unlink` that is an entity id. `unlink` takes an
  edge id from a previous `link` or `expand` result.
- Repeating an invalid tool call after a validation error. Fix the args and
  retry once, or stop.