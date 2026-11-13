import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '../../src/errors.js';
import {
  explainIngestError,
  readIngestFile,
  waitFailure,
  waitForProcessing,
  type WaitEntity
} from '../../src/ingest.js';

type Step = WaitEntity | Error;

function scriptedWithErrors(steps: Step[]) {
  let index = 0;
  let clock = 0;
  const delays: number[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  return {
    delays,
    signals,
    fetchEntity: (signal?: AbortSignal) => {
      signals.push(signal);
      const step = steps[Math.min(index, steps.length - 1)]!;
      index += 1;
      return step instanceof Error
        ? Promise.reject(step)
        : Promise.resolve(step);
    },
    sleep: (ms: number) => {
      delays.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock
  };
}

const done: WaitEntity = {
  loading_status: 'completed',
  enrichment_status: 'completed'
};

describe('waitForProcessing poll errors', () => {
  it('keeps polling after a transient error and then completes', async () => {
    const s = scriptedWithErrors([
      new TypeError('fetch failed'),
      new AppError(ErrorCode.INTERNAL, 'Request failed with status 502'),
      done
    ]);

    const result = await waitForProcessing({ ...s, timeoutMs: 60_000 });

    expect(result.outcome).toBe('completed');
    expect(s.delays).toEqual([1000, 2000]);
  });

  it.each([ErrorCode.NOT_FOUND, ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN])(
    'rethrows %s at once',
    async (code) => {
      const s = scriptedWithErrors([new AppError(code, 'nope')]);

      await expect(
        waitForProcessing({ ...s, timeoutMs: 60_000 })
      ).rejects.toMatchObject({ code });
      expect(s.delays).toEqual([]);
    }
  );

  it('times out with the last error when every poll fails', async () => {
    const s = scriptedWithErrors([new TypeError('fetch failed')]);

    const result = await waitForProcessing({ ...s, timeoutMs: 4000 });

    expect(result.outcome).toBe('timeout');
    expect(result.lastError).toMatch(/fetch failed/);
  });

  it('gives each poll an abort signal and stops a hung poll at the deadline', async () => {
    const started = Date.now();
    let seen: AbortSignal | undefined;

    const result = await waitForProcessing({
      timeoutMs: 300,
      fetchEntity: (signal) => {
        seen = signal;
        return new Promise<WaitEntity>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new Error('poll aborted'))
          );
        });
      }
    });

    expect(seen).toBeDefined();
    expect(result.outcome).toBe('timeout');
    expect(result.lastError).toMatch(/aborted/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('limits one poll to 30 s even with a long deadline', async () => {
    const s = scriptedWithErrors([done]);

    await waitForProcessing({ ...s, timeoutMs: 600_000 });

    expect(s.signals[0]).toBeInstanceOf(AbortSignal);
    expect(s.signals[0]!.aborted).toBe(false);
  });
});

describe('explainIngestError', () => {
  function resetError(code: string): TypeError {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = Object.assign(
      new Error('other side closed'),
      { code }
    );
    return error;
  }

  it.each(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'])(
    'explains an early close (%s) during an upload',
    (code) => {
      const result = explainIngestError(resetError(code), { bytes: 123456 });

      expect(result).toBeInstanceOf(AppError);
      const message = (result as AppError).message;
      expect(message).toContain('123456 bytes');
      expect(message).toContain('closed the connection');
      expect(message).toContain('INGEST_MAX_BYTES');
      expect(message).toContain('50 MB');
    }
  );

  it.each([
    [512, '512 bytes'],
    [2048, '2048 bytes (2 KB)'],
    [52_428_800, '52428800 bytes (50 MB)']
  ])('prints a 413 limit of %i bytes in a sensible unit', (max, text) => {
    const result = explainIngestError(
      new AppError(ErrorCode.PAYLOAD_TOO_LARGE, 'too big', { max_bytes: max }),
      { bytes: 1 }
    ) as AppError;

    expect(result.message).toContain(`up to ${text}.`);
    expect(result.message).not.toContain('0.0 MB');
  });

  it('leaves other network errors alone', () => {
    const error = resetError('ECONNREFUSED');

    expect(explainIngestError(error, { bytes: 1 })).toBe(error);
  });
});

describe('waitFailure messages', () => {
  it('says how the server retries a failed load and how to queue it again', () => {
    const error = waitFailure(
      {
        outcome: 'loading_failed',
        entity: { loading_status: 'failed', loading_error: 'pdf: corrupt' }
      },
      { id: 'abc', timeoutSeconds: 600 }
    );

    expect(error.message).toContain('pdf: corrupt');
    expect(error.message).toContain('retries a failed load automatically');
    expect(error.message).toContain('up to 3 attempts');
    expect(error.message).toContain('ingest the same file again');
  });

  it('says that the server retries a failed enrichment', () => {
    const error = waitFailure(
      {
        outcome: 'enrichment_failed',
        entity: { loading_status: 'completed', enrichment_status: 'failed' }
      },
      { id: 'abc', timeoutSeconds: 600 }
    );

    expect(error.message).toContain('retries it automatically');
  });

  it('puts the last poll error into a timeout', () => {
    const error = waitFailure(
      {
        outcome: 'timeout',
        entity: { loading_status: 'pending' },
        lastError: 'fetch failed'
      },
      { id: 'abc', timeoutSeconds: 5 }
    );

    expect(error.message).toContain('still processing');
    expect(error.details.last_error).toBe('fetch failed');
    expect(error.message).toContain('fetch failed');
  });
});

describe('readIngestFile', () => {
  it.skipIf(process.getuid?.() === 0)(
    'maps an unreadable file to a validation error',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'pgm-ingest-unit-'));
      try {
        const file = path.join(dir, 'secret.pdf');
        await writeFile(file, 'x');
        await chmod(file, 0o000);

        await expect(readIngestFile(file)).rejects.toMatchObject({
          code: ErrorCode.VALIDATION,
          message: expect.stringMatching(/permission denied/i) as unknown
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
});
