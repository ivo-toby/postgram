---
name: postgram
description: Use the `pgm` CLI (Postgram) to persist, search, and link knowledge across sessions. Invoke whenever the user wants to remember something across conversations, recall prior context, search their personal knowledge base, track tasks, explore relationships between stored entities, or keep track of features, worktrees and agent sessions across machines. Also invoke when the user asks to clean up, consolidate or get an overview of their projects, features or worktrees ("clean up my projects", "ruim mijn projecten op", "where was I", "what needs review"): that means the Workspace tracking consolidate procedure, not freeing disk space. Assumes `pgm` is on PATH, `PGM_API_URL` is set, and `PGM_API_KEY` is valid. Verifies config with `pgm config` or falls back to `curl $PGM_API_URL/health` before first write.
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

Use durable memory for information future agents should treat as stable. Use session context for "where we are in this thread" continuity. Session context is embedded for semantic recall, but does not participate in graph extraction.

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
pgm search "what the user asked about" --limit 5 --toon
```

Hybrid vector + keyword retrieval with chunk-level reciprocal-rank fusion and
recency weighting. Search scores are relative RRF numbers, not percentages;
`--threshold` is a cosine floor; below-floor keyword matches need at least half
of the retained distinct query terms, rounded up. A single-term query,
including a compound identifier, requires its one retained term. Query terms
split on whitespace are
ORed, while each term's `simple` lexemes are ANDed so compound identifiers such
as `ABC-1234` remain intact. In multi-term queries, standalone English stopwords
are omitted using the English dictionary; matching and ranking still use the
`simple` configuration. Add `--type project` or `--visibility work` to narrow.

Search is a discovery step. Compact JSON and TOON contain matched chunks, not complete entity bodies. Start with a specific query and `--limit 5`, inspect `id`, `score`, `chunk`, tags, and edge summaries, then run `pgm recall <id>` only for the results needed to answer the user.

Do not request `--full-response` just to read a search hit. It can inline large documents and graph-neighbor content. Use it only when a machine consumer needs the complete legacy search envelope. For MCP, use default `search`, then `recall`; set `full_response: true` only for the same exceptional case.

For session continuity, search for recent `session_context` memories first when the user appears to be resuming an active topic.

```bash
pgm search "active topic keywords" --type memory --memory-role session_context --visibility personal --limit 5 --toon
```

For durable knowledge, prefer durable memories and source documents. Treat old session-context hits as working notes, not authoritative facts.

### Search with graph expansion

```bash
pgm search "what the user asked about" --limit 5 --expand-graph --toon
```

Use `--expand-graph` whenever relationships matter — tracing a decision, understanding who worked on something, exploring what's connected to a topic. Each result gains a `related` array of graph-connected entities with their `relation` and `direction`.

**When to use expand_graph:**
- "Who was involved in X?" — edges like `involves`, `assigned_to`, `mentioned_in` surface people and meetings
- "What led to this decision?" — follow `caused_by`, `depends_on`, `part_of` edges
- "What else is connected to Y?" — open-ended graph neighbourhood traversal
- Any time semantic search alone feels too flat

**Important:** graph edges only exist for documents that have been through extraction (`extraction_status = completed`). Check `pgm queue` if `related` is empty — extraction may still be in progress.

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
pgm list --type task --status next --limit 10 --toon
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

- **Session start.** The SessionStart hook prints a feature line when the
  worktree is linked. If the workspace is unassigned and the work clearly
  belongs to a feature, look it up and propose the link. Do not guess when
  two features fit; ask.
- **"Where was I?" / "what needs me?" / after a reboot.** Call `where`
  (MCP) or `pgm where`. Use `view: actions` / `pgm where --actions` for the
  human's to-do list. Give the resume command for the piece they pick.
- **Starting new work.** Find an existing feature first (`pgm search` or
  `where`). Create one only when none fits, with a short concrete title.
  Prefer `pgm worktree new <feature> [--create]`: it creates the branch and
  worktree, writes the marker and registers the workspace.
- **Opening a PR.** Attach it with `feature_pr` / `pgm feature pr <id> <url>`.
  That moves `building` to `review` by itself.
- **PR merged.** Report it with `--state merged`. That moves the feature to
  `awaiting_release`, or to `released` when the repo has
  `release_on_merge` (`pgm repo set <remote> --release-on-merge true`).
- **Manual stage moves.** Set `functional_test` or `ready_to_merge` only when
  the user says so or the evidence is clear (tests handed to the user,
  approval given). Never set `released` unless a release was published.
- **Housekeeping.** When `where` shows unassigned workspaces, stale features,
  or risks (`dirty`, `unpushed`, `no_upstream`, `interrupted`), point them
  out and propose one concrete fix each. Do not link, unlink or change stages
  in bulk without the user's approval.

### Consolidate: "clean up my projects"

Use this when the user asks to get an overview, consolidate or clean up their
projects on a machine. Work in three passes and stop after the second for
approval. Do not hand-roll git discovery and do not call `pgm feature link`
per worktree.

1. **Inventory (read-only).** Run `pgm scan --json` (roots come from
   `scan_roots` in `~/.pgmrc`; pass `--root <dir>` otherwise, often
   `~/workspace`). It lists every worktree with repo remote, branch, last
   commit date and subject, dirty and unpushed state, the link Postgram
   already has and candidate features. It sends nothing and needs no
   terminal. Add `pgm where --all --json` for features without workspaces and
   `gh pr list --head <branch> --state all` where the PR decides the action.
   Run `pgm feature sync` first so PR states and stages are current.
2. **Proposal.** Show one table, one row per worktree: path, branch, last
   activity, risks, and the proposed action:
   - link to an existing feature (give its short id),
   - new feature (give the title),
   - skip,
   - remove (merged or closed PR, no unique commits, or a throwaway
     worktree).
   Also propose a stage per feature, derived from its PR (open → `review`,
   merged → `awaiting_release` or `released`), and which features are
   finished (`pgm feature done`). Group large sets of the same kind (for
   example hundreds of review worktrees from one tool) into one row with a
   count and one decision. Mark rows you are unsure about and ask about
   those; do not guess.
3. **Apply what the user approved.**
   - Write the approved links, new features and skips to a plan file and run
     `pgm scan --apply plan.json --dry-run`, then without `--dry-run`. The
     plan is `{"entries": [{"path", "action": "link", "feature_id"} |
     {"path", "action": "create", "title"} | {"path", "action": "skip"}]}`.
     One invalid entry rejects the whole plan; fix it and rerun.
   - `pgm feature pr <id> <url> [--state merged]` and `pgm feature stage` where
     a PR does not settle the stage; `pgm feature done <id>` for finished
     features.
   - `pgm worktree rm <path>` for approved removals. It refuses dirty files and
     unpushed commits and has no force flag; report the refusal instead of
     working around it. Never run `git worktree remove --force`.
   - `pgm workspace prune --dry-run`, then `pgm workspace prune`, for
     registrations whose directory is gone.
   - If a directory such as the workspace root got registered, add it to
     `ignore_paths` in `~/.pgmrc` and run `pgm workspace prune --ignored`.
   End with `pgm where` so the user sees the result.

Links are per machine: `pgm scan` links paths on the machine where it runs.
For another machine, run each pass there (or over `ssh <connect_target>`),
one machine at a time.

### Commands

| Need | CLI | MCP tool |
|------|-----|----------|
| Overview by stage | `pgm where` | `where` |
| Human to-do list | `pgm where --actions` | `where` with `view: actions` |
| Feature of this directory | `pgm here` | `workspace_lookup` |
| Create a feature | `pgm feature add "<title>"` | `task_create` with `metadata.kind: feature` |
| Link/unlink a workspace | `pgm feature link <id> [--path <dir>]` / `pgm feature unlink` | `workspace_link` (`feature_id: null` unlinks) |
| Set a stage | `pgm feature stage <id> <stage>` | `feature_stage` |
| Attach a PR | `pgm feature pr <id> <url> [--state merged]` | `feature_pr` |
| New worktree for a feature | `pgm worktree new <feature> [--create]` | — |
| Bootstrap existing worktrees (human) | `pgm scan --root <dir> [--dry-run]` (interactive, needs a terminal) | — |
| Inventory worktrees (agent) | `pgm scan --json` | — |
| Apply an approved plan | `pgm scan --apply plan.json [--dry-run]` | — |
| Follow PR state on GitHub | `pgm feature sync [id]` (needs `gh`) | `feature_pr` per changed PR |
| Finish a feature | `pgm feature done <id>` | `task_complete` |
| Remove a clean worktree | `pgm worktree rm <path>` | — |
| Remove registrations of gone directories | `pgm workspace prune [--dry-run]` | `workspace_delete` (delete scope) |

`pgm scan` asks per worktree; run it in the user's terminal, not from an
agent without a TTY. Use `--yes-exact` to accept only marker and short-id
matches without prompts.

## Principles

- **Use TOON for agent-facing reads.** Add `--toon` to `pgm search` and `pgm list` when the model will read and summarize the result. For MCP tools that expose the option, set `toon: true`.
- **Search, then recall.** Treat matched chunks as discovery evidence. Recall only the selected IDs whose complete content is needed; do not pull every full document into context.
- **Use JSON for machine parsing.** Add `--json` only when a following shell or tool step needs exact fields, such as extracting IDs with `jq`. Add `--full-response` only when that consumer needs the complete legacy envelope.
- **Be specific in content** — Postgram's semantic search works better on concrete sentences than headline-style fragments.
- **Set visibility deliberately**: `personal` for the user, `work` for shared with colleagues, `shared` for public knowledge. When unsure, ask once and remember the preference.
- **Don't duplicate** — search first when the user's phrasing suggests something may already exist. Postgram stores everything; a cluttered knowledge base is worse than a sparse one.
- **When storing from a long exchange**, store a *summary* memory with the key facts, not the full transcript. The transcript belongs in the conversation log; the memory is the distilled signal.
- **Separate continuity from knowledge** — use `session_context` for active-thread state and `durable_memory` for stable facts. Do not make session context durable by copying it verbatim.
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

## Non-goals

- Don't use Postgram as a replacement for a file system — it stores *text entities*, not code or artifacts.
- Don't store secrets (API keys, tokens, credentials) — audit log records every write.
- Don't use it for volatile state (counters, session tokens, caches).
- Don't treat session-context memory as durable truth. It is working context until groomed or promoted by Postgram's LLM-assisted groomer.
