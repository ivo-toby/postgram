import { describe, expect, it } from 'vitest';

import { waitForProcessing, type WaitEntity } from '../../src/ingest.js';

function scripted(states: Array<Partial<WaitEntity>>) {
  let index = 0;
  const delays: number[] = [];
  let clock = 0;
  return {
    delays,
    fetchEntity: () => {
      const state = states[Math.min(index, states.length - 1)]!;
      index += 1;
      return Promise.resolve({
        loading_status: 'pending',
        enrichment_status: null,
        ...state
      } as WaitEntity);
    },
    sleep: (ms: number) => {
      delays.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock
  };
}

describe('waitForProcessing', () => {
  it('completes when loading and enrichment are completed', async () => {
    const s = scripted([
      { loading_status: 'pending' },
      { loading_status: 'completed', enrichment_status: 'pending' },
      { loading_status: 'completed', enrichment_status: 'completed' }
    ]);

    const result = await waitForProcessing({ ...s, timeoutMs: 600_000 });

    expect(result.outcome).toBe('completed');
    expect(s.delays).toEqual([1000, 2000]);
  });

  it('backs off from 1 s to at most 5 s', async () => {
    const s = scripted([{ loading_status: 'running' }]);

    await waitForProcessing({ ...s, timeoutMs: 30_000 });

    expect(s.delays.slice(0, 5)).toEqual([1000, 2000, 4000, 5000, 5000]);
    expect(Math.max(...s.delays)).toBe(5000);
  });

  it('stops at once when loading failed', async () => {
    const s = scripted([
      { loading_status: 'failed', loading_error: 'pdf: corrupt' }
    ]);

    const result = await waitForProcessing({ ...s, timeoutMs: 600_000 });

    expect(result.outcome).toBe('loading_failed');
    expect(result.entity.loading_error).toBe('pdf: corrupt');
    expect(s.delays).toEqual([]);
  });

  it('stops when enrichment failed after loading completed', async () => {
    const s = scripted([
      { loading_status: 'completed', enrichment_status: 'failed' }
    ]);

    const result = await waitForProcessing({ ...s, timeoutMs: 600_000 });

    expect(result.outcome).toBe('enrichment_failed');
  });

  it('keeps waiting while loading is completed and enrichment is not set', async () => {
    const s = scripted([
      { loading_status: 'completed', enrichment_status: null },
      { loading_status: 'completed', enrichment_status: 'completed' }
    ]);

    expect((await waitForProcessing({ ...s, timeoutMs: 60_000 })).outcome).toBe(
      'completed'
    );
  });

  it('times out without sleeping past the deadline', async () => {
    const s = scripted([{ loading_status: 'pending' }]);

    const result = await waitForProcessing({ ...s, timeoutMs: 2500 });

    expect(result.outcome).toBe('timeout');
    expect(s.delays.reduce((a, b) => a + b, 0)).toBe(2500);
  });

  it('does not report its own deadline abort as a failed status check', async () => {
    const startedAt = Date.now();
    const result = await waitForProcessing({
      // Honours the abort signal and takes 20 ms, like a real request.
      fetchEntity: (signal) =>
        new Promise<WaitEntity>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve({ loading_status: 'running' }),
            20
          );
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason as Error);
          });
        }),
      timeoutMs: 60,
      // Wakes a little early, so the next poll gets a very short signal.
      sleep: (ms) =>
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms - 3))),
      now: () => Date.now() - startedAt
    });

    expect(result.outcome).toBe('timeout');
    expect(result.lastError).toBeUndefined();
  });
});
