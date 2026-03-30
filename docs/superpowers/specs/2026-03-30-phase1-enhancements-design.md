# Phase 1 Enhancements — Design Spec

**Date:** 2026-03-30
**Scope:** 5 enhancements to the Phase 1 MVP, shipping together
**Migration:** Single file `002_phase1_enhancements.sql`

---

## 1. Hybrid Search (BM25 + Vector) — Default

Replace pure vector search with a blended BM25 + vector approach. Transparent to callers — no new API parameters.

### Schema

Add a generated tsvector column to `entities`:

```sql
ALTER TABLE entities
  ADD COLUMN search_tsvector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX idx_entities_search_tsvector ON entities USING gin (search_tsvector);
```

Uses `'simple'` text search config (no stemming, no stop words) so it works for all languages. The vector side handles semantic similarity; BM25 catches exact keyword and name matches.

### Search Logic

In `search-service.ts`, the `searchEntities` function changes to:

1. **Embed the query** via OpenAI (same as today). If embedding fails, fall back to BM25-only (see fallback below).
2. **Run a single query** that computes both scores:
   - Vector: `1 - (c.embedding <=> $query_embedding)` from chunks table (existing)
   - BM25: `ts_rank(e.search_tsvector, plainto_tsquery('simple', $query))` from entities table
3. **Normalize BM25** to 0-1 by dividing each BM25 score by the max BM25 score in the result set (or 1 if no keyword matches).
4. **Blend:** `final_score = 0.6 * vector_score + 0.4 * normalized_bm25_score`
5. Apply recency boost on the blended score (same formula as today).
6. Deduplicate, threshold filter, sort, limit (same as today).

### BM25-Only Fallback

When the embedding service fails (OpenAI down, bad API key):

1. Skip the vector side entirely.
2. Query entities directly using `ts_rank` against `search_tsvector`.
3. Apply auth filters, threshold, recency boost, limit.
4. Return results with `similarity: 0` and `score` based on BM25 rank only.
5. No `EMBEDDING_FAILED` error — the search degrades gracefully.

This is an improvement over today where search completely fails without embeddings.

### Weights

Hardcoded for Phase 1: `0.6 vector / 0.4 bm25`. These can be made configurable later if needed. The 60/40 split favors semantic relevance while giving enough weight to exact matches to surface them.

### Files Changed

- `src/db/migrations/002_phase1_enhancements.sql` — tsvector column + index
- `src/services/search-service.ts` — blended query, BM25 normalization, fallback path
- `tests/unit/search-scoring.test.ts` — new tests for BM25 normalization and blending
- `tests/integration/search-service.test.ts` — hybrid results, BM25-only fallback

---

## 2. `pgm-admin reembed`

Batch re-embedding command for when the active embedding model changes. Marks entities for re-processing and lets the existing enrichment worker handle it.

### Command

```
pgm-admin reembed [--model <id>] [--all] [--type <type>]
```

| Flag | Description |
|------|-------------|
| `--model <id>` | Switch active model before re-embedding |
| `--all` | Re-embed all entities with content (required unless --type) |
| `--type <type>` | Re-embed only entities of this type |

At least `--all` or `--type` must be specified. If neither is given, the command exits with an error: `"Specify --all or --type <type> to confirm which entities to re-embed"`.

### How It Works

1. If `--model` is given: run the same `model set-active` logic (deactivate current, activate target) in a transaction.
2. In a single transaction:
   a. `DELETE FROM chunks WHERE entity_id IN (SELECT id FROM entities WHERE ...)` — remove stale chunks
   b. `UPDATE entities SET enrichment_status = 'pending', enrichment_attempts = 0 WHERE ...` — mark for re-processing
3. Log count to stdout: `Marked 142 entities for re-embedding`
4. Append audit entry: `reembed.start` with entity count and model ID.

The enrichment worker picks up the `pending` entities on its next poll cycle. Progress is visible via `pgm-admin stats` (watch chunk count grow back).

### Files Changed

- `src/cli/admin/pgm-admin.ts` — new `reembed` command
- `tests/integration/cli-admin.test.ts` — test for reembed command

---

## 3. Enrichment Retry for Failed Entities

Entities with `enrichment_status = 'failed'` currently stay failed forever unless their content is updated. Fix the worker to retry with backoff and a max attempt limit.

### Schema

```sql
ALTER TABLE entities ADD COLUMN enrichment_attempts integer NOT NULL DEFAULT 0;
```

### Worker Changes

The enrichment worker query in `enrichment-worker.ts` changes from:

```sql
WHERE enrichment_status = 'pending' AND content IS NOT NULL
```

to:

```sql
WHERE content IS NOT NULL
  AND (
    enrichment_status = 'pending'
    OR (
      enrichment_status = 'failed'
      AND enrichment_attempts < 3
      AND updated_at < now() - interval '5 minutes'
    )
  )
ORDER BY
  CASE WHEN enrichment_status = 'pending' THEN 0 ELSE 1 END,
  created_at ASC
```

Pending entities are prioritized over retries via the ORDER BY.

### State Transitions

| Event | enrichment_status | enrichment_attempts |
|-------|-------------------|---------------------|
| Entity stored with content | `pending` | `0` |
| Content updated | `pending` | `0` (reset) |
| Worker succeeds | `completed` | `0` (reset) |
| Worker fails | `failed` | `+1` |
| 3rd failure | `failed` | `3` (no more retries) |
| Reembed command | `pending` | `0` (reset) |

### Files Changed

- `src/db/migrations/002_phase1_enhancements.sql` — `enrichment_attempts` column
- `src/services/enrichment-worker.ts` — updated query, increment attempts on failure, reset on success
- `src/services/entity-service.ts` — reset `enrichment_attempts = 0` when content changes
- `tests/integration/enrichment-worker.test.ts` — retry behavior, max attempts

---

## 4. `pgm list` CLI Command

Wire the existing `GET /api/entities` endpoint to a new `pgm list` command.

### Command

```
pgm list [--type <type>] [--status <status>] [--visibility <vis>] [--tags <tags>] [--limit <n>] [--offset <n>] [--json]
```

All flags optional. Defaults match the REST endpoint (limit 50, offset 0, no filters).

### Human-Readable Output

```
memory b9a4a432  Sprite is a cloud dev environment...
  tags: tools, cloud | shared | 2026-03-30

project 61042289  Building an AI-powered personal...
  tags: ai, knowledge | shared | 2026-03-30

2 entities (showing 1-2)
```

### Files Changed

- `src/cli/client.ts` — add `listEntities()` method
- `src/cli/pgm.ts` — add `list` command
- `tests/integration/cli-pgm.test.ts` — test for list command

---

## 5. Startup OpenAI Validation

Validate the embedding service on boot by calling `embedQuery` with a test string. Log the result but don't block startup.

### Behavior

In `startServer()` after migrations and before starting the HTTP server:

```typescript
try {
  await embeddingService.embedQuery('startup validation');
  logger.info('embedding service validated');
} catch (error) {
  logger.warn({ err: error }, 'embedding service unavailable — search and enrichment will fail');
}
```

The server still starts on failure. Recall, list, tasks, and BM25-only search all work without embeddings. The warning makes it immediately obvious when the API key is bad.

### Files Changed

- `src/index.ts` — validation call in `startServer()`

---

## Migration File

`src/db/migrations/002_phase1_enhancements.sql`:

```sql
-- Hybrid search: tsvector column with simple config (language-agnostic)
ALTER TABLE entities
  ADD COLUMN search_tsvector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX idx_entities_search_tsvector ON entities USING gin (search_tsvector);

-- Enrichment retry: attempt counter for backoff
ALTER TABLE entities
  ADD COLUMN enrichment_attempts integer NOT NULL DEFAULT 0;
```

---

## Testing Strategy

- **Unit tests:** BM25 score normalization, blended score calculation, enrichment state transitions
- **Integration tests:** Hybrid search results, BM25-only fallback, retry with backoff, reembed command, list CLI
- **Contract tests:** Search endpoint returns blended results (update existing contract tests)

All existing tests must continue to pass — the hybrid search change is backward-compatible (same API shape, better results).
