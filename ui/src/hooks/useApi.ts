import { useMemo } from 'react';
import { createApiClient, type ApiClient } from '../lib/api.ts';

type UseApiOptions = {
  apiKey: string;
  onUnauthorized: () => void;
};

export function useApi({ apiKey, onUnauthorized }: UseApiOptions): ApiClient {
  return useMemo(
    () => createApiClient({ apiKey, onUnauthorized }),
    [apiKey, onUnauthorized]
  );
}
