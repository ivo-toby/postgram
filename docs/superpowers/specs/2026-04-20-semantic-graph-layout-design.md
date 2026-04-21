# Semantic Graph Layout Design

**Goal:** Place nodes in the graph canvas at 2D coordinates derived from their embedding vectors, so that semantically similar entities cluster spatially. Available as an additional layout mode (**Semantic**) inside the existing Graph page, alongside Force / Radial / Hierarchy.

**Scope:** This spec covers the 2D layout mode only. The standalone 3D embedding projector (separate top-bar tab) is covered in `2026-04-20-embedding-projector-design.md`. Both features share the backend endpoint and projection worker described below under *Shared Infrastructure*.

**Tech Stack:** `umap-js` (npm), graphology, Sigma.js, existing pgvector embeddings stored in the `entities` table.

---

## Shared Infrastructure

The following pieces are reused by both the 2D layout mode (this spec) and the 3D embedding projector page (`2026-04-20-embedding-projector-design.md`). They are specified here because this spec lands first.

### Backend endpoint: `POST /api/entities/embeddings`

Returns embedding vectors for a set of entity IDs. **POST, not GET** — 500 UUIDs comma-joined is ~18 KB, which blows past nginx's default 8 KB request-URI limit and produced 414 in practice.

**Request body:**
```json
{
  "ids": ["uuid", "uuid", ...],
  "owner": "optional-owner-scope"
}
```

**Response:**
```json
{
  "embeddings": [
    { "id": "uuid", "embedding": [0.123, -0.456, ...] }
  ]
}
```

**Implementation notes:**
- Embeddings live in the `chunks` table (`entity_id`, `chunk_index`, `embedding vector(1536)`). A single entity can have multiple chunks for long documents, so the endpoint aggregates per entity with `AVG(chunks.embedding)` and returns the centroid.
- Serialisation: cast `AVG(embedding)::text` to use pgvector's bracket text form (`[0.1,0.2,...]`) and `JSON.parse` server-side into a plain `number[]`. Works without a custom pg type parser.
- Entities with no chunks (enrichment still `pending`, or entity has no textual content) are **omitted** from the response. Callers handle missing IDs gracefully (those nodes keep their current position or are excluded from the point cloud).
- Scope enforcement: reuse `auth.allowedTypes`, `auth.allowedVisibility`, and `ownerSqlCondition` — keys only see embeddings for entities they can read. Requires the `read` scope.
- Validation: UUID-shape each id with a regex and hard-cap the list at **500** per request. Beyond that, the client batches.
- Auth: same API key bearer token as every other endpoint.
- No pagination needed — 500 entities × 1536 floats × ~20 text bytes per float ≈ ~15 MB max payload (verify; gzipped ~3 MB). If this ever becomes a problem, switch to `::float4[]` binary output.

### API client method: `ui/src/lib/api.ts`

```ts
getEmbeddings(ids: string[]) {
  return r<{ embeddings: { id: string; embedding: number[] }[] }>(
    '/api/entities/embeddings',
    { method: 'POST', body: { ids } }
  );
}
```

### Projection WebWorker: `ui/src/workers/projection.worker.ts`

Single worker that handles both 2D and 3D projections. Lives off the main thread so long-running reductions don't block the UI.

**Input message:**
```ts
{
  ids: string[];
  embeddings: number[][];
  dim: 2 | 3;
  algorithm?: 'umap' | 'pca'; // default 'umap'
  params?: {
    nNeighbors?: number;  // UMAP; default 15
    minDist?: number;     // UMAP; default 0.1
  };
}
```

**Output messages:**
```ts
// Progress (optional, UMAP only)
{ type: 'progress'; epoch: number; epochs: number }

// Final
{ type: 'result'; positions: { id: string; coords: number[] }[] }
```

`coords.length === dim`. For 2D the consumer reads `[x, y]`; for 3D `[x, y, z]`.

**Implementation sketch (UMAP, 2D or 3D):**
```ts
import { UMAP } from 'umap-js';

self.onmessage = (e) => {
  const { ids, embeddings, dim = 2, params = {} } = e.data;
  const umap = new UMAP({
    nComponents: dim,
    nNeighbors: params.nNeighbors ?? 15,
    minDist: params.minDist ?? 0.1,
  });
  const result = umap.fit(embeddings);
  const positions = ids.map((id, i) => ({ id, coords: result[i] }));
  self.postMessage({ type: 'result', positions });
};
```

**Coordinate scaling:** UMAP output is roughly `[-10, 10]` per axis. Consumers scale as needed (graphology layout scales by ×100; three.js scene uses the raw values).

---

## Layout mode: 2D Semantic (this spec)

### Layout hook change: `ui/src/hooks/useLayout.ts`

Add `'semantic'` to `LayoutType`. New `startSemantic(api)` method:

1. Collect all visible node IDs from the graph in batches of 500.
2. Call `api.getEmbeddings(ids)` for each batch and merge.
3. Post `{ ids, embeddings, dim: 2 }` to the shared projection WebWorker.
4. On worker `result` message: write `x`/`y` back to each node via `graph.setNodeAttribute`, scaling by ×100.
5. Call `sigma.refresh()`.
6. Nodes with no embedding returned keep their current position.

Expose `layoutLoading: boolean` from the hook so the UI can show a spinner while the worker runs.

### UI change: `ui/src/components/GraphControls.tsx`

Add "Semantic" button to the layout switcher. Disable it (greyed, tooltip "Computing…") while `layoutLoading` is true. Show a small ⚡ icon to hint at the compute step.

---

## Performance

| Graph size | UMAP time (WebWorker) | Embedding fetch |
|---|---|---|
| 100 nodes | ~0.5s | ~50 KB |
| 500 nodes | ~2–4s | ~3 MB |
| 1000+ nodes | 10s+ | ~6 MB+ |

For graphs over 500 nodes, subsample: run UMAP on the 500 most-connected nodes, place the rest using their nearest neighbour among the sampled set (cosine similarity against already-projected nodes). Keeps layout interactive at scale.

Cache the latest `{ id → coords }` map in the layout hook so re-selecting Semantic is instant unless the node set changed.

---

## Out of Scope

- Persisting projected coordinates server-side (recompute per session).
- Incremental layout updates as new nodes are added (user must re-apply the layout).
- Exposing UMAP parameters via UI (use defaults; advanced controls live in the projector page).
- t-SNE and PCA for the 2D layout mode — those are exposed only in the projector page. UMAP is the 2D-mode default because its cluster tightness translates well to the graph visualisation.
