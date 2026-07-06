import { createHash } from 'node:crypto';

import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import type { ServiceResult, PaginatedResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';
import type { JsonObject, JsonValue } from './admin-settings-service.js';

export type AdminJobMode = 'dry_run' | 'apply';

export type AdminJobStatus =
  | 'queued'
  | 'running'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type AdminJobTerminalStatus = 'succeeded' | 'failed' | 'cancelled';

export type AdminJobProgress = {
  current: number;
  total: number | null;
  message: string | null;
};

export type AdminJobRecord = {
  id: string;
  operation: string;
  mode: AdminJobMode;
  status: AdminJobStatus;
  idempotencyKey: string | null;
  requestedScope: JsonObject;
  requestSummary: JsonObject;
  resultSummary: JsonObject;
  progress: AdminJobProgress;
  createdByAdminUserId: string | null;
  updatedByAdminUserId: string | null;
  startedAt: string | null;
  cancelRequestedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAdminJobInput = {
  operation: string;
  mode: AdminJobMode;
  actorAdminUserId: string;
  authorization: {
    activeMfa: boolean;
    stepUpFresh: boolean;
  };
  idempotencyKey?: string | undefined;
  requestedScope?: Record<string, unknown> | undefined;
  requestSummary?: Record<string, unknown> | undefined;
  now?: Date | undefined;
};

export type UpdateAdminJobProgressInput = {
  jobId: string;
  actorAdminUserId: string;
  progress: {
    current: number;
    total?: number | null | undefined;
    message?: string | null | undefined;
  };
  now?: Date | undefined;
};

export type CompleteAdminJobInput = {
  jobId: string;
  actorAdminUserId: string;
  status: AdminJobTerminalStatus;
  resultSummary?: Record<string, unknown> | undefined;
  now?: Date | undefined;
};

export type RequestAdminJobCancelInput = {
  jobId: string;
  actorAdminUserId: string;
  reason?: string | undefined;
  now?: Date | undefined;
};

export type ListAdminJobsInput = {
  status?: AdminJobStatus[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

type AdminJobRow = {
  id: string;
  operation: string;
  mode: AdminJobMode;
  status: AdminJobStatus;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  requested_scope: JsonObject;
  request_summary: JsonObject;
  result_summary: JsonObject;
  progress_current: number;
  progress_total: number | null;
  progress_message: string | null;
  created_by_admin_user_id: string | null;
  updated_by_admin_user_id: string | null;
  started_at: Date | null;
  cancel_requested_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AdminJobEventType =
  | 'create'
  | 'start'
  | 'progress'
  | 'cancel_request'
  | 'succeed'
  | 'fail'
  | 'cancel';

const ADMIN_JOB_MODES = ['dry_run', 'apply'] as const;
const ADMIN_JOB_STATUSES = [
  'queued',
  'running',
  'cancel_requested',
  'succeeded',
  'failed',
  'cancelled'
] as const;
const ADMIN_JOB_TERMINAL_STATUSES = [
  'succeeded',
  'failed',
  'cancelled'
] as const;
const OPERATION_PATTERN = /^[a-z][a-z0-9_.:_-]{1,127}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_KEY_PATTERN =
  /^[a-z][a-z0-9_.-]{0,63}:[a-z0-9][a-z0-9_.:-]{0,191}$/u;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_PROGRESS_MESSAGE_LENGTH = 500;
const MAX_SAFE_STRING_LENGTH = 2000;
const MAX_JSON_DEPTH = 8;
const SAFE_REFERENCE_KEYS = new Set([
  'secretname',
  'secretnames',
  'settingkey',
  'settingkeys'
]);
const CONFIG_REFERENCE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;
const FORBIDDEN_KEY_FRAGMENTS = [
  'plaintext',
  'ciphertext',
  'authtag',
  'authorization',
  'authheader',
  'token',
  'tokenprefix',
  'apikey',
  'password',
  'validationmetadata',
  'providerresponse',
  'nonce',
  'privatekey',
  'credential',
  'secret',
  'secretvalue',
  'secretplaintext',
  'secretciphertext'
] as const;
const SENSITIVE_STRING_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/iu,
  /\bsk-[A-Za-z0-9_-]{8,}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
] as const;

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (isPgErrorCode(error, '23505')) {
    return new AppError(ErrorCode.CONFLICT, fallbackMessage, {
      cause: 'unique_violation'
    });
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

function isPgErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function validationError(message: string, details: JsonObject): AppError {
  return new AppError(ErrorCode.VALIDATION, message, details);
}

function mapJob(row: AdminJobRow): AdminJobRecord {
  return {
    id: row.id,
    operation: row.operation,
    mode: row.mode,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestedScope: row.requested_scope,
    requestSummary: row.request_summary,
    resultSummary: row.result_summary,
    progress: {
      current: row.progress_current,
      total: row.progress_total,
      message: row.progress_message
    },
    createdByAdminUserId: row.created_by_admin_user_id,
    updatedByAdminUserId: row.updated_by_admin_user_id,
    startedAt: row.started_at?.toISOString() ?? null,
    cancelRequestedAt: row.cancel_requested_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function stableJsonStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries
    .map(
      ([key, nestedValue]) =>
        `${JSON.stringify(key)}:${stableJsonStringify(nestedValue)}`
    )
    .join(',')}}`;
}

function fingerprintJobRequest(input: {
  operation: string;
  mode: AdminJobMode;
  requestedScope: JsonObject;
  requestSummary: JsonObject;
}): string {
  return createHash('sha256')
    .update(
      stableJsonStringify({
        operation: input.operation,
        mode: input.mode,
        requestedScope: input.requestedScope,
        requestSummary: input.requestSummary
      }),
      'utf8'
    )
    .digest('hex');
}

function previewJobIdForApply(
  mode: AdminJobMode,
  requestedScope: JsonObject
): string | null {
  if (mode !== 'apply') {
    return null;
  }

  const previewJobId = requestedScope.previewJobId;
  return typeof previewJobId === 'string' ? previewJobId : null;
}

function requireJobId(jobId: string): string {
  if (!UUID_PATTERN.test(jobId)) {
    throw validationError('Invalid admin job ID', {
      field: 'jobId'
    });
  }

  return jobId;
}

function requireOperation(operation: string): string {
  if (!OPERATION_PATTERN.test(operation)) {
    throw validationError('Invalid admin job operation', {
      field: 'operation'
    });
  }

  return operation;
}

function requireMode(mode: AdminJobMode): AdminJobMode {
  if (!(ADMIN_JOB_MODES as readonly string[]).includes(mode)) {
    throw validationError('Invalid admin job mode', {
      field: 'mode'
    });
  }

  return mode;
}

function requireStatus(status: AdminJobStatus): AdminJobStatus {
  if (!(ADMIN_JOB_STATUSES as readonly string[]).includes(status)) {
    throw validationError('Invalid admin job status', {
      field: 'status'
    });
  }

  return status;
}

function requireTerminalStatus(
  status: AdminJobTerminalStatus
): AdminJobTerminalStatus {
  if (!(ADMIN_JOB_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    throw validationError('Invalid terminal admin job status', {
      field: 'status'
    });
  }

  return status;
}

function normalizeIdempotencyKey(
  idempotencyKey: string | undefined
): string | null {
  if (idempotencyKey === undefined) {
    return null;
  }

  const normalized = idempotencyKey.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) {
    throw validationError('Invalid admin job idempotency key', {
      field: 'idempotencyKey'
    });
  }

  return assertSafeString(normalized, 'idempotencyKey');
}

function assertJobCreationAuthority(input: CreateAdminJobInput): void {
  if (!input.authorization.activeMfa) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Active admin MFA is required for admin jobs'
    );
  }

  if (input.mode === 'apply' && !input.authorization.stepUpFresh) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Recent admin step-up is required for apply jobs'
    );
  }
}

function normalizeKeyForSafety(key: string): string {
  return key.replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
}

function normalizeSafeReferenceValue(
  key: string,
  value: unknown,
  path: string
): JsonValue {
  const normalized = normalizeKeyForSafety(key);
  const expectsArray =
    normalized === 'secretnames' || normalized === 'settingkeys';
  const values = expectsArray ? value : [value];

  if (!Array.isArray(values)) {
    throw validationError('Invalid admin job reference value', {
      field: path,
      reason: 'invalid_reference'
    });
  }

  const normalizedValues = values.map((item, index) => {
    if (
      typeof item !== 'string' ||
      !CONFIG_REFERENCE_PATTERN.test(item) ||
      item.toLowerCase().includes('password')
    ) {
      throw validationError('Invalid admin job reference value', {
        field: expectsArray ? `${path}[${index}]` : path,
        reason: 'invalid_reference'
      });
    }
    return item;
  });

  return expectsArray ? normalizedValues : normalizedValues[0] ?? null;
}

function assertSafeJsonKey(key: string, path: string): void {
  const normalized = normalizeKeyForSafety(key);
  const normalizedPath = normalizeKeyForSafety(path);

  if (SAFE_REFERENCE_KEYS.has(normalized)) {
    return;
  }

  if (
    normalizedPath.includes('providermetadata') ||
    normalizedPath.includes('providerbody') ||
    FORBIDDEN_KEY_FRAGMENTS.some(
      (fragment) =>
        normalized.includes(fragment) || normalizedPath.includes(fragment)
    )
  ) {
    throw validationError('Unsafe admin job summary field', {
      field: path,
      reason: 'sensitive_field'
    });
  }
}

function assertSafeString(value: string, path: string): string {
  if (value.length > MAX_SAFE_STRING_LENGTH) {
    throw validationError('Admin job summary string is too long', {
      field: path,
      maxLength: MAX_SAFE_STRING_LENGTH
    });
  }

  if (SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(value))) {
    throw validationError('Unsafe admin job summary value', {
      field: path,
      reason: 'sensitive_value'
    });
  }

  return value;
}

function ensureSafeJsonValue(
  value: unknown,
  path: string,
  depth: number
): JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw validationError('Admin job summary is too deeply nested', {
      field: path
    });
  }

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return assertSafeString(value, path);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw validationError('Admin job summary numbers must be finite', {
        field: path
      });
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      ensureSafeJsonValue(item, `${path}[${index}]`, depth + 1)
    );
  }

  if (typeof value === 'object' && value !== null) {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw validationError('Admin job summary must be JSON-compatible', {
        field: path
      });
    }

    const result: JsonObject = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (SAFE_REFERENCE_KEYS.has(normalizeKeyForSafety(key))) {
        result[key] = normalizeSafeReferenceValue(key, nestedValue, nestedPath);
      } else {
        assertSafeJsonKey(key, nestedPath);
        result[key] = ensureSafeJsonValue(nestedValue, nestedPath, depth + 1);
      }
    }
    return result;
  }

  throw validationError('Admin job summary must be JSON-compatible', {
    field: path
  });
}

function normalizeSafeJsonObject(
  value: Record<string, unknown> | undefined,
  field: string
): JsonObject {
  if (value === undefined) {
    return {};
  }

  const safe = ensureSafeJsonValue(value, field, 0);
  if (safe === null || Array.isArray(safe) || typeof safe !== 'object') {
    throw validationError('Admin job summary must be an object', {
      field
    });
  }

  return safe;
}

function normalizeProgress(
  input: UpdateAdminJobProgressInput['progress']
): AdminJobProgress {
  if (!Number.isSafeInteger(input.current) || input.current < 0) {
    throw validationError('Invalid admin job progress current value', {
      field: 'progress.current'
    });
  }

  const total = input.total ?? null;
  if (
    total !== null &&
    (!Number.isSafeInteger(total) || total < 0 || input.current > total)
  ) {
    throw validationError('Invalid admin job progress total value', {
      field: 'progress.total'
    });
  }

  const message = input.message?.trim() || null;
  if (message && message.length > MAX_PROGRESS_MESSAGE_LENGTH) {
    throw validationError('Admin job progress message is too long', {
      field: 'progress.message'
    });
  }
  if (message) {
    assertSafeString(message, 'progress.message');
  }

  return {
    current: input.current,
    total,
    message
  };
}

function auditOperationForEvent(eventType: AdminJobEventType): string {
  switch (eventType) {
    case 'create':
      return 'admin.jobs.create';
    case 'start':
      return 'admin.jobs.start';
    case 'progress':
      return 'admin.jobs.progress';
    case 'cancel_request':
      return 'admin.jobs.cancel_request';
    case 'succeed':
      return 'admin.jobs.succeed';
    case 'fail':
      return 'admin.jobs.fail';
    case 'cancel':
      return 'admin.jobs.cancel';
  }
}

function eventTypeForTerminalStatus(
  status: AdminJobTerminalStatus
): AdminJobEventType {
  switch (status) {
    case 'succeeded':
      return 'succeed';
    case 'failed':
      return 'fail';
    case 'cancelled':
      return 'cancel';
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original service error.
  }
}

async function findJobById(
  executor: Pool | PoolClient,
  jobId: string,
  options: { forUpdate?: boolean } = {}
): Promise<AdminJobRecord | null> {
  const result = await executor.query<AdminJobRow>(
    `
      SELECT *
      FROM admin_jobs
      WHERE id = $1
      LIMIT 1
      ${options.forUpdate ? 'FOR UPDATE' : ''}
    `,
    [jobId]
  );

  const row = result.rows[0];
  return row ? mapJob(row) : null;
}

function jobCreationSummary(job: AdminJobRecord): JsonObject {
  const summary: JsonObject = {};

  if (Object.keys(job.requestedScope).length > 0) {
    summary.requested_scope = job.requestedScope;
  }
  if (Object.keys(job.requestSummary).length > 0) {
    summary.request_summary = job.requestSummary;
  }

  return summary;
}

function notFoundError(jobId: string): AppError {
  return new AppError(ErrorCode.NOT_FOUND, 'Admin job not found', {
    jobId
  });
}

function transitionError(
  job: AdminJobRecord,
  action: string,
  allowedStatuses: readonly AdminJobStatus[]
): AppError {
  return new AppError(
    ErrorCode.CONFLICT,
    `Admin job cannot ${action} from current status`,
    {
      jobId: job.id,
      status: job.status,
      allowedStatuses: [...allowedStatuses]
    }
  );
}

async function writeJobEventAndAudit(
  executor: PoolClient,
  input: {
    job: AdminJobRecord;
    adminUserId: string | null;
    eventType: AdminJobEventType;
    fromStatus: AdminJobStatus | null;
    toStatus: AdminJobStatus | null;
    progress?: JsonObject | undefined;
    summary?: JsonObject | undefined;
  }
): Promise<void> {
  const progress = input.progress ?? {};
  const summary = input.summary ?? {};
  const summaryKey = ['succeed', 'fail', 'cancel'].includes(input.eventType)
    ? 'result_summary'
    : 'event_summary';
  await executor.query(
    `
      INSERT INTO admin_job_events (
        job_id,
        admin_user_id,
        event_type,
        from_status,
        to_status,
        progress,
        summary
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
    `,
    [
      input.job.id,
      input.adminUserId,
      input.eventType,
      input.fromStatus,
      input.toStatus,
      JSON.stringify(progress),
      JSON.stringify(summary)
    ]
  );

  await executor.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        admin_user_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, NULL, $3::jsonb)
    `,
    [
      input.adminUserId,
      auditOperationForEvent(input.eventType),
      JSON.stringify({
        job_id: input.job.id,
        job_operation: input.job.operation,
        mode: input.job.mode,
        from_status: input.fromStatus,
        status: input.toStatus ?? input.job.status,
        ...(Object.keys(summary).length > 0 ? { [summaryKey]: summary } : {}),
        ...(Object.keys(progress).length > 0 ? { progress } : {})
      })
    ]
  );
}

export function createAdminJob(
  pool: Pool,
  input: CreateAdminJobInput
): ServiceResult<{ created: boolean; job: AdminJobRecord }> {
  return ResultAsync.fromPromise(
    (async () => {
      const operation = requireOperation(input.operation);
      const mode = requireMode(input.mode);
      assertJobCreationAuthority(input);

      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      if (mode === 'apply' && !idempotencyKey) {
        throw validationError('Admin apply jobs require an idempotency key', {
          field: 'idempotencyKey'
        });
      }
      const requestedScope = normalizeSafeJsonObject(
        input.requestedScope,
        'requestedScope'
      );
      const requestSummary = normalizeSafeJsonObject(
        input.requestSummary,
        'requestSummary'
      );
      const requestFingerprint = fingerprintJobRequest({
        operation,
        mode,
        requestedScope,
        requestSummary
      });
      const previewJobId = previewJobIdForApply(mode, requestedScope);
      const now = input.now ?? new Date();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        if (idempotencyKey) {
          const existing = await client.query<AdminJobRow>(
            `
              SELECT *
              FROM admin_jobs
              WHERE idempotency_key = $1
              ORDER BY created_at DESC
              LIMIT 1
              FOR UPDATE
            `,
            [idempotencyKey]
          );
          const existingRow = existing.rows[0];
          if (existingRow) {
            if (existingRow.request_fingerprint !== requestFingerprint) {
              throw new AppError(
                ErrorCode.CONFLICT,
                'Admin job idempotency key is already used for a different request',
                {
                  idempotencyKey
                }
              );
            }

            await client.query('COMMIT');
            return {
              created: false,
              job: mapJob(existingRow)
            };
          }
        }

        if (previewJobId) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `admin-job-preview:${operation}:${input.actorAdminUserId}:${previewJobId}`
          ]);
          const existingPreviewApply = await client.query<AdminJobRow>(
            `
              SELECT *
              FROM admin_jobs
              WHERE operation = $1
                AND mode = 'apply'
                AND created_by_admin_user_id = $2
                AND requested_scope->>'previewJobId' = $3
              ORDER BY created_at DESC, id DESC
              LIMIT 1
              FOR UPDATE
            `,
            [operation, input.actorAdminUserId, previewJobId]
          );
          const existingPreviewRow = existingPreviewApply.rows[0];
          if (existingPreviewRow) {
            throw new AppError(
              ErrorCode.CONFLICT,
              'Admin job preview has already been used',
              {
                previewJobId,
                jobId: existingPreviewRow.id
              }
            );
          }
        }

        const inserted = await client.query<AdminJobRow>(
          `
            INSERT INTO admin_jobs (
              operation,
              mode,
              status,
              idempotency_key,
              request_fingerprint,
              requested_scope,
              request_summary,
              created_by_admin_user_id,
              updated_by_admin_user_id,
              created_at,
              updated_at
            )
            VALUES ($1, $2, 'queued', $3, $4, $5::jsonb, $6::jsonb, $7, $7, $8, $8)
            ON CONFLICT (idempotency_key)
              WHERE idempotency_key IS NOT NULL
              DO NOTHING
            RETURNING *
          `,
          [
            operation,
            mode,
            idempotencyKey,
            requestFingerprint,
            JSON.stringify(requestedScope),
            JSON.stringify(requestSummary),
            input.actorAdminUserId,
            now
          ]
        );
        let row = inserted.rows[0];
        if (!row && idempotencyKey) {
          const existing = await client.query<AdminJobRow>(
            `
              SELECT *
              FROM admin_jobs
              WHERE idempotency_key = $1
              ORDER BY created_at DESC
              LIMIT 1
              FOR UPDATE
            `,
            [idempotencyKey]
          );
          row = existing.rows[0];
          if (row && row.request_fingerprint === requestFingerprint) {
            await client.query('COMMIT');
            return {
              created: false,
              job: mapJob(row)
            };
          }
          if (row) {
            throw new AppError(
              ErrorCode.CONFLICT,
              'Admin job idempotency key is already used for a different request',
              {
                idempotencyKey
              }
            );
          }
        }
        if (!row) {
          throw new AppError(ErrorCode.INTERNAL, 'Failed to create admin job');
        }

        const job = mapJob(row);
        await writeJobEventAndAudit(client, {
          job,
          adminUserId: input.actorAdminUserId,
          eventType: 'create',
          fromStatus: null,
          toStatus: 'queued',
          summary: jobCreationSummary(job)
        });

        await client.query('COMMIT');
        return {
          created: true,
          job
        };
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to create admin job')
  );
}

export function getAdminJob(
  pool: Pool,
  jobId: string
): ServiceResult<AdminJobRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const id = requireJobId(jobId);
      const job = await findJobById(pool, id);
      if (!job) {
        throw notFoundError(id);
      }
      return job;
    })(),
    (error) => toAppError(error, 'Failed to get admin job')
  );
}

export function getAdminJobByIdempotencyKey(
  pool: Pool,
  idempotencyKey: string
): ServiceResult<AdminJobRecord | null> {
  return ResultAsync.fromPromise(
    (async () => {
      const normalized = normalizeIdempotencyKey(idempotencyKey);
      if (!normalized) {
        throw validationError('Invalid admin job idempotency key', {
          field: 'idempotencyKey'
        });
      }

      const result = await pool.query<AdminJobRow>(
        `
          SELECT *
          FROM admin_jobs
          WHERE idempotency_key = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [normalized]
      );
      const row = result.rows[0];
      return row ? mapJob(row) : null;
    })(),
    (error) => toAppError(error, 'Failed to get admin job by idempotency key')
  );
}

export function listAdminJobs(
  pool: Pool,
  input: ListAdminJobsInput = {}
): ServiceResult<PaginatedResult<AdminJobRecord>> {
  return ResultAsync.fromPromise(
    (async () => {
      const status = input.status?.map(requireStatus) ?? null;
      const limit = input.limit ?? 20;
      const offset = input.offset ?? 0;

      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw validationError('Invalid admin job list limit', {
          field: 'limit'
        });
      }

      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw validationError('Invalid admin job list offset', {
          field: 'offset'
        });
      }

      const count = await pool.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM admin_jobs
          WHERE ($1::text[] IS NULL OR status = ANY($1::text[]))
        `,
        [status]
      );
      const rows = await pool.query<AdminJobRow>(
        `
          SELECT *
          FROM admin_jobs
          WHERE ($1::text[] IS NULL OR status = ANY($1::text[]))
          ORDER BY created_at DESC, id DESC
          LIMIT $2
          OFFSET $3
        `,
        [status, limit, offset]
      );

      return {
        items: rows.rows.map(mapJob),
        total: Number.parseInt(count.rows[0]?.count ?? '0', 10),
        limit,
        offset
      };
    })(),
    (error) => toAppError(error, 'Failed to list admin jobs')
  );
}

export function startAdminJob(
  pool: Pool,
  input: {
    jobId: string;
    actorAdminUserId: string;
    now?: Date | undefined;
  }
): ServiceResult<AdminJobRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const jobId = requireJobId(input.jobId);
      const now = input.now ?? new Date();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const updated = await client.query<AdminJobRow>(
          `
            UPDATE admin_jobs
            SET
              status = 'running',
              started_at = COALESCE(started_at, $2),
              updated_by_admin_user_id = $3,
              updated_at = $2
            WHERE id = $1
              AND status = 'queued'
            RETURNING *
          `,
          [jobId, now, input.actorAdminUserId]
        );
        const row = updated.rows[0];
        if (!row) {
          const existing = await findJobById(client, jobId);
          if (!existing) {
            throw notFoundError(jobId);
          }
          throw transitionError(existing, 'start', ['queued']);
        }

        const job = mapJob(row);
        await writeJobEventAndAudit(client, {
          job,
          adminUserId: input.actorAdminUserId,
          eventType: 'start',
          fromStatus: 'queued',
          toStatus: 'running'
        });

        await client.query('COMMIT');
        return job;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to start admin job')
  );
}

export function updateAdminJobProgress(
  pool: Pool,
  input: UpdateAdminJobProgressInput
): ServiceResult<AdminJobRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const jobId = requireJobId(input.jobId);
      const progress = normalizeProgress(input.progress);
      const now = input.now ?? new Date();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const updated = await client.query<AdminJobRow>(
          `
            UPDATE admin_jobs
            SET
              progress_current = $2,
              progress_total = $3,
              progress_message = $4,
              updated_by_admin_user_id = $5,
              updated_at = $6
            WHERE id = $1
              AND (
                status = 'running'
                OR (status = 'cancel_requested' AND started_at IS NOT NULL)
              )
            RETURNING *
          `,
          [
            jobId,
            progress.current,
            progress.total,
            progress.message,
            input.actorAdminUserId,
            now
          ]
        );
        const row = updated.rows[0];
        if (!row) {
          const existing = await findJobById(client, jobId);
          if (!existing) {
            throw notFoundError(jobId);
          }
          throw transitionError(existing, 'record progress', [
            'running',
            'cancel_requested'
          ]);
        }

        const job = mapJob(row);
        await writeJobEventAndAudit(client, {
          job,
          adminUserId: input.actorAdminUserId,
          eventType: 'progress',
          fromStatus: job.status,
          toStatus: job.status,
          progress: {
            current: progress.current,
            total: progress.total,
            message: progress.message
          }
        });

        await client.query('COMMIT');
        return job;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to update admin job progress')
  );
}

export function requestAdminJobCancel(
  pool: Pool,
  input: RequestAdminJobCancelInput
): ServiceResult<AdminJobRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const jobId = requireJobId(input.jobId);
      const reason =
        input.reason === undefined
          ? null
          : assertSafeString(input.reason.trim(), 'reason');
      const summary = normalizeSafeJsonObject(
        reason ? { reason } : {},
        'cancelSummary'
      );
      const now = input.now ?? new Date();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const before = await findJobById(client, jobId, { forUpdate: true });
        if (!before) {
          throw notFoundError(jobId);
        }
        if (before.status === 'cancel_requested') {
          await client.query('COMMIT');
          return before;
        }
        if (!['queued', 'running'].includes(before.status)) {
          throw transitionError(before, 'request cancellation', [
            'queued',
            'running'
          ]);
        }

        const updated = await client.query<AdminJobRow>(
          `
            UPDATE admin_jobs
            SET
              status = 'cancel_requested',
              cancel_requested_at = COALESCE(cancel_requested_at, $2),
              updated_by_admin_user_id = $3,
              updated_at = $2
            WHERE id = $1
              AND status = ANY($4::text[])
            RETURNING *
          `,
          [jobId, now, input.actorAdminUserId, ['queued', 'running']]
        );
        const row = updated.rows[0];
        if (!row) {
          throw transitionError(before, 'request cancellation', [
            'queued',
            'running'
          ]);
        }

        const job = mapJob(row);
        await writeJobEventAndAudit(client, {
          job,
          adminUserId: input.actorAdminUserId,
          eventType: 'cancel_request',
          fromStatus: before.status,
          toStatus: 'cancel_requested',
          summary
        });

        await client.query('COMMIT');
        return job;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to request admin job cancellation')
  );
}

export function completeAdminJob(
  pool: Pool,
  input: CompleteAdminJobInput
): ServiceResult<AdminJobRecord> {
  return ResultAsync.fromPromise(
    (async () => {
      const jobId = requireJobId(input.jobId);
      const status = requireTerminalStatus(input.status);
      const resultSummary = normalizeSafeJsonObject(
        input.resultSummary,
        'resultSummary'
      );
      const now = input.now ?? new Date();
      const allowedStatuses: AdminJobStatus[] =
        status === 'cancelled'
          ? ['cancel_requested']
          : ['running', 'cancel_requested'];
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const before = await findJobById(client, jobId, { forUpdate: true });
        if (!before) {
          throw notFoundError(jobId);
        }
        if (!allowedStatuses.includes(before.status)) {
          throw transitionError(before, 'complete', allowedStatuses);
        }
        if (
          status !== 'cancelled' &&
          before.status === 'cancel_requested' &&
          !before.startedAt
        ) {
          throw new AppError(
            ErrorCode.CONFLICT,
            'Admin job cannot complete successful work after queued cancellation',
            {
              jobId,
              status: before.status,
              allowedStatuses: ['running', 'started cancel_requested']
            }
          );
        }

        const updated = await client.query<AdminJobRow>(
          `
            UPDATE admin_jobs
            SET
              status = $2,
              result_summary = $3::jsonb,
              finished_at = $4,
              updated_by_admin_user_id = $5,
              updated_at = $4
            WHERE id = $1
              AND status = ANY($6::text[])
            RETURNING *
          `,
          [
            jobId,
            status,
            JSON.stringify(resultSummary),
            now,
            input.actorAdminUserId,
            allowedStatuses
          ]
        );
        const row = updated.rows[0];
        if (!row) {
          throw transitionError(before, 'complete', allowedStatuses);
        }

        const job = mapJob(row);
        await writeJobEventAndAudit(client, {
          job,
          adminUserId: input.actorAdminUserId,
          eventType: eventTypeForTerminalStatus(status),
          fromStatus: before.status,
          toStatus: status,
          summary: resultSummary
        });

        await client.query('COMMIT');
        return job;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to complete admin job')
  );
}
