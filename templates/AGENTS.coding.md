## Persistent Development Memory (Postgram)

You have a connected Postgram memory store via MCP (`mcp__postgram__*` tools).
For coding work, use it only for development continuity:

- session-context memory for active work, resumability, hypotheses, and next
  steps
- durable memory for stable decisions, constraints, root causes, and completed
  outcomes

Do not use Postgram as a general knowledge-work system during coding sessions.
Avoid broad document/person/task exploration unless the user explicitly asks for
it or the coding task cannot proceed without that context.

### Session Start

At the start of a coding session, always search recent session context for the
current repo, project, branch, issue, or task before asking the user to restate
context. Use concrete repo, branch, issue, task, or feature keywords when they
are available.

```
mcp__postgram__search {
  "query": "project-or-repo active work",
  "type": "memory",
  "memory_role": "session_context",
  "limit": 5
}
```

MCP output is compact by default for token-heavy tools such as search, task
lists, graph expansion, write acknowledgements, and link acknowledgements. Keep
that default for normal session-start searches. Add `"full_response": true`
only when you need metadata, timestamps, version, or raw similarity; use
`"toon": true` on list-like tools (`search`, `task_list`, `expand`) when you
want the smallest readable output.

Durable-memory search is conditional, but use strong triggers. Search durable
memory before choosing an approach or asking the user for historical context
when the task involves any of:

- an explicit past decision, root cause, environment constraint, or architecture
  tradeoff
- continuing or resuming an existing branch, issue, PR, migration, or debugging
  thread
- debugging a non-trivial failure, flaky behavior, or production-like issue
- touching architecture, data models, auth, API contracts, persistence, CI,
  deployment, or tooling where prior constraints are likely to matter
- planning a broad refactor, migration, integration, or cross-module change
- storing durable memory, to avoid duplicating an existing memory

Do not run durable-memory search for routine one-file edits, formatting-only
changes, simple command requests, or code facts that repo inspection already
answers.

```
mcp__postgram__search {
  "query": "<project-or-repo> <area-or-issue> decision constraint root-cause completed-work",
  "type": "memory",
  "memory_role": "durable_memory",
  "limit": 5
}
```

Search once with the best concrete keywords. If a result points to a named
decision, root cause, or branch, one targeted follow-up search is fine.

Search silently. Use what you find, and only ask the user for context if memory
and the repo do not answer the question.

### Session-Context Memory

Store session context when the current coding thread should be resumable later
or would otherwise lose useful active state:

- there is an active implementation or debugging hypothesis
- you have partial results and a clear next step
- verification is blocked or still running
- the user asks to continue later, checkpoint, or resume

Do not use session context as a completion log. For completed, verified outcomes,
use durable memory only if they pass the durable-memory gate below.

```
mcp__postgram__store_session_context {
  "content": "Session context: working on <project>. Current goal is <goal>. Evidence so far: <evidence>. Next step: <next step>.",
  "visibility": "personal",
  "topic": "<project-or-repo>",
  "agent_id": "codex",
  "tags": ["<project-or-repo>", "session-context"],
  "promotable": false
}
```

Set `promotable: true` only when the context likely contains durable value after
distillation. Do not set `client_id`; Postgram derives the session scope from
the authenticated API key.

If `store_session_context` is unavailable, use:

```
mcp__postgram__store {
  "type": "memory",
  "visibility": "personal",
  "tags": ["<project-or-repo>", "session-context"],
  "metadata": { "memory_role": "session_context" },
  "content": "Session context: <short active-thread state>"
}
```

### Durable Memory

At the end of meaningful coding work, treat durable memory as a completion
check, not an automatic write. Store durable memory only for stable development
facts future coding agents should trust:

- a decision is made with a reason and tradeoff
- a bug's root cause is identified
- an environment or tooling constraint is discovered
- a meaningful piece of work is completed, including verification outcome

Do not store durable memory for trivial edits, unverified hypotheses, obvious
facts already present in code, or intermediate progress that belongs in session
context.

Before storing durable memory, search for an existing related memory and update
it if appropriate instead of creating duplicates.

```
mcp__postgram__search {
  "query": "<project-or-repo> <decision-or-root-cause>",
  "type": "memory",
  "memory_role": "durable_memory",
  "limit": 3
}
```

Create a durable memory when no suitable existing entry exists:

```
mcp__postgram__store {
  "type": "memory",
  "visibility": "personal",
  "tags": ["<project-or-repo>", "decision"],
  "metadata": { "memory_role": "durable_memory" },
  "content": "<one paragraph: what changed or was decided, why, tradeoff, verification/outcome>"
}
```

Use specific tags such as `decision`, `constraint`, `bug`, `root-cause`, or
`completed-work` alongside the project/repo tag.

### Principles

- Keep Postgram calls relevant to the coding task.
- Use targeted durable-memory searches when the triggers match; avoid broad
  all-memory or graph exploration during coding unless the user asks.
- Prefer repo inspection over broad memory exploration for code facts.
- Store concise, third-person or project-scoped facts, not transcripts.
- Do not store code; the code lives in the repo.
- Do not copy session context verbatim into durable memory. Durable memory
  should distill the stable claim.
- Personal visibility is the default unless the memory should surface in a
  shared work context.

## Configuration Changes

Whenever a runtime configuration value is added or renamed, update the Docker
setup in the same change. Check `docker-compose.yml`, `.env.example`, Dockerfile
defaults, deployment docs, and README tables so container deployments receive
the new value.
