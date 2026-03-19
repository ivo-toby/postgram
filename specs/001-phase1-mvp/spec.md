# Feature Specification: Phase 1 MVP — Central Knowledge Store

**Feature Branch**: `001-phase1-mvp`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "Phase 1 MVP — central knowledge store with vector search, MCP + REST transports, CLI, and API key auth"
**Supporting Detail**: `SPEC.md` at repo root contains detailed implementation
notes (schemas, Docker setup, API contracts) that informed this spec. This
feature spec is the authoritative source for scope and acceptance criteria.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Store and Recall Knowledge (Priority: P1)

As an AI agent (Talon, Claude Code, or a work agent), I can store pieces of
knowledge — memories, decisions, notes, people, projects — and retrieve them
later by ID so that context persists across sessions and tools.

**Why this priority**: Without durable storage and retrieval, no other feature
works. This replaces Talon's fragmented per-thread KV store with a shared,
persistent backend.

**Independent Test**: Store a memory via the API, then recall it by ID and
verify content, type, tags, and metadata match.

**Acceptance Scenarios**:

1. **Given** a valid API key with write scope, **When** I store a memory with
   content, type, tags, and metadata, **Then** the system persists the entity
   and returns it with a unique ID, version 1, and enrichment_status "pending"
   before chunking or embedding completes.
2. **Given** a stored entity, **When** I recall it by ID with a valid read key,
   **Then** the system returns the full entity including content, metadata,
   timestamps, and current version.
3. **Given** a stored entity, **When** I update it with the correct version
   number, **Then** the system returns the updated entity with an incremented
   version.
4. **Given** a stored entity, **When** I update it with a stale version number,
   **Then** the system rejects the update with a conflict error and returns
   the current entity state.
5. **Given** a stored entity, **When** I soft-delete it, **Then** the entity
   status becomes archived and it no longer appears in search results.

---

### User Story 2 - Semantic Search (Priority: P1)

As an AI agent, I can search stored knowledge using natural language queries
and receive results ranked by semantic relevance so that I can find contextually
appropriate information without knowing exact keywords.

**Why this priority**: Semantic search is the core value proposition — it turns
a dumb data store into an intelligent memory layer. Without it, agents must
recall by exact ID.

**Independent Test**: Store several memories with varied content, search with
a natural language query, and verify results are ranked by semantic relevance
with the most relevant result first.

**Acceptance Scenarios**:

1. **Given** multiple stored entities, **When** I search with a natural language
   query, **Then** the system returns entities ranked by semantic similarity
   with a relevance score.
2. **Given** a search query, **When** I filter by entity type or tags, **Then**
   only matching entities appear in results.
3. **Given** entities of different ages, **When** I search with recency boosting
   enabled, **Then** the final score is `similarity * (1 + recency_weight *
   exp(-age_days / half_life))` where half_life defaults to 30 days, producing
   a measurable boost for newer entities over older ones with similar content.
4. **Given** a search query with no results above the similarity threshold,
   **Then** the system returns an empty result set (not an error).
5. **Given** a long entity that spans multiple chunks, **When** a search matches
   one chunk, **Then** the result includes the matching chunk text alongside
   the parent entity.

---

### User Story 3 - API Key Authentication and Scoped Access (Priority: P1)

As the system operator, I can create API keys with specific scopes (read, write,
delete, sync), type restrictions, and visibility restrictions so that each
agent only accesses the knowledge it is authorized to see.

**Why this priority**: The system stores personal, work, and shared knowledge.
Without access control, any agent can read or modify anything — unacceptable
for a multi-agent knowledge store.

**Independent Test**: Create two API keys with different visibility scopes,
store entities with different visibility levels, and verify each key can only
access its authorized entities.

**Acceptance Scenarios**:

1. **Given** an API key with read and write scopes restricted to "shared"
   visibility, **When** I attempt to store a "personal" entity, **Then** the
   system rejects the request with a forbidden error.
2. **Given** an API key restricted to "task" and "project" types, **When** I
   attempt to recall a "memory" entity, **Then** the system rejects the request.
3. **Given** a request without an API key, **When** I call any endpoint except
   health, **Then** the system returns an unauthorized error.
4. **Given** a revoked API key, **When** I attempt any operation, **Then** the
   system rejects the request with an unauthorized error.
5. **Given** an API key with only "read" scope, **When** I attempt to store an
   entity, **Then** the system rejects the request with a forbidden error.

---

### User Story 4 - MCP Transport for AI Agents (Priority: P2)

As an AI agent connected via MCP (Model Context Protocol), I can discover and
use knowledge tools (store, recall, search, update, delete, task operations)
over a standard MCP SSE connection so that I can integrate with the knowledge
store without custom API client code.

**Why this priority**: MCP is the primary transport for AI agents (Talon, Claude
Code). Without it, agents must use REST, which requires custom integration per
agent.

**Independent Test**: Connect an MCP client, list available tools, call the
store tool, then call the search tool and verify results.

**Acceptance Scenarios**:

1. **Given** a valid MCP connection with an API key, **When** I list available
   tools, **Then** I see store, recall, search, update, delete, task_create,
   task_list, task_update, and task_complete tools with descriptions.
2. **Given** an MCP connection, **When** I call the store tool with valid input,
   **Then** the entity is created and the result matches the REST API behavior.
3. **Given** an MCP connection, **When** I call the search tool, **Then** results
   are identical to the REST search endpoint for the same query and filters.

---

### User Story 5 - Task Management (Priority: P2)

As a user or AI agent, I can create, list, update, and complete tasks with GTD
contexts and due dates so that the knowledge store doubles as a persistent task
system that survives sessions.

**Why this priority**: GTD task management is a key use case for the personal
agent. Without persistent tasks, the agent loses track of work across sessions.

**Independent Test**: Create a task via the CLI, list tasks filtered by status,
complete a task, and verify the status change persists.

**Acceptance Scenarios**:

1. **Given** a write-scoped API key, **When** I create a task with content,
   GTD context, and due date, **Then** the system stores it as a task entity
   with status "inbox" by default.
2. **Given** multiple tasks with different statuses and contexts, **When** I list
   tasks filtered by status and context, **Then** only matching tasks appear.
3. **Given** an active task, **When** I mark it complete, **Then** the status
   changes to "done" and a completion timestamp is recorded.
4. **Given** a task operation via MCP, **When** the same operation is performed
   via REST with the same inputs, **Then** the results are identical.

---

### User Story 6 - CLI Tool for Manual Operations (Priority: P2)

As a human operator, I can use a command-line tool to store memories, search
knowledge, manage tasks, and run backups so that I can interact with the
knowledge store directly without needing an AI agent.

**Why this priority**: The CLI is essential for manual operations — capturing
thoughts during work, quick lookups, GTD reviews, and backups. It also serves
as a skill target for agents.

**Independent Test**: Use the CLI to store a memory, search for it, recall it
by ID, and verify the output is human-readable.

**Acceptance Scenarios**:

1. **Given** CLI credentials configured, **When** I run the store command with
   content, type, and tags, **Then** the entity is created and the CLI prints
   the entity ID.
2. **Given** stored entities, **When** I run the search command with a query,
   **Then** the CLI prints results with scores, types, short IDs, and content
   previews.
3. **Given** an entity ID, **When** I run the recall command, **Then** the CLI
   prints the full entity in a human-readable format.
4. **Given** tasks in the system, **When** I run the task list command filtered
   by status, **Then** the CLI prints tasks grouped by status with context and
   due dates.

---

### User Story 7 - Admin Operations (Priority: P3)

As the system operator with container access, I can manage API keys, review
audit logs, inspect system stats, and manage embedding models without any
network-exposed admin endpoints so that admin capabilities remain secure by
design.

**Why this priority**: Admin operations (key management, audit review, stats,
and embedding model management) are necessary for ongoing operation, but
exposing them over the network increases attack surface. Container-local admin
eliminates the leaked-admin-key vector.

**Independent Test**: SSH into the server, run admin commands inside the
container, and verify key creation, audit log queries, model management, and
stats output work correctly.

**Acceptance Scenarios**:

1. **Given** container access, **When** I create a new API key with specified
   scopes and visibility, **Then** the system returns the plaintext key once
   and stores only the hash.
2. **Given** container access, **When** I query the audit log for a specific
   time range and key, **Then** the system returns matching audit entries.
3. **Given** container access, **When** I run the stats command, **Then** the
   system displays entity counts by type, chunk count, storage usage, and key
   count.
4. **Given** container access, **When** I list embedding models, **Then** the
   system shows all configured models with their active/inactive status.
5. **Given** container access, **When** I set a different embedding model as
   active, **Then** the system updates the active model and new enrichment
   uses the new model.

---

### User Story 8 - Talon Memory Migration (Priority: P3)

As the system operator, I can migrate existing memories from Talon's SQLite
store into the new knowledge store so that historical context is preserved and
the transition is seamless.

**Why this priority**: Without migration, switching to the new store loses all
existing memories. This is a one-time operation but critical for adoption.

**Independent Test**: Run the migration on a copy of the Talon SQLite database,
verify all non-embedding-ref items appear as entities, and confirm they are
searchable.

**Acceptance Scenarios**:

1. **Given** a Talon SQLite database, **When** I run the migration command,
   **Then** all memory items (excluding embedding_ref type) are imported as
   entities with preserved timestamps and metadata.
2. **Given** the migration command, **When** I use the dry-run flag, **Then**
   the system reports what would be migrated without writing anything.
3. **Given** a failed partial migration, **When** I re-run for remaining
   threads, **Then** the system completes without duplicating already-migrated
   items.

---

### Edge Cases

- What happens when the embedding service is unavailable during a store
  operation? The entity MUST still be persisted with enrichment_status "failed".
  It is recallable by ID but won't appear in vector search results until
  enrichment succeeds on retry.
- What happens when two agents update the same entity simultaneously? The first
  write wins; the second receives a version conflict with the current state.
- What happens when a search query returns chunks from the same entity? Results
  MUST be deduplicated to show only the best-matching chunk per entity.
- What happens when an API key's allowed visibility doesn't intersect with the
  requested filter? The system returns empty results, not an error.
- What happens when content is empty or whitespace-only? No chunks or embeddings
  are generated. The entity is stored as metadata-only.
- What happens when a very long piece of content is stored? It is automatically
  split into chunks with overlap for embedding and search.
- What is the enrichment lifecycle for a stored entity? On store/update, the
  entity is persisted immediately with enrichment_status "pending". Background
  enrichment chunks and embeds the content, then sets enrichment_status to
  "completed". If enrichment fails, enrichment_status is set to "failed" and
  the entity remains persisted and recallable. Retry is triggered on the next
  content update (which resets enrichment_status to "pending").

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist knowledge entities with content, type,
  visibility, status, tags, source, and arbitrary metadata.
- **FR-002**: System MUST support six entity types: memory, person, project,
  task, interaction, and document.
- **FR-003**: System MUST support three visibility levels: personal, work, and
  shared.
- **FR-004**: System MUST persist entities before enrichment. Chunking and
  embedding MUST happen asynchronously after the store/update response returns.
  Each entity MUST track enrichment_status (pending, completed, failed).
- **FR-005**: System MUST provide semantic search ranked by cosine similarity
  with optional recency boosting and type/tag filtering.
- **FR-006**: System MUST enforce optimistic locking on entity updates using a
  version counter.
- **FR-007**: System MUST authenticate all non-health requests via API keys.
- **FR-008**: System MUST enforce scope-based authorization (read, write, delete,
  sync) at the service layer.
- **FR-009**: System MUST enforce entity type and visibility restrictions per API
  key at the service layer.
- **FR-010**: System MUST store API keys as hashed values only — plaintext
  returned once at creation.
- **FR-011**: System MUST log all mutating operations and all privileged admin
  operations to an append-only audit log with key ID, operation, entity ID, and
  timestamp. Privileged admin operations include key management, audit queries,
  embedding model management, and stats. Read-only non-admin operations
  (recall, search, list) are not audited.
- **FR-012**: System MUST expose operations via both MCP (SSE) and REST
  transports with identical behavior.
- **FR-013**: System MUST provide a CLI tool for manual store, search, recall,
  update, delete, and task operations.
- **FR-014**: System MUST provide container-local admin commands for key
  management, audit log queries, embedding model management, and system stats
  with zero network exposure.
- **FR-015**: System MUST support migrating existing Talon memories from SQLite
  with preserved timestamps and metadata.
- **FR-016**: System MUST provide a health endpoint (no auth required) reporting
  service and database status.
- **FR-017**: System MUST provide encrypted backup capability for the database.
- **FR-018**: System MUST soft-delete entities (archive status) rather than
  hard-delete, preserving data for audit and recovery.
- **FR-019**: System MUST deduplicate search results when multiple chunks from
  the same entity match a query.
- **FR-020**: System MUST support task convenience operations: create, list (with
  status/context filters), update, and complete (with completion timestamp).
- **FR-021**: Task operations (create, list, update, complete) MUST behave
  identically across REST and MCP transports, consistent with FR-012.
- **FR-022**: System MUST provide container-local embedding model management
  (list models, set active model) via the admin CLI.

### Key Entities

- **Entity**: A piece of knowledge — can be a memory, person, project, task,
  interaction, or document. Has content, type, visibility, status, version, tags,
  source attribution, and arbitrary metadata. The core data object of the system.
- **Chunk**: A segment of an entity's content with a vector embedding. Entities
  with content are automatically split into chunks for semantic search. Short
  content produces one chunk; long content produces many with overlap.
- **Embedding Model**: Configuration for the active embedding provider — tracks
  model name, dimensions, and chunking parameters. Only one model active at a
  time.
- **API Key**: Authentication credential with scoped permissions. Has a name,
  hashed secret, scope list (read/write/delete/sync), optional type restrictions,
  and visibility restrictions.
- **Audit Entry**: Immutable record of every operation — who did what to which
  entity and when. Append-only.

## Data, Contracts & Operational Impact

### Affected Tables and Migrations

- **entities**: Core table — stores all knowledge objects. Requires
  `enrichment_status` column (pending/completed/failed) for async enrichment
  tracking.
- **chunks**: Vector-embedded content segments. Created asynchronously after
  entity persistence.
- **embedding_models**: Embedding provider config. Seeded with initial model.
- **api_keys**: Scoped auth credentials. Managed via container-local admin CLI.
- **audit_log**: Append-only operation log for mutating/privileged operations.
- **schema_migrations**: Migration tracking (managed by migration runner).
- All tables created in a single numbered migration (`001_initial_schema.sql`).

### Optimistic Locking and Versioning

- Entity updates require the current version number. Mismatches return a
  conflict error with the current entity state.
- Enrichment updates (chunks) do not increment the entity version — they are
  background operations on immutable content.

### Service Modules Affected

- **entity-service**: Store (persist-first, then dispatch enrichment), recall,
  update, soft-delete, list.
- **search-service**: Vector search with recency boost, deduplication, threshold.
- **task-service**: Task convenience wrappers over entity-service.
- **embedding-service**: OpenAI embedding generation, batch processing.
- **chunking-service**: Content splitting (RecursiveCharacterTextSplitter port).
- **enrichment-worker**: Background enrichment dispatcher — processes pending
  entities, updates enrichment_status.
- **key-service**: API key creation (argon2), validation, scope checking.

### Transport Surfaces Affected

- **REST API**: Entity CRUD, search, task CRUD, health. All behind auth
  middleware except health.
- **MCP (SSE)**: Same operations as REST, registered as MCP tools. Behavior
  identical to REST (FR-012, FR-021).
- **CLI (`pgm`)**: Thin HTTP client over REST API. Human-readable + JSON output.
- **Admin CLI (`pgm-admin`)**: Container-local, direct DB connection. Key
  management, audit queries, model management, stats.

### Auth and Audit Impact

- All non-health transport endpoints require API key auth (FR-007).
- Scope, type, and visibility enforcement at the service layer (FR-008, FR-009).
- Mutating and privileged operations emit audit log entries (FR-011). Read
  operations are not audited unless they are privileged admin actions.
- All admin CLI operations are audited as privileged actions, including key
  management, audit queries, embedding model management, and stats.

### Operational Impact

- **Deployment**: Docker Compose (Postgres + server). Caddy for TLS.
- **Backup**: `pgm backup --encrypt` wraps pg_dump with GPG encryption.
  Restoration via standard pg_restore.
- **Quickstart**: Local dev setup documented in quickstart.md.
- **Monitoring**: Health endpoint reports DB connectivity and active embedding
  model. Structured pino logs for operational visibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An AI agent can store a memory and retrieve it semantically within
  5 seconds end-to-end (store + search round-trip).
- **SC-002**: Given a fixed set of 10 seed entities with distinct topics, a
  search using a paraphrased query for any seeded entity returns that entity
  as the top result (not just exact keyword matches).
- **SC-003**: Two agents with different visibility scopes cannot access each
  other's restricted entities — 100% enforcement with zero leakage.
- **SC-004**: All Talon memories (excluding embedding_refs) are successfully
  migrated and searchable in the new store.
- **SC-005**: The CLI tool supports all core operations (store, search, recall,
  update, delete, task CRUD, backup) as single-line commands.
- **SC-006**: The system operates continuously on a single VM with less than
  512 MB total RAM usage (database + server).
- **SC-007**: Admin key management, audit review, embedding model management,
  and stats are only accessible from inside the container — no network-exposed
  admin endpoints exist.
- **SC-008**: Every mutating or privileged operation produces an audit log entry
  traceable to the calling API key.
- **SC-009**: Encrypted backups can be created and restored successfully,
  preserving all data.
- **SC-010**: MCP and REST transports produce identical results for the same
  operation and inputs.
