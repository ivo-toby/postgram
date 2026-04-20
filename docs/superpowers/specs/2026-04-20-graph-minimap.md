# Graph Minimap

**Goal:** A small always-visible overview of the full graph in the bottom-left corner of the canvas, showing all nodes as dots and a rectangle indicating the current viewport. Clicking or dragging in the minimap moves the main camera.

**Architecture:** A `<canvas>` element rendered on top of the Sigma canvas (absolute positioned). Redraws on every Sigma `afterRender` event. Camera sync is bidirectional: Sigma camera changes update the minimap viewport rect; click/drag on the minimap animates the Sigma camera.

**Tech Stack:** HTML5 Canvas 2D API, Sigma.js camera API, graphology node positions.

---

## Component: `ui/src/components/GraphMinimap.tsx`

```tsx
type Props = {
  sigmaRef: React.RefObject<Sigma | null>;
  graph: Graph;
};
```

Renders a `<canvas ref={canvasRef}>` at fixed size (160×120px), positioned absolute bottom-left inside GraphCanvas's relative container.

### Drawing

On each `afterRender` event from Sigma:

1. Clear canvas
2. Draw background: `rgba(17, 24, 39, 0.85)` (gray-900 with opacity)
3. For each non-hidden node: read `x`/`y` from graph, map to minimap coords, draw a 2px circle in the node's `color` attribute
4. Compute viewport rectangle from Sigma camera (`ratio`, `x`, `y`) and draw as a white semi-transparent rect

Coordinate mapping: find bounding box of all node positions, normalise to `[0, 1]`, scale to minimap dimensions with 8px padding.

### Interaction

`mousedown` + `mousemove` on the minimap canvas:
- Convert click position back to graph coordinates
- Call `sigma.getCamera().animate({ x, y, ratio: currentRatio }, { duration: 200 })`

### Integration in GraphCanvas

```tsx
<GraphMinimap sigmaRef={sigmaControls.sigmaRef} graph={graphHook.graph} />
```

Place inside the `<div className="relative w-full h-full">` container, after the Sigma container div.

---

## Performance

- Minimap redraws only on `afterRender` (Sigma already throttles this)
- With 2000 nodes, each draw is ~2000 fillRect calls on a 160×120 canvas — negligible
- No animation loop needed; event-driven only

---

## Out of Scope

- Edge rendering in minimap (too noisy at scale)
- Node labels in minimap
- Resize handle
- Hide/show toggle (always visible)
