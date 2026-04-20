# Semantic Graph Layout Design

**Goal:** Place nodes in the graph canvas at 2D coordinates derived from their embedding vectors, so that semantically similar entities cluster spatially.

**Architecture:** A new backend endpoint returns stored embedding vectors in bulk. The frontend projects them to 2D using UMAP (via `umap-js`) in a WebWorker, then writes the resulting coordinates back to the graphology graph. A new "Semantic" option is added to the layout switcher alongside the existing Force / Radial / Hierarchy options.

**Tech Stack:** `umap-js` (npm), graphology, existing pgvector embeddings stored in the `entities` table.

---

## Backend

### New endpoint: `GET /api/entities/embeddings`

Returns embedding vectors for a set of entity IDs.

**Query params:**
- `ids` — comma-separated entity UUIDs (max 500)

**Response:**
```json
{
  "embeddings": [
    { "id": "uuid", "embedding": [0.123, -0.456, ...] }
  ]
}
```

**Implementation notes:**
- Embeddings are stored in the `entities` table as a `vector` column. Cast to `float4[]` for JSON serialisation: `embedding::float4[]`.
- Entities with no embedding (status = `pending`) are omitted from the response — the caller handles missing nodes gracefully (they stay at their current position).
- Auth: same API key bearer token as all other endpoints.
- No pagination needed — 500 entities × 1536 floats × 4 bytes = ~3 MB max payload, acceptable.

---

## Frontend

### WebWorker: `ui/src/workers/umap.worker.ts`

Runs UMAP off the main thread to avoid blocking the UI.

**Input message:**
```ts
{ ids: string[], embeddings: number[][] }
```

**Output message:**
```ts
{ positions: { id: string; x: number; y: number }[] }
```

**Implementation:**
```ts
import { UMAP } from 'umap-js';

self.onmessage = (e) => {
  const { ids, embeddings } = e.data;
  const umap = new UMAP({ nComponents: 2, nNeighbors: 15, minDist: 0.1 });
  const result = umap.fit(embeddings);
  const positions = ids.map((id, i) => ({ id, x: result[i][0], y: result[i][1] }));
  self.postMessage({ positions });
};
```

UMAP parameters:
- `nNeighbors: 15` — good default for knowledge graphs; increase for denser graphs
- `minDist: 0.1` — keeps related clusters tight
- Scale output coords by `×100` to match graphology's default coordinate space

### Layout hook change: `ui/src/hooks/useLayout.ts`

Add `'semantic'` to `LayoutType`. New `startSemantic(api)` method:

1. Collect all node IDs from the graph in batches of 500
2. Call `api.getEmbeddings(ids)` for each batch
3. Post `{ ids, embeddings }` to the UMAP WebWorker
4. On worker response: write `x`/`y` back to each node via `graph.setNodeAttribute`
5. Call `sigma.refresh()`
6. Nodes with no embedding returned keep their current position

Show a loading indicator in `GraphControls` while the worker is running (new `layoutLoading: boolean` return value from `useLayout`).

### API client change: `ui/src/lib/api.ts`

New method:
```ts
getEmbeddings(ids: string[]) {
  return r<{ embeddings: { id: string; embedding: number[] }[] }>(
    `/api/entities/embeddings?ids=${ids.join(',')}`
  );
}
```

### UI change: `ui/src/components/GraphControls.tsx`

Add "Semantic" button to the layout switcher. Disable it (greyed out, tooltip "Computing…") while `layoutLoading` is true.

---

## Performance

| Graph size | UMAP time (WebWorker) | Embedding fetch |
|---|---|---|
| 100 nodes | ~0.5s | ~50 KB |
| 500 nodes | ~2–4s | ~3 MB |
| 1000+ nodes | 10s+ | ~6 MB+ |

For graphs over 500 nodes, subsample: run UMAP on the 500 most-connected nodes, place the rest using their nearest neighbour among the sampled set (cosine similarity against already-projected nodes). This keeps it interactive at scale.

---

## Out of Scope

- Persisting UMAP coordinates (recompute on demand each session)
- Incremental layout updates as new nodes are added
- Server-side dimensionality reduction
- Changing UMAP parameters via UI
