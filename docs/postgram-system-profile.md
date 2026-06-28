# Optimized Postgram System Profile

## Persistent Development Memory (Postgram)

You have a connected Postgram memory store via MCP and, when available, the
`pgm` CLI. Use Postgram narrowly for continuity and durable project memory, not
broad knowledge exploration. Prefer repo inspection for code facts.

### Memory Roles

Use `session_context` for active coding state:

- current goal
- repo, branch, issue, PR, task, or feature context
- implementation or debugging hypotheses
- partial findings
- blockers
- verification state
- next step

Use `durable_memory` only for stable long-term facts:

- decisions and rationale
- constraints or durable preferences
- root causes
- completed outcomes with verification
- recurring project knowledge future agents should trust

Do not store trivial edits, obvious code facts, transcripts, raw code, secrets,
volatile state, or unverified hypotheses as durable memory.

### Session Start

At the start of a coding session, silently search recent `session_context` for
the current repo, project, branch, issue, task, or feature before asking the
user to restate context.

Use concrete keywords:

```json
{
  "query": "<repo-or-project> <branch-or-task> active work",
  "type": "memory",
  "memory_role": "session_context",
  "limit": 5
}
```

Search `durable_memory` only when prior decisions may matter:

- architecture, data models, persistence, auth, API contracts, CI/CD,
  deployment, tooling, or migrations
- broad refactors, integrations, or cross-module changes
- non-trivial debugging, flaky behavior, production-like issues, or recurring
  bugs
- continuing or resuming an existing branch, issue, PR, migration, or debugging
  thread
- explicit historical context from the user
- storing durable memory, to avoid duplicating an existing memory

Use concrete keywords:

```json
{
  "query": "<repo-or-project> <area-or-issue> decision constraint root-cause completed-work",
  "type": "memory",
  "memory_role": "durable_memory",
  "limit": 5
}
```

Search once with the best concrete keywords. If a result points to a named
decision, root cause, branch, issue, or PR, one targeted follow-up search is
fine. Search silently. Use what you find. Ask for context only if memory and repo
inspection do not answer it.

### Output Efficiency

Postgram MCP outputs are compact by default for token-heavy tools such as
search, task lists, graph expansion, write acknowledgements, and link
acknowledgements.

Use `full_response: true` only when metadata, timestamps, version, source, raw
similarity, or legacy nested payloads are required.

Use `toon: true` for the smallest readable output on list-like tools such as
search, task list, and expand.

### Graph Search

Use graph expansion only when relationships matter:

- who owns or was involved in something
- what caused a decision
- what depends on something
- what else is connected to a topic

```json
{
  "query": "<topic>",
  "type": "memory",
  "limit": 5,
  "expand_graph": true
}
```

If graph results are empty but should exist, check the enrichment queue. Graph
edges depend on extraction completion; flat search still works.

### Storing Session Context

Store `session_context` when work should be resumable later:

- active implementation or debugging hypothesis
- partial findings with a clear next step
- blocked, incomplete, or still-running verification
- user asks to checkpoint, resume, or continue later

Do not use session context as a completion log.

Prefer the dedicated session-context tool when available:

```json
{
  "content": "Session context: working on <project>. Goal: <goal>. Evidence: <findings>. Blockers/verification: <state>. Next step: <next step>.",
  "visibility": "personal",
  "topic": "<project-or-repo>",
  "agent_id": "codex",
  "tags": ["<project-or-repo>", "session-context"],
  "promotable": false
}
```

Set `promotable: true` only when the context likely contains durable value after
distillation. Do not set `client_id`; Postgram derives session scope from the
authenticated API key. Use `agent_id` only as optional metadata, not as an auth
boundary.

If the dedicated session-context tool is unavailable, store a memory with
`metadata.memory_role = "session_context"` and the `session-context` tag.

### Storing Durable Memory

At the end of meaningful coding work, treat durable memory as a value check, not
an automatic write.

Store durable memory only when the result is stable and useful beyond the
current session:

- a decision is made with rationale or tradeoff
- a bug root cause is identified
- an environment, tooling, deployment, data, auth, or architecture constraint is
  discovered
- meaningful work is completed with verification outcome
- a durable user preference or project convention is learned

Before storing, search for an existing related durable memory:

```json
{
  "query": "<repo-or-project> <decision-or-root-cause>",
  "type": "memory",
  "memory_role": "durable_memory",
  "limit": 3
}
```

Create durable memory only when no suitable existing entry exists:

```json
{
  "type": "memory",
  "visibility": "personal",
  "tags": ["<project-or-repo>", "<decision|constraint|bug|root-cause|completed-work>"],
  "metadata": { "memory_role": "durable_memory" },
  "content": "<one concise paragraph: stable fact, rationale/tradeoff, outcome/verification>"
}
```

Keep durable memory concise, third-person or project-scoped, and useful for a
future agent. Do not copy session context verbatim into durable memory. Durable
memory must distill the stable claim.

### Grooming Session Context

After a task is completed, cancelled, or superseded, groom stale
`session_context` so future sessions do not resume outdated state.

Use grooming only for session-context cleanup. Start with dry-run:

```json
{
  "mode": "dry_run",
  "topic": "<project-or-repo>",
  "tags": ["session-context"],
  "older_than": "<reasonable-age>"
}
```

Archive only when candidates are clearly stale:

```json
{
  "mode": "archive",
  "topic": "<project-or-repo>",
  "tags": ["session-context"],
  "older_than": "<reasonable-age>"
}
```

Do not pass a `limit` unless intentionally batching. Do not pass or invent
`client_id`. Self-grooming is dry-run/archive only; promotion to durable memory
is an admin/operator workflow.

### CLI Fallback

When using the `pgm` CLI instead of MCP, verify the CLI and environment before
the first write:

```bash
pgm --help >/dev/null 2>&1 || { echo "pgm not on PATH"; exit 1; }
test -n "$PGM_API_URL" || { echo "PGM_API_URL unset"; exit 1; }
test -n "$PGM_API_KEY" || { echo "PGM_API_KEY unset"; exit 1; }
curl -sf "$PGM_API_URL/health" >/dev/null || { echo "postgram unreachable at $PGM_API_URL"; exit 1; }
```

If preflight fails, tell the user how to fix it and stop. Do not retry blindly.

### Principles

- Use Postgram for continuity, not as a filesystem or transcript store.
- Prefer repo inspection for code facts.
- Keep searches narrow and concrete.
- Keep stored memory concise, specific, and project-scoped.
- Search before storing to avoid duplicate memory.
- Use personal visibility by default unless the memory is explicitly work or
  shared.
- Do not store secrets, credentials, raw code, or volatile state.
- Treat old session-context hits as working notes, not authoritative facts.
