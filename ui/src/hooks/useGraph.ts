import { useRef, useMemo } from 'react';
import Graph from 'graphology';
import type { Entity, Edge, GraphNeighbour } from '../lib/types.ts';
import { getNodeColor, getNodeSize, getNodeOpacity } from '../lib/nodeStyles.ts';
import { entityTitle } from '../lib/entityTitle.ts';

function makeNodeAttrs(entity: { id: string; type: string; content: string | null; metadata?: Record<string, unknown> }, enrichmentStatus: string | null, edgeCount = 0) {
  // Construct a minimal Entity shape for the title helper.
  const e = {
    id: entity.id,
    type: entity.type,
    content: entity.content,
    metadata: entity.metadata ?? {},
  } as Entity;
  return {
    x: (Math.random() - 0.5) * 100,
    y: (Math.random() - 0.5) * 100,
    size: getNodeSize(entity.type, edgeCount),
    color: getNodeColor(entity.type),
    label: entityTitle(e, 60) || entity.type,
    type: 'circle',
    entityType: entity.type,
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
        graph.addNode(entity.id, makeNodeAttrs(entity, entity.enrichment_status));
      }
    }
  }

  function addNeighbours(neighbours: GraphNeighbour[]) {
    for (const n of neighbours) {
      if (!graph.hasNode(n.id)) {
        graph.addNode(n.id, makeNodeAttrs(n, null));
      }
    }
  }

  function addEdges(edges: Edge[]) {
    for (const edge of edges) {
      if (
        !graph.hasEdge(edge.id) &&
        graph.hasNode(edge.source_id) &&
        graph.hasNode(edge.target_id) &&
        !graph.hasDirectedEdge(edge.source_id, edge.target_id)
      ) {
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
      if (attrs['entityType'] === type) {
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

  function clear() {
    graph.clear();
  }

  return useMemo(
    () => ({ graph, addEntities, addNeighbours, addEdges, setNodesHiddenByType, setEdgesHiddenByRelation, getLoadedRelations, clear }),
    // graph reference is stable — functions are recreated but graph identity is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}
