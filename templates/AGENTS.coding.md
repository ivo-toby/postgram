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

At the start of a coding session, search recent session context for the current
repo, project, branch, issue, or task before asking the user to restate context.

```
mcp__postgram__search {
  "query": "project-or-repo active work",
  "type": "memory",
  "memory_role": "session_context",
  "limit": 5
}
```

If the task references a past decision, root cause, environment constraint, or
architecture tradeoff, also search durable memory:

```
mcp__postgram__search {
  "query": "project-or-repo decision constraint root cause",
  "type": "memory",
  "memory_role": "durable_memory",
  "limit": 5
}
```

Search silently. Use what you find, and only ask the user for context if memory
and the repo do not answer the question.

### Session-Context Memory

Store session context when the current coding thread should be resumable later:

- there is an active implementation or debugging hypothesis
- you have partial results and a clear next step
- verification is blocked or still running
- the user asks to continue later, checkpoint, or resume

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

Store durable memory only for stable development facts future coding agents
should trust:

- a decision is made with a reason and tradeoff
- a bug's root cause is identified
- an environment or tooling constraint is discovered
- a meaningful piece of work is completed, including verification outcome

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
- Prefer repo inspection over broad memory exploration for code facts.
- Store concise, third-person or project-scoped facts, not transcripts.
- Do not store code; the code lives in the repo.
- Do not copy session context verbatim into durable memory. Durable memory
  should distill the stable claim.
- Personal visibility is the default unless the memory should surface in a
  shared work context.
