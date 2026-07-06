import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  createActiveAdminMiddleware,
  createAdminSessionMiddleware,
  setAdminNoStoreHeaders,
  type AdminRequestContext
} from '../auth/admin-middleware.js';
import {
  getAdminJob,
  listAdminJobs,
  type AdminJobStatus
} from '../services/admin-job-service.js';
import { AppError, ErrorCode } from '../util/errors.js';

type AdminJobApp = Hono<{
  Variables: {
    admin: AdminRequestContext;
  };
}>;

const jobIdSchema = z.string().uuid();
const statusSchema = z.enum([
  'queued',
  'running',
  'cancel_requested',
  'succeeded',
  'failed',
  'cancelled'
]);

function parsePositiveInteger(
  value: string | undefined,
  input: { field: string; defaultValue: number; min: number; max: number }
): number {
  if (value === undefined) {
    return input.defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    String(parsed) !== value ||
    parsed < input.min ||
    parsed > input.max
  ) {
    throw new AppError(ErrorCode.VALIDATION, 'Invalid query parameter', {
      field: input.field
    });
  }

  return parsed;
}

function parseStatusFilter(value: string | undefined): AdminJobStatus[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }

  return value.split(',').map((raw) => {
    const parsed = statusSchema.safeParse(raw.trim());
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, 'Invalid job status filter', {
        field: 'status'
      });
    }
    return parsed.data;
  });
}

export function registerAdminJobRoutes(
  app: AdminJobApp,
  pool: Pool
): void {
  app.get(
    '/admin/api/jobs',
    createAdminSessionMiddleware({ pool, enforceCsrf: false }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const status = parseStatusFilter(c.req.query('status'));
      const limit = parsePositiveInteger(c.req.query('limit'), {
        field: 'limit',
        defaultValue: 20,
        min: 1,
        max: 100
      });
      const offset = parsePositiveInteger(c.req.query('offset'), {
        field: 'offset',
        defaultValue: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER
      });

      const jobs = await listAdminJobs(pool, {
        ...(status.length > 0 ? { status } : {}),
        limit,
        offset
      });
      if (jobs.isErr()) {
        throw jobs.error;
      }

      return c.json({
        jobs: jobs.value.items,
        total: jobs.value.total,
        limit: jobs.value.limit,
        offset: jobs.value.offset
      });
    }
  );

  app.get(
    '/admin/api/jobs/:jobId',
    createAdminSessionMiddleware({ pool, enforceCsrf: false }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const parsedJobId = jobIdSchema.safeParse(c.req.param('jobId'));
      if (!parsedJobId.success) {
        throw new AppError(ErrorCode.VALIDATION, 'Invalid admin job ID', {
          field: 'jobId'
        });
      }

      const job = await getAdminJob(pool, parsedJobId.data);
      if (job.isErr()) {
        throw job.error;
      }

      return c.json({ job: job.value });
    }
  );
}
