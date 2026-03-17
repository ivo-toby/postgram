# Postgram — Phase 1 Implementation Spec

**Date:** 2026-03-17
**Companion doc:** `specs/postgram-brief.md` (design rationale, architecture, phasing)
**Scope:** Phase 1 MVP — replaces Talon memory, adds vector search, CLI, REST + MCP transports

---

## 1. Postgres Schema

All tables live in the `public` schema. Extensions enabled: `pgvector`, `pgcrypto`.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 1.1 `entities`

```sql
CREATE TABLE entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('memory', 'person', 'project', 'task', 'interaction', 'document')),
  content     text,
  visibility  text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('personal', 'work', 'shared')),
  status      text CHECK (status IN ('active', 'done', 'archived', 'inbox', 'next', 'waiting', 'scheduled', 'someday')),
  version     integer NOT NULL DEFAULT 1,
  tags        text[] NOT NULL DEFAULT '{}',
  source      text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_entities_type ON entities (type);
CREATE INDEX idx_entities_visibility ON entities (visibility);
CREATE INDEX idx_entities_status ON entities (status) WHERE status IS NOT NULL;
CREATE INDEX idx_entities_tags ON entities USING gin (tags);
CREATE INDEX idx_entities_metadata ON entities USING gin (metadata jsonb_path_ops);
CREATE INDEX idx_entities_created_at ON entities (created_at DESC);
```

**Auto-update trigger for `updated_at`:**

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**Edge cases:**
- `content` is nullable — documents may have content only in chunks, persons may be metadata-only
- `status` is nullable — not all entity types use it (e.g., a person has no status)
- `version` starts at 1, incremented on every successful update
- `tags` defaults to empty array, not NULL — simplifies queries (`@>` works on empty arrays)
- `source` tracks which agent/client wrote the entity (e.g., `talon-personal`, `claude-code`)

### 1.2 `chunks`

```sql
CREATE TABLE chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content     text NOT NULL,
  embedding   vector(1536) NOT NULL,
  model_id    uuid NOT NULL REFERENCES embedding_models(id),
  token_count integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, chunk_index)
);

CREATE INDEX idx_chunks_entity_id ON chunks (entity_id);
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
```

**Design notes:**
- `ON DELETE CASCADE` — deleting an entity removes its chunks automatically
- `UNIQUE (entity_id, chunk_index)` — prevents duplicate chunks for the same position
- HNSW index params: `m=16` (connections per node), `ef_construction=200` (build quality). These are good defaults for <100K vectors. Personal scale will be well under this.
- `vector(1536)` is fixed to OpenAI `text-embedding-3-small`. When switching models, create a new `embedding_models` row and re-embed all chunks.
- `token_count` is the OpenAI token count for the chunk text, useful for context budgeting in RAG

### 1.3 `embedding_models`

```sql
CREATE TABLE embedding_models (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  provider      text NOT NULL,
  dimensions    integer NOT NULL,
  chunk_size    integer NOT NULL,
  chunk_overlap integer NOT NULL,
  is_active     boolean NOT NULL DEFAULT false,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only one active model at a time
CREATE UNIQUE INDEX idx_embedding_models_active ON embedding_models (is_active) WHERE is_active = true;
```

**Seed data (inserted by migration):**

```sql
INSERT INTO embedding_models (name, provider, dimensions, chunk_size, chunk_overlap, is_active)
VALUES ('text-embedding-3-small', 'openai', 1536, 300, 100, true);
```

**Design notes:**
- Partial unique index on `is_active WHERE true` enforces single active model at DB level
- `chunk_size` and `chunk_overlap` are in characters (matching obsidian-autopilot-backend convention)
- `metadata` can hold provider-specific config (e.g., `{"base_url": "...", "api_version": "..."}`)

### 1.4 `api_keys`

```sql
CREATE TABLE api_keys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL UNIQUE,
  key_hash           text NOT NULL,
  key_prefix         text NOT NULL,
  scopes             text[] NOT NULL DEFAULT '{read}',
  allowed_types      text[],
  allowed_visibility text[] NOT NULL DEFAULT '{shared}',
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

CREATE INDEX idx_api_keys_prefix ON api_keys (key_prefix) WHERE is_active = true;
```

**Design notes:**
- `key_hash` stores argon2id hash (includes salt, algorithm params in the hash string)
- `key_prefix` stores first 8 chars of the plaintext key for log identification (e.g., `pgm-talo`)
- `allowed_types` is nullable — NULL means "all types allowed"
- `allowed_visibility` defaults to `{shared}` — explicit grant required for `personal` or `work`
- `name` is UNIQUE — human-readable label like `talon-personal`, `claude-code-work`
- Index on `key_prefix` with `WHERE is_active` for fast lookup during auth

**Key format:** `pgm-<name>-<random>` (e.g., `pgm-talon-personal-a1b2c3d4e5f6...`). 32 random bytes, base62 encoded.

### 1.5 `audit_log`

```sql
CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES api_keys(id),
  operation  text NOT NULL,
  entity_id  uuid,
  details    jsonb NOT NULL DEFAULT '{}',
  timestamp  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_timestamp ON audit_log (timestamp DESC);
CREATE INDEX idx_audit_log_api_key ON audit_log (api_key_id);
CREATE INDEX idx_audit_log_operation ON audit_log (operation);
```

**Design notes:**
- `api_key_id` references `api_keys(id)` but no CASCADE — audit entries survive key deletion
- `entity_id` is nullable — some operations (search, list) don't target a specific entity
- `details` holds operation-specific context: query params for search, field changes for updates, result counts
- Append-only: application never issues UPDATE or DELETE on this table

### 1.6 Migration script

```sql
-- 001_initial_schema.sql
-- Runs all CREATE statements above in order:
-- 1. Extensions (vector, pgcrypto)
-- 2. embedding_models (no FK deps)
-- 3. api_keys (no FK deps)
-- 4. entities (no FK deps)
-- 5. chunks (references entities, embedding_models)
-- 6. audit_log (references api_keys)
-- 7. Triggers (update_updated_at)
-- 8. Seed data (active embedding model)
```

Migration runner: simple numbered SQL files in `src/db/migrations/`, executed in order. Track applied migrations in a `schema_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 2. Project Structure

```
postgram/
├── SPEC.md                          # This file
├── specs/
│   └── postgram-brief.md            # Design document
├── docker-compose.yml               # Postgres + mcp-server
├── Dockerfile                       # Multi-stage build for mcp-server
├── .env.example                     # Template for env vars
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Entry point — starts MCP + HTTP servers
│   ├── config.ts                    # Env var loading, validation, typed config object
│   ├── db/
│   │   ├── pool.ts                  # pg Pool setup, connection config
│   │   ├── migrations/
│   │   │   └── 001_initial_schema.sql
│   │   └── migrate.ts              # Migration runner (reads SQL files, tracks in schema_migrations)
│   ├── services/
│   │   ├── entity-service.ts        # store, recall, update, delete, list
│   │   ├── search-service.ts        # vector search with recency boost
│   │   ├── task-service.ts          # task convenience wrappers (create, list, update, complete)
│   │   ├── embedding-service.ts     # OpenAI embedding generation, batch processing
│   │   └── chunking-service.ts      # Text splitting (port from obsidian-autopilot-backend)
│   ├── auth/
│   │   ├── middleware.ts            # Hono middleware — extract Bearer token, validate, attach to context
│   │   ├── key-service.ts          # Key creation (argon2 hash), validation, scope checking
│   │   └── types.ts                # AuthContext, ApiKeyRecord types
│   ├── transport/
│   │   ├── rest.ts                  # Hono routes — maps HTTP to service layer
│   │   └── mcp.ts                   # MCP server setup — registers tools, maps to service layer
│   ├── types/
│   │   ├── entities.ts              # Entity, Chunk, EmbeddingModel types
│   │   ├── api.ts                   # Request/response shapes, error format
│   │   └── common.ts               # Shared types (PaginatedResult, ServiceResult, etc.)
│   └── util/
│       ├── errors.ts                # AppError class, error codes, toHttpStatus mapping
│       ├── logger.ts                # Structured logger (pino)
│       └── audit.ts                 # Audit log helper — appendAuditEntry()
├── src/cli/
│   ├── pgm.ts                       # CLI entry point (commander)
│   ├── commands/
│   │   ├── store.ts                 # pgm store
│   │   ├── search.ts               # pgm search
│   │   ├── recall.ts               # pgm recall
│   │   ├── update.ts               # pgm update
│   │   ├── delete.ts               # pgm delete
│   │   ├── task.ts                  # pgm task (add/list/update/complete)
│   │   └── backup.ts               # pgm backup
│   ├── admin/
│   │   ├── pgm-admin.ts            # Admin CLI entry point
│   │   ├── key.ts                   # pgm-admin key (create/list/revoke)
│   │   ├── audit.ts                 # pgm-admin audit
│   │   ├── model.ts                # pgm-admin model (list/set-active)
│   │   └── stats.ts                # pgm-admin stats
│   └── client.ts                    # HTTP client for CLI → REST API calls
├── src/migrate-talon/
│   ├── index.ts                     # Talon migration entry point
│   ├── reader.ts                    # SQLite reader for Talon's memory_items
│   └── transformer.ts              # Maps Talon MemoryItem → Postgram entity
└── tests/
    └── smoke/
        ├── health.test.ts           # Health endpoint
        ├── store-recall.test.ts     # Store + recall round-trip
        ├── search.test.ts           # Vector search
        ├── auth.test.ts             # Key validation, scope enforcement
        └── task.test.ts             # Task CRUD
```

### 2.1 Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "pg": "^8.x",
    "pgvector": "^0.2.x",
    "hono": "^4.x",
    "@hono/node-server": "^1.x",
    "openai": "^4.x",
    "argon2": "^0.40.x",
    "commander": "^12.x",
    "pino": "^9.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "vitest": "^2.x",
    "@types/pg": "^8.x",
    "@types/node": "^20.x"
  }
}
```

**Key choices:**
- `pgvector` npm package — JS bindings for pgvector types, registers vector type with pg
- `zod` — runtime validation for all API inputs (request bodies, query params, MCP tool args)
- `pino` — structured JSON logging, low overhead
- `tsx` — TypeScript execution for development (`tsx src/index.ts`)
- `vitest` — test runner, compatible with TypeScript out of the box
- `commander` — CLI framework, mature and lightweight
- No ORM — raw SQL with typed query helpers

---

## 3. Service Layer API

All service functions are transport-agnostic. They accept typed inputs and return `ServiceResult<T>` — a discriminated union:

```typescript
type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

class AppError {
  constructor(
    public code: ErrorCode,
    public message: string,
    public details?: Record<string, unknown>
  ) {}
}

type ErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'           // optimistic locking failure
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'EMBEDDING_FAILED'
  | 'INTERNAL';
```

### 3.1 `entity-service.ts`

```typescript
// AuthContext is attached by middleware — passed through to all service calls
interface AuthContext {
  keyId: string;
  keyName: string;
  scopes: string[];
  allowedTypes: string[] | null;   // null = all types
  allowedVisibility: string[];
}

// --- store ---
interface StoreInput {
  content?: string;
  type: EntityType;
  visibility?: 'personal' | 'work' | 'shared';  // default: 'shared'
  status?: string;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
}

interface StoredEntity {
  id: string;
  type: string;
  content: string | null;
  visibility: string;
  status: string | null;
  version: number;
  tags: string[];
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;   // ISO 8601
  updated_at: string;
}

function store(input: StoreInput, auth: AuthContext): Promise<ServiceResult<StoredEntity>>
// 1. Validate auth: requires 'write' scope, type must be in allowedTypes, visibility in allowedVisibility
// 2. INSERT into entities
// 3. If content is non-empty: chunk → embed → store chunks (async, non-blocking — entity returned immediately)
// 4. Append audit log entry
// Returns: the created entity with id, version=1

// --- recall ---
function recall(id: string, auth: AuthContext): Promise<ServiceResult<StoredEntity>>
// 1. Validate auth: requires 'read' scope
// 2. SELECT from entities WHERE id = $1
// 3. Filter: entity visibility must be in auth.allowedVisibility
// 4. Filter: entity type must be in auth.allowedTypes (if set)
// Returns: entity or NOT_FOUND

// --- update ---
interface UpdateInput {
  content?: string;
  visibility?: string;
  status?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  version: number;  // required — optimistic locking
}

function update(id: string, input: UpdateInput, auth: AuthContext): Promise<ServiceResult<StoredEntity>>
// 1. Validate auth: requires 'write' scope, type/visibility checks
// 2. UPDATE entities SET ... WHERE id = $1 AND version = $2
// 3. If 0 rows affected: fetch current entity, return CONFLICT with current state
// 4. If content changed: delete old chunks, re-chunk → re-embed → store new chunks
// 5. Append audit log entry
// Returns: updated entity with version incremented

// --- delete (soft) ---
function softDelete(id: string, auth: AuthContext): Promise<ServiceResult<{ id: string; deleted: true }>>
// 1. Validate auth: requires 'delete' scope, type/visibility checks
// 2. UPDATE entities SET status = 'archived' WHERE id = $1
// 3. Does NOT delete chunks — archived entities are still searchable (intentional)
// 4. Append audit log entry
// Returns: { id, deleted: true } or NOT_FOUND

// --- list ---
interface ListInput {
  type?: EntityType;
  status?: string;
  visibility?: string;
  tags?: string[];         // entities must contain ALL of these tags
  limit?: number;          // default: 50, max: 200
  offset?: number;         // default: 0
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

function list(input: ListInput, auth: AuthContext): Promise<ServiceResult<PaginatedResult<StoredEntity>>>
// 1. Validate auth: requires 'read' scope
// 2. Apply auth filters (allowedTypes, allowedVisibility) on top of user filters
// 3. SELECT with WHERE clauses, ORDER BY created_at DESC
// 4. COUNT(*) for total (separate query)
// Returns: paginated entity list
```

**Edge cases:**
- `store` with no `content` — allowed for metadata-only entities (e.g., person with just metadata). No chunks created.
- `update` with version mismatch — returns `CONFLICT` with the current entity state so the client can retry or merge.
- `update` that changes `type` — not allowed. Type is immutable after creation. Return `VALIDATION` error.
- `softDelete` on already-archived entity — idempotent, returns success.
- `list` with conflicting auth filters — e.g., user requests `visibility=personal` but key only allows `shared`. Return empty results, not an error.

### 3.2 `search-service.ts`

```typescript
interface SearchInput {
  query: string;
  type?: EntityType;
  tags?: string[];
  visibility?: string;
  limit?: number;            // default: 10, max: 50
  threshold?: number;        // default: 0.35 for OpenAI
  recency_weight?: number;   // default: 0.1, set to 0 to disable
}

interface SearchResult {
  entity: StoredEntity;
  chunk_content: string;    // the matching chunk's text
  score: number;            // final score (similarity * recency boost)
  similarity: number;       // raw cosine similarity
}

function search(input: SearchInput, auth: AuthContext): Promise<ServiceResult<SearchResult[]>>
// 1. Validate auth: requires 'read' scope
// 2. Embed the query string using active embedding model
// 3. Execute vector search:
//    SELECT c.content, c.entity_id,
//           1 - (c.embedding <=> $query_embedding) AS similarity,
//           e.*
//    FROM chunks c
//    JOIN entities e ON c.entity_id = e.id
//    WHERE e.visibility = ANY($allowed_visibility)
//      AND ($type IS NULL OR e.type = $type)
//      AND ($tags IS NULL OR e.tags @> $tags)
//      AND e.status != 'archived'
//      AND 1 - (c.embedding <=> $query_embedding) >= $threshold
//    ORDER BY c.embedding <=> $query_embedding
//    LIMIT $limit
// 4. Apply recency boost in application code:
//    final_score = similarity * (1 + recency_weight * exp(-age_days / 30))
// 5. Re-sort by final_score descending
// 6. Deduplicate: if multiple chunks from same entity match, keep highest-scoring chunk
// 7. Append audit log entry with query and result count
```

**Recency boost formula:**
```
boost = 1 + (recency_weight * e^(-age_days / half_life))
final_score = similarity * boost
```
- `recency_weight` default: 0.1 (10% max boost for brand-new entities)
- `half_life`: 30 days (hardcoded for Phase 1)
- Effect: a 0-day-old entity gets 10% boost, a 30-day-old entity gets ~3.7% boost, a 90-day-old entity gets ~0.5% boost
- Set `recency_weight=0` to disable entirely

**Edge cases:**
- Empty query string — return `VALIDATION` error
- No results above threshold — return empty array, not an error
- Embedding API failure — return `EMBEDDING_FAILED` error with details
- Multiple chunks from same entity — deduplicate, return only the best-matching chunk per entity

### 3.3 `task-service.ts`

Thin wrappers around `entity-service` with type preset to `task`.

```typescript
interface TaskCreateInput {
  content: string;
  context?: string;      // GTD context: @focus-work, @home, etc.
  status?: string;       // default: 'inbox'
  due_date?: string;     // ISO 8601 date
  tags?: string[];
  metadata?: Record<string, unknown>;
}

function taskCreate(input: TaskCreateInput, auth: AuthContext): Promise<ServiceResult<StoredEntity>>
// Calls entity-service.store() with:
//   type: 'task'
//   status: input.status ?? 'inbox'
//   metadata: { context: input.context, due_date: input.due_date, ...input.metadata }

interface TaskListInput {
  status?: string;
  context?: string;
  limit?: number;
  offset?: number;
}

function taskList(input: TaskListInput, auth: AuthContext): Promise<ServiceResult<PaginatedResult<StoredEntity>>>
// Calls entity-service.list() with:
//   type: 'task'
//   status: input.status
// Then filters by metadata.context if provided (JSONB query)

function taskUpdate(id: string, input: UpdateInput, auth: AuthContext): Promise<ServiceResult<StoredEntity>>
// Calls entity-service.update() — no extra logic

function taskComplete(id: string, version: number, auth: AuthContext): Promise<ServiceResult<StoredEntity>>
// Calls entity-service.update() with:
//   status: 'done'
//   metadata merge: { completed_at: new Date().toISOString() }
```

### 3.4 `embedding-service.ts`

```typescript
interface EmbeddingService {
  // Embed a single text (for search queries)
  embedQuery(text: string): Promise<number[]>;

  // Embed multiple texts (for chunks — batched)
  embedBatch(texts: string[]): Promise<number[][]>;

  // Get current model config
  getActiveModel(): Promise<EmbeddingModel>;
}
```

**Implementation details:**
- Uses OpenAI SDK `openai.embeddings.create()` with `model: 'text-embedding-3-small'`
- Batch size: 100 texts per API call (OpenAI limit is 2048, but 100 keeps memory reasonable)
- Retry: 3 attempts with exponential backoff (1s, 2s, 4s) on 429/5xx errors
- Normalization: OpenAI `text-embedding-3-small` returns pre-normalized vectors; no L2 normalization needed
- Error: wraps OpenAI errors into `AppError` with code `EMBEDDING_FAILED`

### 3.5 `chunking-service.ts`

Port of obsidian-autopilot-backend's `RecursiveCharacterTextSplitter` logic to TypeScript.

```typescript
interface ChunkingConfig {
  chunkSize: number;       // default: 300 (characters)
  chunkOverlap: number;    // default: 100 (characters)
  separators: string[];    // default: ["\n\n", "\n### ", "\n## ", "\n# ", "\n", ". ", "? ", "! ", "; "]
}

interface Chunk {
  content: string;
  index: number;
  tokenCount: number;      // estimated via tiktoken or simple word-based estimate
}

function chunkText(text: string, config?: Partial<ChunkingConfig>): Chunk[]
// 1. If text length <= chunkSize: return single chunk
// 2. Try splitting by first separator in list
// 3. If resulting pieces are still > chunkSize, try next separator recursively
// 4. Merge small pieces back together up to chunkSize, respecting overlap
// 5. Assign sequential chunk_index starting from 0
// 6. Estimate token count per chunk (chars / 4 as rough estimate, or use tiktoken)
// Fallback: if all separators fail, hard-split at chunkSize boundaries with overlap
```

**Token counting:** Use `gpt-tokenizer` package (lightweight tiktoken port for JS) for accurate counts. Fall back to `Math.ceil(text.length / 4)` if tokenizer fails.

**Edge cases:**
- Empty or whitespace-only content — return empty array (no chunks)
- Content shorter than `chunkSize` — return single chunk
- Content with no matching separators — hard-split at character boundaries
- Very long single word (>chunkSize) — hard-split mid-word (rare but handled)

### 3.6 Write Pipeline (orchestration)

The write pipeline runs after entity insertion. It can be synchronous (Phase 1) or async.

```typescript
async function runWritePipeline(entityId: string, content: string): Promise<void>
// 1. Get active embedding model config
// 2. Chunk the content using chunking-service
// 3. Embed all chunks using embedding-service (batched)
// 4. Store chunks in DB within a transaction:
//    a. DELETE FROM chunks WHERE entity_id = $1 (clear old chunks if re-indexing)
//    b. INSERT each chunk with embedding
// 5. On failure: log error, entity exists but has no chunks (searchable by metadata, not by vector)
```

**Phase 1 decision:** Run the pipeline synchronously within the store/update request. The API response waits for chunking + embedding to complete. This is simpler and acceptable at personal scale (embedding a few hundred chars takes <500ms). If latency becomes an issue, switch to async with a job queue in a later phase.

**Error handling:**
- If embedding fails, the entity is still stored — it just won't appear in vector searches. Error is logged and the response includes a warning field.
- If chunk storage fails (DB error), retry once. If still failing, log and move on — entity exists without chunks.

---

## 4. MCP Tool Definitions

MCP server uses `@modelcontextprotocol/sdk` with SSE transport. All tools share the same auth context (MCP connection is authenticated once at connection time via API key in the initial request headers).

### 4.1 `store`

```typescript
{
  name: "store",
  description: "Store a new knowledge entity (memory, person, project, task, interaction, or document). Content is automatically chunked and embedded for semantic search.",
  inputSchema: {
    type: "object",
    properties: {
      content:    { type: "string", description: "The text content to store" },
      type:       { type: "string", enum: ["memory", "person", "project", "task", "interaction", "document"], description: "Entity type" },
      visibility: { type: "string", enum: ["personal", "work", "shared"], default: "shared" },
      status:     { type: "string", description: "Entity status (e.g., active, inbox, next)" },
      tags:       { type: "array", items: { type: "string" }, description: "Tags for categorization" },
      metadata:   { type: "object", description: "Type-specific metadata (JSON)" }
    },
    required: ["type"]
  }
}
// Returns: { entity: StoredEntity }
```

### 4.2 `recall`

```typescript
{
  name: "recall",
  description: "Retrieve a specific entity by its ID.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid", description: "Entity UUID" }
    },
    required: ["id"]
  }
}
// Returns: { entity: StoredEntity }
```

### 4.3 `search`

```typescript
{
  name: "search",
  description: "Semantic search across all stored knowledge. Returns entities ranked by relevance to the query, with optional type/tag filtering and recency boosting.",
  inputSchema: {
    type: "object",
    properties: {
      query:          { type: "string", description: "Natural language search query" },
      type:           { type: "string", enum: ["memory", "person", "project", "task", "interaction", "document"] },
      tags:           { type: "array", items: { type: "string" }, description: "Filter to entities containing ALL of these tags" },
      limit:          { type: "number", default: 10, description: "Max results (1-50)" },
      threshold:      { type: "number", default: 0.35, description: "Minimum similarity score (0-1)" },
      recency_weight: { type: "number", default: 0.1, description: "Recency boost strength (0=disabled)" }
    },
    required: ["query"]
  }
}
// Returns: { results: SearchResult[] }
```

### 4.4 `update`

```typescript
{
  name: "update",
  description: "Update an existing entity. Requires the current version number for optimistic locking. Returns 409 Conflict if the version doesn't match.",
  inputSchema: {
    type: "object",
    properties: {
      id:         { type: "string", format: "uuid" },
      content:    { type: "string" },
      status:     { type: "string" },
      visibility: { type: "string", enum: ["personal", "work", "shared"] },
      tags:       { type: "array", items: { type: "string" } },
      metadata:   { type: "object" },
      version:    { type: "number", description: "Current version of the entity (required for optimistic locking)" }
    },
    required: ["id", "version"]
  }
}
// Returns: { entity: StoredEntity }
// Error: { code: "CONFLICT", current: StoredEntity } if version mismatch
```

### 4.5 `delete`

```typescript
{
  name: "delete",
  description: "Soft-delete an entity (sets status to 'archived'). The entity remains in the database but is excluded from search results.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" }
    },
    required: ["id"]
  }
}
// Returns: { id: string, deleted: true }
```

### 4.6 `task_create`

```typescript
{
  name: "task_create",
  description: "Create a new task. Shortcut for store(type='task') with task-specific fields.",
  inputSchema: {
    type: "object",
    properties: {
      content:  { type: "string", description: "Task description" },
      context:  { type: "string", description: "GTD context (e.g., @focus-work, @home)" },
      status:   { type: "string", default: "inbox", description: "Task status" },
      due_date: { type: "string", description: "Due date (ISO 8601)" },
      tags:     { type: "array", items: { type: "string" } }
    },
    required: ["content"]
  }
}
```

### 4.7 `task_list`

```typescript
{
  name: "task_list",
  description: "List tasks, optionally filtered by status and GTD context.",
  inputSchema: {
    type: "object",
    properties: {
      status:  { type: "string", description: "Filter by status (inbox, next, waiting, active, done, etc.)" },
      context: { type: "string", description: "Filter by GTD context" },
      limit:   { type: "number", default: 50 },
      offset:  { type: "number", default: 0 }
    }
  }
}
```

### 4.8 `task_update`

```typescript
{
  name: "task_update",
  description: "Update a task's fields (status, content, context, due_date, etc.).",
  inputSchema: {
    type: "object",
    properties: {
      id:       { type: "string", format: "uuid" },
      content:  { type: "string" },
      status:   { type: "string" },
      context:  { type: "string" },
      due_date: { type: "string" },
      tags:     { type: "array", items: { type: "string" } },
      version:  { type: "number" }
    },
    required: ["id", "version"]
  }
}
```

### 4.9 `task_complete`

```typescript
{
  name: "task_complete",
  description: "Mark a task as done. Sets status to 'done' and records completion timestamp.",
  inputSchema: {
    type: "object",
    properties: {
      id:      { type: "string", format: "uuid" },
      version: { type: "number" }
    },
    required: ["id", "version"]
  }
}
```

---

## 5. REST Endpoint Contracts

Base path: `/api`. Content-Type: `application/json`. Auth: `Authorization: Bearer <api-key>`.

### 5.1 Standard Error Format

All error responses use this shape:

```typescript
interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}
```

HTTP status mapping:
| ErrorCode        | HTTP Status |
|------------------|-------------|
| NOT_FOUND        | 404         |
| CONFLICT         | 409         |
| VALIDATION       | 400         |
| UNAUTHORIZED     | 401         |
| FORBIDDEN        | 403         |
| EMBEDDING_FAILED | 502         |
| INTERNAL         | 500         |

### 5.2 Endpoints

#### `POST /api/entities` — store

**Request:**
```json
{
  "content": "decided to use pgvector over dedicated graph DB",
  "type": "memory",
  "visibility": "shared",
  "tags": ["decisions", "architecture"],
  "metadata": { "namespace": "decisions", "key": "vector-db-choice" }
}
```

**Response:** `201 Created`
```json
{
  "entity": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "memory",
    "content": "decided to use pgvector over dedicated graph DB",
    "visibility": "shared",
    "status": null,
    "version": 1,
    "tags": ["decisions", "architecture"],
    "source": "pgm-talon-personal",
    "metadata": { "namespace": "decisions", "key": "vector-db-choice" },
    "created_at": "2026-03-17T10:30:00.000Z",
    "updated_at": "2026-03-17T10:30:00.000Z"
  }
}
```

**Errors:** 400 (validation), 401 (no/bad key), 403 (scope/type/visibility denied)

#### `GET /api/entities/:id` — recall

**Response:** `200 OK` with `{ "entity": StoredEntity }`

**Errors:** 401, 403, 404

#### `PATCH /api/entities/:id` — update

**Request:**
```json
{
  "content": "updated decision text",
  "tags": ["decisions", "architecture", "finalized"],
  "version": 1
}
```

**Response:** `200 OK` with `{ "entity": StoredEntity }` (version incremented to 2)

**Errors:** 400, 401, 403, 404, 409 (version conflict — response includes `{ "error": { "code": "CONFLICT", ... }, "current": StoredEntity }`)

#### `DELETE /api/entities/:id` — soft delete

**Response:** `200 OK` with `{ "id": "...", "deleted": true }`

**Errors:** 401, 403, 404

#### `POST /api/search` — search

**Request:**
```json
{
  "query": "auth decisions",
  "type": "memory",
  "tags": ["decisions"],
  "limit": 10,
  "threshold": 0.35,
  "recency_weight": 0.1
}
```

**Response:** `200 OK`
```json
{
  "results": [
    {
      "entity": { ... },
      "chunk_content": "decided to use pgvector over dedicated graph DB",
      "score": 0.87,
      "similarity": 0.82
    }
  ]
}
```

**Errors:** 400, 401, 502 (embedding failed)

#### `GET /api/entities` — list

**Query params:** `type`, `status`, `visibility`, `tags` (comma-separated), `limit`, `offset`

**Response:** `200 OK`
```json
{
  "items": [ StoredEntity, ... ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

#### `POST /api/tasks` — task_create

**Request:**
```json
{
  "content": "set up Caddy TLS for store endpoint",
  "context": "@focus-work",
  "status": "next",
  "due_date": "2026-04-01"
}
```

**Response:** `201 Created` with `{ "entity": StoredEntity }`

#### `GET /api/tasks` — task_list

**Query params:** `status`, `context`, `limit`, `offset`

**Response:** `200 OK` with `{ "items": [...], "total": N, "limit": N, "offset": N }`

#### `PATCH /api/tasks/:id` — task_update

Same shape as `PATCH /api/entities/:id`.

#### `POST /api/tasks/:id/complete` — task_complete

**Request:**
```json
{ "version": 3 }
```

**Response:** `200 OK` with `{ "entity": StoredEntity }` (status=done)

#### `GET /health` — health check

No auth required.

**Response:** `200 OK`
```json
{
  "status": "ok",
  "version": "0.1.0",
  "postgres": "connected",
  "embedding_model": "text-embedding-3-small"
}
```

**Error:** `503 Service Unavailable` if Postgres is unreachable:
```json
{
  "status": "degraded",
  "postgres": "disconnected"
}
```

---

## 6. Auth Middleware

### 6.1 Request Flow

```
Request → Extract Bearer token → Lookup by prefix → Verify argon2 hash → Attach AuthContext → Route handler
```

### 6.2 Implementation

```typescript
// Hono middleware
async function authMiddleware(c: Context, next: Next): Promise<void> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' } }, 401);
  }

  const token = header.slice(7);
  const prefix = token.slice(0, 8);

  // Find active key by prefix
  const keyRow = await db.query(
    'SELECT * FROM api_keys WHERE key_prefix = $1 AND is_active = true',
    [prefix]
  );

  if (!keyRow.rows[0]) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, 401);
  }

  // Verify full key against stored hash
  const valid = await argon2.verify(keyRow.rows[0].key_hash, token);
  if (!valid) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, 401);
  }

  // Update last_used_at (fire-and-forget, don't block request)
  db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [keyRow.rows[0].id]);

  // Attach auth context
  c.set('auth', {
    keyId: keyRow.rows[0].id,
    keyName: keyRow.rows[0].name,
    scopes: keyRow.rows[0].scopes,
    allowedTypes: keyRow.rows[0].allowed_types,
    allowedVisibility: keyRow.rows[0].allowed_visibility,
  } satisfies AuthContext);

  await next();
}
```

### 6.3 Scope Enforcement

Scope checking happens in the service layer, not middleware. Middleware only authenticates; services authorize.

```typescript
function requireScope(auth: AuthContext, scope: string): void {
  if (!auth.scopes.includes(scope)) {
    throw new AppError('FORBIDDEN', `Key '${auth.keyName}' lacks '${scope}' scope`);
  }
}

function checkTypeAccess(auth: AuthContext, type: string): void {
  if (auth.allowedTypes && !auth.allowedTypes.includes(type)) {
    throw new AppError('FORBIDDEN', `Key '${auth.keyName}' cannot access type '${type}'`);
  }
}

function checkVisibilityAccess(auth: AuthContext, visibility: string): void {
  if (!auth.allowedVisibility.includes(visibility)) {
    throw new AppError('FORBIDDEN', `Key '${auth.keyName}' cannot access visibility '${visibility}'`);
  }
}
```

### 6.4 MCP Auth

MCP connections authenticate once when the SSE connection is established. The API key is passed as a query parameter or header on the initial SSE request. The auth context is stored for the duration of the connection and applied to every tool call.

```typescript
// MCP transport auth — on SSE connection init
const apiKey = req.headers['authorization']?.replace('Bearer ', '')
             || req.query.apiKey;
// Validate same way as REST middleware
// Store AuthContext on the MCP session object
```

### 6.5 Edge Cases

- **Key prefix collision**: Unlikely with 8 chars of base62 (62^8 = 218 trillion combinations). If it happens, the prefix lookup returns multiple rows; iterate and verify each until one matches. In practice, a personal system will have <10 keys.
- **Revoked key mid-session (MCP)**: The SSE connection stays alive, but the next tool call will re-validate. If the key was revoked, the call fails with 401. The MCP client should reconnect with a valid key.
- **No key for health check**: `/health` is exempt from auth middleware.
- **Argon2 timing**: `argon2.verify()` is constant-time by design, preventing timing attacks.

---

## 7. Embedding Pipeline

### 7.1 Chunking

Ported from obsidian-autopilot-backend's `ChunkingService`:

```
Input text
  ↓
Is length <= 300 chars? → return as single chunk
  ↓
Split by first separator ("\n\n")
  ↓
Any piece > 300 chars? → recursively split with next separator
  ↓
Merge small adjacent pieces up to 300 chars (with 100 char overlap)
  ↓
Return Chunk[] with sequential indices
```

**Config** (from `embedding_models` table):
- `chunk_size`: 300 characters
- `chunk_overlap`: 100 characters
- Separators: `["\n\n", "\n### ", "\n## ", "\n# ", "\n", ". ", "? ", "! ", "; "]`

**Separator priority:** Tries to split on paragraph boundaries first, then headers, then lines, then sentences. This preserves semantic coherence within chunks.

### 7.2 Embedding Generation

```
Chunks[]
  ↓
Batch into groups of 100
  ↓
For each batch: POST openai.embeddings.create({ model, input: batch })
  ↓
Retry on 429/5xx (3 attempts, exponential backoff: 1s, 2s, 4s)
  ↓
Collect all embeddings
  ↓
Return number[][] aligned with input chunks
```

### 7.3 Write Pipeline Flow

```
store(content, type, ...) called
  ↓
INSERT entity → return entity to caller immediately? No — Phase 1 is synchronous.
  ↓
chunkText(content) → Chunk[]
  ↓
If 0 chunks (empty content): done, no embedding needed
  ↓
embedBatch(chunk texts) → number[][]
  ↓
BEGIN transaction
  DELETE FROM chunks WHERE entity_id = $id  (idempotent — handles re-indexing)
  INSERT INTO chunks (entity_id, chunk_index, content, embedding, model_id, token_count)
    VALUES ($1, $2, $3, $4, $5, $6) for each chunk
COMMIT
  ↓
On embedding failure: log error, entity exists without chunks (still discoverable by ID/list, not by vector search)
On DB failure: log error, retry once, then give up (entity exists, chunks missing)
```

### 7.4 Error Scenarios

| Scenario | Behavior |
|----------|----------|
| OpenAI API key invalid | `EMBEDDING_FAILED` error on store/update, entity still created |
| OpenAI rate limit (429) | Retry 3x with backoff, then fail |
| OpenAI timeout | Retry 3x, then fail |
| Empty content | No chunks created, no embedding call, success |
| Content is only whitespace | Treat as empty — no chunks |
| Chunk DB insert fails | Retry once, then log and continue (entity exists without chunks) |
| Embedding dimension mismatch | Should never happen if model config is correct. If it does, log error, skip chunk storage |

---

## 8. CLI Commands

Two CLI tools: `pgm` (user-facing, talks to REST API) and `pgm-admin` (admin, talks directly to Postgres).

### 8.1 `pgm` — User CLI

Base config: reads `PGM_API_URL` and `PGM_API_KEY` from environment or `~/.pgmrc` (JSON file).

```
~/.pgmrc:
{
  "api_url": "https://postgram.example.com",
  "api_key": "pgm-talon-personal-..."
}
```

#### `pgm store <content>`

```
pgm store "decided to use pgvector" --type memory --tags decisions,architecture --visibility shared
pgm store "Jan de Vries" --type person --metadata '{"role":"engineer","org":"Acme"}'
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--type, -t` | string | `memory` | Entity type |
| `--tags` | string | | Comma-separated tags |
| `--visibility, -v` | string | `shared` | personal/work/shared |
| `--status, -s` | string | | Entity status |
| `--metadata, -m` | string | `{}` | JSON metadata |

**Output:** Entity ID and type confirmation.
```
Stored memory 550e8400-e29b-41d4-a716-446655440000
```

**Stdin support:** `pgm store --type memory -` reads content from stdin (useful for piping).

#### `pgm search <query>`

```
pgm search "auth decisions" --type memory --limit 5
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--type, -t` | string | | Filter by type |
| `--tags` | string | | Filter by tags (comma-separated) |
| `--limit, -n` | number | 10 | Max results |
| `--threshold` | number | 0.35 | Min similarity |
| `--json` | boolean | false | Output raw JSON |

**Output (default):**
```
[0.87] memory 550e8400 — decided to use pgvector over dedicated graph DB
       tags: decisions, architecture | 2026-03-17

[0.72] memory 661f9511 — evaluated graph databases: Neo4j too heavy for personal use
       tags: decisions, research | 2026-03-15
```

**Output (--json):** Raw API response.

#### `pgm recall <id>`

```
pgm recall 550e8400-e29b-41d4-a716-446655440000
pgm recall 550e8400  # prefix match — CLI expands shortest unique prefix
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | Output raw JSON |

**Output:**
```
memory 550e8400-e29b-41d4-a716-446655440000 (v1)
Status: active | Visibility: shared
Tags: decisions, architecture
Created: 2026-03-17 10:30 | Updated: 2026-03-17 10:30
Source: pgm-talon-personal

decided to use pgvector over dedicated graph DB

Metadata:
  namespace: decisions
  key: vector-db-choice
```

**Prefix matching:** If the user provides a short UUID prefix, the CLI queries `GET /api/entities?id_prefix=<prefix>`. If exactly one match, show it. If multiple, list them and ask for disambiguation. Service layer supports this via `WHERE id::text LIKE $prefix || '%'`.

#### `pgm update <id>`

```
pgm update 550e8400 --content "new text" --tags decisions,final --version 1
pgm update 550e8400 --status done --version 2
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--content, -c` | string | | New content |
| `--tags` | string | | Replace tags |
| `--status, -s` | string | | New status |
| `--visibility, -v` | string | | New visibility |
| `--metadata, -m` | string | | JSON metadata (merged) |
| `--version` | number | **required** | Current version |

**On conflict (409):**
```
Conflict: entity was updated since version 1.
Current version: 2, updated at 2026-03-17 11:00 by claude-code-work
Use --version 2 to retry, or --force to overwrite.
```

`--force` flag: fetches current version and retries with that version number.

#### `pgm delete <id>`

```
pgm delete 550e8400
```

**Output:** `Archived memory 550e8400-e29b-41d4-a716-446655440000`

No confirmation prompt by default (soft delete is reversible). Add `--hard` in a future phase if needed.

#### `pgm task add <content>`

```
pgm task add "set up Caddy TLS" --context @focus-work --status next --due 2026-04-01
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--context, -c` | string | | GTD context |
| `--status, -s` | string | `inbox` | Task status |
| `--due, -d` | string | | Due date (ISO 8601 or relative: "tomorrow", "friday") |
| `--tags` | string | | Comma-separated tags |

#### `pgm task list`

```
pgm task list
pgm task list --status next --context @focus-work
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--status, -s` | string | | Filter by status |
| `--context, -c` | string | | Filter by context |
| `--limit, -n` | number | 50 | Max results |
| `--json` | boolean | false | Raw JSON |

**Output:**
```
inbox (3)
  ☐ 550e — set up Caddy TLS                    @focus-work  due: Apr 1
  ☐ 661f — migrate Talon memories               @focus-work
  ☐ 772a — order new SSD for home server         @home

next (1)
  ☐ 883b — write Postgram spec                  @focus-work
```

#### `pgm task update <id>`

Same flags as `pgm update`.

#### `pgm task complete <id>`

```
pgm task complete 550e --version 1
```

**Output:** `Completed: set up Caddy TLS ✓`

#### `pgm backup`

```
pgm backup
pgm backup --output /Volumes/NAS/postgram/
pgm backup --encrypt --output /Volumes/NAS/postgram/
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--output, -o` | string | `./backups/` | Output directory |
| `--encrypt` | boolean | false | Encrypt with GPG (requires `PGM_BACKUP_GPG_KEY` env var) |

**Implementation:** Calls `pg_dump` via the REST API or directly (if running locally). For remote: the server exposes a `GET /api/backup` endpoint (requires a special `backup` scope, not in default key scopes) that streams a `pg_dump` output. For Phase 1, keep it simple: `pgm backup` SSHes to the server and runs `pg_dump` via a wrapper script.

Actually, simpler approach: `pgm backup` is a local convenience that runs:
```bash
ssh hetzner "docker exec postgres pg_dump -U talon postgram" > postgram-$(date +%Y%m%d-%H%M%S).sql
```

If `--encrypt`: pipe through `gpg --encrypt --recipient $PGM_BACKUP_GPG_KEY`.

### 8.2 `pgm-admin` — Admin CLI (container-only)

Runs inside the Docker container, connects directly to Postgres via `DATABASE_URL`.

#### `pgm-admin key create`

```
pgm-admin key create --name "talon-personal" --scopes read,write --visibility personal,shared
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--name` | string | **required** | Human-readable label |
| `--scopes` | string | `read` | Comma-separated scopes |
| `--visibility` | string | `shared` | Comma-separated visibility scopes |
| `--types` | string | | Comma-separated allowed entity types (omit for all) |

**Output:**
```
Created API key: pgm-talon-personal-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
Key ID: 550e8400-e29b-41d4-a716-446655440000
Name: talon-personal
Scopes: read, write
Visibility: personal, shared
Types: all

⚠ Save this key now — it cannot be retrieved later.
```

**Key generation:**
1. Generate 32 random bytes
2. Base62 encode → 43 chars
3. Prefix with `pgm-<name>-` → `pgm-talon-personal-<base62>`
4. Hash with argon2id (time=3, memory=65536, parallelism=4)
5. Store hash, prefix (first 8 chars of full key), and metadata

#### `pgm-admin key list`

```
pgm-admin key list
```

**Output:**
```
ID         Name              Scopes       Visibility       Types    Active  Last Used
550e8400   talon-personal    read,write   personal,shared  all      yes     2026-03-17 10:30
661f9511   claude-code-work  read,write   work,shared      all      yes     2026-03-17 09:15
772a0622   webhook-reader    read         shared           memory   yes     never
```

#### `pgm-admin key revoke <id>`

Sets `is_active = false`. No confirmation needed (can re-create).

#### `pgm-admin audit`

```
pgm-admin audit --since 2026-03-17
pgm-admin audit --key talon-personal --operation search --limit 100
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--since` | string | 24h ago | Start timestamp |
| `--key` | string | | Filter by key name |
| `--operation` | string | | Filter by operation |
| `--entity` | string | | Filter by entity ID |
| `--limit, -n` | number | 50 | Max results |

**Output:**
```
2026-03-17 10:30:05  talon-personal  store     550e8400  type=memory
2026-03-17 10:30:12  talon-personal  search    -         query="auth decisions" results=3
2026-03-17 10:31:00  claude-code     recall    550e8400
```

#### `pgm-admin model list`

Lists embedding models. Shows dimensions, chunk config, active status.

#### `pgm-admin model set-active <model-id>`

Sets a new active model. Does NOT re-embed existing chunks (use `pgm-admin reembed` for that).

#### `pgm-admin stats`

```
pgm-admin stats
```

**Output:**
```
Entities:  142 (87 memory, 23 task, 15 person, 12 project, 5 interaction)
Chunks:    312
Storage:   48 MB (data) + 124 MB (indexes)
Model:     text-embedding-3-small (1536 dims)
Keys:      3 active, 0 revoked
Uptime:    14d 3h
```

---

## 9. Docker Setup

### 9.1 `Dockerfile`

Multi-stage build:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
# Output: dist/ with compiled JS

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY src/db/migrations ./dist/db/migrations

# pgm-admin is included in the image
# Expose the combined MCP + REST port
EXPOSE 3100

USER node
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1
```

**Notes:**
- `tini` for proper signal handling (PID 1 zombie reaping)
- Non-root `node` user
- Migrations bundled for `pgm-admin` to run inside the container
- Health check hits the `/health` endpoint

### 9.2 `docker-compose.yml`

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: postgram
      POSTGRES_USER: postgram
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgram"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    # No ports exposed — only accessible via Docker network

  mcp-server:
    build: .
    ports:
      - "127.0.0.1:3100:3100"
    environment:
      DATABASE_URL: postgres://postgram:${POSTGRES_PASSWORD}@postgres:5432/postgram
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      PORT: 3100
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
```

**Notes:**
- `pgvector/pgvector:pg17` — Postgres 17 with pgvector pre-installed
- Postgres has no port binding — only reachable from the Docker network
- `mcp-server` binds to `127.0.0.1:3100` — Caddy reverse-proxies this with TLS
- `depends_on` with `service_healthy` ensures Postgres is ready before the server starts
- `POSTGRES_USER` changed from `talon` to `postgram` (the brief used `talon`, but the DB user should match the project name)

### 9.3 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | yes | | Full Postgres connection string |
| `OPENAI_API_KEY` | yes | | For embedding generation |
| `PORT` | no | `3100` | HTTP/MCP server port |
| `LOG_LEVEL` | no | `info` | pino log level (trace/debug/info/warn/error) |
| `POSTGRES_PASSWORD` | yes | | Used by Docker Compose for Postgres init |

`.env.example`:
```
POSTGRES_PASSWORD=changeme
OPENAI_API_KEY=sk-...
LOG_LEVEL=info
```

### 9.4 Startup Sequence

```
1. Load config from env vars (validated with zod)
2. Create pg Pool, test connection
3. Run migrations (src/db/migrate.ts)
4. Initialize embedding service (verify OpenAI key works with a test embed)
5. Start Hono HTTP server on PORT
6. Start MCP SSE transport on the same port (mounted at /mcp)
7. Log startup complete with version and port
```

**Startup failures:**
- DB connection fails → retry 3 times with 2s delay, then exit 1
- Migration fails → exit 1 (don't start with wrong schema)
- OpenAI key invalid → log warning but start anyway (search/store will fail but recall/list work)

---

## 10. Migration Script — Talon Memories

### 10.1 Source Format

Talon stores memories in SQLite (`memory_items` table):

```sql
-- Talon schema (source)
CREATE TABLE memory_items (
  id            TEXT,
  thread_id     TEXT NOT NULL,
  type          TEXT NOT NULL,      -- 'fact', 'summary', 'note', 'embedding_ref'
  content       TEXT NOT NULL,
  embedding_ref TEXT,
  metadata      TEXT DEFAULT '{}',  -- JSON string
  created_at    INTEGER NOT NULL,   -- Unix epoch milliseconds
  updated_at    INTEGER NOT NULL,   -- Unix epoch milliseconds
  PRIMARY KEY (thread_id, id)
);
```

### 10.2 Mapping

| Talon field | Postgram field | Transformation |
|-------------|----------------|----------------|
| `id` | `metadata.talon_id` | Preserved for reference; new UUID generated |
| `thread_id` | `metadata.talon_thread_id` | Preserved in metadata |
| `type` | `type` | All map to `memory` (see below) |
| `content` | `content` | Direct copy |
| `metadata` | `metadata` | JSON.parse, merge with Talon-specific fields |
| `created_at` | `created_at` | Convert ms epoch → ISO 8601 timestamptz |
| `updated_at` | `updated_at` | Convert ms epoch → ISO 8601 timestamptz |

**Type mapping:**
- `fact` → `memory` with `metadata.namespace = 'facts'`
- `summary` → `memory` with `metadata.namespace = 'summaries'`
- `note` → `memory` with `metadata.namespace = 'notes'`
- `embedding_ref` → skip (these are Chroma vector refs, not content)

### 10.3 Migration Script Flow

```
pgm migrate-talon <sqlite-path>
  ↓
1. Open SQLite database (read-only)
2. SELECT * FROM memory_items WHERE type != 'embedding_ref'
3. Group by thread_id for context preservation
4. For each memory item:
   a. Transform to Postgram entity format
   b. POST /api/entities (using a migration-specific API key)
   c. Write pipeline runs: chunk → embed → store chunks
   d. Log progress: "Migrated 42/156 items"
5. Summary: "Migrated 156 items from 12 threads. Skipped 23 embedding_refs."
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | boolean | false | Show what would be migrated without writing |
| `--thread` | string | | Migrate only this thread ID |
| `--batch-size` | number | 50 | Items per batch (controls embedding API calls) |
| `--skip-embeddings` | boolean | false | Import entities without running the embedding pipeline |

### 10.4 Edge Cases

- **Duplicate content**: Two threads might have the same memory text. Import both — dedup is a Phase 5 concern.
- **Empty content**: Skip items with empty/whitespace-only content. Log them.
- **Malformed metadata JSON**: Try `JSON.parse()`, fall back to `{}` if it fails. Log the error.
- **Large migration**: 1000+ items. Batch the embedding calls, log progress every 50 items. Estimated time: ~2 minutes for 1000 items (embedding is the bottleneck at ~100ms per batch).
- **Resumability**: The `--thread` flag allows partial migration. If a migration fails midway, re-run for the remaining threads. Duplicate inserts are harmless (new UUIDs each time, content search will surface them).
- **Timestamps**: Talon uses Unix epoch milliseconds. Convert: `new Date(created_at).toISOString()`. The `entities` table stores `timestamptz` which Postgres handles correctly.
- **Thread context preservation**: The `metadata.talon_thread_id` field preserves the original thread grouping. A future "browse by original thread" feature could use this.

---

## Appendix A: Caddy Configuration

For reference — not part of the Postgram codebase, but needed for deployment:

```caddyfile
postgram.example.com {
  reverse_proxy localhost:3100
}
```

Caddy auto-provisions TLS via Let's Encrypt. The MCP SSE endpoint and REST API both go through this.

## Appendix B: MCP Client Configuration

### Talon (Claude Desktop / MCP config)

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

### Claude Code (MCP config)

```json
{
  "mcpServers": {
    "postgram": {
      "url": "https://postgram.example.com/mcp",
      "headers": {
        "Authorization": "Bearer pgm-claude-code-..."
      }
    }
  }
}
```

## Appendix C: Phase 1 Exclusions

Explicitly **not** in Phase 1 (deferred to later phases):

- `edges` table and graph traversal (`link`, `expand` tools)
- `document_sources` table and sync pipeline (`pgm sync`)
- LLM-based relation extraction on write
- Entity resolution / dedup
- `log_interaction` convenience wrapper
- BM25 hybrid search
- Local embedding models (Ollama)
- Field-level encryption
- `pgm-admin reembed` (batch re-embedding when switching models)
