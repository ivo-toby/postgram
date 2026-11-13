# @ivotoby/postgram-cli

Command-line client for [Postgram](https://github.com/ivo-toby/postgram/) built
for both humans and agents.

## Install

```bash
npm install -g @ivotoby/postgram-cli
```

## Configure

Set environment variables or create `~/.pgmrc`:

```bash
# Option 1: environment variables
export PGM_API_URL=http://localhost:3100
export PGM_API_KEY=your-api-key

# Option 2: ~/.pgmrc
echo '{"api_url":"http://localhost:3100","api_key":"your-api-key"}' > ~/.pgmrc
```

## Usage

```bash
# Store durable memory
pgm store "decided to use pgvector" --type memory --tags "decisions,architecture"

# Search with human output
pgm search "pgvector decisions" --limit 5

# Agent-friendly discovery, then selective full retrieval
pgm search "pgvector decisions" --limit 5 --json       # matched chunks by default
pgm search "pgvector decisions" --limit 5 --toon       # smallest discovery output
pgm recall <selected-entity-id>                         # complete selected content
pgm search "pgvector decisions" --json --full-response # complete legacy response
pgm list --json                                        # compact JSON rows
pgm list --json --full-response                        # full API-shaped rows
pgm list --toon                                        # compact TOON rows
pgm expand <entity-id> --json                          # compact graph JSON
pgm expand <entity-id> --toon                          # compact TOON graph

# Recall by ID
pgm recall <entity-id>

# List entities
pgm list --type memory

# Update an entity
pgm update <entity-id> --content "updated content" --version 1

# Delete an entity
pgm delete <entity-id>

# Create a relation
pgm link <source-id> <target-id> --relation involves

# Show graph neighborhood
pgm expand <entity-id> --depth 2

# Tasks
pgm task add "write integration tests" --context @dev --status next
pgm task list --status inbox
pgm task complete <task-id> --version 1

# Upload a document (needs LOADERS_ENABLED=true on the server)
pgm ingest report.pdf --title "Q3 report" --wait

# Sync markdown directory
pgm sync ./notes --repo my-notes

# Check enrichment/extraction queue status
pgm queue

# Compact JSON output where supported
pgm store "hello" --json
```

Search retrieves both semantic vector neighbors and chunks matching query
keywords. Whitespace-separated terms are ORed; each term's `simple` lexemes
are ANDed, preserving compound identifiers such as `ABC-1234`. For multi-term
queries, standalone English stopwords are omitted using the English dictionary;
matching and ranking still use the `simple` configuration. This lets a chunk
matching one complete term enter the bounded candidate set for a long query.
It deduplicates chunks and ranks the candidates with reciprocal-rank fusion
(RRF): `1 / (60 + vector_rank) + 1 / (60 + keyword_rank)`, with a missing
branch contributing zero. The `--threshold` value is a cosine similarity
floor; below-floor keyword matches need at least half of the retained distinct
query terms, rounded up. A single-term query, including a compound identifier,
requires its one retained term.
Human-readable scores are relative RRF values, printed with six decimal places,
and are not percentages. A candidate ranked first in both branches scores about
`0.03279` before recency. Equal final scores prefer the lower keyword rank,
then vector rank, then stable identifiers.

Agent-facing `--json` output is compact by default for search, list, task list,
graph expansion, write acknowledgements, and link acknowledgements. Search
returns identifiers, numeric RRF scores, matched chunks, tags, and edge summaries without
complete result or graph-neighbor content. Select an ID from those chunks and
use `pgm recall <id>` when complete content is needed. Other compact outputs
omit token-heavy fields such as timestamps, metadata, nested `entity` objects,
and raw cosine similarity unless you pass `--full-response`. Use `--toon` on list-like
commands (`search`, `list`, `task list`, `expand`) when an agent needs the
smallest readable output. TOON and compacting are CLI-layer formats; the
Postgram API remains JSON.

Compact search may include an `edges` summary:

```json
"edges": {
  "count": 3,
  "relations": [{ "relation": "mentioned_in", "count": 2 }]
}
```

`edges.count` and `edges.relations` are traversal affordances. They tell an
agent that graph context exists without returning neighbor content. Use
`--full-response` only when a machine consumer needs the complete legacy search
envelope, not as a substitute for recalling one selected result. Use
`--expand-graph` or `pgm expand <entity-id>` when the user asks about causes,
provenance, decisions, dependencies, blockers, ownership, involvement,
discussion participants, connected context, or ambiguous search hits. Do not
expand when the compact result already answers a direct fact.

## Workspace tracking

Track features, machines, workspaces and agent sessions across worktrees.
For onboarding and daily use, see [docs/workspace-tracking.md](../docs/workspace-tracking.md).

```bash
pgm here                       # report the current workspace and session
pgm hooks install              # install the Claude Code hooks (--pi installs the pi extension)
pgm hooks uninstall            # remove the installed hooks
pgm where                      # features and workspaces grouped by stage, one summary per feature (--expand lists every workspace, --all includes done and released)
pgm feature add "my feature"   # create a feature (also: stage, pr, link, unlink)
pgm feature done 1234abcd      # mark the feature task done; pgm where hides it unless --all
pgm feature sync [1234abcd]    # update PR states from GitHub with gh and apply the stage rules
pgm machine set --alias codebox # set this machine's alias or connect target (also: pgm machine list)
pgm repo set <remote> --release-on-merge true|false  # record the repository for this worktree
pgm worktree new 1234abcd      # create a worktree for a feature (UUID, 8-hex short id or title; --create creates the feature)
pgm scan --root ~/src          # discover worktrees and record their features (needs --root <dir> or scan_roots; --yes-exact, --dry-run)
pgm scan --json                # read-only inventory for agents: one entry per worktree, nothing is sent
pgm scan --apply plan.json     # apply an approved plan (--dry-run validates and shows the result only)
pgm worktree rm <path>         # remove a clean, pushed worktree and unregister it (no force flag)
pgm workspace prune            # remove registrations of this machine whose directory is gone (--dry-run, --ignored)
```

The interactive `pgm scan` needs a terminal. Without one it exits with a
message that points to `--json`, `--apply` and `--yes-exact`.

### Scan inventory and plan

`pgm scan --json` prints:

```json
{
  "machine": "codebox",
  "generated_at": "2026-11-01T10:00:00.000Z",
  "roots": ["/home/me/workspace"],
  "worktrees": [
    {
      "path": "/home/me/workspace/app.worktrees/1a2b3c4d-kw-rank",
      "repo_remote": "git@github.com:owner/app.git",
      "branch": "feat/1a2b3c4d-kw-rank",
      "last_commit": { "date": "2026-10-30T09:12:00+00:00", "subject": "fix: ranking" },
      "git": { "dirty_count": 0, "unpushed_count": 1, "has_upstream": true },
      "workspace_id": null,
      "feature": null,
      "marker_feature_id": null,
      "sessions": { "count": 2, "last_activity_at": "2026-10-30T10:00:00.000Z" },
      "candidates": [
        { "kind": "short-id", "feature_id": "1a2b3c4d-...", "title": "Keyword rank fusion" }
      ]
    }
  ]
}
```

`feature` is the link Postgram already has. `candidates` (marker, short-id,
search) are only computed for worktrees without a link. `git` is `null` when
git timed out (then `note` says so).

`pgm scan --apply plan.json` takes one entry per worktree path:

```json
{
  "entries": [
    { "path": "/home/me/workspace/app.worktrees/1a2b3c4d-kw-rank", "action": "link", "feature_id": "1a2b3c4d" },
    { "path": "/home/me/workspace/app.worktrees/spike", "action": "create", "title": "Spike: new cache" },
    { "path": "/home/me/workspace/app.worktrees/old", "action": "skip" }
  ]
}
```

The whole plan is validated before anything is written: paths must be
absolute, unique, existing worktree roots outside `ignore_paths`; `link` needs
a feature id (UUID or 8-hex) that exists; `create` needs a title. One invalid
entry rejects the plan. Entries then run one by one and the result lists
`linked`, `created`, `skipped` or `failed` per path (exit code 1 when any
failed). With `--json` the result is `{ "results": [...], "failed": n }`.

New `~/.pgmrc` keys (read alongside `api_url`/`api_key`):

| Key | Default |
|-----|---------|
| `machine` | `{ "alias": <hostname>, "connect_target": <alias> }` |
| `scan_roots` | `[]` |
| `worktree_root` | `null` (meaning `<repo_root>.worktrees`) |
| `here_timeout_ms` | `2000` |
| `ignore_paths` | `[]`. Directories `pgm here`, the hooks and `pgm scan` skip. An entry matches that directory exactly; an entry ending in `/**` matches everything below it. `~` is expanded. Example: `["~/workspace"]` skips the workspace root but not the repos in it. |
| `resume` | per-agent-kind `with_id`/`without_id` command templates |

## Memory Roles

Store durable memory:

```bash
pgm store "The user prefers client-scoped session context in Postgram." \
  --type memory \
  --visibility personal \
  --metadata '{"memory_role":"durable_memory"}'
```

Store session context:

```bash
pgm memory session-context "We are discussing Postgram memory lifecycle roles." \
  --visibility personal \
  --topic postgram-memory \
  --agent-id codex \
  --tags session-context
```

Search session context:

```bash
pgm search "Postgram memory lifecycle roles" \
  --type memory \
  --memory-role session_context \
  --visibility personal
```

Use durable memory for stable facts, decisions, constraints, and preferences.
Use session context for recent-thread continuity. Session context is embedded
for semantic recall, scoped to the calling client when the server knows its
`client_id`, and skipped by graph extraction.

## Claude Code skill

A portable Claude Code skill for using `pgm` from your agent lives in
[`skill/postgram/SKILL.md`](https://github.com/ivo-toby/postgram/blob/main/skill/postgram/SKILL.md)
in the main repo. Copy the `skill/postgram/` directory into your own project's
`.claude/skills/` (or your user-level `~/.claude/skills/`) and the agent will
know when to invoke `pgm store`, `pgm search`, `pgm link`, etc.

## Development

```bash
git clone https://github.com/ivo-toby/postgram/
cd postgram/cli
npm install
npm run build
npm test
```

## License

MIT
