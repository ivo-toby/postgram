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
        { x: nodePosition.x, y: nodePosition.y, ratio: 0.5 },
        { duration: 500 }
      );
    }
  }, []);

  const refresh = useCallback(() => {
    sigmaRef.current?.refresh();
  }, []);

  return { sigmaRef, zoomIn, zoomOut, focusNode, refresh };
}
