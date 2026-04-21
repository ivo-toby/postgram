import { useState, useRef, useCallback } from 'react';
import type Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';
import circular from 'graphology-layout/circular';
import dagre from 'dagre';
import type { ApiClient } from '../lib/api.ts';
import type { ProjectionRequest, ProjectionResponse } from '../workers/projection.worker.ts';

export type LayoutType = 'force' | 'radial' | 'hierarchy' | 'semantic';

const FORCE_DURATION_MS = 2000;
const EMBEDDING_BATCH = 500;
const SEMANTIC_SCALE = 100;

export function useLayout(graph: Graph) {
  const [layout, setLayout] = useState<LayoutType>('force');
  const [layoutLoading, setLayoutLoading] = useState(false);
  const supervisorRef = useRef<FA2LayoutSupervisor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const semanticCacheRef = useRef<Map<string, [number, number]>>(new Map());

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
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
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

  const applyCachedSemantic = useCallback(() => {
    semanticCacheRef.current.forEach((coords, nodeId) => {
      if (graph.hasNode(nodeId)) {
        graph.setNodeAttribute(nodeId, 'x', coords[0] * SEMANTIC_SCALE);
        graph.setNodeAttribute(nodeId, 'y', coords[1] * SEMANTIC_SCALE);
      }
    });
  }, [graph]);

  const startSemantic = useCallback(async (api: ApiClient): Promise<void> => {
    if (graph.order === 0) return;
    stopWorker();
    setLayoutLoading(true);

    try {
      const ids: string[] = [];
      graph.forEachNode(id => { ids.push(id); });

      const allEmbeddings: { id: string; embedding: number[] }[] = [];
      for (let i = 0; i < ids.length; i += EMBEDDING_BATCH) {
        const batch = ids.slice(i, i + EMBEDDING_BATCH);
        const res = await api.getEmbeddings(batch);
        allEmbeddings.push(...res.embeddings);
      }

      if (allEmbeddings.length < 2) {
        setLayoutLoading(false);
        return;
      }

      const worker = new Worker(
        new URL('../workers/projection.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      await new Promise<void>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<ProjectionResponse>) => {
          const msg = event.data;
          if (msg.type === 'result') {
            semanticCacheRef.current.clear();
            for (const pos of msg.positions) {
              const [x = 0, y = 0] = pos.coords;
              semanticCacheRef.current.set(pos.id, [x, y]);
              if (graph.hasNode(pos.id)) {
                graph.setNodeAttribute(pos.id, 'x', x * SEMANTIC_SCALE);
                graph.setNodeAttribute(pos.id, 'y', y * SEMANTIC_SCALE);
              }
            }
            resolve();
          } else if (msg.type === 'error') {
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (e) => reject(new Error(e.message));

        const request: ProjectionRequest = {
          ids: allEmbeddings.map(e => e.id),
          embeddings: allEmbeddings.map(e => e.embedding),
          dim: 2,
          algorithm: 'umap',
        };
        worker.postMessage(request);
      });

      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    } finally {
      setLayoutLoading(false);
    }
  }, [graph, stopWorker]);

  const switchLayout = useCallback(
    (next: LayoutType, options?: { api?: ApiClient }) => {
      stopWorker();

      if (next === 'force') {
        startForce();
      } else if (next === 'radial') {
        applyRadial();
      } else if (next === 'hierarchy') {
        applyHierarchy();
      } else if (next === 'semantic') {
        if (semanticCacheRef.current.size > 0) {
          applyCachedSemantic();
        }
        if (options?.api) {
          void startSemantic(options.api).catch(console.error);
        }
      }

      setLayout(next);
    },
    [stopWorker, startForce, applyRadial, applyHierarchy, applyCachedSemantic, startSemantic]
  );

  return { layout, layoutLoading, switchLayout, startForce, stopWorker };
}
