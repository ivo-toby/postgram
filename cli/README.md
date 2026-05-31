# @ivotoby/postgram-cli

Command-line client for [Postgram](https://github.com/ivo-toby/postgram/).

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
# Store an entity
pgm store "decided to use pgvector" --type memory --tags "decisions,architecture"

# Search
pgm search "pgvector decisions" --limit 5

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

# JSON output (all commands)
pgm store "hello" --json
```

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
