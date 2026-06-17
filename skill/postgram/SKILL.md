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
- Wraps a work session ("end of day", "let's checkpoint") — store a durable memory summarizing the session.
- Needs continuity for an active or recent thread — store session context, not durable memory.
- Relates two things explicitly ("X depends on Y", "A is part of B") — create an edge.

Do **not** invoke this skill for one-off scratchpad content that does not need either session continuity or durable recall. Postgram is not a general notepad.

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

### Memory roles

Postgram supports two roles for `memory` entities:

- `durable_memory`: long-lived facts, decisions, preferences, constraints, root causes, and completed-work summaries.
- `session_context`: short-lived working context used to resume an active or recent conversation.

Use durable memory for information future agents should treat as stable. Use session context for "where we are in this thread" continuity. Memory entities are embedded for semantic recall by default, but do not participate in graph extraction by default, including durable memory. Operators can opt memory extraction back in with Postgram runtime configuration when they explicitly want graph edges from memory summaries.

When using MCP and a `store_session_context` tool is available, prefer it for session context. It sets the correct metadata and client scope automatically.

Do not manually choose or set `client_id`. Postgram derives session scope from the authenticated API key. Use one API key/client id per client identity (for example `codex-local`, `claude-desktop`, or `talon`) so sessions from the same client can resume each other. Use `agent_id` only as optional metadata, not as an auth boundary.

### Store durable memory

```bash
pgm store --type memory --visibility personal \
  --metadata '{"memory_role":"durable_memory"}' \
  --content "…"
```

For richer content, use `--stdin` and pipe the text. Add `--tags tag1,tag2` for filtering later. If `memory_role` is omitted, Postgram treats the memory as durable for backwards compatibility.

### Store session context

Use session context for resumability, open questions, and active-thread state:

```bash
pgm memory session-context --visibility personal \
  --tags session-context,postgram \
  --topic postgram-memory-lifecycle \
  --agent-id codex \
  "We are discussing Postgram session_context memory. Current direction: embed for recall, skip graph extraction, groom into durable_memory later."
```

This command scopes session context to the authenticated client when the server knows its `client_id`. Do not manually promote session context by copying it verbatim into durable memory. Promotion should distill the stable claim.

### Store a task

```bash
pgm store --type task --status inbox --content "…"
```

Statuses: `inbox` (unprocessed), `next` (actionable), `waiting` (blocked), `scheduled`, `someday`, `done`, `archived`.

### Search

```bash
pgm search "what the user asked about" --limit 5
```

Hybrid BM25 + vector with recency weighting. Add `--type project` or `--visibility work` to narrow.

For agentic use, prefer compact structured search output:

```bash
pgm search "what the user asked about" --limit 5 --json
```

`pgm search --json` is compact by default: it returns id, type, score, content,
matched chunk, tags, and compact related entries, while omitting token-heavy
metadata, timestamps, nested `entity` objects, and raw similarity. Use
`--full-response` only when you need the full API-shaped payload:

```bash
pgm search "what the user asked about" --limit 5 --json --full-response
```

Use TOON when you want the smallest readable CLI search output:

```bash
pgm search "what the user asked about" --limit 5 --toon
```

Compacting and TOON are CLI-layer formats. The Postgram REST API always remains
JSON.

The same compact-output rules apply to other token-heavy CLI surfaces:

- write acknowledgements (`store`, `memory session-context`, `update`, task
  writes, `link`) return compact ids/status/version by default with `--json`
- `list`, `task list`, and `expand` return compact rows/graphs by default with
  `--json`
- pass `--full-response` when you need metadata, timestamps, source, version
  details, or other full API fields
- pass `--toon` on list-like commands (`search`, `list`, `task list`,
  `expand`) for the smallest readable output

Examples:

```bash
pgm list --type memory --json
pgm list --type memory --json --full-response
pgm list --type memory --toon
pgm task list --status next --toon
pgm expand <entity-id> --json
pgm expand <entity-id> --toon
```

For session continuity, search for recent `session_context` memories first when the user appears to be resuming an active topic.

```bash
pgm search "active topic keywords" --type memory --memory-role session_context --visibility personal --limit 5 --json
```

Keep the compact default for normal continuity searches. Add `--full-response`
only when you need to inspect metadata, timestamps, version, source, or raw
similarity.

For durable knowledge, prefer durable memories and source documents. Treat old session-context hits as working notes, not authoritative facts. Do not expect durable memories to appear as graph neighbours unless an operator has explicitly enabled memory extraction; use ordinary `memory_role=durable_memory` search for durable-memory recall.

### Search with graph expansion

```bash
pgm search "what the user asked about" --limit 5 --expand-graph --json
```

Use `--expand-graph` whenever relationships matter — tracing a decision, understanding who worked on something, exploring what's connected to a topic. Each result gains a `related` array of graph-connected entities with their `relation` and `direction`.

**When to use expand_graph:**

- "Who was involved in X?" — edges like `involves`, `assigned_to`, `mentioned_in` surface people and meetings
- "What led to this decision?" — follow `caused_by`, `depends_on`, `part_of` edges
- "What else is connected to Y?" — open-ended graph neighbourhood traversal
- Any time semantic search alone feels too flat

**Important:** graph edges only exist for source knowledge that has been through extraction (`extraction_status = completed`). Memory entities are embed-only by default, so memory may be searchable without producing graph neighbours. Check `pgm queue` if `related` is empty for a document or interaction — extraction may still be in progress.

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

### Check enrichment queue

Use this when search results seem stale or entities aren't showing up yet — enrichment may still be in progress. Available as `pgm queue` (CLI) or the `queue` MCP tool.

```bash
pgm queue
```

Output:

```
embedding:  pending=12  completed=3421  failed=0  retry_eligible=0  oldest_pending=4s
extraction: pending=8   completed=1230  failed=2
```

- `pending` — items waiting to be processed by the background worker
- `oldest_pending_secs` — how long the oldest item has been waiting (a large value means the worker is stuck or slow)
- `retry_eligible` — failed embedding jobs that will be retried automatically
- `extraction: null / disabled` — extraction is off; enable with `EXTRACTION_ENABLED=true`

### Groom stale session context

Use this only for stale working context that belongs to the authenticated
client. Self-grooming can preview or archive; promotion to durable memory is an
admin/operator workflow.

CLI dry-run:

```bash
pgm memory groom --dry-run --older-than 7d
```

CLI archive, with optional filters:

```bash
pgm memory groom --older-than 14d --topic postgram --tag session-context --yes
```

MCP self-grooming uses `groom_session_context`:

```json
{
  "mode": "dry_run",
  "older_than": "7d",
  "topic": "postgram",
  "tags": ["session-context"]
}
```

Grooming has no default candidate cap. Pass `--limit <n>` or `limit` only when
you intentionally want a bounded batch.

Do not pass or invent a client id for self-grooming. Postgram derives scope
from the API key. Use `pgm-admin memory groom --client-id <id>` or
`--all-clients` only as an operator, and use admin `--mode promote --yes` for
LLM-assisted promotion.

## Principles

- **Prefer JSON output** (`--json`) when parsing results into further actions. Human table output is for direct display.
- **Keep output compact by default** — `pgm ... --json` on token-heavy commands
  is designed for agent token efficiency. Reach for `--full-response` only when
  the omitted fields are required, or `--toon` when a small readable listing is
  enough.
- **Be specific in content** — Postgram's semantic search works better on concrete sentences than headline-style fragments.
- **Set visibility deliberately**: `personal` for the user, `work` for shared with colleagues, `shared` for public knowledge. When unsure, ask once and remember the preference.
- **Don't duplicate** — search first when the user's phrasing suggests something may already exist. Postgram stores everything; a cluttered knowledge base is worse than a sparse one.
- **When storing from a long exchange**, store a _summary_ memory with the key facts, not the full transcript. The transcript belongs in the conversation log; the memory is the distilled signal.
- **Separate continuity from knowledge** — use `session_context` for active-thread state and `durable_memory` for stable facts. Do not make session context durable by copying it verbatim.
- **Use memory as recall, not graph source, by default** — both durable and session-context memories are embedded for semantic search but skipped by graph extraction unless an operator explicitly enables memory extraction.
- **Let Postgram groom** — promotion from session context to durable memory should be handled by Postgram's groomer or an explicit operator workflow, because promotion changes the authority and sharing level of the memory. The groomer uses the configured extraction LLM to assess whether eligible session context deserves promotion and stores only the distilled durable memory, not a verbatim copy.

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

### User: "let's keep this thread resumable"

If `store_session_context` is available through MCP, use it. Otherwise:

```bash
pgm memory session-context --visibility personal \
  --tags session-context \
  --topic active-thread \
  --agent-id codex \
  "Session context: user wants this thread resumable. Capture open decisions and active questions, but promote only stable outcomes later."
```

### User: "what did I say about embeddings last week"

```bash
pgm search "embeddings" --visibility personal --limit 5 --json
```

Summarize the top 2–3 hits in natural language. Include the short id so the user can drill in if they want.

### User: "what else is connected to the open-brain RFC?"

```bash
pgm search "open-brain RFC" --limit 1 --expand-graph --json
```

The `related` field on each result shows graph neighbours — meetings that mentioned it, people involved, decisions caused by it. Summarize the connections, not just the document content.

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

- Don't use Postgram as a replacement for a file system — it stores _text entities_, not code or artifacts.
- Don't store secrets (API keys, tokens, credentials) — audit log records every write.
- Don't use it for volatile state (counters, session tokens, caches).
- Don't treat session-context memory as durable truth. It is working context until groomed or promoted by Postgram's LLM-assisted groomer.
- Don't assume memory entities create graph edges. By default they are semantic-recall records only; graph extraction is for source knowledge unless explicitly configured otherwise.
