# Postgram — Design

**Date:** 2026-03-17
**Status:** Draft
**Inspired by:** [OpenBrain](https://github.com/NateBJones-Projects/OB1) (Nate B. Jones)

## 1. Why

Talon's memory is fragmented:

- **Per-thread KV store** — doesn't persist well across sessions, not accessible from other tools
- **Git repos** (cf-notes, personal-notes) — good for long-form notes and version history, bad for structured recall
- **Session context** — gone when the thread ends

There's no shared state between agents. The agent split design (06) needs both the work agent and personal agent to read/write the same knowledge. Claude Code during daily work can't access Talon's memory at all. GTD (07) needs a persistent task store that survives sessions.

OpenBrain showed the pattern: central pgvector store + MCP = any agent can read/write structured knowledge. AI-agnostic memory layer. Their setup uses Supabase + OpenRouter + Slack capture, 5 tables, ~$0.10/day.

I don't want Supabase. I have the resources to run this myself — Postgres in Docker on Hetzner or at home.

## 2. Architecture

```
[Talon] ──────────┐
[Claude Code] ────┤
[Work Agent] ─────┤── MCP (SSE, API key auth) ──> [Central Store API] ──> [Postgres + pgvector]
[Future tools] ───┘                                  (Hetzner VM)          (Docker container)
```

### Deployment

Everything on Hetzner. Both MCP server and Postgres on the Hetzner VM. Always available, no home network dependency. The VM is already running, has capacity, and is reachable from anywhere.

## 3. Core Concept — Hybrid Vector + Knowledge Graph

Instead of separate tables per entity type (people, projects, tasks, etc.), the store uses a unified entity-graph model: one table for all knowledge objects, one table for connections between them. Embeddings are stored separately as chunks, supporting both short memories and long documents.

This gives two complementary retrieval paths:

1. **Vector search** — "find things semantically similar to X" via chunk embeddings
2. **Graph traversal** — "follow the connections from X to related entities" via edges

Vector search alone can miss structured relationships. If "Project Alpha involves Person X" and "Task Y belongs to Project Alpha," a graph pulls the full context chain in one traversal — something embedding similarity might not reliably surface.

## 4. Data Model

Seven tables. That's it.

### `entities` — all knowledge objects

Every piece of knowledge is an entity: a memory, a person, a project, a task, an interaction, a document. Type-specific fields live in the JSONB `metadata` column.

| Column     | Type        | Notes                                                                                 |
| ---------- | ----------- | ------------------------------------------------------------------------------------- |
| id         | UUID        | PK                                                                                    |
| type       | text        | `memory`, `person`, `project`, `task`, `interaction`, `document`                      |
| content    | text        | nullable — empty for external docs                                                    |
| visibility | text        | `personal`, `work`, `shared` — default `shared`, indexed                              |
| status     | text        | nullable — `active`, `done`, `inbox`, `next`, `waiting`, `scheduled`, `someday`, etc. |
| version    | int         | optimistic locking — incremented on every update                                      |
| tags       | text[]      | flexible categorization                                                               |
| source     | text        | which agent/tool wrote it                                                             |
| metadata   | jsonb       | type-specific fields (see below)                                                      |
| created_at | timestamptz |                                                                                       |
| updated_at | timestamptz |                                                                                       |

**Example metadata by type:**

- **memory:** `{ "namespace": "decisions", "key": "auth-approach" }`
- **person:** `{ "role": "engineer", "organization": "Acme", "relationship": "colleague" }`
- **project:** `{ "links": ["https://..."], "description": "..." }`
- **task:** `{ "context": "@focus-work", "due_date": "2026-04-01", "waiting_on": "Jan" }`
- **interaction:** `{ "interaction_type": "meeting", "participants": ["Jan", "Piet"], "action_items": ["..."] }`
- **document:** `{ "title": "Central Store Design" }` (content lives in chunks, source tracked in `document_sources`)

### `edges` — graph connections between entities

| Column     | Type        | Notes                                                                                 |
| ---------- | ----------- | ------------------------------------------------------------------------------------- |
| id         | UUID        | PK                                                                                    |
| source_id  | UUID        | FK → entities                                                                         |
| target_id  | UUID        | FK → entities                                                                         |
| relation   | text        | `involves`, `assigned_to`, `part_of`, `blocked_by`, `mentioned_in`, `related_to`, ... |
| confidence | float       | LLM-assigned confidence score                                                         |
| source     | text        | which agent created this edge                                                         |
| metadata   | jsonb       |                                                                                       |
| created_at | timestamptz |                                                                                       |

Edges are created automatically by an LLM extraction step on every write. The MCP server sends the new entity's content (plus nearby context) to a lightweight LLM, which identifies entities and relationships, matches them against existing rows (vector similarity + name matching), and creates edges.

### `chunks` — chunked content + embeddings

Embeddings are not stored on entities directly. Content is chunked and each chunk gets its own embedding. This supports both short memories (1 chunk) and long documents (many chunks).

| Column      | Type        | Notes                                            |
| ----------- | ----------- | ------------------------------------------------ |
| id          | UUID        | PK                                               |
| entity_id   | UUID        | FK → entities                                    |
| chunk_index | int         | ordering within the entity                       |
| content     | text        | the actual chunk text — needed for RAG retrieval |
| embedding   | vector      | pgvector                                         |
| model_id    | UUID        | FK → embedding_models                            |
| token_count | int         | useful for context budgeting                     |
| created_at  | timestamptz |                                                  |

### `embedding_models` — config tracking for reproducibility

| Column        | Type        | Notes                                              |
| ------------- | ----------- | -------------------------------------------------- |
| id            | UUID        | PK                                                 |
| name          | text        | `text-embedding-3-small`, `nomic-embed-text`, etc. |
| provider      | text        | `openai`, `ollama`, etc.                           |
| dimensions    | int         | 1536, 384, etc.                                    |
| chunk_size    | int         | tokens per chunk                                   |
| chunk_overlap | int         | overlap between chunks                             |
| is_active     | boolean     | which model is currently in use                    |
| metadata      | jsonb       | any other config                                   |
| created_at    | timestamptz |                                                    |

When switching embedding models: keep the old `embedding_models` row, create a new one with `is_active = true`, regenerate all chunks pointing at the new model. Can run both in parallel during transition.

### `api_keys` — authentication & authorization

| Column             | Type        | Notes                                                                          |
| ------------------ | ----------- | ------------------------------------------------------------------------------ |
| id                 | UUID        | PK                                                                             |
| name               | text        | human-readable label (`talon-personal`, `claude-code-work`)                    |
| key_hash           | text        | argon2 hash of the API key — plaintext never stored                            |
| key_prefix         | text        | first 8 chars of key, for identification in logs (`sk-talon-...`)              |
| scopes             | text[]      | `read`, `write`, `delete`, `sync`                                              |
| allowed_types      | text[]      | nullable — if set, restricts which entity types this key can access            |
| allowed_visibility | text[]      | which visibility scopes this key can read/write (`personal`, `work`, `shared`) |
| is_active          | boolean     | soft revocation — set to false to disable                                      |
| created_at         | timestamptz |                                                                                |
| last_used_at       | timestamptz | updated on every authenticated request                                         |

### `document_sources` — external document tracking

For documents whose source of truth lives outside the database (e.g., markdown files in git repos). The store holds chunks and embeddings for RAG, but doesn't own the content.

| Column      | Type        | Notes                                         |
| ----------- | ----------- | --------------------------------------------- |
| id          | UUID        | PK                                            |
| entity_id   | UUID        | FK → entities (type=`document`)               |
| repo        | text        | `personal-notes`, `cf-notes`, etc.            |
| path        | text        | `Side projects/talon-central-store-design.md` |
| sha         | text        | git SHA of the file content                   |
| last_synced | timestamptz | when we last checked/embedded                 |
| sync_status | text        | `current`, `stale`, `error`                   |

**Sync flow (push-based):**

The CLI tool (`pgm sync`) runs locally where the repos live. The server never needs git access. This can be scheduled via cron or run manually.

1. **`pgm sync <repo-path>`** — the CLI walks the local repo, computes SHA-256 per file (same approach as obsidian-autopilot-backend), compares against stored SHAs via `GET /api/sync/status`
2. **New file** → CLI reads content, pushes to `POST /api/sync/push` with repo, path, sha, and content. Server creates entity (type=`document`), `document_sources` row, chunks content, embeds
3. **SHA changed** → CLI pushes updated content. Server deletes old chunks, re-chunks, re-embeds. Entity and edges get updated, not recreated, so inbound links from other entities survive
4. **File deleted** → CLI reports deletion. Server marks entity as archived, keeps edges as historical context

```bash
# Manual sync
pgm sync ~/Documents/personal-notes
pgm sync ~/Documents/cf-notes --path "architecture/"

# Cron (e.g. every 30 min)
*/30 * * * * /usr/local/bin/pgm sync ~/Documents/personal-notes --quiet

# Backup (daily at 2am, encrypted to NAS)
0 2 * * * /usr/local/bin/pgm backup --encrypt --output /Volumes/NAS/postgram/
```

## 5. Server Design

Containerized Node.js/TypeScript service. Runs alongside Postgres on Hetzner. The core logic lives in a **service layer** that is transport-agnostic — MCP, REST, and CLI all call into the same functions.

```
                                    ┌─────────────────┐
[Talon]         ── MCP (SSE) ──────>│                 │
[Claude Code]   ── MCP (SSE) ──────>│  Transport      │
[Work Agent]    ── MCP (SSE) ──────>│  Layer          │──> Service Layer ──> Postgres
[CLI tool]      ── REST API ───────>│  (MCP + REST)   │
[Skills/Scripts] ── REST API ──────>│                 │
                                    └─────────────────┘
```

### Transports

**MCP (SSE):** Standard MCP remote transport. Exposes tools with names and descriptions. Agents discover capabilities via the MCP tool listing. Works over HTTPS behind Caddy.

**REST API:** Same operations as MCP, exposed as standard HTTP endpoints. Enables the CLI tool, scripts, webhooks, and any non-MCP client. Simple JSON request/response.

```
POST   /api/entities          → store
GET    /api/entities/:id      → recall
PATCH  /api/entities/:id      → update
DELETE /api/entities/:id      → delete (soft)
POST   /api/search            → search
POST   /api/edges             → link
GET    /api/entities/:id/graph → expand
POST   /api/sync/push         → sync_push (CLI pushes file content)
GET    /api/sync/status       → sync_status
DELETE /api/sync/:repo/:path  → sync_delete (file removed from repo)
```

**CLI tool (`pgm`):** Thin client over the REST API. Useful for manual operations — capturing notes/thoughts while working, quick lookups, GTD reviews. Also powerful as a skill target for agents.

```bash
pgm store "decided to use pgvector over dedicated graph DB" --type memory --tags decisions,architecture
pgm search "auth decisions" --type memory
pgm task add "set up Caddy TLS for store endpoint" --context @focus-work
pgm task list --status next
pgm expand <entity-id> --depth 2
pgm sync personal-notes
```

A Claude Code skill wrapping `pgm` gives any agent structured access without needing MCP configuration. The skill describes the commands, the agent calls them via bash.

### Authentication & Authorization

API key in the `Authorization` header (`Bearer <key>`). One key per agent/client.

**API keys have scopes:**

| Scope    | Allows                                            |
| -------- | ------------------------------------------------- |
| `read`   | search, recall, expand, list                      |
| `write`  | store, update, link, log_interaction, task_create |
| `delete` | soft-delete entities                              |
| `sync`   | sync_repo, sync_status                            |

`sync` is the highest privilege exposed over the network. **Admin operations are not available via the API or MCP** — they run exclusively inside the container (see Admin CLI below).

**Keys can also have type restrictions:**

```json
{
  "key": "sk-work-agent-...",
  "scopes": ["read", "write"],
  "allowed_types": ["task", "project", "interaction"],
  "visibility": ["work", "shared"]
}
```

This means the work agent can't read personal memories, and the personal agent can't write to work projects. Enforced at the service layer, not the transport.

### Entity visibility

Entities have a top-level `visibility` column (`personal`, `work`, or `shared`), indexed for fast filtering. The service layer filters all query results based on the calling key's allowed visibility scopes. Default visibility is `shared` unless specified.

### Optimistic locking

Entities have a `version` column (integer, starts at 1). Every update must include the current version in the request. The service layer uses `UPDATE ... WHERE id = $1 AND version = $2` — if the version doesn't match (concurrent write), the update fails with HTTP 409 Conflict. The response includes the current entity state so the client can decide how to proceed. The CLI tool handles this by warning the user and offering to overwrite or abort.

### Audit log

Every operation is logged:

| Column     | Type        | Notes                                       |
| ---------- | ----------- | ------------------------------------------- |
| id         | UUID        | PK                                          |
| api_key_id | text        | which key made the request                  |
| operation  | text        | `store`, `search`, `recall`, `expand`, etc. |
| entity_id  | UUID        | nullable — the entity acted on              |
| details    | jsonb       | query params, result count, etc.            |
| timestamp  | timestamptz |                                             |

Cheap table, append-only. Useful for debugging agent behavior and detecting key misuse.

### Write pipeline

Every write operation follows this pipeline:

1. **Authorize** — check key scopes and type/visibility restrictions
2. **Version check** — if update, verify version matches (optimistic locking). Fail with 409 if stale.
3. **Store** the entity in `entities` (increment version)
4. **Chunk** the content (or use as-is if short)
5. **Embed** each chunk via the active embedding model
6. **Store** chunks in `chunks`
7. **Log** the operation to the audit log

Steps 4-6 can be async — write the entity immediately, queue the enrichment.

**Phase 3 adds** steps between 6 and 7: extract entities/relationships via LLM, match against existing rows, create edges. The pipeline is designed to accommodate this without changing the Phase 1 contract.

### Operations

**Core:**

- `store(content, type, tags?, metadata?)` — create or update an entity
- `recall(id)` — get an entity by ID
- `update(id, fields)` — update an entity
- `search(query, type?, tags?, limit?, follow_connections?)` — vector search over chunks → return chunk content + parent entity, optionally expand graph neighbors. See search ranking below
- `delete(id)` — soft-delete an entity

**Graph:**

- `link(source_id, target_id, relation)` — manually create an edge
- `expand(id, depth?, relation_types?)` — return graph neighborhood up to N hops

**Convenience wrappers** (thin sugar over store + link):

- `task_create(text, context?, project?, due_date?)` — store(type="task") + link to project
- `task_list(status?, context?, project?)` — filtered listing
- `task_update(id, fields)` — change status, context, etc.
- `task_complete(id)` — mark done with timestamp
- `log_interaction(summary, participants?, action_items?)` — store(type="interaction") + link to people

**Document sync:**

- `sync_push(repo, path, sha, content)` — push file content from CLI to server
- `sync_status(repo?)` — show what's current/stale/errored

### Search ranking

Phase 1 uses cosine similarity via pgvector's `<=>` operator, which is sufficient for a personal-scale store. Results are ranked by:

1. **Cosine similarity** (primary) — pgvector handles this natively
2. **Recency boost** (secondary) — optional multiplier that gently favors recent entities. Formula: `score * (1 + recency_weight * decay(age))` where `decay` is exponential with a configurable half-life (default 30 days). Can be disabled per query.
3. **Type filtering** — not a ranking factor, but a pre-filter that narrows the search space before similarity computation

This is intentionally simple. Cosine similarity alone works well for short-to-medium content at personal scale. The recency boost prevents old memories from always winning on common topics. More sophisticated ranking (BM25 hybrid, edge-boosted) is deferred to Phase 2+ when graph data is available.

Configurable similarity threshold (default 0.35 for OpenAI embeddings, 0.60 for Ollama — based on working values from obsidian-autopilot-backend) to filter low-quality matches.

### Admin CLI (`pgm-admin`) — container-only

Admin operations have **zero network exposure**. `pgm-admin` is a separate binary baked into the Docker image that connects directly to Postgres over the internal Docker network. No API key, no HTTP, no TLS — access requires SSH to the Hetzner VM + `docker exec`.

```bash
# Key management
docker exec -it mcp-server pgm-admin key create --name "talon-personal" --scopes read,write --visibility personal,shared
docker exec -it mcp-server pgm-admin key list
docker exec -it mcp-server pgm-admin key revoke <id>

# Audit log
docker exec -it mcp-server pgm-admin audit --since 2026-03-17
docker exec -it mcp-server pgm-admin audit --key talon-work --operation search

# Embedding model management
docker exec -it mcp-server pgm-admin model list
docker exec -it mcp-server pgm-admin model set-active <model-id>
docker exec -it mcp-server pgm-admin reembed --model <model-id>  # batch re-embed all chunks

# Database maintenance
docker exec -it mcp-server pgm-admin prune --stale-edges --older-than 90d
docker exec -it mcp-server pgm-admin stats  # entity counts, chunk counts, storage usage
```

For convenience, alias locally:

```bash
alias pgm-admin="ssh hetzner docker exec -it mcp-server pgm-admin"
```

This removes the "leaked admin key" attack vector entirely. Two layers of auth (SSH + Docker exec) that are already trusted.

### Embedding generation

All write operations auto-generate embeddings. Two options:

- **API (OpenAI `text-embedding-3-small`):** ~$0.02/1M tokens. Simple, no local resources needed. 1536 dimensions.
- **Local (Ollama on home server):** Free after setup. `nomic-embed-text` or similar. 384-768 dimensions. More private.

Start with API for simplicity. Switch to local later if volume justifies it. The `embedding_models` table makes this a clean transition.

### LLM for relation extraction

A lightweight model (Haiku-class or local via Ollama) is sufficient for entity/relation extraction on write. This is the key cost driver beyond embeddings — but at personal scale with mostly short content, it's negligible.

## 6. Security

### Threat model

This store will hold personal memories, work context, people information, and indexed documents. The threat model for personal infrastructure:

| Threat                    | Mitigation                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| VM compromise (Hetzner)   | Volume encryption (LUKS), strong SSH keys, no password auth                                                  |
| API key leak              | Scoped keys limit blast radius, audit log detects misuse, key rotation via admin CLI (no admin keys to leak) |
| Network sniffing          | TLS everywhere (Caddy), MCP and REST both over HTTPS                                                         |
| Backup exposure           | Encrypt `pg_dump` output with a separate key before pushing to NAS                                           |
| Unauthorized agent access | Per-key type and visibility restrictions, service-layer enforcement                                          |

### Encryption

**In transit:** TLS via Caddy for all API/MCP traffic.

**At rest:** LUKS volume encryption on the Hetzner VM. Protects against disk theft and snapshot leaks. This covers Postgres data, chunks, embeddings — everything.

**Field-level encryption** is an option for highly sensitive content (encrypt before storing, decrypt on read). Trade-off: encrypted content can't be chunked or embedded for semantic search. Pragmatic approach: volume encryption + TLS + scoped keys covers 99% of the threat model. Field-level encryption only if specific entities require it (mark in metadata, skip embedding for those).

### Key management

- Keys stored hashed in the database (like passwords — bcrypt or argon2)
- Key creation returns the plaintext once, never stored
- Key rotation: create new key, update client config, revoke old key
- All key management via `pgm-admin` inside the container — no admin endpoints on the network
- Emergency revocation: `ssh hetzner docker exec -it mcp-server pgm-admin key revoke <id>`

## 7. Migration Path

Getting from current Talon memory to the central store:

1. **Export** all current `memory_access` entries from Talon's KV store
2. **Import** as entities (type=`memory`), running through the write pipeline (chunk, embed)
3. **Update Talon config** to point `memory_access` tool calls at the new MCP server
4. **Sync git repos** — run `sync_repo` for cf-notes and personal-notes to index existing documents
5. **Keep git repos as-is** — they serve a different purpose (long-form notes, version history, human-readable docs). The store indexes them for RAG but doesn't replace them.

Transition period: flag in Talon's config to switch over, with a fallback read from the old store. Keep old store read-only as a safety net.

## 8. Infrastructure

### Docker Compose on Hetzner VM

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: postgram
      POSTGRES_USER: talon
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    restart: unless-stopped

  mcp-server:
    build: ./mcp-server
    ports:
      - "127.0.0.1:3100:3100"
    environment:
      DATABASE_URL: postgres://talon:${POSTGRES_PASSWORD}@postgres:5432/postgram
      API_KEYS: ${API_KEYS}
      OPENAI_API_KEY: ${OPENAI_API_KEY} # for embeddings
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  pgdata:
```

Reverse proxy (Caddy) handles TLS for the MCP endpoint. Already have Caddy on the Hetzner VM for other services.

### Resource estimates

- Postgres: 256-512MB RAM, minimal CPU
- MCP server: ~128MB RAM
- Storage: <1GB for years of personal data
- Cost: zero incremental — already covered by the existing Hetzner VM

## 9. Open Questions

- **Embedding model:** Start with OpenAI API, but local (Ollama) is cheaper and more private long-term. Decision can be deferred — the `embedding_models` table makes switching clean.
- **Vector dimensions:** 1536 (OpenAI) vs 384 (local). Not a big deal at personal scale. The `embedding_models` table tracks this, and re-embedding is a one-time batch job.
- **LLM for extraction (Phase 2+):** API (Haiku) vs local (Ollama). Same trade-off as embeddings — start with API, move local if it makes sense. Deferred until graph phase.
- **Edge confidence threshold (Phase 2+):** When traversing the graph, should low-confidence edges be filtered? Or always returned with the score and let the client decide?
- **Entity resolution (Phase 2+):** How to handle near-duplicate entities ("Jan" vs "Jan de Vries")? Needs a dedup strategy before graph extraction is useful.

## 10. Implementation Phases

### Phase 1 — MVP (replaces Talon memory + vector search + CLI)

- Postgres + pgvector container on Hetzner (Docker Compose)
- `entities`, `chunks`, `embedding_models`, `api_keys`, `audit_log` tables
- MCP server with `store` / `recall` / `search` / `update` / `delete`
- Embedding pipeline (OpenAI `text-embedding-3-small`)
- Chunking (port from obsidian-autopilot-backend: RecursiveCharacterTextSplitter, 300 chars, 100 overlap)
- Search with cosine similarity + recency boost + configurable threshold
- API key auth (scoped, with visibility filtering)
- Optimistic locking on entity updates
- REST API alongside MCP
- CLI tool (`pgm`) — store, search, recall, task CRUD
- `pgm backup` command (encrypted `pg_dump` to local path, schedulable via cron)
- Migration script for existing Talon memories
- Talon switched from built-in memory to Postgram MCP
- Claude Code configured as MCP client
- Basic smoke tests

### Phase 2 — Document Sync

- `document_sources` table
- Push-based sync via CLI (`pgm sync <repo-path>`)
- SHA-256 change detection (port from obsidian-autopilot-backend)
- Chunking pipeline for long documents
- Initial sync of personal-notes and cf-notes
- Cron-schedulable sync

### Phase 3 — Knowledge Graph

- `edges` table
- LLM extraction pipeline on write (Haiku-class or local Ollama)
- Entity resolution / dedup strategy
- `link` and `expand` tools
- Graph-enhanced search (search → expand neighbors)
- Manual edge creation/deletion for correcting extraction errors

### Phase 4 — Integration & Convenience

- Agent split: work and personal agents with different API keys
- GTD skill wired up to task tools
- Convenience wrappers (`task_create`, `log_interaction`, etc.)
- Claude Code skill wrapping `pgm` for non-MCP agents

### Phase 5 — Intelligence

- Automatic relationship strengthening (repeated co-occurrence → higher confidence)
- Periodic consolidation (merge duplicate entities, prune stale edges)
- Analytics: what topics come up most, what's been sitting in inbox too long, what's neglected
- Maybe: auto-tagging, duplicate detection, stale memory cleanup
