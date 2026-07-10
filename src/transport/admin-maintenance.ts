import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  createActiveAdminMiddleware,
  createAdminSessionMiddleware,
  setAdminNoStoreHeaders,
  type AdminRequestContext
} from '../auth/admin-middleware.js';
import {
  applyAdminPruneEdgesMaintenance,
  applyAdminReembedMaintenance,
  applyAdminReextractMaintenance,
  previewAdminPruneEdgesMaintenance,
  previewAdminReembedMaintenance,
  previewAdminReextractMaintenance,
  type PruneEdgesMaintenanceResult,
  type ReembedMaintenanceResult,
  type ReextractMaintenanceResult
} from '../services/admin-maintenance-service.js';
import {
  completeAdminJob,
  createAdminJob,
  getAdminJob,
  getAdminJobByIdempotencyKey,
  startAdminJob,
  updateAdminJobProgress,
  type AdminJobRecord
} from '../services/admin-job-service.js';
import {
  AppError,
  ErrorCode,
  toErrorResponse,
  toHttpStatus
} from '../util/errors.js';
import type { ServiceResult } from '../types/common.js';

type AdminMaintenanceApp = Hono<{
  Variables: {
    admin: AdminRequestContext;
  };
}>;

type MaintenanceOperation = 'reembed' | 'reextract' | 'prune-edges';
type MaintenanceMode = 'dry_run' | 'apply';

type JobRunResult =
  | { reused: true; job: AdminJobRecord }
  | { reused: false; job: AdminJobRecord };

const entityTypeSchema = z.enum([
  'memory',
  'person',
  'project',
  'task',
  'interaction',
  'document'
]);

const entityScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('type'), type: entityTypeSchema }).strict(),
  z.object({ kind: z.literal('id'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('failed') }).strict()
]);

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(256)
  .regex(/^[a-z][a-z0-9_.-]{0,63}:[a-z0-9][a-z0-9_.:-]{0,191}$/u);
const previewJobIdSchema = z.string().uuid();
const PREVIEW_EVIDENCE_MAX_AGE_MS = 10 * 60 * 1000;
const MAINTENANCE_JOB_START_DELAY_MS = 25;

const reextractDryRunSchema = z
  .object({
    scope: entityScopeSchema,
    onlyFailed: z.boolean().optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
    cleanEdges: z.boolean().optional(),
    includeAutoCreated: z.boolean().optional(),
    noEdgesOnly: z.boolean().optional(),
    showSkipped: z.boolean().optional()
  })
  .strict();

const reextractApplySchema = reextractDryRunSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  previewJobId: previewJobIdSchema
});

const reembedDryRunSchema = z
  .object({
    scope: entityScopeSchema,
    onlyFailed: z.boolean().optional()
  })
  .strict();

const reembedApplySchema = reembedDryRunSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  previewJobId: previewJobIdSchema
});

const webPruneSourceSchema = z.literal('llm-extraction');

const pruneEdgesDryRunSchema = z
  .object({
    below: z.number().min(0).max(1),
    source: webPruneSourceSchema.optional(),
    relation: z.string().trim().min(1).max(120).optional()
  })
  .strict();

const pruneEdgesApplySchema = pruneEdgesDryRunSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  previewJobId: previewJobIdSchema
});

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(ErrorCode.VALIDATION, 'Expected JSON request body');
  }
}

function parseJsonBody<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new AppError(
      ErrorCode.VALIDATION,
      parsed.error.issues[0]?.message ?? 'Invalid request'
    );
  }

  return parsed.data;
}

function jsonError(c: Context, error: AppError, status?: ContentfulStatusCode) {
  return c.json(
    toErrorResponse(error),
    status ?? (toHttpStatus(error.code) as ContentfulStatusCode)
  );
}

function maintenanceJobOperation(operation: MaintenanceOperation): string {
  return `maintenance.${operation === 'prune-edges' ? 'prune_edges' : operation}`;
}

function operationLabel(operation: MaintenanceOperation): string {
  return operation === 'prune-edges' ? 'prune-edges' : operation;
}

function scopeForJob(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined)
  );
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, nestedValue]) =>
        `${JSON.stringify(key)}:${stableJsonStringify(nestedValue)}`
    )
    .join(',')}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJsonStringify(left) === stableJsonStringify(right);
}

async function existingApplyJobForRetry(
  pool: Pool,
  input: {
    operation: MaintenanceOperation;
    actorAdminUserId: string;
    idempotencyKey: string;
    requestedScope: Record<string, unknown>;
    requestSummary: Record<string, unknown>;
  }
): Promise<AdminJobRecord | null> {
  const existing = await unwrapJob(
    getAdminJobByIdempotencyKey(pool, input.idempotencyKey)
  );
  if (!existing) {
    return null;
  }

  if (
    existing.operation !== maintenanceJobOperation(input.operation) ||
    existing.mode !== 'apply' ||
    existing.createdByAdminUserId !== input.actorAdminUserId ||
    !sameJson(existing.requestedScope, input.requestedScope) ||
    !sameJson(existing.requestSummary, input.requestSummary)
  ) {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Admin job idempotency key is already used for a different request',
      {
        idempotencyKey: input.idempotencyKey
      }
    );
  }

  return existing;
}

function reextractScopeSummary(
  body: z.infer<typeof reextractDryRunSchema>
): Record<string, unknown> {
  return scopeForJob({
    operation: 'reextract',
    scope: body.scope,
    onlyFailed: Boolean(body.onlyFailed),
    limit: body.limit ?? null,
    cleanEdges: Boolean(body.cleanEdges),
    includeAutoCreated: Boolean(body.includeAutoCreated),
    noEdgesOnly: Boolean(body.noEdgesOnly),
    showSkipped: Boolean(body.showSkipped)
  });
}

function reembedScopeSummary(
  body: z.infer<typeof reembedDryRunSchema>
): Record<string, unknown> {
  return scopeForJob({
    operation: 'reembed',
    scope: body.scope,
    onlyFailed: Boolean(body.onlyFailed)
  });
}

function pruneScopeSummary(
  body: z.infer<typeof pruneEdgesDryRunSchema>
): Record<string, unknown> {
  return scopeForJob({
    operation: 'prune-edges',
    threshold: body.below,
    source: body.source ?? 'llm-extraction',
    relation: body.relation ?? null
  });
}

function requestSummary(input: {
  mode: MaintenanceMode;
  destructive: boolean;
  llmCost?: boolean | undefined;
  providerWork?: boolean | undefined;
  permanentDelete?: boolean | undefined;
}): Record<string, unknown> {
  return {
    dryRun: input.mode === 'dry_run',
    destructive: input.destructive,
    llmCost: Boolean(input.llmCost),
    providerWork: Boolean(input.providerWork),
    permanentDelete: Boolean(input.permanentDelete),
    requiresStepUp: input.mode === 'apply'
  };
}

function progressForResult(
  result:
    | ReextractMaintenanceResult
    | ReembedMaintenanceResult
    | PruneEdgesMaintenanceResult
): { current: number; total: number; message: string } {
  if ('markedCount' in result) {
    return {
      current: result.markedCount,
      total: result.markedCount,
      message: 'Maintenance mutation applied'
    };
  }

  return {
    current: result.deleted,
    total: result.deleted,
    message: 'Maintenance mutation applied'
  };
}

async function unwrapJob<T>(result: ServiceResult<T>): Promise<T> {
  const resolved = await result;
  if (resolved.isErr()) {
    throw resolved.error;
  }

  return resolved.value;
}

function applyScopeForPreview(
  previewScope: Record<string, unknown>,
  previewJobId: string
): Record<string, unknown> {
  return {
    ...previewScope,
    previewJobId
  };
}

function isPreviewFresh(job: AdminJobRecord): boolean {
  const finishedAt = job.finishedAt ? Date.parse(job.finishedAt) : Number.NaN;
  if (!Number.isFinite(finishedAt)) {
    return false;
  }

  return Date.now() - finishedAt <= PREVIEW_EVIDENCE_MAX_AGE_MS;
}

async function completeIfCancelRequested(
  pool: Pool,
  input: {
    jobId: string;
    actorAdminUserId: string;
    phase: string;
  }
): Promise<boolean> {
  const job = await unwrapJob(getAdminJob(pool, input.jobId));
  if (job.status !== 'cancel_requested') {
    return false;
  }

  await unwrapJob(
    completeAdminJob(pool, {
      jobId: input.jobId,
      actorAdminUserId: input.actorAdminUserId,
      status: 'cancelled',
      resultSummary: {
        cancelled: true,
        phase: input.phase
      }
    })
  );
  return true;
}

async function cancelRequestedAfterExecution(
  pool: Pool,
  input: {
    jobId: string;
    phase: 'after_execution' | 'after_progress';
  }
): Promise<string | null> {
  const job = await unwrapJob(getAdminJob(pool, input.jobId));
  return job.status === 'cancel_requested' ? input.phase : null;
}

function completionResultSummary<T>(
  result: T,
  cancelPhase: string | null
): Record<string, unknown> {
  const summary = result as Record<string, unknown>;
  return cancelPhase
    ? {
        ...summary,
        cancelRequested: true,
        cancelPhase
      }
    : summary;
}

async function requirePreviewEvidence(
  pool: Pool,
  input: {
    operation: MaintenanceOperation;
    actorAdminUserId: string;
    previewJobId: string;
    requestedScope: Record<string, unknown>;
  }
): Promise<void> {
  const job = await unwrapJob(getAdminJob(pool, input.previewJobId));
  if (
    job.operation !== maintenanceJobOperation(input.operation) ||
    job.mode !== 'dry_run' ||
    job.status !== 'succeeded' ||
    job.createdByAdminUserId !== input.actorAdminUserId ||
    !sameJson(job.requestedScope, input.requestedScope)
  ) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'A matching successful dry-run job is required before apply',
      {
        previewJobId: input.previewJobId,
        operation: maintenanceJobOperation(input.operation)
      }
    );
  }

  if (!isPreviewFresh(job)) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'A fresh dry-run job is required before apply',
      {
        previewJobId: input.previewJobId,
        maxAgeSeconds: PREVIEW_EVIDENCE_MAX_AGE_MS / 1000
      }
    );
  }
}

function dispatchMaintenanceJob<T>(
  pool: Pool,
  input: {
    job: AdminJobRecord;
    actorAdminUserId: string;
    execute: () => Promise<T>;
    progress: (result: T) => { current: number; total: number; message: string };
  }
): void {
  const run = async () => {
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, MAINTENANCE_JOB_START_DELAY_MS)
      );
      if (
        await completeIfCancelRequested(pool, {
          jobId: input.job.id,
          actorAdminUserId: input.actorAdminUserId,
          phase: 'before_execution'
        })
      ) {
        return;
      }

      const result = await input.execute();
      const executionCancelPhase = await cancelRequestedAfterExecution(pool, {
        jobId: input.job.id,
        phase: 'after_execution'
      });

      const progress = input.progress(result);
      await unwrapJob(
        updateAdminJobProgress(pool, {
          jobId: input.job.id,
          actorAdminUserId: input.actorAdminUserId,
          progress: {
            current: progress.current,
            total: progress.total,
            message: progress.message
          }
        })
      );
      const completionCancelPhase =
        executionCancelPhase ??
        (await cancelRequestedAfterExecution(pool, {
          jobId: input.job.id,
          phase: 'after_progress'
        }));

      await unwrapJob(
        completeAdminJob(pool, {
          jobId: input.job.id,
          actorAdminUserId: input.actorAdminUserId,
          status: 'succeeded',
          resultSummary: completionResultSummary(result, completionCancelPhase)
        })
      );
    } catch (error) {
      try {
        await unwrapJob(
          completeAdminJob(pool, {
            jobId: input.job.id,
            actorAdminUserId: input.actorAdminUserId,
            status: 'failed',
            resultSummary: {
              failed: true,
              errorCode:
                error instanceof AppError ? error.code : ErrorCode.INTERNAL
            }
          })
        );
      } catch {
        // Avoid surfacing background maintenance failures as unhandled rejections.
      }
    }
  };

  setImmediate(() => {
    void run();
  });
}

async function runJob<T>(
  pool: Pool,
  input: {
    operation: MaintenanceOperation;
    mode: MaintenanceMode;
    actorAdminUserId: string;
    idempotencyKey?: string | undefined;
    requestedScope: Record<string, unknown>;
    requestSummary: Record<string, unknown>;
    execute: () => Promise<T>;
    progress: (result: T) => { current: number; total: number; message: string };
  }
): Promise<JobRunResult> {
  const created = await unwrapJob(
    createAdminJob(pool, {
      operation: maintenanceJobOperation(input.operation),
      mode: input.mode,
      actorAdminUserId: input.actorAdminUserId,
      authorization: {
        activeMfa: true,
        stepUpFresh: input.mode === 'apply'
      },
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      requestedScope: input.requestedScope,
      requestSummary: input.requestSummary
    })
  );

  if (!created.created) {
    return {
      reused: true,
      job: created.job
    };
  }

  const started = await unwrapJob(
    startAdminJob(pool, {
      jobId: created.job.id,
      actorAdminUserId: input.actorAdminUserId
    })
  );

  dispatchMaintenanceJob(pool, {
    job: started,
    actorAdminUserId: input.actorAdminUserId,
    execute: input.execute,
    progress: input.progress
  });

  return {
    reused: false,
    job: started
  };
}

export function registerAdminMaintenanceRoutes(
  app: AdminMaintenanceApp,
  pool: Pool
): void {
  app.post(
    '/admin/api/maintenance/reextract/dry-run',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(reextractDryRunSchema, await readJson(c));
      const jobRun = await runJob(pool, {
        operation: 'reextract',
        mode: 'dry_run',
        actorAdminUserId: admin.user.id,
        requestedScope: reextractScopeSummary(body),
        requestSummary: requestSummary({
          mode: 'dry_run',
          destructive: false,
          llmCost: true
        }),
        execute: () => previewAdminReextractMaintenance(pool, body),
        progress: (result) => ({
          current: result.wouldMark,
          total: result.wouldMark,
          message: 'Maintenance preview completed'
        })
      });

      if (jobRun.reused) {
        return jsonError(
          c,
          new AppError(ErrorCode.CONFLICT, 'Unexpected dry-run job reuse')
        );
      }

      return c.json(
        {
          operation: operationLabel('reextract'),
          dryRun: true,
          job: jobRun.job,
          metadata: jobRun.job.requestSummary
        },
        202
      );
    }
  );

  app.post(
    '/admin/api/maintenance/reextract/apply',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(reextractApplySchema, await readJson(c));
      const previewScope = reextractScopeSummary(body);
      const requestedScope = applyScopeForPreview(
        previewScope,
        body.previewJobId
      );
      const applyRequestSummary = requestSummary({
        mode: 'apply',
        destructive: true,
        llmCost: true
      });
      const existingApply = await existingApplyJobForRetry(pool, {
        operation: 'reextract',
        actorAdminUserId: admin.user.id,
        idempotencyKey: body.idempotencyKey,
        requestedScope,
        requestSummary: applyRequestSummary
      });
      if (existingApply) {
        return c.json({
          job: {
            id: existingApply.id,
            status: existingApply.status
          },
          reused: true
        });
      }

      await requirePreviewEvidence(pool, {
        operation: 'reextract',
        actorAdminUserId: admin.user.id,
        previewJobId: body.previewJobId,
        requestedScope: previewScope
      });
      const jobRun = await runJob(pool, {
        operation: 'reextract',
        mode: 'apply',
        actorAdminUserId: admin.user.id,
        idempotencyKey: body.idempotencyKey,
        requestedScope,
        requestSummary: applyRequestSummary,
        execute: () =>
          applyAdminReextractMaintenance(pool, {
            ...body,
            actorAdminUserId: admin.user.id
          }),
        progress: progressForResult
      });

      if (jobRun.reused) {
        return c.json({
          job: {
            id: jobRun.job.id,
            status: jobRun.job.status
          },
          reused: true
        });
      }

      return c.json(
        {
          operation: operationLabel('reextract'),
          dryRun: false,
          job: jobRun.job,
          metadata: jobRun.job.requestSummary
        },
        202
      );
    }
  );

  app.post(
    '/admin/api/maintenance/reembed/dry-run',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(reembedDryRunSchema, await readJson(c));
      const jobRun = await runJob(pool, {
        operation: 'reembed',
        mode: 'dry_run',
        actorAdminUserId: admin.user.id,
        requestedScope: reembedScopeSummary(body),
        requestSummary: requestSummary({
          mode: 'dry_run',
          destructive: false,
          providerWork: true
        }),
        execute: () => previewAdminReembedMaintenance(pool, body),
        progress: (result) => ({
          current: result.wouldMark,
          total: result.wouldMark,
          message: 'Maintenance preview completed'
        })
      });

      if (jobRun.reused) {
        return jsonError(
          c,
          new AppError(ErrorCode.CONFLICT, 'Unexpected dry-run job reuse')
        );
      }

      return c.json(
        {
          operation: operationLabel('reembed'),
          dryRun: true,
          job: jobRun.job,
          metadata: jobRun.job.requestSummary
        },
        202
      );
    }
  );

  app.post(
    '/admin/api/maintenance/reembed/apply',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(reembedApplySchema, await readJson(c));
      const previewScope = reembedScopeSummary(body);
      const requestedScope = applyScopeForPreview(
        previewScope,
        body.previewJobId
      );
      const applyRequestSummary = requestSummary({
        mode: 'apply',
        destructive: true,
        providerWork: true
      });
      const existingApply = await existingApplyJobForRetry(pool, {
        operation: 'reembed',
        actorAdminUserId: admin.user.id,
        idempotencyKey: body.idempotencyKey,
        requestedScope,
        requestSummary: applyRequestSummary
      });
      if (existingApply) {
        return c.json({
          job: {
            id: existingApply.id,
            status: existingApply.status
          },
          reused: true
        });
      }

      await requirePreviewEvidence(pool, {
        operation: 'reembed',
        actorAdminUserId: admin.user.id,
        previewJobId: body.previewJobId,
        requestedScope: previewScope
      });
      const jobRun = await runJob(pool, {
        operation: 'reembed',
        mode: 'apply',
        actorAdminUserId: admin.user.id,
        idempotencyKey: body.idempotencyKey,
        requestedScope,
        requestSummary: applyRequestSummary,
        execute: () =>
          applyAdminReembedMaintenance(pool, {
            ...body,
            actorAdminUserId: admin.user.id
          }),
        progress: progressForResult
      });

      if (jobRun.reused) {
        return c.json({
          job: {
            id: jobRun.job.id,
            status: jobRun.job.status
          },
          reused: true
        });
      }

      return c.json(
        {
          operation: operationLabel('reembed'),
          dryRun: false,
          job: jobRun.job,
          metadata: jobRun.job.requestSummary
        },
        202
      );
    }
  );

  app.post(
    '/admin/api/maintenance/prune-edges/dry-run',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(pruneEdgesDryRunSchema, await readJson(c));
      const jobRun = await runJob(pool, {
        operation: 'prune-edges',
        mode: 'dry_run',
        actorAdminUserId: admin.user.id,
        requestedScope: pruneScopeSummary(body),
        requestSummary: requestSummary({
          mode: 'dry_run',
          destructive: false,
          permanentDelete: true
        }),
        execute: () => previewAdminPruneEdgesMaintenance(pool, body),
        progress: (result) => ({
          current: result.wouldDelete,
          total: result.wouldDelete,
          message: 'Maintenance preview completed'
        })
      });

      if (jobRun.reused) {
        return jsonError(
          c,
          new AppError(ErrorCode.CONFLICT, 'Unexpected dry-run job reuse')
        );
      }

      return c.json(
        {
          operation: operationLabel('prune-edges'),
          dryRun: true,
          job: jobRun.job,
          metadata: jobRun.job.requestSummary
        },
        202
      );
    }
  );

  app.post(
    '/admin/api/maintenance/prune-edges/apply',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(pruneEdgesApplySchema, await readJson(c));
      const previewScope = pruneScopeSummary(body);
      const requestedScope = applyScopeForPreview(
        previewScope,
        body.previewJobId
      );
      const applyRequestSummary = requestSummary({
        mode: 'apply',
        destructive: true,
        permanentDelete: true
      });
      const existingApply = await existingApplyJobForRetry(pool, {
        operation: 'prune-edges',
        actorAdminUserId: admin.user.id,
        idempotencyKey: body.idempotencyKey,
        requestedScope,
        requestSummary: applyRequestSummary
      });
      if (existingApply) {
        return c.json({
          job: {
            id: existingApply.id,
            status: existingApply.status
          },
          reused: true
        });
      }

      await requirePreviewEvidence(pool, {
        operation: 'prune-edges',
        actorAdminUserId: admin.user.id,
        previewJobId: body.previewJobId,
        requestedScope: previewScope
      });
      const jobRun = await runJob(pool, {
        operation: 'prune-edges',
        mode: 'apply',
        actorAdminUserId: admin.user.id,
        idempotencyKey: body.idempotencyKey,
        requestedScope,
        requestSummary: applyRequestSummary,
        execute: () =>
          applyAdminPruneEdgesMaintenance(pool, {
            ...body,
            actorAdminUserId: admin.user.id
          }),
        progress: progressForResult
      });

      if (jobRun.reused) {
        return c.json({
          job: {
            id: jobRun.job.id,
            status: jobRun.job.status
          },
          reused: true
        });
      }

      return c.json(
        {
          operation: operationLabel('prune-edges'),
          dryRun: false,
          job: jobRun.job,
          metadata: jobRun.job.requestSummary
        },
        202
      );
    }
  );
}
