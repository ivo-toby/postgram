import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { AppError, ErrorCode } from './errors.js';

/** The entity fields that `pgm ingest --wait` looks at. */
export type WaitEntity = {
  id?: string;
  loading_status?: string | null;
  loading_error?: string | null;
  enrichment_status?: string | null;
};

export type WaitOutcome =
  | 'completed'
  | 'loading_failed'
  | 'enrichment_failed'
  | 'timeout';

export type WaitResult = {
  outcome: WaitOutcome;
  entity: WaitEntity;
  /** On timeout, the last poll error, if a poll failed. */
  lastError?: string;
};

export const WAIT_FIRST_DELAY_MS = 1000;
export const WAIT_MAX_DELAY_MS = 5000;
export const WAIT_POLL_TIMEOUT_MS = 30_000;

const FATAL_POLL_CODES: ReadonlySet<string> = new Set([
  ErrorCode.NOT_FOUND,
  ErrorCode.UNAUTHORIZED,
  ErrorCode.FORBIDDEN
]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Poll until the document is searchable or processing has failed.
 *
 * Done: loading and enrichment are both `completed`. A document whose loader
 * returned no text ends that way too, because the worker marks enrichment
 * `completed` for it. Failed: either status is `failed`. A failed load is
 * final here even though the server retries it, because the retries are
 * minutes apart. The delay starts at 1 s, doubles, and stops at 5 s.
 *
 * A poll that fails is remembered and tried again, except for NOT_FOUND,
 * UNAUTHORIZED and FORBIDDEN, which end the wait. Each poll gets an abort
 * signal for the smaller of the time left and 30 s, so a hung request cannot
 * outlast the deadline.
 */
export async function waitForProcessing(options: {
  fetchEntity: (signal?: AbortSignal) => Promise<WaitEntity>;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<WaitResult> {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const deadline = now() + options.timeoutMs;
  let delay = WAIT_FIRST_DELAY_MS;
  let entity: WaitEntity = {};
  let lastError: string | undefined;

  for (;;) {
    const pollMs = Math.max(
      1,
      Math.min(deadline - now(), WAIT_POLL_TIMEOUT_MS)
    );
    try {
      entity = await options.fetchEntity(AbortSignal.timeout(pollMs));
      lastError = undefined;
      if (entity.loading_status === 'failed') {
        return { outcome: 'loading_failed', entity };
      }
      if (entity.loading_status === 'completed') {
        if (entity.enrichment_status === 'failed') {
          return { outcome: 'enrichment_failed', entity };
        }
        if (entity.enrichment_status === 'completed') {
          return { outcome: 'completed', entity };
        }
      }
    } catch (error) {
      if (error instanceof AppError && FATAL_POLL_CODES.has(error.code)) {
        throw error;
      }
      lastError = errorText(error);
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      return {
        outcome: 'timeout',
        entity,
        ...(lastError !== undefined ? { lastError } : {})
      };
    }
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, WAIT_MAX_DELAY_MS);
  }
}

/** Read the file to upload. Fails with a clear message for a bad path. */
export async function readIngestFile(
  filePath: string
): Promise<{ filename: string; bytes: Uint8Array }> {
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError(ErrorCode.VALIDATION, `File not found: ${filePath}`);
    }
    throw unreadable(filePath, error);
  }
  if (!info.isFile()) {
    throw new AppError(ErrorCode.VALIDATION, `Not a regular file: ${filePath}`);
  }
  try {
    return {
      filename: path.basename(filePath),
      bytes: await readFile(filePath)
    };
  } catch (error) {
    throw unreadable(filePath, error);
  }
}

function unreadable(filePath: string, error: unknown): AppError {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EACCES' || code === 'EPERM') {
    return new AppError(
      ErrorCode.VALIDATION,
      `Cannot read ${filePath}: permission denied`
    );
  }
  return new AppError(
    ErrorCode.VALIDATION,
    `Cannot read ${filePath}: ${errorText(error)}`
  );
}

const CONNECTION_CLOSED_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'EPIPE'
]);

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Replace the server's terse upload errors with messages that say what to do. */
export function explainIngestError(
  error: unknown,
  context: { bytes: number }
): unknown {
  if (error instanceof TypeError) {
    const cause = (error as { cause?: { code?: unknown } }).cause;
    if (
      typeof cause?.code === 'string' &&
      CONNECTION_CLOSED_CODES.has(cause.code)
    ) {
      return new AppError(
        ErrorCode.UPLOAD_INTERRUPTED,
        `The server closed the connection during the upload of ${context.bytes} bytes. ` +
          'The usual cause is a file over the server limit (INGEST_MAX_BYTES, default 50 MB).'
      );
    }
    return error;
  }

  if (!(error instanceof AppError)) {
    return error;
  }

  if (error.code === ErrorCode.PAYLOAD_TOO_LARGE) {
    const max = error.details.max_bytes;
    return new AppError(
      error.code,
      typeof max === 'number'
        ? `File is too large. The server accepts files up to ${max} bytes (${(max / 1024 / 1024).toFixed(1)} MB).`
        : 'File is too large for this server.',
      error.details
    );
  }

  if (error.code === ErrorCode.UNSUPPORTED_MEDIA_TYPE) {
    const accepted = (error.details.accepted ?? {}) as Record<string, unknown>;
    const mimeTypes = stringList(accepted.mime_types);
    const extensions = stringList(accepted.extensions);
    return new AppError(
      error.code,
      [
        'No loader on this server accepts this file type.',
        `Accepted MIME types: ${mimeTypes.join(', ') || 'none'}`,
        `Accepted extensions: ${extensions.join(', ') || 'none'}`,
        'Pass --mime-type if the file has an unusual extension.'
      ].join('\n'),
      error.details
    );
  }

  if (error.code === ErrorCode.UNAVAILABLE) {
    return new AppError(
      error.code,
      'Document loaders are not enabled on this server. Ask the operator to set LOADERS_ENABLED=true.',
      error.details
    );
  }

  return error;
}

/** The error for a finished `--wait` that did not end well. */
export function waitFailure(
  result: WaitResult,
  context: { id: string; timeoutSeconds: number }
): AppError {
  const details = {
    id: context.id,
    loading_status: result.entity.loading_status ?? null,
    enrichment_status: result.entity.enrichment_status ?? null,
    loading_error: result.entity.loading_error ?? null,
    ...(result.lastError !== undefined ? { last_error: result.lastError } : {})
  };

  if (result.outcome === 'loading_failed') {
    return new AppError(
      ErrorCode.PROCESSING_FAILED,
      `Loading failed for ${context.id}: ${result.entity.loading_error ?? 'unknown error'}. ` +
        'The server retries a failed load automatically, up to 3 attempts. ' +
        'After the last attempt, ingest the same file again to queue it again.',
      details
    );
  }

  if (result.outcome === 'enrichment_failed') {
    return new AppError(
      ErrorCode.PROCESSING_FAILED,
      `Embedding failed for ${context.id}. The text was loaded, but the server could not index it. ` +
        'The server retries it automatically. The API exposes no further detail.',
      details
    );
  }

  return new AppError(
    ErrorCode.PROCESSING_TIMEOUT,
    `Stopped waiting after ${context.timeoutSeconds} s. The document ${context.id} is still processing ` +
      `(loading: ${details.loading_status ?? '-'}, enrichment: ${details.enrichment_status ?? '-'}).` +
      (result.lastError !== undefined
        ? ` The last status check failed: ${result.lastError}.`
        : ''),
    details
  );
}
