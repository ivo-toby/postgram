import { useEffect, useRef, useCallback } from 'react';
import Sigma from 'sigma';
import type { SigmaEvents as SigmaEventMap } from 'sigma/types';
import type Graph from 'graphology';

type SigmaEvents = {
  onClickNode?: (nodeId: string) => void;
  onRightClickNode?: (nodeId: string, x: number, y: number) => void;
  onClickStage?: () => void;
};

export function useSigma(
  containerRef: React.RefObject<HTMLDivElement | null>,
  graph: Graph,
  events: SigmaEvents = {}
) {
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: '#374151',
      defaultNodeColor: '#3B82F6',
      labelFont: 'Inter, sans-serif',
      labelSize: 11,
      labelColor: { color: '#9CA3AF' },
    });

    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [containerRef, graph]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    const handleClickNode: SigmaEventMap['clickNode'] = ({ node }) => {
      events.onClickNode?.(node);
    };
    const handleRightClickNode: SigmaEventMap['rightClickNode'] = ({ node, event }) => {
      events.onRightClickNode?.(node, event.x, event.y);
    };
    const handleClickStage: SigmaEventMap['clickStage'] = () => {
      events.onClickStage?.();
    };

    sigma.on('clickNode', handleClickNode);
    sigma.on('rightClickNode', handleRightClickNode);
    sigma.on('clickStage', handleClickStage);

    return () => {
      sigma.off('clickNode', handleClickNode);
      sigma.off('rightClickNode', handleRightClickNode);
      sigma.off('clickStage', handleClickStage);
    };
  }, [events.onClickNode, events.onRightClickNode, events.onClickStage]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    let draggedNode: string | null = null;
    let dragged = false;
    let initialDrag: { x: number; y: number } | null = null;
    let currentDelta = { dx: 0, dy: 0 };
    type NeighborState = { initX: number; initY: number; curX: number; curY: number; factor: number };
    let neighborState = new Map<string, NeighborState>();
    let rafId: number | null = null;

    // Spring settling speed (higher = snappier); hop attenuation gives nearby nodes stronger pull.
    const SPRING = 0.3;
    const ATTENUATION: Record<number, number> = { 1: 0.9, 2: 0.4 };
    const MAX_HOP = 2;

    const stepAnimation = () => {
      let active = false;
      neighborState.forEach((s, nodeId) => {
        if (!graph.hasNode(nodeId)) return;
        const tx = s.initX + currentDelta.dx * s.factor;
        const ty = s.initY + currentDelta.dy * s.factor;
        const ex = tx - s.curX;
        const ey = ty - s.curY;
        if (Math.abs(ex) > 0.0005 || Math.abs(ey) > 0.0005) {
          s.curX += ex * SPRING;
          s.curY += ey * SPRING;
          graph.setNodeAttribute(nodeId, 'x', s.curX);
          graph.setNodeAttribute(nodeId, 'y', s.curY);
          active = true;
        }
      });
      sigma.refresh();
      if (active || draggedNode) {
        rafId = requestAnimationFrame(stepAnimation);
      } else {
        rafId = null;
      }
    };

    const ensureAnimating = () => {
      if (rafId === null) rafId = requestAnimationFrame(stepAnimation);
    };

    const onDownNode: SigmaEventMap['downNode'] = ({ node }) => {
      draggedNode = node;
      dragged = false;
      initialDrag = {
        x: graph.getNodeAttribute(node, 'x') as number,
        y: graph.getNodeAttribute(node, 'y') as number,
      };
      currentDelta = { dx: 0, dy: 0 };
      neighborState = new Map();

      // BFS up to MAX_HOP, snapshotting each neighbour's starting position.
      const visited = new Set<string>([node]);
      let frontier: string[] = [node];
      for (let hop = 1; hop <= MAX_HOP && frontier.length > 0; hop++) {
        const next: string[] = [];
        for (const n of frontier) {
          graph.forEachNeighbor(n, (nb) => {
            if (visited.has(nb)) return;
            visited.add(nb);
            const x = graph.getNodeAttribute(nb, 'x') as number;
            const y = graph.getNodeAttribute(nb, 'y') as number;
            neighborState.set(nb, {
              initX: x, initY: y, curX: x, curY: y,
              factor: ATTENUATION[hop] ?? 0,
            });
            next.push(nb);
          });
        }
        frontier = next;
      }

      sigma.getCamera().disable();
      ensureAnimating();
    };

    const captor = sigma.getMouseCaptor();

    const onMouseMove = ({ x, y }: { x: number; y: number }) => {
      if (!draggedNode || !initialDrag) return;
      dragged = true;
      const pos = sigma.viewportToGraph({ x, y });
      currentDelta = { dx: pos.x - initialDrag.x, dy: pos.y - initialDrag.y };
      graph.setNodeAttribute(draggedNode, 'x', pos.x);
      graph.setNodeAttribute(draggedNode, 'y', pos.y);
      ensureAnimating();
    };

    const onMouseUp = () => {
      sigma.getCamera().enable();
      draggedNode = null;
      initialDrag = null;
      // Keep animating so neighbours spring to rest at their final targets.
      ensureAnimating();
    };

    // Suppress clickNode when the user just finished dragging
    const onClickNode: SigmaEventMap['clickNode'] = (e) => {
      if (dragged) {
        dragged = false;
        if (typeof e.preventSigmaDefault === 'function') e.preventSigmaDefault();
      }
    };

    sigma.on('downNode', onDownNode);
    sigma.on('clickNode', onClickNode);
    captor.on('mousemovebody', onMouseMove);
    captor.on('mouseup', onMouseUp);

    return () => {
      sigma.off('downNode', onDownNode);
      sigma.off('clickNode', onClickNode);
      captor.off('mousemovebody', onMouseMove);
      captor.off('mouseup', onMouseUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [graph]);

  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300 });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 });
  }, []);

  const focusNode = useCallback((nodeId: string, g: Graph) => {
    const sigma = sigmaRef.current;
    if (!sigma || !g.hasNode(nodeId)) return;
    const nodePosition = sigma.getNodeDisplayData(nodeId);
    if (nodePosition) {
      sigma.getCamera().animate(
        { x: nodePosition.x, y: nodePosition.y, ratio: 0.15 },
        { duration: 500 }
      );
    }
  }, []);

  const refresh = useCallback(() => {
    sigmaRef.current?.refresh();
  }, []);

  return { sigmaRef, zoomIn, zoomOut, focusNode, refresh };
}
