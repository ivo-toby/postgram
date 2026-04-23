import { useState, useEffect } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, Edge } from '../lib/types.ts';

export function useEntityDetail(api: ApiClient, entityId: string | null) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityId) {
      setEntity(null);
      setEdges([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setEdges([]);

    // Fetch entity and edges independently so that a failing edges call
    // (e.g. archived entities are blocked by `enforceEntityAccess` on the
    // server) does not prevent the entity itself from rendering.
    api.getEntity(entityId)
      .then(res => { if (!cancelled) setEntity(res.entity); })
      .catch(err => {
        if (cancelled) return;
        console.error(err);
        setEntity(null);
        setError(err instanceof Error ? err.message : 'Failed to load entity');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    api.listEdges(entityId)
      .then(res => { if (!cancelled) setEdges(res.edges); })
      .catch(err => {
        if (cancelled) return;
        // Edges may fail independently (e.g. archived entities); keep the
        // entity visible but surface an empty edge list.
        console.warn('Failed to load edges', err);
        setEdges([]);
      });

    return () => { cancelled = true; };
  }, [api, entityId]);

  function updateEntity(updated: Entity) {
    setEntity(updated);
  }

  return { entity, edges, loading, error, updateEntity };
}
