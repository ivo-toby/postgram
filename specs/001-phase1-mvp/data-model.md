# Data Model: Phase 1 MVP — Central Knowledge Store

**Date**: 2026-03-18
**Source**: `SPEC.md` sections 1 (Schema) and 3 (Service Layer API)

## Entities

### Entity

The core knowledge object. All knowledge types share this structure.

| Field       | Type                | Required | Default   | Notes |
|-------------|---------------------|----------|-----------|-------|
| id          | UUID                | auto     | generated | Primary key |
| type        | enum                | yes      | —         | `memory`, `person`, `project`, `task`, `interaction`, `document` |
| content     | text                | no       | null      | Nullable for metadata-only entities (e.g., persons) |
| visibility  | enum                | yes      | `shared`  | `personal`, `work`, `shared` |
| status      | enum                | no       | null      | `active`, `done`, `archived`, `inbox`, `next`, `waiting`, `scheduled`, `someday` |
| version     | integer             | auto     | 1         | Optimistic locking counter; incremented on every update |
| tags        | text array          | no       | `[]`      | Empty array, not null |
| source      | text                | no       | null      | Which agent/client wrote it (e.g., `talon-personal`) |
| metadata    | JSON object         | no       | `{}`      | Type-specific fields (see below) |
| created_at  | timestamp (tz)      | auto     | now       | Immutable after creation |
| updated_at  | timestamp (tz)      | auto     | now       | Auto-updated on every modification |

**Validation rules**:
- `type` is immutable after creation
- `version` must match current value on updates (optimistic locking)
- `tags` defaults to empty array, never null
- `metadata` defaults to empty object, never null

**Metadata by type**:
- **memory**: `{ namespace, key }` — for namespaced key-value lookups
- **person**: `{ role, organization, relationship }` — structured person info
- **project**: `{ links[], description }` — project references
- **task**: `{ context, due_date, completed_at, waiting_on }` — GTD fields
- **interaction**: `{ interaction_type, participants[], action_items[] }` — meetings/conversations
- **document**: `{ title }` — document metadata (content lives in chunks)

**State transitions**:
- Any status → `archived` (soft delete)
- `inbox` → `next` | `waiting` | `scheduled` | `someday` | `active` (GTD processing)
- `active` | `next` | `waiting` | `scheduled` → `done` (task completion)
- No transitions enforced at the database level — service layer validates

---

### Chunk

A segment of an entity's content with a vector embedding.

| Field       | Type           | Required | Default   | Notes |
|-------------|----------------|----------|-----------|-------|
| id          | UUID           | auto     | generated | Primary key |
| entity_id   | UUID (FK)      | yes      | —         | References Entity; cascading delete |
| chunk_index | integer        | yes      | —         | Sequential ordering within entity (0-based) |
| content     | text           | yes      | —         | The actual chunk text |
| embedding   | vector(1536)   | yes      | —         | pgvector embedding |
| model_id    | UUID (FK)      | yes      | —         | References EmbeddingModel |
| token_count | integer        | yes      | —         | Token count for context budgeting |
| created_at  | timestamp (tz) | auto     | now       | — |

**Validation rules**:
- `(entity_id, chunk_index)` must be unique
- Chunks are deleted and recreated on entity content update (not patched)
- Entity deletion cascades to all chunks

---

### EmbeddingModel

Configuration for the active embedding provider.

| Field         | Type           | Required | Default | Notes |
|---------------|----------------|----------|---------|-------|
| id            | UUID           | auto     | generated | Primary key |
| name          | text           | yes      | —       | e.g., `text-embedding-3-small` |
| provider      | text           | yes      | —       | e.g., `openai`, `ollama` |
| dimensions    | integer        | yes      | —       | e.g., 1536 |
| chunk_size    | integer        | yes      | —       | Characters per chunk (e.g., 300) |
| chunk_overlap | integer        | yes      | —       | Overlap in characters (e.g., 100) |
| is_active     | boolean        | yes      | false   | Only one active model at a time (enforced) |
| metadata      | JSON object    | no       | `{}`    | Provider-specific config |
| created_at    | timestamp (tz) | auto     | now     | — |

**Validation rules**:
- Exactly one model may have `is_active = true` at any time (enforced by partial unique index)
- Seeded with `text-embedding-3-small` (openai, 1536 dims, 300/100 chunk config)

---

### ApiKey

Authentication credential with scoped permissions.

| Field              | Type           | Required | Default    | Notes |
|--------------------|----------------|----------|------------|-------|
| id                 | UUID           | auto     | generated  | Primary key |
| name               | text           | yes      | —          | Unique human-readable label |
| key_hash           | text           | yes      | —          | argon2id hash |
| key_prefix         | text           | yes      | —          | First 8 chars of plaintext key (for log identification) |
| scopes             | text array     | yes      | `[read]`   | `read`, `write`, `delete`, `sync` |
| allowed_types      | text array     | no       | null       | null = all types allowed |
| allowed_visibility | text array     | yes      | `[shared]` | `personal`, `work`, `shared` |
| is_active          | boolean        | yes      | true       | Soft revocation |
| created_at         | timestamp (tz) | auto     | now        | — |
| last_used_at       | timestamp (tz) | no       | null       | Updated on every authenticated request |

**Validation rules**:
- `name` must be unique
- `key_hash` stores argon2id hash (includes salt and params in the string)
- `allowed_types` null means unrestricted; empty array would mean no access
- Key format: `pgm-<name>-<32 random bytes base62>`

---

### AuditEntry

Immutable record of every operation.

| Field      | Type           | Required | Default   | Notes |
|------------|----------------|----------|-----------|-------|
| id         | UUID           | auto     | generated | Primary key |
| api_key_id | UUID (FK)      | no       | —         | References ApiKey; survives key deletion |
| operation  | text           | yes      | —         | `store`, `recall`, `search`, `update`, `delete`, etc. |
| entity_id  | UUID           | no       | null      | Nullable for non-entity operations (search, list) |
| details    | JSON object    | no       | `{}`      | Operation-specific context |
| timestamp  | timestamp (tz) | auto     | now       | — |

**Validation rules**:
- Append-only: no UPDATE or DELETE operations on this table
- `api_key_id` references ApiKey without cascading delete

---

## Relationships

```text
Entity 1───* Chunk         (entity_id FK, CASCADE delete)
Chunk *───1 EmbeddingModel (model_id FK)
AuditEntry *───1 ApiKey    (api_key_id FK, no CASCADE)
```

- One Entity has zero or many Chunks (zero when content is null/empty)
- Each Chunk belongs to exactly one EmbeddingModel
- Each AuditEntry references the ApiKey that performed the operation
- No direct relationship between Entity and ApiKey (tracked via AuditEntry)

---

## Indexes

| Table           | Index                      | Type          | Purpose |
|-----------------|----------------------------|---------------|---------|
| entities        | idx_entities_type          | btree         | Filter by type |
| entities        | idx_entities_visibility    | btree         | Auth filtering |
| entities        | idx_entities_status        | btree partial | Filter by status (WHERE NOT NULL) |
| entities        | idx_entities_tags          | GIN           | Tag containment queries (`@>`) |
| entities        | idx_entities_metadata      | GIN jsonb_path| JSONB path queries |
| entities        | idx_entities_created_at    | btree DESC    | Ordering |
| chunks          | idx_chunks_entity_id       | btree         | Join to parent entity |
| chunks          | idx_chunks_embedding       | HNSW          | Vector similarity search (m=16, ef=200) |
| api_keys        | idx_api_keys_prefix        | btree partial | Key lookup (WHERE is_active) |
| embedding_models| idx_embedding_models_active| unique partial | Enforce single active model |
| audit_log       | idx_audit_log_timestamp    | btree DESC    | Time-range queries |
| audit_log       | idx_audit_log_api_key      | btree         | Filter by key |
| audit_log       | idx_audit_log_operation    | btree         | Filter by operation |
