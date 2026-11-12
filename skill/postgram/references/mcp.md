# Postgram over MCP

Read this when your tool list has the Postgram MCP tools. It gives the calls
for what [SKILL.md](../SKILL.md) tells you to do. For features and worktrees,
see [workspace.md](workspace.md).

Tool names are shown bare. Your client may prefix them with the server name,
for example `mcp__postgram__search`. Use the name your tool list shows.

There is no preflight. The connection is authenticated when the client
connects; a failing call returns an error you can report.

## Output

Results are compact by default: write acknowledgements carry the id and
version, search returns matched chunks. Two optional arguments change that:

- `toon: true` on `search`, `task_list` and `expand` gives the smallest readable output. Use it when you will read and summarize the result.
- `full_response: true` gives the full REST-shaped payload. Use it only when a machine consumer needs it, never just to read a search hit.

## Store durable memory

```
store { "type": "memory", "visibility": "personal", "tags": ["homelab", "postgres"], "content": "…" }
```

A memory is durable unless you say otherwise. `type` also takes `person`,
`project`, `interaction` and `document`. Use `task_create` for tasks.

## Store session context

```
store_session_context { "content": "…", "topic": "postgram-memory-lifecycle", "tags": ["session-context"], "visibility": "personal" }
```

It sets the memory role and the client scope for you. Do not pass a client
id; `agent_id` is optional metadata.

`groom_session_context` previews stale session context for this client
(`mode` `dry_run`, the default) or archives it (`mode` `archive`). Leave
grooming to Postgram unless the user asks for it.

## Tasks

```
task_create { "content": "Write the integration tests", "context": "blocked until the schema lands", "status": "next" }
task_list { "status": "next", "limit": 10, "toon": true }
task_update { "id": "<id>", "version": 1, "status": "waiting" }
task_complete { "id": "<id>", "version": 2 }
```

`task_list` leaves features out unless you pass `kind` `feature` or `all`.

## Search

```
search { "query": "what the user asked about", "limit": 5, "toon": true }
```

Narrow with `type`, `visibility`, `tags` or `memory_role`. `threshold` sets
the cosine floor. Then read only what you need:

```
recall { "id": "<entity-id>" }
```

For session continuity:

```
search { "query": "active topic keywords", "type": "memory", "memory_role": "session_context", "limit": 5 }
```

## Search with graph expansion

A compact search result may carry `edges.count` and `edges.relations`. That
tells you graph context exists without loading it. To load it:

```
search { "query": "open-brain RFC", "limit": 1, "expand_graph": true }
expand { "entity_id": "<entity-id>", "depth": 2 }
```

If `related` is empty, check `queue`: extraction may still be in progress.

## Update and delete

An update needs the version you expect, so that two writers do not overwrite
each other. The version is in every write acknowledgement and in the result
of `recall`. On a conflict, recall again and retry with the new version.

```
update { "id": "<id>", "version": 3, "tags": ["new", "tags"] }
delete { "id": "<id>" }
```

`delete` is a soft delete and needs the delete scope.

## Link entities

```
link { "source_id": "<a>", "target_id": "<b>", "relation": "depends_on", "confidence": 0.9 }
unlink { "id": "<edge-id>" }
```

## Check enrichment queue

Use this when search results seem stale or entities aren't showing up yet.

```
queue { "include_failures": true }
```

- `pending` — items waiting for the background worker
- `oldest_pending_secs` — a large value means the worker is stuck or slow
- `retry_eligible` — failed embedding jobs that are retried automatically
- extraction `null` or disabled — extraction is off on the server

## Document sync

`sync_push` sends a repository of documents (path, SHA-256 and content per
file) and `sync_status` reports what the server holds for a repository.
These are for sync clients. To store one note, use `store`.

## Example interactions

### User: "remember that our Postgres is running pgvector 0.8 on the homelab"

```
store { "type": "memory", "visibility": "personal", "tags": ["homelab", "postgres", "pgvector"], "content": "Homelab Postgres runs pgvector 0.8.0 (installed 2026-04-19). Used for entity chunk embeddings at 1024 dims via bge-m3." }
```

Confirm to the user with the returned entity id (first 8 chars) and the tags.

### User: "let's keep this thread resumable"

```
store_session_context { "topic": "active-thread", "tags": ["session-context"], "content": "Session context: user wants this thread resumable. Capture open decisions and active questions, but promote only stable outcomes later." }
```

### User: "what did I say about embeddings last week"

```
search { "query": "embeddings", "visibility": "personal", "limit": 5, "toon": true }
```

Summarize the top 2–3 hits in natural language. Include the short id so the user can drill in if they want.

### User: "link the homelab migration project to its owner"

Find both first, then link the ids from the two results:

```
search { "query": "homelab migration", "type": "project", "limit": 1 }
search { "query": "homelab migration owner", "type": "person", "limit": 1 }
link { "source_id": "<person-id>", "target_id": "<project-id>", "relation": "assigned_to", "confidence": 1.0 }
```

### User: "end of day — what did we get done?"

```
task_list { "status": "done", "limit": 50, "toon": true }
store { "type": "memory", "visibility": "personal", "tags": ["daily", "wrap-up"], "content": "2026-04-19 wrap-up: finished the Ollama embedding provider feature and deployed to homelab. 15 tasks complete. Graph extraction working end-to-end." }
```
