# Embedding Projector Design

**Goal:** A standalone 3D visualisation of the entire entity corpus as a point cloud in embedding space — inspired by the TensorFlow Embedding Projector. Users orbit/pan/zoom through the cloud, colour points by metadata, highlight nearest neighbours, and jump from any point into the Graph or Search views.

**Architecture:** A new top-bar tab — **Projector** — rendering a `<canvas>` driven by `@react-three/fiber` (react bindings for three.js). Points are projected from the stored embedding vectors with UMAP / PCA / t-SNE (user-selectable) in a WebWorker. Interaction (hover, select, kNN) uses three.js raycasting; filters reuse the SearchPage filter components.

**Relationship to other specs:**
- Reuses the `POST /api/entities/embeddings` endpoint and `projection.worker.ts` described in the *Shared Infrastructure* section of `2026-04-20-semantic-graph-layout-design.md`. This spec extends the worker with 3D output and additional algorithms.
- Does **not** replace the 2D Semantic layout mode inside the Graph page — that remains part of the graph exploration surface. The projector is a purer cluster-analysis tool with no edges or layout switching.

**Tech Stack:** `three`, `@react-three/fiber`, `@react-three/drei` (OrbitControls, Text), `umap-js`, `ml-pca`, `tsne-js`, existing API client + search types.

---

## Navigation

Extend `type Page = 'search' | 'graph'` in `ui/src/components/TopBar.tsx` to include `'projector'`. Add a third tab button between Graph and Logout:

```
[Search] [Graph] [Projector]            … [Logout]
```

Projector is **not** the default — keep Search as default. Persist the last-opened tab in `localStorage` under `pgm_current_page` (already wired).

---

## Page component: `ui/src/components/ProjectorPage.tsx`

### Layout

```
┌───────────────────────────────────────────────────────────────┐
│ [Algorithm ▾] [Colour by ▾] [Filter…] [Labels ◻] [Reset view]│ ← toolbar
├──────────────────────────────────────────────────┬────────────┤
│                                                  │            │
│                                                  │  Legend    │
│                                                  │  Selection │
│                                                  │  detail    │
│                3D scene (canvas)                 │  panel     │
│                                                  │  (hidden   │
│                                                  │   on       │
│                                                  │   mobile)  │
│                                                  │            │
└──────────────────────────────────────────────────┴────────────┘
```

On mobile the selection detail panel overlays the scene as a bottom sheet.

### Data loading

On mount (when user first opens the tab):

1. Call `api.listEntities({ limit: 500, offset })` in a loop to collect all entity IDs and their metadata (type, tags, status, owner, content preview). Cache in component state.
2. Call the shared `getEmbeddings(ids)` endpoint in batches of 500.
3. Post `{ ids, embeddings, dim: 3, algorithm }` to the projection worker.
4. On `result`, build a typed `Float32Array` of `[x, y, z]` per point for three.js.

Show a full-screen loading state with progress (percent of entities fetched, percent of UMAP epochs). Cache results in memory so re-opening the tab is instant unless the algorithm or colour-by filter changes.

### 3D scene

```tsx
<Canvas camera={{ position: [0, 0, 25], fov: 55 }}>
  <color attach="background" args={['#030712']} />   {/* gray-950 */}
  <ambientLight intensity={0.6} />
  <PointCloud positions={positions} colors={colors} sizes={sizes} />
  <HighlightRing selectedId={selectedId} positions={positions} />
  <KnnLines from={selectedId} to={knnIds} positions={positions} />
  <HoverLabel hoveredId={hoveredId} positions={positions} />
  <OrbitControls enableDamping dampingFactor={0.1} makeDefault />
  <axesHelper args={[5]} /> {/* toggled by Labels control */}
</Canvas>
```

**Point cloud implementation:** a single `<points>` with a `BufferGeometry` holding `position` and `color` attributes (both `Float32BufferAttribute`), and a `ShaderMaterial` / `PointsMaterial` with:
- `size: 0.15` base (configurable by zoom level; use `sizeAttenuation: true`)
- `vertexColors: true`
- Custom fragment shader drawing a soft-edged disc (`discard` outside radius) for a clean look at any zoom
- `transparent: true, depthWrite: false` to allow light halos without z-fighting

Rendering a single `<points>` scales to tens of thousands of entries trivially.

### Interaction

| Action | Behaviour |
|---|---|
| Orbit | Left-drag rotates; right-drag pans; scroll zooms. OrbitControls. |
| Hover | Raycast against point cloud (threshold tuned to disc radius). Show floating label with first 40 chars of content + type badge near cursor. |
| Click | Select the nearest point. Opens the selection detail panel and highlights the point with a ring + draws lines to its k-nearest neighbours in embedding space (pre-computed on projection result, k = 8). |
| Shift-click | Add point to a "pinned" set (kept highlighted as user clicks around). |
| Esc / background click | Clear selection. |
| Double-click | Re-centre camera on the selected point (keeps current zoom). |

**kNN computation:** done once in the worker after projection. For each point, compute cosine similarity against all other points in the original high-dim embedding (not the projected coords — preserves true similarity), keep top-8. Store `{ id → number[] }` map. Worker reports `{ type: 'result', positions, knn }`.

### Toolbar

```tsx
<ProjectorControls
  algorithm={algorithm} onAlgorithmChange={…}
  colorBy={colorBy} onColorByChange={…}
  filters={filters} onFiltersChange={…}
  labelsOn={labelsOn} onToggleLabels={…}
  onResetView={() => controlsRef.current?.reset()}
/>
```

**Algorithm:** `umap` (default) | `pca` | `tsne`. Changing triggers a re-projection (cached per-algorithm).

**Colour by:** `type` (default, uses `ENTITY_COLORS`) | `status` | `owner` | `visibility` | `tag:<name>` | `none` (all gray). Dropdown groups show colour legend in the side panel.

**Filter:** reuses the `Section` sub-components from `SearchPage.tsx` (entity types, statuses, visibility, owner, tags) — rendered in a popover from the toolbar. Filtered-out points are kept in the scene but rendered at 0.1 alpha so the cluster shape is preserved; filtered-in points remain at full alpha. A "Hide filtered" toggle removes them entirely.

**Labels:** off by default. On → render `<Text>` from `drei` above every point whose content has ≥1 tag OR is currently hovered/selected. Capped at ~30 visible labels via screen-space collision to avoid clutter.

**Reset view:** restores camera to `[0, 0, 25]` looking at origin.

### Selection detail panel

When a point is selected, the right-hand (desktop) / bottom-sheet (mobile) panel shows:

- Entity type badge, status, visibility
- First line of content (markdown-rendered, truncated)
- Tags
- **Nearest neighbours** — list of 8, each with type badge + content preview. Clicking a neighbour selects it in the scene (camera zooms onto it).
- **Actions:** `Open in Graph →` (navigates to Graph tab with node focused), `Open in Search →` (navigates to Search with the entity selected)

### Cross-page navigation

`Open in Graph` reuses the existing `handleOpenInGraph(nodeId)` from `App.tsx` — lifted to a context or passed via props. `Open in Search` sets a pending `selectedId` on the SearchPage via a new `onOpenInSearch(nodeId)` callback that navigates and pre-selects.

---

## WebWorker extensions

Extend `projection.worker.ts` (defined in the semantic-graph-layout spec) to:

1. Accept `algorithm: 'umap' | 'pca' | 'tsne'`.
2. Support `dim: 3`.
3. Emit `progress` events for UMAP (every 10 epochs) and t-SNE (every 50 iterations).
4. Compute and return kNN map based on **original** embeddings.

**PCA** via `ml-pca`:
```ts
import { PCA } from 'ml-pca';
const pca = new PCA(embeddings);
const result = pca.predict(embeddings, { nComponents: dim }).to2DArray();
```
Fast (~100 ms for 500×1536), deterministic — good first render while UMAP computes in the background.

**t-SNE** via `tsne-js`:
```ts
import TSNE from 'tsne-js';
const model = new TSNE({ dim, perplexity: 30, earlyExaggeration: 4.0, learningRate: 100 });
model.init({ data: embeddings, type: 'dense' });
model.run();
const result = model.getOutputScaled();
```
Slow (10–30s for 500 points). Warn the user with a progress bar.

---

## Performance

| Point count | UMAP 3D | PCA 3D | t-SNE 3D | Render FPS |
|---|---|---|---|---|
| 500 | ~3–5s | ~0.1s | ~15s | 60 |
| 2 000 | ~10–15s | ~0.3s | 60s+ | 60 |
| 10 000 | 30s+ | ~1s | impractical | 60 (single points material) |

Projection is the bottleneck, not rendering. Strategies:

- **Default to PCA** on first paint while UMAP runs in the background; swap to UMAP when ready.
- Subsample beyond 2 000 entities (same strategy as the 2D layout mode): project the 2 000 most-connected nodes with UMAP/t-SNE, place the rest using their nearest-neighbour projected position + small jitter.
- Memoise projection per `(algorithm, dim, entity-set-hash)` so toggling algorithms is free after the first compute.

Rendering is handled by a single draw call regardless of count — three.js points scale well. FPS is stable at 60 up to ~50 k points on mid-range hardware.

---

## Persistence

Projector state stored in `localStorage`:

- `pgm_projector_algorithm` — last chosen algorithm
- `pgm_projector_color_by` — last colour-by
- `pgm_projector_filters` — last filter set (JSON)

Not persisted: camera pose, selection, hover (transient).

---

## Accessibility / mobile

- Keyboard: arrow keys rotate (10° per press), `+/−` zoom, Enter on hover selects, Esc clears.
- Touch: one-finger orbit, two-finger pan, pinch zoom. OrbitControls has this built-in.
- Selection panel collapses to a bottom sheet under 768 px.
- Colour legend is always keyboard-accessible via the toolbar.

---

## Out of Scope

- Server-side projection (all projection runs client-side in the worker).
- Animating between projections when switching algorithms (snap for v1; animate is a follow-up).
- Saving/sharing a specific camera angle via URL.
- Editing entities from the projector page (use "Open in Search" to edit).
- Custom embedding spaces (e.g. project only tasks, project only tags) — v1 uses the full entity embedding space.
- Rendering entity–entity edges as 3D lines. Available as a future toggle but off by default because it obscures cluster structure.
