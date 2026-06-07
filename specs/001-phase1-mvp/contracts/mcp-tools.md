# MCP Tool Contract: Phase 1 MVP

**Transport**: SSE (Server-Sent Events)
**Endpoint**: `/mcp`
**Auth**: API key via `Authorization: Bearer <key>` header or `apiKey` query
param on initial SSE connection. Auth context persists for the session.
**SDK**: `@modelcontextprotocol/sdk`

## Tools

All tools share the same auth context established at connection time.
Behavior is identical to the corresponding REST endpoint.

### store

Store a new knowledge entity. The entity is persisted immediately. Chunking
and embedding happen asynchronously after the response. The returned entity
includes `enrichment_status` ("pending" if content is non-empty, null otherwise).

| Parameter  | Type     | Required | Default  |
| ---------- | -------- | -------- | -------- |
| content    | string   | no       | —        |
| type       | enum     | yes      | —        |
| visibility | enum     | no       | `shared` |
| status     | string   | no       | —        |
| tags       | string[] | no       | —        |
| metadata   | object   | no       | —        |

**Returns**: `{ "entity": StoredEntity }`

---

### recall

Retrieve a specific entity by ID.

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| id        | string | yes      |

**Returns**: `{ "entity": StoredEntity }`

---

### store_session_context

Stores short-lived working context for resuming recent conversations.

Session-context memories:

- are stored as `type=memory`
- have `metadata.memory_role=session_context`
- are scoped to the authenticated API key's `client_id`
- are embedded for semantic recall
- do not run graph extraction

| Parameter   | Type     | Required | Default  |
| ----------- | -------- | -------- | -------- |
| content     | string   | yes      | —        |
| visibility  | enum     | no       | `shared` |
| owner       | string   | no       | —        |
| session_id  | string   | no       | —        |
| agent_id    | string   | no       | —        |
| topic       | string   | no       | —        |
| tags        | string[] | no       | —        |
| promotable  | boolean  | no       | —        |
| groom_after | string   | no       | —        |
| expires_at  | string   | no       | —        |

**Returns**: `{ "entity": StoredEntity }`

---

### search

Semantic search across stored knowledge.

| Parameter      | Type     | Required | Default |
| -------------- | -------- | -------- | ------- |
| query          | string   | yes      | —       |
| type           | enum     | no       | —       |
| tags           | string[] | no       | —       |
| memory_role    | enum     | no       | —       |
| limit          | number   | no       | 10      |
| threshold      | number   | no       | 0.35    |
| recency_weight | number   | no       | 0.1     |

**Returns**: `{ "results": SearchResult[] }`

---

### groom_session_context

Preview or archive stale `session_context` memories for the authenticated
client scope.

This tool never accepts a caller-provided client id. Scope is derived from the
API key's `client_id`, and candidates are filtered by the key's memory type and
visibility permissions. Promotion is intentionally not available through MCP;
LLM-assisted promotion remains an admin grooming operation.

| Parameter  | Type     | Required | Default   |
| ---------- | -------- | -------- | --------- |
| mode       | enum     | no       | `dry_run` |
| older_than | string   | no       | `7d`      |
| limit      | number   | no       | 50        |
| topic      | string   | no       | —         |
| session_id | string   | no       | —         |
| tags       | string[] | no       | —         |

`mode` values are `dry_run` and `archive`. `older_than` accepts `m`, `h`, and
`d` units, for example `30m`, `24h`, or `7d`. The optional `tags` filter
requires all supplied tags to be present.

Dry-run returns counts plus eligible candidate summaries:

```json
{
  "dryRun": true,
  "mode": "dry_run",
  "olderThan": "7d",
  "olderThanMs": 604800000,
  "limit": 50,
  "scope": { "kind": "client", "clientId": "coding-agents" },
  "eligibleCount": 1,
  "eligible": [
    {
      "id": "uuid",
      "content": "Session context: ...",
      "visibility": "personal",
      "owner": null,
      "tags": ["session-context"],
      "metadata": {},
      "createdAt": "2026-06-07T00:00:00.000Z"
    }
  ]
}
```

Archive mode is an explicit mutation and returns archived ids:

```json
{
  "dryRun": false,
  "mode": "archive",
  "olderThan": "7d",
  "olderThanMs": 604800000,
  "limit": 50,
  "scope": { "kind": "client", "clientId": "coding-agents" },
  "archived": 1,
  "archivedCount": 1,
  "archivedIds": ["uuid"]
}
```

---

### update

Update an existing entity. Requires current version for optimistic locking.
If content changes, enrichment is re-dispatched asynchronously and
`enrichment_status` resets to `"pending"`.

| Parameter  | Type     | Required |
| ---------- | -------- | -------- |
| id         | string   | yes      |
| content    | string   | no       |
| status     | string   | no       |
| visibility | enum     | no       |
| tags       | string[] | no       |
| metadata   | object   | no       |
| version    | number   | yes      |

**Returns**: `{ "entity": StoredEntity }`

---

### delete

Soft-delete an entity (sets status to archived).

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| id        | string | yes      |

**Returns**: `{ "id": "uuid", "deleted": true }`

---

### task_create

Create a new task (shortcut for store with type=task).

| Parameter | Type     | Required | Default |
| --------- | -------- | -------- | ------- |
| content   | string   | yes      | —       |
| context   | string   | no       | —       |
| status    | string   | no       | `inbox` |
| due_date  | string   | no       | —       |
| tags      | string[] | no       | —       |

**Returns**: `{ "entity": StoredEntity }`

---

### task_list

List tasks with optional filters.

| Parameter | Type   | Required | Default |
| --------- | ------ | -------- | ------- |
| status    | string | no       | —       |
| context   | string | no       | —       |
| limit     | number | no       | 50      |
| offset    | number | no       | 0       |

**Returns**: `{ "items": StoredEntity[], "total": number, "limit": number, "offset": number }`

---

### task_update

Update a task's fields.

| Parameter | Type     | Required |
| --------- | -------- | -------- |
| id        | string   | yes      |
| content   | string   | no       |
| status    | string   | no       |
| context   | string   | no       |
| due_date  | string   | no       |
| tags      | string[] | no       |
| version   | number   | yes      |

**Returns**: `{ "entity": StoredEntity }`

---

### task_complete

Mark a task as done.

| Parameter | Type   | Required |
| --------- | ------ | -------- |
| id        | string | yes      |
| version   | number | yes      |

**Returns**: `{ "entity": StoredEntity }` (status=done, metadata.completed_at set)

---

## Enum Values

| Enum       | Values                                                           |
| ---------- | ---------------------------------------------------------------- |
| type       | `memory`, `person`, `project`, `task`, `interaction`, `document` |
| visibility | `personal`, `work`, `shared`                                     |

## Error Behavior

MCP tool errors use the same `AppError` codes as REST (`NOT_FOUND`, `CONFLICT`,
`VALIDATION`, `UNAUTHORIZED`, `FORBIDDEN`, `EMBEDDING_FAILED`, `INTERNAL`).
Search may return `EMBEDDING_FAILED` when query embedding generation fails.
Enrichment failures are not surfaced as tool errors — they are tracked via
`enrichment_status` on the entity.

StoredEntity includes `enrichment_status` (`"pending"`, `"completed"`,
`"failed"`, or `null` for metadata-only entities).
