import { useRef, useEffect, useCallback, useState } from 'react';
import { useSigma } from '../hooks/useSigma.ts';
import type { useGraph } from '../hooks/useGraph.ts';
import type { ApiClient } from '../lib/api.ts';

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

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button
          onClick={sigmaControls.zoomIn}
          className="w-9 h-9 bg-gray-800 border border-gray-700 rounded text-white text-lg hover:bg-gray-700 flex items-center justify-center"
        >
          +
        </button>
        <button
          onClick={sigmaControls.zoomOut}
          className="w-9 h-9 bg-gray-800 border border-gray-700 rounded text-white text-lg hover:bg-gray-700 flex items-center justify-center"
        >
          −
        </button>
      </div>

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
