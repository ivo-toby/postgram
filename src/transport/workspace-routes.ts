// Workspace, machine and where REST routes (spec 004, rest.md). Thin
// adapters: each route reads the auth context, parses its input, calls one
// service function and throws the service error so the shared onError
// handler renders the standard envelope.
import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { AuthContext } from '../auth/types.js';
import {
  listMachines,
  setMachineConnectTarget
} from '../services/machine-service.js';
import { getWhere } from '../services/where-service.js';
import { listWorkspaces } from '../services/workspace-query.js';
import { reportWorkspace } from '../services/workspace-service.js';
import { updateWorkspace } from '../services/workspace-update.js';
import { lookupWorkspace } from '../services/workspace-lookup.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type WorkspaceRoutesOptions = {
  dormantAfterDays: number;
};

const workspacePatchSchema = z
  .object({
    feature_id: z.union([z.string(), z.null()]).optional(),
    missing: z.boolean().optional()
  })
  .refine((body) => body.feature_id !== undefined || body.missing !== undefined, {
    message: 'feature_id or missing is required'
  });

const machineConnectTargetSchema = z.object({
  connect_target: z.union([z.string(), z.null()])
});

function toValidationError(message: string): AppError {
  return new AppError(ErrorCode.VALIDATION, message);
}

function parseJsonBody<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw toValidationError(parsed.error.issues[0]?.message ?? 'Invalid request');
  }

  return parsed.data;
}

// D12: boolean query flags accept exactly `true` or `false`; absent is
// undefined and anything else is a 400.
function parseBoolFlag(name: string, raw: string | undefined): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  throw toValidationError(`${name} must be true or false`);
}

function requiredQuery(name: string, raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    throw toValidationError(`${name} is required`);
  }

  return raw;
}

export function registerWorkspaceRoutes(
  app: Hono<{ Variables: { auth: AuthContext } }>,
  pool: Pool,
  options: WorkspaceRoutesOptions
): void {
  app.post('/api/workspaces/report', async (c) => {
    const auth = c.get('auth');
    // reportWorkspace validates the raw body itself; pass it unchanged.
    const result = await reportWorkspace(
      pool,
      auth,
      await c.req.json(),
      options
    );

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value, 200);
  });

  // Registered before any `/api/workspaces/:id` GET so `lookup` is never
  // captured by the `:id` segment.
  app.get('/api/workspaces/lookup', async (c) => {
    const auth = c.get('auth');
    const machine = requiredQuery('machine', c.req.query('machine'));
    const path = requiredQuery('path', c.req.query('path'));
    const result = await lookupWorkspace(
      pool,
      auth,
      { machine, path },
      options
    );

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value, 200);
  });

  app.patch('/api/workspaces/:id', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(workspacePatchSchema, await c.req.json());
    const result = await updateWorkspace(
      pool,
      auth,
      {
        id: c.req.param('id'),
        ...(body.feature_id !== undefined
          ? { featureId: body.feature_id }
          : {}),
        ...(body.missing !== undefined ? { missing: body.missing } : {})
      },
      options
    );

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ workspace: result.value }, 200);
  });

  app.put('/api/machines/:alias', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(machineConnectTargetSchema, await c.req.json());
    const result = await setMachineConnectTarget(pool, auth, {
      alias: c.req.param('alias'),
      connectTarget: body.connect_target
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ machine: result.value }, 200);
  });

  app.get('/api/machines', async (c) => {
    const auth = c.get('auth');
    const result = await listMachines(pool, auth);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ machines: result.value }, 200);
  });

  app.get('/api/workspaces', async (c) => {
    const auth = c.get('auth');
    const result = await listWorkspaces(
      pool,
      auth,
      {
        ...(c.req.query('machine') !== undefined
          ? { machine: c.req.query('machine') }
          : {}),
        ...(c.req.query('repo') !== undefined
          ? { repo: c.req.query('repo') }
          : {}),
        ...(c.req.query('feature_id') !== undefined
          ? { featureId: c.req.query('feature_id') }
          : {}),
        unassigned: parseBoolFlag('unassigned', c.req.query('unassigned')),
        includeEnded: parseBoolFlag(
          'include_ended',
          c.req.query('include_ended')
        )
      },
      options
    );

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ workspaces: result.value }, 200);
  });

  app.get('/api/where', async (c) => {
    const auth = c.get('auth');
    const result = await getWhere(
      pool,
      auth,
      {
        ...(c.req.query('view') !== undefined
          ? { view: c.req.query('view') }
          : {}),
        ...(c.req.query('machine') !== undefined
          ? { machine: c.req.query('machine') }
          : {}),
        ...(c.req.query('repo') !== undefined
          ? { repo: c.req.query('repo') }
          : {}),
        includeReleased: parseBoolFlag(
          'include_released',
          c.req.query('include_released')
        ),
        includeDone: parseBoolFlag('include_done', c.req.query('include_done')),
        includeEnded: parseBoolFlag(
          'include_ended',
          c.req.query('include_ended')
        )
      },
      options
    );

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value, 200);
  });
}
