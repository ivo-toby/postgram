# Quickstart: Phase 1 MVP — Central Knowledge Store

## Prerequisites

- Node.js 22+ (LTS)
- Docker and Docker Compose
- OpenAI API key (for embeddings)

## Local Development Setup

### 1. Clone and install

```bash
git clone <repo-url> postgram
cd postgram
npm install
```

### 2. Environment

```bash
cp .env.example .env
# Edit .env:
#   POSTGRES_PASSWORD=<local-dev-password>
#   OPENAI_API_KEY=sk-...
#   LOG_LEVEL=debug
```

### 3. Start Postgres

```bash
docker compose up postgres -d
```

### 4. Run migrations

```bash
npx tsx src/db/migrate.ts
```

### 5. Create an API key

```bash
# Start the server first, then use pgm-admin inside the container
# OR for local dev, run the admin CLI directly:
npx tsx src/cli/admin/pgm-admin.ts key create \
  --name "dev-local" \
  --scopes read,write,delete \
  --visibility personal,work,shared
```

Save the returned key — it's shown only once.

### 6. Start the server

```bash
npx tsx src/index.ts
# Server starts on http://localhost:3100
# MCP endpoint at http://localhost:3100/mcp
# Health check at http://localhost:3100/health
```

### 7. Test it

```bash
# Health check
curl http://localhost:3100/health

# Store a memory
curl -X POST http://localhost:3100/api/entities \
  -H "Authorization: Bearer <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"content":"test memory","type":"memory","tags":["test"]}'

# Search
curl -X POST http://localhost:3100/api/search \
  -H "Authorization: Bearer <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'
```

## Production Deployment (Hetzner VM)

### 1. Deploy

```bash
scp .env hetzner:~/postgram/.env
ssh hetzner "cd postgram && docker compose up -d --build"
```

### 2. Create API keys

```bash
ssh hetzner "docker exec -it postgram-mcp-server-1 \
  node dist/cli/admin/pgm-admin.js key create \
  --name talon-personal \
  --scopes read,write \
  --visibility personal,shared"
```

### 3. Configure Caddy (TLS)

Add to Caddyfile on the VM:

```caddyfile
postgram.example.com {
  reverse_proxy localhost:3100
}
```

### 4. Configure MCP clients

Talon / Claude Code MCP config:

```json
{
  "mcpServers": {
    "postgram": {
      "url": "https://postgram.example.com/mcp",
      "headers": {
        "Authorization": "Bearer pgm-talon-personal-..."
      }
    }
  }
}
```

## CLI Usage

```bash
# Configure CLI
export PGM_API_URL=https://postgram.example.com
export PGM_API_KEY=pgm-talon-personal-...
# Or create ~/.pgmrc with {"api_url":"...","api_key":"..."}

# Store
pgm store "decided to use pgvector" --type memory --tags decisions

# Search
pgm search "database decisions" --type memory

# Tasks
pgm task add "set up monitoring" --context @focus-work --status next
pgm task list --status next
pgm task complete <id> --version 1

# Backup
pgm backup --encrypt --output /path/to/backups/
```

## Running Tests

```bash
# Unit tests (no external deps)
npx vitest run tests/unit/

# Integration tests (requires running Postgres)
docker compose up postgres -d
npx vitest run tests/integration/

# Contract tests (requires running server)
npx vitest run tests/contract/

# All tests
npx vitest run
```

## Key Commands Reference

| Command | Description |
|---------|-------------|
| `npx tsx src/index.ts` | Start server (dev) |
| `npx tsx src/db/migrate.ts` | Run migrations |
| `npx tsx src/cli/pgm.ts <cmd>` | CLI tool (dev) |
| `npx tsx src/cli/admin/pgm-admin.ts <cmd>` | Admin CLI (dev) |
| `docker compose up -d` | Start all services |
| `docker compose up -d --build` | Rebuild and start |
| `npx vitest run` | Run all tests |
| `npx vitest --coverage` | Run tests with coverage |
