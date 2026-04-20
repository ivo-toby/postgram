import { useState, useRef, useCallback } from 'react';
import type Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';
import circular from 'graphology-layout/circular';
import dagre from 'dagre';

export type LayoutType = 'force' | 'radial' | 'hierarchy';

const FORCE_DURATION_MS = 2000;

export function useLayout(graph: Graph) {
  const [layout, setLayout] = useState<LayoutType>('force');
  const supervisorRef = useRef<FA2LayoutSupervisor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopWorker = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (supervisorRef.current) {
      supervisorRef.current.stop();
      supervisorRef.current.kill();
      supervisorRef.current = null;
    }
  }, []);

  const startForce = useCallback(() => {
    if (graph.order === 0) return;

    stopWorker();

    const supervisor = new FA2LayoutSupervisor(graph, {
      settings: {
        barnesHutOptimize: graph.order > 100,
        gravity: 1,
        scalingRatio: 2,
      },
    });
    supervisorRef.current = supervisor;
    supervisor.start();

    timerRef.current = setTimeout(() => {
      supervisor.stop();
      timerRef.current = null;
    }, FORCE_DURATION_MS);
  }, [graph, stopWorker]);

  const applyRadial = useCallback(() => {
    circular.assign(graph);
  }, [graph]);

  const applyHierarchy = useCallback(() => {
    try {
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });
      g.setDefaultEdgeLabel(() => ({}));

      graph.forEachNode(nodeId => {
        g.setNode(nodeId, { width: 40, height: 40 });
      });

      graph.forEachEdge((_edgeId, _attrs, source, target) => {
        g.setEdge(source, target);
      });

      dagre.layout(g);

      g.nodes().forEach(nodeId => {
        const nodeData = g.node(nodeId);
        if (nodeData && graph.hasNode(nodeId)) {
          // dagre uses pixel coords — normalize to graphology space by dividing by 100
          graph.setNodeAttribute(nodeId, 'x', nodeData.x / 100);
          graph.setNodeAttribute(nodeId, 'y', nodeData.y / 100);
        }
      });
    } catch {
      // Fall back to circular if dagre fails (e.g. disconnected graph edge cases)
      circular.assign(graph);
    }
  }, [graph]);

  const switchLayout = useCallback((next: LayoutType, _focusNodeId?: string) => {
    stopWorker();

    if (next === 'force') {
      startForce();
    } else if (next === 'radial') {
      applyRadial();
    } else if (next === 'hierarchy') {
      applyHierarchy();
    }

    setLayout(next);
  }, [stopWorker, startForce, applyRadial, applyHierarchy]);

  return { layout, switchLayout, startForce, stopWorker };
}
