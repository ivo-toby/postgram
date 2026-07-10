import type { Context, Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  createActiveAdminMiddleware,
  createAdminSessionMiddleware,
  setAdminNoStoreHeaders,
  type AdminRequestContext
} from '../auth/admin-middleware.js';
import {
  ADMIN_ONBOARDING_STEPS,
  completeAdminOnboarding,
  readAdminOnboardingState,
  skipAdminOnboarding,
  updateAdminOnboardingState
} from '../services/admin-onboarding-service.js';
import { AppError, ErrorCode } from '../util/errors.js';

type AdminOnboardingApp = Hono<{
  Variables: {
    admin: AdminRequestContext;
  };
}>;

const stepSchema = z.enum(ADMIN_ONBOARDING_STEPS);
const updateOnboardingSchema = z
  .object({
    currentStep: stepSchema.optional(),
    completedSteps: z.array(stepSchema).optional()
  })
  .strict();
const emptyBodySchema = z.object({}).strict();

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

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(ErrorCode.VALIDATION, 'Expected JSON request body');
  }
}

async function readOptionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, 'Expected JSON request body');
  }
}

export function registerAdminOnboardingRoutes(
  app: AdminOnboardingApp,
  pool: Pool
): void {
  app.get(
    '/admin/api/onboarding',
    createAdminSessionMiddleware({ pool, enforceCsrf: false }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      return c.json({
        onboarding: await readAdminOnboardingState(pool)
      });
    }
  );

  app.put(
    '/admin/api/onboarding',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(updateOnboardingSchema, await readJson(c));
      return c.json({
        onboarding: await updateAdminOnboardingState(pool, {
          actorAdminUserId: admin.user.id,
          ...body
        })
      });
    }
  );

  app.post(
    '/admin/api/onboarding/skip',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      parseJsonBody(emptyBodySchema, await readOptionalJson(c));
      const admin = c.get('admin');
      return c.json({
        onboarding: await skipAdminOnboarding(pool, {
          actorAdminUserId: admin.user.id
        })
      });
    }
  );

  app.post(
    '/admin/api/onboarding/complete',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      parseJsonBody(emptyBodySchema, await readOptionalJson(c));
      const admin = c.get('admin');
      return c.json({
        onboarding: await completeAdminOnboarding(pool, {
          actorAdminUserId: admin.user.id
        })
      });
    }
  );
}
