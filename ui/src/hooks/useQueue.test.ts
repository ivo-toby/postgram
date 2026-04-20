import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQueue } from './useQueue.ts';
import type { ApiClient } from '../lib/api.ts';

describe('useQueue', () => {
  it('fetches queue status on mount', async () => {
    const mockApi = {
      getQueueStatus: vi.fn().mockResolvedValue({
        embedding: { pending: 0, completed: 100, failed: 0, retry_eligible: 0, oldest_pending_secs: null },
        extraction: { pending: 0, completed: 50, failed: 0 },
      }),
    } as unknown as ApiClient;

    const { result } = renderHook(() => useQueue(mockApi));

    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.status?.embedding.completed).toBe(100);
  });

  it('sets up interval for polling', async () => {
    const getQueueStatusMock = vi.fn().mockResolvedValue({
      embedding: { pending: 0, completed: 100, failed: 0, retry_eligible: 0, oldest_pending_secs: null },
      extraction: null,
    });

    const mockApi = {
      getQueueStatus: getQueueStatusMock,
    } as unknown as ApiClient;

    const { unmount } = renderHook(() => useQueue(mockApi));

    await waitFor(() => expect(getQueueStatusMock).toHaveBeenCalled());
    const initialCount = getQueueStatusMock.mock.calls.length;

    // Unmount should clean up interval
    unmount();

    // Wait a moment
    await new Promise(r => setTimeout(r, 100));

    // Should not have been called again
    expect(getQueueStatusMock.mock.calls.length).toBe(initialCount);
  });
});
