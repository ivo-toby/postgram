# Postgram over the `pgm` CLI

Read this when you use Postgram through a shell. It gives the commands for
what [SKILL.md](../SKILL.md) tells you to do. For features, worktrees and the
consolidate procedure, see [workspace.md](workspace.md).

## Preflight

Before the first call of a session, verify the CLI is wired up:

```bash
pgm --help >/dev/null 2>&1 || { echo "pgm not on PATH"; exit 1; }
test -n "$PGM_API_URL" || { echo "PGM_API_URL unset"; exit 1; }
test -n "$PGM_API_KEY" || { echo "PGM_API_KEY unset"; exit 1; }
curl -sf "$PGM_API_URL/health" >/dev/null || { echo "postgram unreachable at $PGM_API_URL"; exit 1; }
```

If any of those fail, tell the user how to fix it and stop — don't retry blindly.

## Output formats

- Add `--toon` to `pgm search` and `pgm list` when you will read and summarize the result.
- Add `--json` only when a following shell or tool step needs exact fields, such as extracting ids with `jq`.
- Add `--full-response` only when that consumer needs the complete legacy envelope. Do not use it just to read a search hit.

## Store durable memory

```bash
pgm store --type memory --visibility personal \
  --metadata '{"memory_role":"durable_memory"}' \
  --content "…"
```

For richer content, use `--stdin` and pipe the text. Add `--tags tag1,tag2` for filtering later.

## Store session context

Use session context for resumability, open questions, and active-thread state:

```bash
pgm memory session-context --visibility personal \
  --tags session-context,postgram \
  --topic postgram-memory-lifecycle \
  --agent-id codex \
  "We are discussing Postgram session_context memory. Current direction: embed for recall, skip graph extraction, groom into durable_memory later."
```

This command scopes session context to the authenticated client when the server knows its `client_id`.

## Tasks

```bash
pgm store --type task --status inbox --content "…"
pgm list --type task --status next --limit 10 --toon
pgm task complete <id> --version <n>
```

`pgm task add "…" --context @dev --status next` does the same as the first line and also takes a GTD context.

## Search

```bash
pgm search "what the user asked about" --limit 5 --toon
```

`--threshold` sets the cosine floor. Add `--type project` or `--visibility work` to narrow.

Run `pgm recall <id>` only for the results you need in full.

For session continuity:

```bash
pgm search "active topic keywords" --type memory --memory-role session_context --visibility personal --limit 5 --toon
```

## Search with graph expansion

```bash
pgm search "what the user asked about" --limit 5 --expand-graph --toon
pgm expand <entity-id> --depth 2 --toon
```

Each result gains a `related` array. If it is empty, check `pgm queue`: extraction may still be in progress.

## Recall by id

```bash
pgm recall <entity-id>
```

## Update

An update needs the version you expect, so that two writers do not overwrite each other. The version is in the output of `pgm recall`. Use `--force` to retry on the latest version.

```bash
pgm update <id> --tags new,tags --version <n>
pgm update <id> --status done --force     # tasks
```

## Link entities

```bash
pgm link --source <a> --target <b> --relation depends_on --confidence 0.9
pgm unlink <edge-id>
```

## Check enrichment queue

Use this when search results seem stale or entities aren't showing up yet — enrichment may still be in progress.

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

## Example interactions

### User: "remember that our Postgres is running pgvector 0.8 on the homelab"

```bash
pgm store --type memory --visibility personal \
  --tags homelab,postgres,pgvector \
  --content "Homelab Postgres runs pgvector 0.8.0 (installed 2026-04-19). Used for entity chunk embeddings at 1024 dims via bge-m3."
```

Confirm to the user with the returned entity id (first 8 chars) and the tags.

### User: "let's keep this thread resumable"

```bash
pgm memory session-context --visibility personal \
  --tags session-context \
  --topic active-thread \
  --agent-id codex \
  "Session context: user wants this thread resumable. Capture open decisions and active questions, but promote only stable outcomes later."
```

### User: "what did I say about embeddings last week"

```bash
pgm search "embeddings" --visibility personal --limit 5 --toon
```

Summarize the top 2–3 hits in natural language. Include the short id so the user can drill in if they want.

### User: "what else is connected to the open-brain RFC?"

```bash
pgm search "open-brain RFC" --limit 1 --expand-graph --toon
```

The `related` field on each result identifies graph neighbours — meetings that mentioned it, people involved, decisions caused by it. Summarize the connections from their relation and direction; recall a neighbour only when its complete content is needed.

### User: "link the homelab migration project to its owner"

```bash
# Find both first
PROJECT=$(pgm search "homelab migration" --type project --limit 1 --json | jq -r '.results[0].id')
PERSON=$(pgm search "homelab migration owner" --type person --limit 1 --json | jq -r '.results[0].id')
pgm link --source "$PERSON" --target "$PROJECT" --relation assigned_to --confidence 1.0
```

### User: "end of day — what did we get done?"

Completed tasks:

```bash
pgm list --type task --status done --limit 50 --toon
```

Then store a wrap-up memory:

```bash
pgm store --type memory --visibility personal \
  --tags daily,wrap-up \
  --content "2026-04-19 wrap-up: finished the Ollama embedding provider feature and deployed to homelab. 15 tasks complete. Graph extraction working end-to-end."
```
