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

# Agent-friendly output formats
pgm search "pgvector decisions" --json                 # compact JSON by default
pgm search "pgvector decisions" --json --full-response # full API-shaped JSON
pgm search "pgvector decisions" --toon                 # compact TOON output
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

# Sync markdown directory
pgm sync ./notes --repo my-notes

# Check enrichment/extraction queue status
pgm queue

# Compact JSON output where supported
pgm store "hello" --json
```

Agent-facing `--json` output is compact by default for search, list, task list,
graph expansion, write acknowledgements, and link acknowledgements. It omits
token-heavy fields such as timestamps, metadata, nested `entity` objects, and
raw similarity unless you pass `--full-response`. Use `--toon` on list-like
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
`--expand-graph` or `pgm expand <entity-id>` when the user asks about causes,
provenance, decisions, dependencies, blockers, ownership, involvement,
discussion participants, connected context, or ambiguous search hits. Do not
expand when the compact result already answers a direct fact.

## Memory Roles

Store durable memory:

```bash
pgm store "Ivo prefers client-scoped session context in Postgram." \
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
