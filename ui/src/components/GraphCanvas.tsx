import { useRef, useEffect, useCallback, useState } from 'react';
import { useSigma } from '../hooks/useSigma.ts';
import { useLayout } from '../hooks/useLayout.ts';
import type { LayoutType } from '../hooks/useLayout.ts';
import type { useGraph } from '../hooks/useGraph.ts';
import type { ApiClient } from '../lib/api.ts';
import GraphControls from './GraphControls.tsx';

type Props = {
  graphHook: ReturnType<typeof useGraph>;
  api: ApiClient;
  depth: number;
  onNodeClick: (nodeId: string) => void;
  onStageClick: () => void;
};

type ContextMenu = { nodeId: string; x: number; y: number } | null;

export default function GraphCanvas({ graphHook, api, depth, onNodeClick, onStageClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const loadingRef = useRef(new Set<string>());

  const expandNode = useCallback((nodeId: string) => {
    if (loadingRef.current.has(nodeId)) return;
    loadingRef.current.add(nodeId);
    api.expandGraph(nodeId, { depth }).then(data => {
      graphHook.addNeighbours(data.entities);
      graphHook.addEdges(data.edges);
    }).catch(console.error);
  }, [api, depth, graphHook]);

  const handleClickNode = useCallback((nodeId: string) => {
    onNodeClick(nodeId);
    expandNode(nodeId);
  }, [onNodeClick, expandNode]);

  const handleRightClickNode = useCallback((nodeId: string, x: number, y: number) => {
    setContextMenu({ nodeId, x, y });
  }, []);

  const handleClickStage = useCallback(() => {
    setContextMenu(null);
    onStageClick();
  }, [onStageClick]);

  const sigmaControls = useSigma(containerRef, graphHook.graph, {
    onClickNode: handleClickNode,
    onRightClickNode: handleRightClickNode,
    onClickStage: handleClickStage,
  });

  const layoutHook = useLayout(graphHook.graph);

  // Start force layout when the graph first receives nodes
  useEffect(() => {
    if (graphHook.graph.order > 0) {
      layoutHook.startForce();
    }
    // Re-run only when node count transitions from 0 to >0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphHook.graph.order > 0]);

  // Stop FA2 worker on unmount to avoid orphaned WebWorkers
  useEffect(() => () => layoutHook.stopWorker(), []);

  const handleLayoutChange = useCallback((next: LayoutType) => {
    layoutHook.switchLayout(next);
    // Refresh sigma after layout positions have been written
    sigmaControls.refresh();
  }, [layoutHook, sigmaControls]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      <GraphControls
        layout={layoutHook.layout}
        onLayoutChange={handleLayoutChange}
        onZoomIn={sigmaControls.zoomIn}
        onZoomOut={sigmaControls.zoomOut}
      />

      {/* Context menu */}
      {contextMenu && (
        <div
          className="absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-10 min-w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            {
              label: 'Expand neighbours',
              action: () => { expandNode(contextMenu.nodeId); setContextMenu(null); }
            },
            {
              label: 'Copy ID',
              action: () => { void navigator.clipboard.writeText(contextMenu.nodeId); setContextMenu(null); }
            },
          ].map(item => (
            <button
              key={item.label}
              onClick={item.action}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
