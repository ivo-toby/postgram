## Persistent Memory (Postgram)

You have a connected personal knowledge store via MCP (`mcp__postgram__*` tools).
Use it proactively — it is what makes you useful across sessions instead of
starting from scratch every time.

### When to search (do this first, before asking the user)

- Session starts on an unfamiliar project or after a break — search the project
  name to recall prior context, decisions, and open threads.
- User references something you don't have context for ("the thing we decided
  last week", "like we discussed") — search before asking.
- Before storing — search first to avoid duplicating something already recorded.

```
mcp__postgram__search { "query": "project decisions", "limit": 5 }
mcp__postgram__search { "query": "homelab setup", "type": "memory", "limit": 5 }
```

All entity types are searchable: `memory`, `person`, `project`, `task`,
`interaction`, `document`. Use `"type"` to narrow results to what you stored.

MCP outputs are compact by default for agent token efficiency on token-heavy
tools: search, task lists, graph expansion, write acknowledgements, and link
acknowledgements. Use `"full_response": true` only when you need metadata,
timestamps, raw similarity, version history context, or the legacy nested entity
shape. Use `"toon": true` on list-like tools (`search`, `task_list`, `expand`)
for the smallest readable MCP output.

### When to use expand_graph

Add `"expand_graph": true` when relationships matter — not just finding a
document, but understanding what is connected to it. Each result gains a
`related` array of graph-connected entities with `relation` and `direction`.

Use it when the user asks:

- Who was involved in X / who owns Y
- What led to a decision, what depends on something
- What else is connected to a topic (open-ended exploration)

```
mcp__postgram__search { "query": "authentication design", "limit": 3, "expand_graph": true }
```

Graph edges only exist after LLM extraction has processed source knowledge such
as documents or interactions. Memory entities are embedded for semantic recall
but are not graph-extracted by default, including durable memory. If `related`
is empty for source knowledge, check `mcp__postgram__queue` — extraction may
still be running. Flat search always works regardless of extraction status.

### When to store (do this without being asked)

- A non-obvious architectural decision is made — the _why_ is what matters, not
  just the _what_.
- A bug's root cause is identified — future sessions waste time re-diagnosing
  the same issues.
- A constraint or environment quirk is discovered.
- A significant feature or fix is completed — store a one-paragraph summary.
- The user expresses a preference about how you should work with them.

Use durable memory for stable facts future agents should trust. Use session
context for active-thread continuity ("where were we?"), resumability, open
questions, and current working state. Memory is embedded for semantic recall
and skipped by graph extraction by default; operators can opt memory extraction
back in with Postgram runtime configuration when they explicitly want graph
edges from memory summaries. Session context is scoped to the authenticated
client.
Do not manually set `client_id`; Postgram derives session scope from the
authenticated API key. Use `agent_id` only as optional metadata.
Do not promote session context by copying it verbatim into durable memory;
promotion should distill the stable claim.

Durable memory:

```
mcp__postgram__store {
  "type": "memory",
  "visibility": "personal",
  "tags": ["memory", "architecture", "project-name"],
  "metadata": { "memory_role": "durable_memory" },
  "content": "Decided X because Y. Tradeoff: Z."
}
```

Session context:

```
mcp__postgram__store_session_context {
  "content": "Session context: we are debugging X. Current hypothesis is Y; next step is Z.",
  "visibility": "personal",
  "topic": "project-name",
  "agent_id": "codex",
  "tags": ["project-name", "session-context"]
}
```

If `store_session_context` is unavailable, use the regular store tool with
`type="memory"`, tag `session-context`, and metadata
`{"memory_role":"session_context"}`.

Do not manually copy session context into durable memory. Postgram grooming
promotes eligible session context through an LLM-assisted distillation step and
archives the source context with provenance.

For session continuity, search session context first:

```
mcp__postgram__search {
  "query": "active topic keywords",
  "type": "memory",
  "memory_role": "session_context",
  "limit": 5
}
```

Keep the compact default for normal continuity searches. Add
`"full_response": true` only when you need to inspect metadata such as
`memory_role`, source, timestamps, or version.

If the connected MCP server does not expose `memory_role`, fall back to a
regular `type="memory"` search and inspect returned metadata.

### When to link

When two stored entities are explicitly related (a decision caused a task, a
bug was fixed by a change, a person owns a project):

```
mcp__postgram__link { "source_id": "...", "target_id": "...", "relation": "caused_by" }
```

Common relation types: `involves`, `assigned_to`, `part_of`, `blocked_by`,
`mentioned_in`, `related_to`, `depends_on`.

### Principles

- **Search silently** — don't announce "I will now search postgram". Just do it
  and use what you find.
- **Store concisely** — one paragraph of dense signal. Not transcripts, not
  summaries of summaries.
- **Tag consistently** — use the repo/project name as a tag so searches stay
  scoped.
- **Personal visibility by default** — use `work` only for content shared with
  colleagues, `shared` for genuinely public knowledge.
- **Don't store code** — store decisions, constraints, patterns, and outcomes.
  The code is in the repo.
- **Check the queue** — if search results seem stale or entities aren't
  appearing, run `mcp__postgram__queue` to see if enrichment is still in
  progress.
