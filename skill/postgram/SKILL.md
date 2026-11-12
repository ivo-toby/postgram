---
name: postgram
description: 'Use Postgram to persist, search, and link knowledge across sessions, through its MCP tools or the `pgm` CLI, whichever the agent has. Invoke whenever the user wants to remember something across conversations, recall prior context, search their personal knowledge base, track tasks, explore relationships between stored entities, or keep track of features, worktrees and agent sessions across machines. Also invoke when the user asks to clean up, consolidate or get an overview of their projects, features or worktrees ("clean up my projects", "ruim mijn projecten op", "where was I", "what needs review"): that means the Workspace tracking consolidate procedure, not freeing disk space.'
---

# Postgram skill

Postgram is a personal knowledge store (Postgres + pgvector) with a REST API, an MCP server and a CLI called `pgm`. This skill tells you when to reach for it and how to use it without asking the user permission for each call.

What to do is the same for every transport. Only the call syntax differs, and that lives in the reference files.

## Pick your transport

Check once per session, in this order:

1. **MCP.** Your tool list has Postgram tools such as `search`, `store`, `recall` and `task_list`, often with a server prefix (`mcp__postgram__search`). Use them, and read [references/mcp.md](references/mcp.md) for the calls. There is no preflight: the connection is already authenticated.
2. **CLI.** You have a shell and `pgm` is on PATH. Read [references/cli.md](references/cli.md) and run its preflight before the first call.
3. **Neither.** Tell the user once that Postgram is not connected: add the Postgram MCP server to this client, or install `pgm` and set `PGM_API_URL` and `PGM_API_KEY`. Then stop. Do not retry blindly.

When you have both, use MCP for knowledge and tasks, and the CLI for everything that touches the local machine: worktrees, `pgm scan`, hooks. Those have no MCP tool, because the server cannot see the user's filesystem.

## When to invoke

Invoke this skill proactively when the user:

- Says "remember …" / "save …" / "log …" / "keep track of …" — store an entity.
- Says "what did I / we say about …" / "find / look up …" — search.
- Says "mark done", "I finished …", "complete …" — complete the task.
- Mentions prior context that should be recalled before acting ("like we discussed earlier", "the thing from yesterday").
- Wraps a work session ("end of day", "let's checkpoint") — store a durable memory summarizing the session.
- Needs continuity for an active or recent thread — store session context, not durable memory.
- Relates two things explicitly ("X depends on Y", "A is part of B") — create an edge.
- Asks to clean up, consolidate or get an overview of their projects ("ruim mijn projecten op"), asks where work lives or what needs them ("where was I", "what needs review", "after the reboot"), starts a feature, or opens or merges a PR — see [Workspace tracking](#workspace-tracking-keep-order-in-the-project-chaos).

Also store without being asked when any of these happen in the conversation:

- The user states a fact about themselves, a person, a project, or a tool.
- The user states a preference or a strong opinion.
- A decision is made and the trade-off is clear.
- The root cause of a bug is found. Store the cause, not the symptom.
- A constraint in the environment is found.
- A piece of work is finished. Store one paragraph: what, why, outcome.

Store it when you are in doubt. Noise costs less than lost context. Never announce that you search or store.

Do **not** invoke this skill for one-off scratchpad content that does not need either session continuity or durable recall. Postgram is not a general notepad.

## Concepts

Entity types: `memory`, `person`, `project`, `task`, `interaction`, `document`.
Visibility: `personal`, `work`, `shared`.
Task statuses: `inbox` (unprocessed), `next` (actionable), `active`, `waiting` (blocked), `scheduled`, `someday`, `done`, `archived`.

### Memory roles

Postgram supports two roles for `memory` entities:

- `durable_memory`: long-lived facts, decisions, preferences, constraints, root causes, and completed-work summaries.
- `session_context`: short-lived working context used to resume an active or recent conversation.

Use durable memory for information future agents should treat as stable. Use session context for "where we are in this thread" continuity. Session context is embedded for semantic recall, but does not participate in graph extraction. If the role is omitted, Postgram treats the memory as durable for backwards compatibility.

Do not manually choose or set `client_id`. Postgram derives session scope from the authenticated API key. Use one API key/client id per client identity (for example `codex-local`, `claude-desktop`, or `talon`) so sessions from the same client can resume each other. Use `agent_id` only as optional metadata, not as an auth boundary.

Do not manually promote session context by copying it verbatim into durable memory. Promotion should distill the stable claim.

## Operations

| Need | MCP tool | CLI |
|------|----------|-----|
| Store a durable memory or other entity | `store` | `pgm store` |
| Store session context | `store_session_context` | `pgm memory session-context` |
| Search | `search` | `pgm search` |
| Read one entity in full | `recall` | `pgm recall <id>` |
| Change an entity | `update` | `pgm update <id>` |
| Create a task | `task_create` | `pgm task add` |
| List tasks | `task_list` | `pgm task list` |
| Finish a task | `task_complete` | `pgm task complete <id>` |
| Relate two entities | `link` | `pgm link` |
| Walk the graph from one entity | `expand` | `pgm expand <id>` |
| Check enrichment progress | `queue` | `pgm queue` |

Arguments, flags and worked examples are in [references/mcp.md](references/mcp.md) and [references/cli.md](references/cli.md). Read only the one for your transport.

### Search, then recall

Search is a discovery step. It returns matched chunks, not complete entity bodies. Start with a specific query and a limit of 5, inspect the id, score, chunk, tags and edge summary of each hit, then recall only the results you need to answer the user.

Do not ask for the full response just to read a search hit. It can inline large documents and graph-neighbor content. It is for a machine consumer that needs the complete legacy search envelope.

Search is hybrid vector + keyword retrieval with chunk-level reciprocal-rank fusion and recency weighting. Scores are relative RRF numbers, not percentages. The threshold is a cosine floor; below-floor keyword matches need at least half of the retained distinct query terms, rounded up. A single-term query, including a compound identifier, requires its one retained term. Query terms split on whitespace are ORed, while each term's `simple` lexemes are ANDed so compound identifiers such as `ABC-1234` remain intact. In multi-term queries, standalone English stopwords are omitted. Narrow with a type or visibility filter.

For session continuity, search for recent `session_context` memories first when the user appears to be resuming an active topic. For durable knowledge, prefer durable memories and source documents. Treat old session-context hits as working notes, not authoritative facts.

### Graph expansion

Expand the graph whenever relationships matter. Each result then gains a `related` array of graph-connected entities with their `relation` and `direction`.

- "Who was involved in X?" — edges like `involves`, `assigned_to`, `mentioned_in` surface people and meetings.
- "What led to this decision?" — follow `caused_by`, `depends_on`, `part_of` edges.
- "What else is connected to Y?" — open-ended graph neighbourhood traversal.
- Any time semantic search alone feels too flat.

Graph edges only exist for documents that have been through extraction. If `related` is empty, check the enrichment queue: extraction may still be in progress.

Common relations when you link by hand: `involves`, `assigned_to`, `part_of`, `blocked_by`, `mentioned_in`, `related_to`, `depends_on`.

## Workspace tracking: keep order in the project chaos

### Why it exists

The user runs many agent sessions in parallel, on several machines, in many
git worktrees, for features that are each in a different stage. Worktrees and
transcripts survive a reboot, but the mapping between them gets lost: which
feature lives where, which session worked on it, and what the human must do
next. Postgram holds that mapping. Your job is to keep it correct and to use
it to help the user decide what to do next.

### The model

- **Feature**: a `task` entity with `metadata.kind = 'feature'`. It carries a
  delivery `stage` and a list of `pull_requests`. It is the unit the user
  thinks in ("keyword rank fusion", "UI v1"). It has a UUID and an 8-hex short
  id (the first 8 characters).
- **Stage**: `building` → `review` → `functional_test` → `ready_to_merge` →
  `awaiting_release` → `released`. Stages map to the human action needed:
  review, test, merge, release. `building` means agents are still working.
- **Machine**: one row per host, by alias (for example `ivomac`,
  `codebox-vm`). The `connect_target` is the ssh host used in resume commands.
- **Workspace**: one directory on one machine, usually a git worktree, with
  its branch and a git-state snapshot (dirty files, unpushed commits). It
  links to at most one feature. Without a link it is "Unassigned".
- **Agent session**: one Claude Code, pi or Talon session in a workspace, with
  status `running`, `idle`, `ended` or `interrupted` (the machine rebooted
  while it ran). Long-inactive sessions show as dormant.
- **Feature marker**: `.postgram/feature.json` in a worktree names its
  feature. A marker wins over a manual link on the next report.

Sessions and git state are reported automatically by the hooks
(`pgm hooks install`). You do not need to report them yourself. Features,
stages, PRs and links need judgement; that is your part.

### What to do

The calls for each step are in
[references/workspace.md](references/workspace.md).

- **Session start.** The SessionStart hook prints a feature line when the
  worktree is linked. If the workspace is unassigned and the work clearly
  belongs to a feature, look it up and propose the link. Do not guess when
  two features fit; ask.
- **"Where was I?" / "what needs me?" / after a reboot.** Ask Postgram where
  the active features live. Use the actions view for the human's to-do list.
  Give the resume command for the piece they pick.
- **Starting new work.** Find an existing feature first. Create one only when
  none fits, with a short concrete title. With the CLI, prefer
  `pgm worktree new`: it creates the branch and worktree, writes the marker
  and registers the workspace.
- **Opening a PR.** Attach it to the feature. That moves `building` to
  `review` by itself.
- **PR merged.** Report the PR as merged. That moves the feature to
  `awaiting_release`, or to `released` when the repo has `release_on_merge`.
- **Manual stage moves.** Set `functional_test` or `ready_to_merge` only when
  the user says so or the evidence is clear (tests handed to the user,
  approval given). Never set `released` unless a release was published.
- **Housekeeping.** When the overview shows unassigned workspaces, stale
  features, or risks (`dirty`, `unpushed`, `no_upstream`, `interrupted`),
  point them out and propose one concrete fix each. Do not link, unlink or
  change stages in bulk without the user's approval.

### Consolidate: "clean up my projects"

Use this when the user asks to get an overview, consolidate or clean up their
projects on a machine. It runs in three passes: inventory, proposal, apply.
Stop after the proposal for approval. The full procedure is in
[references/workspace.md](references/workspace.md#consolidate-clean-up-my-projects);
read it before you start.

The inventory and the apply pass need the CLI on the machine that holds the
worktrees. Without a shell you can still give the overview and move stages
and PRs; say so, and ask the user to run the consolidate pass from an agent
on that machine.

## Principles

- **Search, then recall.** Treat matched chunks as discovery evidence. Recall only the selected IDs whose complete content is needed; do not pull every full document into context.
- **Use compact output for agent-facing reads.** Ask for TOON on search and list calls when you will read and summarize the result. Ask for full JSON only when a following step needs exact fields.
- **Be specific in content** — Postgram's semantic search works better on concrete sentences than headline-style fragments.
- **Set visibility deliberately**: `personal` for the user, `work` for shared with colleagues, `shared` for public knowledge. When unsure, ask once and remember the preference.
- **Don't duplicate** — search first when the user's phrasing suggests something may already exist. Postgram stores everything; a cluttered knowledge base is worse than a sparse one.
- **When storing from a long exchange**, store a *summary* memory with the key facts, not the full transcript. The transcript belongs in the conversation log; the memory is the distilled signal.
- **Separate continuity from knowledge** — use `session_context` for active-thread state and `durable_memory` for stable facts. Do not make session context durable by copying it verbatim.
- **Let Postgram groom** — promotion from session context to durable memory should be handled by Postgram's groomer or an explicit operator workflow, because promotion changes the authority and sharing level of the memory. The groomer uses the configured extraction LLM to assess whether eligible session context deserves promotion and stores only the distilled durable memory, not a verbatim copy.

## Failure modes to recognize

- `VALIDATION: …` → schema issue; inspect the arguments or flags.
- `NOT_FOUND: Entity not found` → wrong id or the entity was soft-deleted.
- `EMBEDDING_FAILED` → embedding provider is unreachable; the write succeeds but search on that entity won't work until enrichment catches up. Retry later.
- `CONFLICT: optimistic concurrency failure` → another writer modified the entity; recall it again to get the latest `version` and retry the update.

## Non-goals

- Don't use Postgram as a replacement for a file system — it stores *text entities*, not code or artifacts.
- Don't store secrets (API keys, tokens, credentials) — audit log records every write.
- Don't use it for volatile state (counters, session tokens, caches).
- Don't treat session-context memory as durable truth. It is working context until groomed or promoted by Postgram's LLM-assisted groomer.
