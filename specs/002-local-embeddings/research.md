# Phase 0 Research: Local Embedding Provider Support

**Feature**: `002-local-embeddings`
**Date**: 2026-04-18

Short, decision-focused notes. Implementation details live in code, not here.

---

## 1. Provider abstraction

**Decision**: One file `src/services/embeddings/providers.ts` containing:

```ts
export interface EmbeddingProvider {
  readonly name: 'openai' | 'ollama';
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export function createEmbeddingProvider(cfg: EmbeddingProviderConfig): EmbeddingProvider;
```

OpenAI and Ollama implementations live side-by-side in the same file. `src/services/embedding-service.ts` is refactored to accept a provider and delegate.

**Rationale**: The surface is small. No factory directory, no separate error-class file, no contracts doc. Fits in one file, under ~200 lines including both providers.

**Rejected**: Separate `types.ts` / `openai-provider.ts` / `ollama-provider.ts` / `errors.ts` / `startup-validation.ts` / `contracts/*.md`. That's subsystem scaffolding for a small change.

## 2. Ollama endpoint

**Decision**: Use `POST {EMBEDDING_BASE_URL}/api/embeddings` with `{ model, prompt }`. `embedBatch` loops sequentially.

**Rationale**: One endpoint, works on any modern Ollama. No probe, no fallback logic, no cached endpoint-variant state.

**Rejected**: Probing for the newer `/api/embed` batch endpoint. Added complexity for marginal speedup on a feature whose target scale is personal-use. Revisit only if enrichment throughput becomes a bottleneck.

## 3. Independent embedding host

**Decision**: Two new env vars for the embedding side:

- `EMBEDDING_BASE_URL` — the URL the Ollama provider posts to. Falls back to `OLLAMA_BASE_URL` when unset (so existing single-host setups keep working).
- `EMBEDDING_API_KEY` — optional bearer token for the embedding host.

The existing `OLLAMA_BASE_URL` / `OLLAMA_API_KEY` remain dedicated to LLM extraction and are unchanged.

**Rationale**: The user's target setup is embeddings on a homelab Ollama and LLM inference on a different OpenAI-compatible endpoint. Reusing `OLLAMA_BASE_URL` forces the two to share a host. Backwards compatibility is preserved via the fallback.

## 4. Conditional `OPENAI_API_KEY`

**Decision**: In `src/config.ts`, declare `OPENAI_API_KEY` as `z.string().min(1).optional()`, then add a top-level `.superRefine` that fails parse when:

- `EMBEDDING_PROVIDER === 'openai'` and the key is missing, OR
- `EXTRACTION_ENABLED` is true, `EXTRACTION_PROVIDER === 'openai'`, and the key is missing.

Today the key is hard-required in the schema; this is the actual breaking change this feature removes.

**Rationale**: Keeps validation in one place, gives a readable parse-time error, avoids imperative post-load checks.

## 5. Dimension source of truth + startup gate

**Decision**: The active `embedding_models.dimensions` row is the single source of truth at runtime. On startup, compare against the configured `EMBEDDING_DIMENSIONS` and refuse to start on mismatch with one human-readable message pointing at the migrate command. The `chunks.embedding` column type is kept in sync by the migrate command but is NOT consulted at startup — the active row is authoritative.

**Rationale**: Simpler, still catches the dangerous case (config says 1024, storage is 1536 → nothing would ever embed correctly). Drop the defense-in-depth pgvector-catalog query; it guards against manual SQL tampering that is not a realistic failure mode.

**Provider reachability at startup**: Keep the existing behavior in `src/index.ts:142` — warn-and-degrade. Do NOT add a new fail-fast gate for "embedding host unreachable." That's a bigger semantic change than the feature requires, and enrichment already retries.

## 6. Migration mechanics

**Decision**: `pgm-admin embeddings migrate --target-dimensions <N> [--dry-run] [--yes]`:

1. Require `EMBEDDING_DIMENSIONS === N` in env (config and flag must agree).
2. Audit-log the intended change.
3. In one transaction: `DROP INDEX idx_chunks_embedding`, `TRUNCATE TABLE chunks`, `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(N)`, deactivate existing `embedding_models`, insert a new active row for the configured provider/model/dimensions, `UPDATE entities SET enrichment_status='pending', enrichment_attempts=0 WHERE content IS NOT NULL`, `CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=200)`.
4. Commit.

`--dry-run` reports affected counts only.

**Rationale**: Chunks are derived data, regenerable from entity content by the existing enrichment worker. Truncate + regenerate is the simplest correct path. The spec now explicitly commits to this; no more "preserve chunk data" contradiction.

## 7. Admin CLI surface

**Decision**: Add exactly one subcommand: `pgm-admin embeddings migrate`. No `status`, no `test`. If operators want visibility, they can already use `pgm-admin model list`, `model set-active`, `reembed`, `stats`, and `audit`, which exist today.

**Rationale**: Per review, `status`/`test` are scope creep for v1. Cheap to add later if a real need appears.

## 8. Batch size

**Decision**: Hard-coded internal constant `OLLAMA_EMBED_SEQUENTIAL` (no env var). OpenAI batching continues to use the existing batch behavior of `openai.embeddings.create`. No `EMBEDDING_BATCH_SIZE`.

**Rationale**: Personal-scale deployments don't need this knob; a bad default is worse than no knob. Add it when someone files an issue with a real bottleneck.
