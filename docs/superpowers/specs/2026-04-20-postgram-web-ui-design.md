# Postgram Web UI — Design Spec

**Date:** 2026-04-20
**Status:** Approved

---

## Overview

A graph-centric web UI for Postgram, served as a separate Docker container on the local network. The primary feature is interactive knowledge graph navigation (Obsidian-style). Secondary features are semantic search, entity management, and server status monitoring.

---

## Architecture

### Container & Deployment

The UI is a separate Docker container running nginx. It serves the compiled React/Vite bundle and proxies all `/api/*` requests to the postgram server over the internal Docker network. No CORS configuration is needed on the postgram server.

```
[Browser on LAN] → [postgram-ui container, nginx :3000]
                        ├── /          → React SPA (static files)
                        └── /api/*     → http://postgram:3100/api/*
```

The container is added to the existing `docker-compose.yml`:

```yaml
services:
  postgram-ui:
    build: ./ui
    ports:
      - "3000:3000"
    depends_on:
      - postgram
    networks:
      - default   # same network as postgram
```

### Project Layout

The UI lives in `ui/` at the repo root — its own `package.json` and build config, not part of the existing npm workspace.

```
ui/
  Dockerfile
  nginx.conf
  vite.config.ts
  tsconfig.json
  package.json
  src/
    main.tsx
    App.tsx
    components/
    hooks/
    lib/
```

### Development

Vite's dev proxy mirrors the nginx setup. Developers run `npm run dev` in `ui/` pointing at a local postgram instance:

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:3100'
  }
}
```

---

## Tech Stack

| Concern | Library |
|---------|---------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Graph model | graphology |
| Graph renderer | Sigma.js (WebGL) |
| Force layout | graphology-layout-forceatlas2 (WebWorker) |
| Radial layout | graphology-layout (circular) |
| Hierarchy layout | dagre |
| Styling | Tailwind CSS |
| HTTP | native fetch (typed wrapper in `lib/api.ts`) |
| Routing | none — single page, panel state managed in React state |

---

## Authentication

On first visit the user sees a login screen with an API key input. The key is stored in `localStorage` and injected as `Authorization: Bearer <key>` on every API request. A logout button clears `localStorage` and returns to the login screen. If the key is invalid, any API call returns 401 and the UI redirects to the login screen.

No server-side session — the browser holds the key. Acceptable for a personal LAN tool.

---

## Layout

The UI has four persistent zones:

```
┌─────────────────────────────────────────────────────────┐
│  top bar: logo · search · health dot · logout           │
├───────────┬─────────────────────────────────┬───────────┤
│           │                                 │           │
│  LEFT     │      GRAPH CANVAS               │  RIGHT    │
│  PANEL    │      Sigma.js / WebGL           │  DETAIL   │
│  ~280px   │      full remaining width       │  PANEL    │
│           │                                 │  ~360px   │
│ search    │  nodes: colour by type          │           │
│ filters   │  edges: label on hover          │ slides in │
│ types     │  click → right panel            │ on node   │
│ depth     │  right-click → context menu     │ click     │
│ status    │                                 │           │
└───────────┴─────────────────────────────────┴───────────┘
```

The left panel is collapsible (chevron toggle). The right detail panel slides in when a node is selected and slides out when dismissed or when the user clicks the canvas background. Both panels overlay on narrow viewports.

---

## Graph Canvas

### Initial Load

1. On login, fetch all entities (`GET /api/entities?limit=500`, paginated if needed) — only id, type, tags, enrichment_status are used. This builds the node cloud.
2. Edges are loaded lazily: clicking a node calls `GET /api/entities/:id/graph?depth=1` and draws its neighbourhood.
3. Semantic search results auto-load edges for matched nodes.
4. A "Show connected" toggle in the left panel batch-loads edges for the top 50 most-recently-updated extracted entities to seed the graph with structure.

### Node Appearance

| Type | Colour | Base size |
|------|--------|-----------|
| document | #3B82F6 (blue) | scaled by edge count |
| memory | #8B5CF6 (purple) | fixed medium |
| person | #F97316 (orange) | scaled by edge count |
| project | #22C55E (green) | fixed large |
| task | #EAB308 (yellow) | fixed small |
| interaction | #14B8A6 (teal) | fixed small |

Nodes with `enrichment_status: pending` render at 60% opacity. Nodes with `enrichment_status: failed` get a red border ring.

### Edge Appearance

- Default: thin grey line, 0.5px
- On hover: highlighted, relation label appears as a tooltip
- Confidence < 0.5: dashed line
- Manual edges (confidence 1.0, source null): solid, slightly thicker

### Interaction

| Action | Behaviour |
|--------|-----------|
| Click node | Open right detail panel, load 1-hop edges |
| Right-click node | Context menu: Expand neighbours / Hide node / Pin node / Copy ID |
| Click edge | Highlight both endpoint nodes |
| Click canvas background | Deselect, close right panel |
| Scroll | Zoom |
| Drag canvas | Pan |
| Drag node | Move (unpins after drop unless pinned) |

### Layout Switcher

A floating button group in the bottom-right corner cycles between three layouts with animated position interpolation:

1. **Force-directed** (default) — ForceAtlas2 in a WebWorker, runs for 2s then freezes
2. **Radial** — circular layout, nodes arranged by type sector
3. **Hierarchy** — dagre top-down, meaningful when a node is focused

---

## Left Panel

**Search box** (top): Calls `POST /api/search` with `expand_graph: false` on each debounced input (300ms). Results appear as a list below the input. Clicking a result pans/zooms the graph to that node and highlights it. The active query is shown as a label on the graph canvas.

**Entity type chips**: Toggle visibility of each entity type on the graph. All on by default.

**Relation type chips**: Toggle visibility of edges by relation type (`involves`, `mentioned_in`, `related_to`, etc.). Populated dynamically from loaded edges.

**Depth slider** (1–3): Controls how many hops to load when expanding a node. Default 1.

**Status widget** (bottom of panel): Polls `GET /api/queue` every 30 seconds.
- Green dot: embedding pending = 0, extraction pending = 0
- Yellow dot: work in progress (shows pending counts)
- Red dot: failed > 0 (shows failed counts)

---

## Right Detail Panel

Opens when a node is clicked. Contains:

**Header:** Entity type badge, short ID, created/updated timestamps. Close (×) button.

**Content section:** Full entity content rendered as markdown (using a lightweight renderer). Inline edit button opens a textarea in place; Save calls `PATCH /api/entities/:id` with the current version for optimistic locking.

**Tags:** Displayed as chips. Editable inline.

**Edges section:** Edges grouped by relation type, each showing the neighbour's type icon, short content preview, and direction arrow (→ outgoing, ← incoming). Clicking a neighbour node flies the graph to it and opens its detail panel.

**Actions:**
- **Add note** — opens a modal to store a new `memory` entity linked to this one via `related_to`
- **Link** — opens a search-to-link modal: search for another entity, pick a relation type, calls `POST /api/edges`
- **Edit metadata** — visibility, status, tags (expanded form)
- **Delete** — confirmation dialog, calls `DELETE /api/entities/:id`

---

## Content Management (beyond graph)

### Add Note / Memory

Available from the right panel ("Add note") and from a global `+` button in the top bar. Opens a modal with:
- Content textarea
- Type selector (memory / interaction / project / person / task)
- Tags input
- Visibility selector (personal / work / shared)

Submits via `POST /api/entities`. The new node appears in the graph immediately.

### Ingest (document sync)

A status card in the left panel footer shows the last sync time per repo (from `GET /api/sync/status/:repo`). No in-browser sync trigger — sync is driven by the `pgm sync` CLI. The UI shows sync state only.

### Semantic Search

The search box in the left panel is the primary entry point. Results show score, chunk preview, and entity type. Matched nodes highlight in the graph with a yellow ring and the camera pans to encompass them.

---

## Server Status

The status widget in the left panel shows:
- **Health**: green/yellow/red dot from `GET /health`
- **Embedding queue**: pending / completed / failed counts
- **Extraction queue**: pending / completed / failed counts
- **Oldest pending**: how long the oldest item has been waiting (signals stalled worker)

Clicking the widget expands it to show full queue detail.

---

## Component Tree

```
App
├── LoginScreen            (shown if no API key in localStorage)
└── MainLayout
    ├── TopBar
    │   ├── SearchBox      (global, mirrors left panel search)
    │   ├── HealthDot
    │   └── LogoutButton
    ├── LeftPanel
    │   ├── SearchBox      (primary search)
    │   ├── SearchResults
    │   ├── FilterChips    (entity types)
    │   ├── RelationChips  (relation types)
    │   ├── DepthSlider
    │   └── StatusWidget
    ├── GraphCanvas
    │   ├── SigmaContainer
    │   ├── GraphControls  (layout switcher, zoom in/out)
    │   └── NodeContextMenu
    └── RightPanel
        ├── EntityDetail
        ├── EdgeList
        └── EntityActions
```

---

## Hooks

| Hook | Responsibility |
|------|---------------|
| `useApi` | Fetch wrapper — injects API key, handles 401 → logout |
| `useGraph` | Graphology instance — add/remove nodes and edges, sync with API |
| `useSigma` | Sigma lifecycle — mount, camera controls, event forwarding |
| `useLayout` | Layout switching — coordinates ForceAtlas2 worker + dagre + circular |
| `useSearch` | Debounced search calls, result state, graph highlight sync |
| `useQueue` | Polls `/api/queue` every 30s, exposes status object |
| `useEntityDetail` | Loads full entity + edges for the right panel |

---

## Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
```

```nginx
# nginx.conf
server {
  listen 3000;

  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://postgram:3100/api/;
    proxy_set_header Host $host;
  }
}
```

---

## Out of Scope (v1)

- Mobile layout
- Dark mode
- Real-time push updates (graph updates on entity change) — polling only
- In-browser document sync trigger
- Multi-user / shared sessions
- Graph export (PNG / JSON)
