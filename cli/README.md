# @postgram/cli

Command-line client for [Postgram](https://github.com/example/postgram).

## Install

```bash
npm install -g @postgram/cli
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

# JSON output (all commands)
pgm store "hello" --json
```

## Development

```bash
cd cli
npm install
npm run build
npm test
```

## License

MIT