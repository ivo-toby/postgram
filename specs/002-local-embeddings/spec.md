# Feature Specification: Local Embedding Provider Support

**Feature Branch**: `002-local-embeddings`
**Created**: 2026-04-18
**Status**: Draft
**Input**: User description: "Add a local (Ollama) embedding provider alongside the existing OpenAI path, selectable via env, with independently configurable embedding host so embeddings and LLM inference can point at different endpoints, and an operator-invoked dimension-migration command."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run Postgram with a local embedding provider (Priority: P1)

A self-hosting operator wants Postgram to generate embeddings against a local Ollama instance rather than against OpenAI, so that no outbound calls to OpenAI are required for routine ingestion and search. The operator also wants the embedding host to be configured independently from the LLM inference host used for knowledge-graph extraction, because those two services often live on different machines (and the inference side may point at a separate OpenAI-compatible endpoint).

**Why this priority**: This is the feature's core goal. Without it, Postgram cannot be deployed in environments that prohibit cloud calls.

**Independent Test**: Configure a fresh Postgram instance with the local embedding provider selected, a dedicated embedding host URL, and no OpenAI API key set (with LLM extraction either disabled or pointed at a non-OpenAI endpoint). Ingest a handful of entities, wait for enrichment to complete, and run search queries. No outbound call is made to OpenAI.

**Acceptance Scenarios**:

1. **Given** `EMBEDDING_PROVIDER=ollama`, a separate `EMBEDDING_BASE_URL`, and no `OPENAI_API_KEY`, **When** the server starts (extraction disabled or non-OpenAI), **Then** it boots successfully and logs the active embedding provider, model, dimensions, and resolved embedding host.
2. **Given** the embedding provider is configured and reachable, **When** entities are ingested, **Then** their chunks are embedded through the configured host and become searchable once enrichment completes.
3. **Given** the embedding host is unreachable at startup, **When** the server starts, **Then** the server still boots and logs a clear warning; enrichment retries in the background; search continues to function on previously embedded content. (Matches current degrade-and-warn semantics for the existing OpenAI path.)
4. **Given** a separate `EMBEDDING_BASE_URL` is set but `OLLAMA_BASE_URL` is also set for LLM extraction, **When** the server starts, **Then** each subsystem uses its own host independently.

---

### User Story 2 - Migrate an existing deployment to a different embedding dimension (Priority: P2)

An operator running an existing deployment wants to switch to a provider or model whose embeddings have a different dimensionality. Because the `chunks.embedding` column has a fixed dimension, the switch requires an operator-invoked migration.

**Why this priority**: Without migration tooling, existing users cannot adopt the feature.

**Independent Test**: On a populated database, run the migration command in dry-run mode and verify the reported chunk count matches reality. Then run the migration for real, restart the server, and verify entities become pending, chunks regenerate in the background, and search returns results once enrichment catches up.

**Acceptance Scenarios**:

1. **Given** a populated database where the stored dimension differs from the configured dimension, **When** the operator starts the server, **Then** the server refuses to start and points to the migration command in its error output.
2. **Given** the operator runs `pgm-admin embeddings migrate --dry-run`, **When** the command executes, **Then** it reports the number of chunks to be discarded and the number of entities that will be marked pending, and does not alter any schema or data.
3. **Given** the operator runs the migration command without a confirmation flag in a non-dry-run mode, **When** the command executes, **Then** it refuses to proceed with a message explaining that `--yes` is required.
4. **Given** the operator runs `pgm-admin embeddings migrate --target-dimensions <N> --yes`, **When** the command completes, **Then** the embedding storage is altered to the new dimension, chunks are discarded (derivable from entity content), enrichable entities are marked pending, a new active `embedding_models` row is inserted, and an audit record is written.
5. **Given** the migration has completed and the server is restarted with the new provider configured, **When** enrichment runs in the background, **Then** pending entities are re-chunked and re-embedded automatically.

---

### Edge Cases

- An existing OpenAI-based deployment upgrades to this version without changing any configuration. The system must continue to operate unchanged: OpenAI is still the default, `OPENAI_API_KEY` is still required for the OpenAI path, and no new env vars are mandatory.
- Extraction is enabled with `EXTRACTION_PROVIDER=openai` while `EMBEDDING_PROVIDER=ollama`. `OPENAI_API_KEY` is required for extraction and must still be set; the embedding pipeline does not depend on it.
- The configured embedding dimension does not match what the provider actually returns at runtime. The mismatch surfaces as a clear embedding error (not a silent truncation), the offending entity remains in `failed` state, and retries proceed per existing enrichment behavior.
- The migration command is interrupted partway through. On re-run, it is safe to invoke again and converges on the target state.
- Search runs while re-embedding is in progress after a migration. Because the migration discards all chunks, post-migration entities are not searchable until their chunks regenerate (search joins directly from `chunks`). Search results recover progressively as the enrichment worker backfills. Operators should plan the migration as a maintenance-window operation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow the operator to select the embedding provider between the existing OpenAI option and an Ollama option via an environment variable, mirroring the naming pattern of the existing extraction provider selector.
- **FR-002**: The system MUST allow the operator to override the embedding model name and the embedding dimension via environment variables, with reasonable per-provider defaults when not set.
- **FR-003**: The system MUST expose an embedding host configuration that is independent of the LLM inference host. When the embedding provider is Ollama, the system MUST accept a dedicated embedding base URL (and optional bearer token) that is separate from the existing LLM-extraction base URL, falling back to the extraction base URL only when the dedicated value is not set (backwards compatibility).
- **FR-004**: The system MUST treat the OpenAI API key as conditionally required: required only when OpenAI is the embedding provider, the extraction provider, or both; optional otherwise.
- **FR-005**: The system MUST log the active embedding provider, model, dimension, and resolved host once at startup so operators can confirm configuration without consulting the database.
- **FR-006**: The system MUST detect, at startup, when the configured embedding dimension differs from the dimension currently used for stored embeddings and refuse to start, pointing the operator to the migration command. (This is the only new fail-fast condition; provider reachability at startup continues to follow the current degrade-and-warn behavior.)
- **FR-007**: The system MUST generate chunk embeddings through the configured provider whenever the enrichment pipeline runs, preserving existing retry, backoff, and enrichment-status transitions.
- **FR-008**: The system MUST continue to operate previously successful OpenAI-based deployments without any configuration change required from the operator.
- **FR-009**: The system MUST provide an administrative command that migrates the embedding storage to a new dimension by discarding existing chunks, inserting a new active embedding-model record, and marking all entities that have content (`content IS NOT NULL`) as pending so that the existing enrichment worker regenerates chunks and embeddings.
- **FR-010**: The migration command MUST support a dry-run mode that reports the affected counts (chunks to discard, entities to mark pending) without altering any schema or data.
- **FR-011**: The migration command MUST require an explicit `--yes` confirmation flag outside of dry-run mode, because it discards existing chunk and embedding data, and MUST refuse to proceed without that flag.
- **FR-012**: The migration command MUST write an audit-log entry for every invocation (both `--dry-run` and real runs), recording the previous and target embedding-model metadata, affected counts, and whether the run was a dry-run. This matches the existing admin CLI's pattern of auditing read-only privileged operations.
- **FR-013**: The system MUST NOT change the external REST or MCP contract as a result of this feature; all provider differences MUST remain internal.

### Key Entities *(include if feature involves data)*

- **Embedding Provider Configuration**: Operator-supplied selection of which provider generates embeddings, the model name, the declared dimension, and — for Ollama — the embedding host URL and optional bearer token (separately configurable from the LLM-extraction host).
- **Chunk Embedding**: A numerical vector associated with a chunk of entity text. Has a fixed dimension determined by the active embedding-model record. Discarded and regenerated when the operator runs the migration command.
- **Embedding Storage Metadata**: The active `embedding_models` row is the single runtime authority for the stored embedding dimension. Must match the operator-declared dimension for the system to operate. The `chunks.embedding` column type is kept in sync by the migration command but is not consulted at startup.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can bring up a fresh Postgram instance configured to use Ollama for embeddings and a different host for LLM extraction, with no OpenAI API key, and successfully ingest, enrich, and search content.
- **SC-002**: Zero outbound calls are made to OpenAI endpoints during normal operation when both the embedding and extraction providers are configured for non-OpenAI options.
- **SC-003**: An operator with an existing deployment can migrate to a different embedding dimension without losing any entity, task, or non-chunk data. Chunks are regenerable from entity content and are expected to be recreated by the enrichment worker after the migration.
- **SC-004**: 100% of existing OpenAI-configured deployments continue to function after upgrading to this version without any configuration change.
- **SC-005**: When the configured dimension does not match the stored dimension, the server refuses to start and emits a single, human-readable error naming both values and pointing at the migration command.

## Assumptions

- Search downtime between the migration and enrichment catch-up is acceptable for this feature's target scale. Operators run `pgm-admin embeddings migrate` as a maintenance operation and accept that migrated entities are not searchable until their chunks regenerate.
- Only two embedding provider identities are in scope for this feature: the existing OpenAI path and Ollama. Additional providers are out of scope.
- One active embedding model per deployment is sufficient.
- The operator is responsible for provisioning the selected model on the target host before pointing Postgram at it; Postgram does not attempt to download or install models.
- Dimension is operator-declared rather than auto-detected; Postgram validates the declared value only against stored dimensions at startup and against actual provider output at runtime call time.
- Provider unreachability at runtime is handled by the existing enrichment retry/backoff behavior; no new fail-fast gate is introduced for reachability.

## Dependencies

- A reachable embedding service (Ollama or equivalent) with the intended model already available, when the Ollama provider is selected.
- The existing enrichment worker and its retry/backoff behavior, reused unchanged.
- The existing `embedding_models`/`chunks` schema, reused unchanged except for the dimension of `chunks.embedding`, which is altered by the migration command.

## Out of Scope

- Supporting embedding providers beyond OpenAI and Ollama.
- Running multiple embedding models simultaneously, A/B testing, or per-tenant selection.
- Changes to re-ranking or hybrid search scoring.
- Automatic dimension detection.
- Preserving chunk text across a dimension migration. Chunks are regenerable from entity content; the migration discards and recreates them.
- Admin CLI commands beyond `embeddings migrate` (no `status`, no `test` subcommands in this pass).
- An operator-tunable embedding batch size (internal default is sufficient at personal scale).
- Supporting legacy Ollama versions that lack `/api/embeddings`. Postgram targets current Ollama.

## Constitutional Note

This feature performs a runtime `ALTER TABLE` on `chunks.embedding` as part of the migration command. That is a **waiver** of Constitution Principle III (numbered forward-only SQL migrations), because the target dimension is operator-declared at runtime and cannot be encoded as a single fixed migration. The waiver is justified in `plan.md` Complexity Tracking; it is NOT a pass.
