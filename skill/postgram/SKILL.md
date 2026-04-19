---
name: postgram
description: Use the `pgm` CLI (Postgram) to persist, search, and link knowledge across sessions. Invoke whenever the user wants to remember something across conversations, recall prior context, search their personal knowledge base, track tasks, or explore relationships between stored entities. Assumes `pgm` is on PATH, `PGM_API_URL` is set, and `PGM_API_KEY` is valid. Verifies config with `pgm config` or falls back to `curl $PGM_API_URL/health` before first write.
---

# Postgram CLI skill

Postgram is a personal knowledge store (Postgres + pgvector) that exposes a REST/MCP API and a CLI called `pgm`. This skill tells you when to reach for it and how to use it without asking the user permission for each call.

## When to invoke

Invoke this skill proactively when the user:

- Says "remember …" / "save …" / "log …" / "keep track of …" — store an entity.
- Says "what did I / we say about …" / "find / look up …" — search.
- Says "mark done", "I finished …", "complete …" — update a task entity's status.
- Mentions prior context that should be recalled before acting ("like we discussed earlier", "the thing from yesterday").
- Wraps a work session ("end of day", "let's checkpoint") — store a memory summarizing the session.
- Relates two things explicitly ("X depends on Y", "A is part of B") — create an edge.

Do **not** invoke this skill for one-off scratchpad content that doesn't need to persist across sessions. Postgram is a durable knowledge store, not a notepad.

## Preflight

Before the first call of a session, verify the CLI is wired up:

```bash
pgm --help >/dev/null 2>&1 || { echo "pgm not on PATH"; exit 1; }
test -n "$PGM_API_URL" || { echo "PGM_API_URL unset"; exit 1; }
test -n "$PGM_API_KEY" || { echo "PGM_API_KEY unset"; exit 1; }
curl -sf "$PGM_API_URL/health" >/dev/null || { echo "postgram unreachable at $PGM_API_URL"; exit 1; }
```

If any of those fail, tell the user how to fix it and stop — don't retry blindly.

## Common operations

Entity types: `memory`, `person`, `project`, `task`, `interaction`, `document`.
Visibility: `personal`, `work`, `shared`.

### Store a memory

```bash
pgm store --type memory --visibility personal --content "…"
```

For richer content, use `--stdin` and pipe the text. Add `--tags tag1,tag2` for filtering later.

### Store a task

```bash
pgm store --type task --status inbox --content "…"
```

Statuses: `inbox` (unprocessed), `next` (actionable), `waiting` (blocked), `scheduled`, `someday`, `done`, `archived`.

### Search

```bash
pgm search "what the user asked about" --limit 5
```

Hybrid BM25 + vector with recency weighting. Add `--type project` or `--visibility work` to narrow. Add `--expand-graph` to include related entities in the response.

### Recall by id

```bash
pgm recall <entity-id>
```

### Update

```bash
pgm update <id> --tags new,tags
pgm update <id> --status done     # tasks
```

### Link entities

```bash
pgm link --source <a> --target <b> --relation depends_on --confidence 0.9
```

Common relations: `involves`, `assigned_to`, `part_of`, `blocked_by`, `mentioned_in`, `related_to`, `depends_on`.

### List tasks

```bash
pgm list --type task --status next --limit 10
```

## Principles

- **Prefer JSON output** (`--json`) when parsing results into further actions. Human table output is for direct display.
- **Be specific in content** — Postgram's semantic search works better on concrete sentences than headline-style fragments.
- **Set visibility deliberately**: `personal` for the user, `work` for shared with colleagues, `shared` for public knowledge. When unsure, ask once and remember the preference.
- **Don't duplicate** — search first when the user's phrasing suggests something may already exist. Postgram stores everything; a cluttered knowledge base is worse than a sparse one.
- **When storing from a long exchange**, store a *summary* memory with the key facts, not the full transcript. The transcript belongs in the conversation log; the memory is the distilled signal.

## Failure modes to recognize

- `VALIDATION: …` → schema issue; inspect the command flags.
- `NOT_FOUND: Entity not found` → wrong id or the entity was soft-deleted.
- `EMBEDDING_FAILED` → embedding provider is unreachable; the write succeeds but search on that entity won't work until enrichment catches up. Retry later.
- `CONFLICT: optimistic concurrency failure` → another writer modified the entity; re-recall to get the latest `version` and retry the update.

## Example interactions

### User: "remember that our Postgres is running pgvector 0.8 on the homelab"

```bash
pgm store --type memory --visibility personal \
  --tags homelab,postgres,pgvector \
  --content "Homelab Postgres runs pgvector 0.8.0 (installed 2026-04-19). Used for entity chunk embeddings at 1024 dims via bge-m3."
```

Confirm to the user with the returned entity id (first 8 chars) and the tags.

### User: "what did I say about embeddings last week"

```bash
pgm search "embeddings" --visibility personal --limit 5 --json
```

Summarize the top 2–3 hits in natural language. Include the short id so the user can drill in if they want.

### User: "link the homelab migration project to Ivo as the owner"

```bash
# Find both first
PROJECT=$(pgm search "homelab migration" --type project --limit 1 --json | jq -r '.results[0].entity.id')
PERSON=$(pgm search "Ivo" --type person --limit 1 --json | jq -r '.results[0].entity.id')
pgm link --source "$PERSON" --target "$PROJECT" --relation assigned_to --confidence 1.0
```

### User: "end of day — what did we get done?"

Recent completed tasks:

```bash
pgm list --type task --status done --since 1d --json
```

Then store a wrap-up memory:

```bash
pgm store --type memory --visibility personal \
  --tags daily,wrap-up \
  --content "2026-04-19 wrap-up: finished the Ollama embedding provider feature and deployed to homelab. 15 tasks complete. Graph extraction working end-to-end."
```

## Non-goals

- Don't use Postgram as a replacement for a file system — it stores *text entities*, not code or artifacts.
- Don't store secrets (API keys, tokens, credentials) — audit log records every write.
- Don't use it for volatile state (counters, session tokens, caches).
