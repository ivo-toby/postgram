import { useState, useEffect } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, Edge } from '../lib/types.ts';

export function useEntityDetail(api: ApiClient, entityId: string | null) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityId) {
      setEntity(null);
      setEdges([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      api.getEntity(entityId),
      api.listEdges(entityId),
    ]).then(([entityRes, edgesRes]) => {
      if (cancelled) return;
      setEntity(entityRes.entity);
      setEdges(edgesRes.edges);
    }).catch(console.error).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [api, entityId]);

  function updateEntity(updated: Entity) {
    setEntity(updated);
  }

  return { entity, edges, loading, updateEntity };
}
