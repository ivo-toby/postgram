import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { WhereResponse, WhereView } from '../lib/where.ts';

const POLL_MS = 60_000;

export type UseWhereResult = {
  data: WhereResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
};

export function useWhere(
  api: ApiClient,
  params: { view: WhereView; includeReleasedAndDone: boolean }
): UseWhereResult {
  const { view, includeReleasedAndDone } = params;
  const [data, setData] = useState<WhereResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [requestId, setRequestId] = useState(0);

  const refresh = useCallback(() => {
    setRequestId((id) => id + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = (): void => {
      const query = includeReleasedAndDone
        ? { view, include_released: true, include_done: true }
        : { view };
      void api
        .getWhere(query)
        .then((response) => {
          if (cancelled) return;
          setData(response);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e : new Error(String(e)));
        });
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [api, view, includeReleasedAndDone, requestId]);

  return {
    data,
    // Loading only means "nothing to show yet": a failed first fetch is not loading.
    loading: data === null && error === null,
    error,
    refresh,
  };
}
