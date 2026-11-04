import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ApiClient } from '../lib/api.ts';
import type { WhereResponse, WhereView } from '../lib/where.ts';
import { useWhere } from './useWhere.ts';

function response(view: WhereView, marker = 'first'): WhereResponse {
  return {
    view,
    generated_at: marker,
    dormant_after_days: 30,
    groups: [],
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function apiWith(getWhere: ReturnType<typeof vi.fn>): ApiClient {
  return { getWhere } as unknown as ApiClient;
}

describe('useWhere', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for the actions view without extra parameters when the toggle is off', async () => {
    const getWhere = vi.fn(() => Promise.resolve(response('actions')));
    const api = apiWith(getWhere);
    renderHook(() => useWhere(api, { view: 'actions', includeReleasedAndDone: false }));

    await waitFor(() => expect(getWhere).toHaveBeenCalledTimes(1));
    expect(getWhere).toHaveBeenCalledWith({ view: 'actions' });
  });

  it('asks for released and done work when the toggle is on', async () => {
    const getWhere = vi.fn(() => Promise.resolve(response('stage')));
    const api = apiWith(getWhere);
    renderHook(() => useWhere(api, { view: 'stage', includeReleasedAndDone: true }));

    await waitFor(() => expect(getWhere).toHaveBeenCalledTimes(1));
    expect(getWhere).toHaveBeenCalledWith({ view: 'stage', include_released: true, include_done: true });
  });

  it('fetches on mount, then loads data and clears loading', async () => {
    const getWhere = vi.fn(() => Promise.resolve(response('actions')));
    const api = apiWith(getWhere);
    const { result } = renderHook(() =>
      useWhere(api, { view: 'actions', includeReleasedAndDone: false })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getWhere).toHaveBeenCalledTimes(1);
  });

  it('refetches with the new view when the view changes', async () => {
    const getWhere = vi.fn(({ view }: { view: WhereView }) => Promise.resolve(response(view)));
    const api = apiWith(getWhere);
    const { result, rerender } = renderHook(
      ({ view }: { view: WhereView }) => useWhere(api, { view, includeReleasedAndDone: false }),
      { initialProps: { view: 'actions' as WhereView } }
    );

    await waitFor(() => expect(result.current.data?.view).toBe('actions'));
    rerender({ view: 'stage' });

    await waitFor(() => expect(result.current.data?.view).toBe('stage'));
    expect(getWhere).toHaveBeenLastCalledWith({ view: 'stage' });
    expect(getWhere).toHaveBeenCalledTimes(2);
  });

  it('refetches with the toggle flags when the toggle changes', async () => {
    const getWhere = vi.fn(() => Promise.resolve(response('actions')));
    const api = apiWith(getWhere);
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => useWhere(api, { view: 'actions', includeReleasedAndDone: on }),
      { initialProps: { on: false } }
    );

    await waitFor(() => expect(getWhere).toHaveBeenCalledTimes(1));
    rerender({ on: true });

    await waitFor(() => expect(getWhere).toHaveBeenCalledTimes(2));
    expect(getWhere).toHaveBeenLastCalledWith({ view: 'actions', include_released: true, include_done: true });
  });

  it('refetches on refresh, and refresh keeps the same identity', async () => {
    const getWhere = vi.fn(() => Promise.resolve(response('actions')));
    const api = apiWith(getWhere);
    const { result } = renderHook(() =>
      useWhere(api, { view: 'actions', includeReleasedAndDone: false })
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const refresh = result.current.refresh;

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(getWhere).toHaveBeenCalledTimes(2));
    expect(result.current.refresh).toBe(refresh);
  });

  it('polls every 60 seconds while mounted', async () => {
    // waitFor advances the fake clock while it polls, so this test drives the clock itself.
    vi.useRealTimers();
    vi.useFakeTimers();
    const getWhere = vi.fn(() => Promise.resolve(response('actions')));
    const api = apiWith(getWhere);
    const { unmount } = renderHook(() => useWhere(api, { view: 'actions', includeReleasedAndDone: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getWhere).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(getWhere).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getWhere).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(getWhere).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous data and sets the error when a refetch fails', async () => {
    const getWhere = vi
      .fn()
      .mockResolvedValueOnce(response('actions', 'good'))
      .mockRejectedValueOnce(new Error('Server down'))
      .mockResolvedValue(response('actions', 'good'));
    const api = apiWith(getWhere);
    const { result } = renderHook(() =>
      useWhere(api, { view: 'actions', includeReleasedAndDone: false })
    );
    await waitFor(() => expect(result.current.data?.generated_at).toBe('good'));

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.error?.message).toBe('Server down'));
    expect(result.current.data?.generated_at).toBe('good');
    expect(result.current.loading).toBe(false);
  });

  it('shows the error without data when the first fetch fails, then clears it on success', async () => {
    const getWhere = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server down'))
      .mockResolvedValueOnce(response('actions', 'recovered'))
      .mockResolvedValue(response('actions', 'recovered'));
    const api = apiWith(getWhere);
    const { result } = renderHook(() =>
      useWhere(api, { view: 'actions', includeReleasedAndDone: false })
    );

    await waitFor(() => expect(result.current.error?.message).toBe('Server down'));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.data?.generated_at).toBe('recovered'));
    expect(result.current.error).toBeNull();
  });

  it('ignores a response that resolves after unmount', async () => {
    const pending = deferred<WhereResponse>();
    const getWhere = vi.fn(() => pending.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = apiWith(getWhere);
    const { result, unmount } = renderHook(() =>
      useWhere(api, { view: 'actions', includeReleasedAndDone: false })
    );
    expect(result.current.data).toBeNull();

    unmount();
    await act(async () => {
      pending.resolve(response('actions', 'late'));
      await pending.promise;
    });

    expect(result.current.data).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('ignores a stale response when the parameters changed in the meantime', async () => {
    const stale = deferred<WhereResponse>();
    const getWhere = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(response('stage', 'fresh'))
      .mockResolvedValue(response('stage', 'fresh'));
    const api = apiWith(getWhere);
    const { result, rerender } = renderHook(
      ({ view }: { view: WhereView }) => useWhere(api, { view, includeReleasedAndDone: false }),
      { initialProps: { view: 'actions' as WhereView } }
    );

    rerender({ view: 'stage' });
    await waitFor(() => expect(result.current.data?.generated_at).toBe('fresh'));

    await act(async () => {
      stale.resolve(response('actions', 'stale'));
      await stale.promise;
    });

    expect(result.current.data?.generated_at).toBe('fresh');
    expect(result.current.data?.view).toBe('stage');
  });
});
