# UI Improvements Backlog

Mini-specs for future work. Each item is self-contained and can be planned independently.

---

## Dim non-matching nodes during search

While a search query is active, dim all nodes that are not in the results set (opacity ~0.15, greyed color). Clear on search reset. Implementation: `useSearch` returns result IDs as a Set; `useGraph` gets a `setHighlight(ids)` method that updates node `color` and `size` attributes. Sigma re-renders automatically.

---

## Create entity from canvas right-click

Right-clicking empty canvas space (the `rightClickStage` Sigma event) opens a small "New entity" popover at the click coordinates. Pre-fills `x`/`y` position so the new node appears where the user clicked. Reuses the existing `createEntity` API call and `AddNoteModal` form fields. After creation, add the node to the graph at the clicked position.

---

## Edge label toggle

Add a "Show edge labels" toggle button to GraphControls. Calls `sigma.setSetting('renderEdgeLabels', true/false)`. Currently hardcoded to `false` in useSigma. Useful for exploring relation types visually.

---

## Keyboard navigation

- `Escape` — close right panel, deselect node
- `Arrow keys` (when a node is selected) — move to next connected node (cycle through neighbours)
- `Cmd/Ctrl + F` — focus search box

Implemented as a `useEffect` with `keydown` listener in `App.tsx`. Neighbour cycling uses `graphHook.graph.neighbors(selectedNodeId)`.

---

## Breadcrumb trail

A horizontal strip below the TopBar showing the last N (default 5) visited nodes as clickable chips: `[memory: note about X] → [person: Alice] → [project: Postgram]`. State is a `visitedNodes: string[]` array in App.tsx, prepended on each `handleNodeClick`. Chips call `handleNodeClick` to navigate back.

---

## Export current view as PNG

Button in TopBar or GraphControls. Calls `sigma.getWebGLRenderer().domElement.toDataURL('image/png')` and triggers a download. Falls back to `renderer.toDataURL()` on the Sigma canvas. No dependencies needed.

---

## Entity timeline view

An alternative to the graph view, toggled from TopBar. Shows entities with a `created_at` date on a vertical timeline, grouped by day. Useful for `interaction` and `memory` types. Renders as a scrollable list, not a graph. Clicking an entity still opens the right panel detail view. Implementation: a new `TimelineView` component that receives the loaded entities array from App.tsx.

---

## Semantic layout (UMAP)

Already fully specced. See `2026-04-20-semantic-graph-layout-design.md`.

---

## Mobile responsive

Already ticketed in Postgram. See task `35cc9db6`. Three areas: responsive breakpoints (panels → bottom sheets), touch events for node drag, right panel overflow.
