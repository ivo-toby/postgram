import { useRef, useMemo } from 'react';
import Graph from 'graphology';
import type { Entity, Edge, GraphNeighbour } from '../lib/types.ts';
import { getNodeColor, getNodeSize, getNodeOpacity } from '../lib/nodeStyles.ts';

function makeNodeAttrs(type: string, content: string | null, enrichmentStatus: string | null, edgeCount = 0) {
  return {
    x: (Math.random() - 0.5) * 100,
    y: (Math.random() - 0.5) * 100,
    size: getNodeSize(type, edgeCount),
    color: getNodeColor(type),
    label: (content ?? '').slice(0, 60) || type,
    type,
    enrichment_status: enrichmentStatus,
    hidden: false,
    opacity: getNodeOpacity(enrichmentStatus),
  };
}

export function useGraph() {
  const graphRef = useRef(new Graph({ multi: false, type: 'directed' }));
  const graph = graphRef.current;

  function addEntities(entities: Entity[]) {
    for (const entity of entities) {
      if (!graph.hasNode(entity.id)) {
        graph.addNode(entity.id, makeNodeAttrs(entity.type, entity.content, entity.enrichment_status));
      }
    }
  }

  function addNeighbours(neighbours: GraphNeighbour[]) {
    for (const n of neighbours) {
      if (!graph.hasNode(n.id)) {
        graph.addNode(n.id, makeNodeAttrs(n.type, n.content, null));
      }
    }
  }

  function addEdges(edges: Edge[]) {
    for (const edge of edges) {
      if (!graph.hasEdge(edge.id) && graph.hasNode(edge.source_id) && graph.hasNode(edge.target_id)) {
        graph.addEdgeWithKey(edge.id, edge.source_id, edge.target_id, {
          label: edge.relation,
          color: '#4B5563',
          size: edge.confidence === 1 && edge.source === null ? 2 : 1,
          hidden: false,
        });
      }
    }
  }

  function setNodesHiddenByType(type: string, hidden: boolean) {
    graph.forEachNode((id, attrs) => {
      if (attrs['type'] === type) {
        graph.setNodeAttribute(id, 'hidden', hidden);
      }
    });
  }

  function setEdgesHiddenByRelation(relation: string, hidden: boolean) {
    graph.forEachEdge((id, attrs) => {
      if (attrs['label'] === relation) {
        graph.setEdgeAttribute(id, 'hidden', hidden);
      }
    });
  }

  function getLoadedRelations(): Set<string> {
    const relations = new Set<string>();
    graph.forEachEdge((_, attrs) => {
      if (attrs['label']) relations.add(attrs['label'] as string);
    });
    return relations;
  }

  return useMemo(
    () => ({ graph, addEntities, addNeighbours, addEdges, setNodesHiddenByType, setEdgesHiddenByRelation, getLoadedRelations }),
    // graph reference is stable — functions are recreated but graph identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}
