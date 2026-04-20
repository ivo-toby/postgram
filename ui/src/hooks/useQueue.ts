import { useState, useEffect } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { QueueStatus } from '../lib/types.ts';

export function useQueue(api: ApiClient) {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const s = await api.getQueueStatus();
        if (!cancelled) setStatus(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      }
    }

    void poll();
    const id = setInterval(() => { void poll(); }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [api]);

  return { status, error };
}
