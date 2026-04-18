# postgram Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-18

## Active Technologies

- TypeScript on Node.js 22+ (LTS) + Hono (HTTP), @modelcontextprotocol/sdk (MCP SSE), (001-phase1-mvp)

## Code Style

TypeScript on Node.js 22+ (LTS): Follow standard conventions

## Developement workflow

Red/Green TDD with SDD specifications. 

IMPORTANT: before pushing code, use /codex (skill-codex) to have your changes reviewed by Codex, fix all p0, p1 and p2 issues at before pushing, after fixing, ask for a review again, until no p0, p1 or p2 issues remain. After pushing, create a PR.

## Recent Changes

- 001-phase1-mvp: Added TypeScript on Node.js 22+ (LTS) + Hono (HTTP), @modelcontextprotocol/sdk (MCP SSE),

<!-- MANUAL ADDITIONS START -->
## E2E Smoke Testing with Sprite

Use the sprite CLI to spin up a real environment and validate wiring end-to-end.

```bash
# Create and activate a sprite
sprite create postgram-test
sprite use postgram-test

# Install postgres + pgvector
sprite exec -- bash -c 'sudo apt-get update -qq && sudo apt-get install -y -qq postgresql postgresql-17-pgvector'

# Fix sprite IPv6 auth (sprite uses fdf::/16 for localhost)
sprite exec -- bash -c '
  echo "host all all fdf::/16 md5" | sudo tee -a /etc/postgresql/17/main/pg_hba.conf > /dev/null
  sudo pg_ctlcluster 17 main start
  sudo -u postgres psql -c "CREATE USER sprite WITH PASSWORD '\''test123'\'' SUPERUSER;"
  sudo -u postgres psql -c "CREATE DATABASE postgram OWNER sprite;"
  sudo -u postgres psql -d postgram -c "CREATE EXTENSION IF NOT EXISTS vector;"
'

# Upload project and install deps
tar czf /tmp/postgram.tar.gz --exclude=node_modules --exclude=dist --exclude=coverage --exclude=.git .
sprite exec --file /tmp/postgram.tar.gz:/tmp/postgram.tar.gz -- bash -c \
  'mkdir -p /home/sprite/postgram && cd /home/sprite/postgram && tar xzf /tmp/postgram.tar.gz && npm ci'

# Start the server (migrations run on boot)
sprite exec --dir /home/sprite/postgram -- bash -c '
  export DATABASE_URL="postgresql://sprite:test123@localhost:5432/postgram"
  export OPENAI_API_KEY="sk-fake-for-smoke"
  export LOG_LEVEL="warn"
  export PORT=3210
  nohup npx tsx src/index.ts > /tmp/postgram.log 2>&1 &
  sleep 3
  curl -s http://localhost:3210/health
'

# Create an API key for testing
sprite exec --dir /home/sprite/postgram -- bash -c '
  export DATABASE_URL="postgresql://sprite:test123@localhost:5432/postgram"
  npx tsx src/cli/admin/pgm-admin.ts key create --name test --scopes read,write,delete --visibility personal,work,shared
'

# Run smoke tests against the live server (store, recall, search, tasks, auth)
# Then clean up
sprite destroy postgram-test --force
```

Key points:
- Sprite VMs use `fdf::/16` for localhost — pg_hba.conf needs this range added
- The server auto-runs migrations on startup, no separate migrate step needed
- Enrichment worker runs in-process; entities move from `pending` to `completed` within ~1s
- Use `--file` flag on `sprite exec` to upload tarballs
- Unit tests run locally with testcontainers; sprite is for validating real deployment wiring

<!-- MANUAL ADDITIONS END -->
