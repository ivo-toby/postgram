import type { Context, Hono } from 'hono';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  createActiveAdminMiddleware,
  createAdminSessionMiddleware,
  isAdminStepUpFresh,
  setAdminNoStoreHeaders,
  type AdminRequestContext
} from '../auth/admin-middleware.js';
import type { AppConfig } from '../config.js';
import {
  applyProviderConfiguration,
  readProviderConfiguration,
  saveProviderConfiguration,
  saveProviderSecret,
  validateProviderConfiguration,
  type ProviderConfigDnsLookup,
  type ProviderConfigFetch
} from '../services/admin-provider-config-service.js';
import { AppError, ErrorCode } from '../util/errors.js';

type AdminProviderConfigApp = Hono<{
  Variables: {
    admin: AdminRequestContext;
  };
}>;

export type AdminProviderConfigRouteOptions = {
  adminSettingsEncryptionKey?: string | undefined;
  runtimeConfig?: AppConfig | undefined;
  providerConfigFetch?: ProviderConfigFetch | undefined;
  providerConfigDnsLookup?: ProviderConfigDnsLookup | undefined;
};

const saveSettingsSchema = z
  .object({
    settings: z.record(z.unknown())
  })
  .strict();

const saveSecretSchema = z
  .object({
    name: z.string(),
    plaintext: z.string().min(1)
  })
  .strict();

const validateSchema = z
  .object({
    testConnections: z.boolean().optional()
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

function requireSettingsEncryptionKey(key: string | undefined): string {
  if (!key) {
    throw new AppError(
      ErrorCode.INTERNAL,
      'Admin settings encryption key is not configured'
    );
  }

  return key;
}

export function registerAdminProviderConfigRoutes(
  app: AdminProviderConfigApp,
  pool: Pool,
  options: AdminProviderConfigRouteOptions = {}
): void {
  async function handleSaveSecret(
    c: Context<{ Variables: { admin: AdminRequestContext } }>
  ) {
    setAdminNoStoreHeaders(c);
    const admin = c.get('admin');
    const body = parseJsonBody(saveSecretSchema, await readJson(c));
    const secret = await saveProviderSecret(pool, {
      name: body.name,
      plaintext: body.plaintext,
      encryptionKey: requireSettingsEncryptionKey(
        options.adminSettingsEncryptionKey
      ),
      actorAdminUserId: admin.user.id
    });
    if (secret.isErr()) {
      throw secret.error;
    }
    return c.json({ secret: secret.value });
  }

  app.get(
    '/admin/api/provider-config',
    createAdminSessionMiddleware({ pool, enforceCsrf: false }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const snapshot = await readProviderConfiguration(pool, {
        envConfig: options.runtimeConfig
      });
      if (snapshot.isErr()) {
        throw snapshot.error;
      }
      return c.json({ config: snapshot.value });
    }
  );

  app.put(
    '/admin/api/provider-config',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(saveSettingsSchema, await readJson(c));
      const saved = await saveProviderConfiguration(pool, {
        settings: body.settings,
        actorAdminUserId: admin.user.id,
        envConfig: options.runtimeConfig
      });
      if (saved.isErr()) {
        throw saved.error;
      }
      return c.json({ config: saved.value });
    }
  );

  app.post(
    '/admin/api/provider-config/secrets',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    handleSaveSecret
  );

  app.put(
    '/admin/api/provider-config/secrets',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    handleSaveSecret
  );

  app.post(
    '/admin/api/provider-config/validate',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const admin = c.get('admin');
      const body = parseJsonBody(validateSchema, await readJson(c));
      if (
        body.testConnections &&
        !isAdminStepUpFresh(admin.session.mfaVerifiedAt)
      ) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Recent admin step-up is required'
        );
      }
      const validated = await validateProviderConfiguration(pool, {
        actorAdminUserId: admin.user.id,
        envConfig: options.runtimeConfig,
        encryptionKey: options.adminSettingsEncryptionKey,
        dnsLookup: options.providerConfigDnsLookup,
        fetchImpl: options.providerConfigFetch,
        testConnections: body.testConnections ?? false
      });
      if (validated.isErr()) {
        throw validated.error;
      }
      return c.json({ validation: validated.value });
    }
  );

  app.post(
    '/admin/api/provider-config/apply',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    async (c) => {
      setAdminNoStoreHeaders(c);
      parseJsonBody(emptyBodySchema, await readJson(c));
      const admin = c.get('admin');
      const applied = await applyProviderConfiguration(pool, {
        actorAdminUserId: admin.user.id,
        envConfig: options.runtimeConfig,
        encryptionKey: options.adminSettingsEncryptionKey,
        dnsLookup: options.providerConfigDnsLookup
      });
      if (applied.isErr()) {
        throw applied.error;
      }
      return c.json({ result: applied.value });
    }
  );
}
