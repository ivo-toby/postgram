import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBootstrapToken } from '../../src/auth/admin-service.js';
import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  saveRuntimeSecret,
  saveRuntimeSetting
} from '../../src/services/admin-settings-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  authorizeAndExchangeOAuthToken,
  OAUTH_PUBLIC_BASE_URL,
  registerOAuthClient
} from '../helpers/oauth.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';
const ADMIN_MFA_SECRET_KEY = 'test-admin-mfa-secret-key-32-bytes-minimum';
const SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url');
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function getSetCookie(response: Response, name: string): string {
  const setCookie =
    response.headers.get('Set-Cookie') ?? response.headers.get('set-cookie');

  if (!setCookie || !setCookie.startsWith(`${name}=`)) {
    throw new Error(`Missing ${name} Set-Cookie header`);
  }

  return setCookie;
}

function cookieHeaderFromSetCookie(setCookie: string): string {
  return setCookie.split(';')[0] ?? setCookie;
}

function decodeBase32(value: string): Buffer {
  let bits = '';
  const bytes: number[] = [];

  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${character}`);
    }
    bits += index.toString(2).padStart(5, '0');
  }

  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }

  return Buffer.from(bytes);
}

function totpCode(secret: string, now = new Date()): string {
  const counter = Math.floor(now.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const lastByte = digest[digest.length - 1];
  if (lastByte === undefined) {
    throw new Error('Unable to generate TOTP code');
  }

  const offset = lastByte & 0x0f;
  const first = digest[offset];
  const second = digest[offset + 1];
  const third = digest[offset + 2];
  const fourth = digest[offset + 3];
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error('Unable to generate TOTP code');
  }

  const binary =
    ((first & 0x7f) << 24) |
    ((second & 0xff) << 16) |
    ((third & 0xff) << 8) |
    (fourth & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

async function setupPendingFirstAdmin(database: TestDatabase): Promise<{
  app: ReturnType<typeof createApp>;
  cookie: string;
  csrfToken: string;
}> {
  const bootstrap = (
    await createBootstrapToken(database.pool, {
      ttlMs: 10 * 60 * 1000
    })
  )._unsafeUnwrap();
  const app = createApp({
    pool: database.pool,
    adminMfaSecretKey: ADMIN_MFA_SECRET_KEY
  });
  const setupResponse = await app.request('/admin/api/bootstrap/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bootstrapToken: bootstrap.plaintextToken,
      email: 'first@example.com',
      displayName: 'First Admin',
      password: STRONG_PASSWORD
    })
  });
  const setupBody = (await setupResponse.json()) as { csrfToken: string };

  expect(setupResponse.status).toBe(201);
  return {
    app,
    cookie: cookieHeaderFromSetCookie(
      getSetCookie(setupResponse, 'pgm_admin_session')
    ),
    csrfToken: setupBody.csrfToken
  };
}

async function setupActiveFirstAdmin(database: TestDatabase): Promise<{
  app: ReturnType<typeof createApp>;
  cookie: string;
}> {
  const setup = await setupPendingFirstAdmin(database);
  const enrollResponse = await setup.app.request(
    '/admin/api/session/mfa/enroll',
    {
      method: 'POST',
      headers: {
        Cookie: setup.cookie,
        'X-CSRF-Token': setup.csrfToken
      }
    }
  );
  const enrollBody = (await enrollResponse.json()) as {
    factor: { id: string };
    secret: string;
  };
  expect(enrollResponse.status).toBe(201);

  const verifyResponse = await setup.app.request(
    '/admin/api/session/mfa/verify',
    {
      method: 'POST',
      headers: {
        Cookie: setup.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': setup.csrfToken
      },
      body: JSON.stringify({
        factorId: enrollBody.factor.id,
        code: totpCode(enrollBody.secret)
      })
    }
  );
  expect(verifyResponse.status).toBe(200);

  return {
    app: setup.app,
    cookie: setup.cookie
  };
}

async function seedDiagnosticsState(database: TestDatabase): Promise<void> {
  await database.pool.query(`
    INSERT INTO entities (
      type,
      content,
      visibility,
      enrichment_status,
      extraction_status,
      updated_at
    )
    VALUES
      ('memory', 'queued memory', 'personal', 'pending', 'pending', now() - interval '45 seconds'),
      ('task', 'completed task', 'shared', 'completed', 'completed', now()),
      ('document', 'failed document', 'work', 'failed', 'failed', now())
  `);

  await database.pool.query(`
    INSERT INTO embedding_models (
      name,
      provider,
      dimensions,
      chunk_size,
      chunk_overlap,
      is_active
    )
    VALUES (
      'bge-m3',
      'ollama',
      1024,
      300,
      100,
      false
    )
  `);

  const savedSetting = await saveRuntimeSetting(database.pool, {
    key: 'EXTRACTION_MEMORY_MODE',
    value: 'extract_durable',
    classification: 'restart_required',
    state: 'pending',
    validation: {
      status: 'valid',
      message: 'safe setting metadata',
      metadata: {
        diagnosticSafe: true
      }
    }
  });
  savedSetting._unsafeUnwrap();

  const savedSecret = await saveRuntimeSecret(database.pool, {
    name: 'EXTRACTION_API_KEY',
    plaintext: 'super-secret-provider-token',
    provider: 'openai-compatible',
    purpose: 'extraction',
    encryptionKey: SETTINGS_ENCRYPTION_KEY,
    validation: {
      status: 'error',
      message: 'connection failed',
      metadata: {
        authorization: 'Bearer leaked-token-prefix'
      }
    }
  });
  savedSecret._unsafeUnwrap();
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(response.headers.get('Vary')).toBe('Cookie');
}

describe('admin diagnostics API', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('returns read-only health, queue, model, and config-status diagnostics for an active MFA admin session', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { app, cookie } = await setupActiveFirstAdmin(database);
    await seedDiagnosticsState(database);

    const healthResponse = await app.request('/admin/api/diagnostics/health', {
      headers: {
        Cookie: cookie
      }
    });
    const healthBody = (await healthResponse.json()) as {
      health: {
        status: string;
        postgres: string;
        embeddingModel: string | null;
      };
    };
    expect(healthResponse.status).toBe(200);
    expectPrivateNoStore(healthResponse);
    expect(healthBody).toEqual({
      health: {
        status: 'ok',
        postgres: 'connected',
        embeddingModel: 'text-embedding-3-small'
      }
    });

    const queueResponse = await app.request('/admin/api/diagnostics/queue', {
      headers: {
        Cookie: cookie
      }
    });
    const queueBody = (await queueResponse.json()) as {
      queue: {
        embedding: {
          pending: number;
          completed: number;
          failed: number;
          retry_eligible: number;
          oldest_pending_secs: number | null;
        };
        extraction: {
          pending: number;
          completed: number;
          failed: number;
          skipped: number;
        } | null;
        failures?: unknown;
      };
    };
    expect(queueResponse.status).toBe(200);
    expect(queueBody.queue.embedding).toMatchObject({
      pending: 1,
      completed: 1,
      failed: 1,
      retry_eligible: 0
    });
    expect(queueBody.queue.embedding.oldest_pending_secs).toBeGreaterThanOrEqual(
      0
    );
    expect(queueBody.queue.extraction).toEqual({
      pending: 1,
      completed: 1,
      failed: 1,
      skipped: 0
    });
    expect(queueBody.queue.failures).toBeUndefined();

    const modelsResponse = await app.request('/admin/api/diagnostics/models', {
      headers: {
        Cookie: cookie
      }
    });
    const modelsBody = (await modelsResponse.json()) as {
      models: Array<{
        id: string;
        name: string;
        provider: string;
        dimensions: number;
        chunkSize: number;
        chunkOverlap: number;
        isActive: boolean;
        createdAt: string;
      }>;
    };
    expect(modelsResponse.status).toBe(200);
    expect(modelsBody.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'text-embedding-3-small',
          provider: 'openai',
          dimensions: 1536,
          isActive: true
        }),
        expect.objectContaining({
          name: 'bge-m3',
          provider: 'ollama',
          dimensions: 1024,
          isActive: false
        })
      ])
    );

    const configResponse = await app.request(
      '/admin/api/diagnostics/config-status',
      {
        headers: {
          Cookie: cookie
        }
      }
    );
    const configBody = (await configResponse.json()) as {
      configStatus: {
        settings: {
          total: number;
          byState: Record<string, number>;
          byClassification: Record<string, number>;
          byValidationStatus: Record<string, number>;
        };
        secrets: {
          totalConfigured: number;
          byPurpose: Record<string, number>;
          byValidationStatus: Record<string, number>;
        };
      };
    };
    expect(configResponse.status).toBe(200);
    expect(configBody).toEqual({
      configStatus: {
        settings: {
          total: 1,
          byState: {
            pending: 1
          },
          byClassification: {
            restart_required: 1
          },
          byValidationStatus: {
            valid: 1
          }
        },
        secrets: {
          totalConfigured: 1,
          byPurpose: {
            extraction: 1
          },
          byValidationStatus: {
            error: 1
          }
        }
      }
    });

    const serializedConfig = JSON.stringify(configBody);
    expect(serializedConfig).not.toContain('super-secret-provider-token');
    expect(serializedConfig).not.toContain('leaked-token-prefix');
    expect(serializedConfig).not.toContain('EXTRACTION_API_KEY');
    expect(serializedConfig).not.toContain('ciphertext');
    expect(serializedConfig).not.toContain('auth_tag');
    expect(serializedConfig).not.toContain('validation_metadata');
  }, 120_000);

  it('rejects pending-MFA admin sessions from diagnostics', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { app, cookie } = await setupPendingFirstAdmin(database);

    const response = await app.request('/admin/api/diagnostics/health', {
      headers: {
        Cookie: cookie
      }
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: 'Active admin MFA is required'
      }
    });
  }, 120_000);

  it('rejects ordinary API-key bearer and MCP OAuth bearer tokens from diagnostics', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      adminMfaSecretKey: ADMIN_MFA_SECRET_KEY,
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });
    const apiKey = (
      await createKey(database.pool, {
        name: 'ordinary-diagnostics-route-denial',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work', 'personal']
      })
    )._unsafeUnwrap();
    const ordinaryApiResponse = await app.request('/api/queue', {
      headers: {
        Authorization: `Bearer ${apiKey.plaintextKey}`
      }
    });
    expect(ordinaryApiResponse.status).toBe(200);

    const apiKeyDiagnosticsResponse = await app.request(
      '/admin/api/diagnostics/health',
      {
        headers: {
          Authorization: `Bearer ${apiKey.plaintextKey}`
        }
      }
    );
    expect(apiKeyDiagnosticsResponse.status).toBe(401);

    const { clientId } = await registerOAuthClient(app);
    const oauthToken = await authorizeAndExchangeOAuthToken(app, database, {
      clientId
    });
    const oauthApiResponse = await app.request('/api/queue', {
      headers: {
        Authorization: `Bearer ${oauthToken.accessToken}`
      }
    });
    expect(oauthApiResponse.status).toBe(200);

    const oauthDiagnosticsResponse = await app.request(
      '/admin/api/diagnostics/health',
      {
        headers: {
          Authorization: `Bearer ${oauthToken.accessToken}`
        }
      }
    );
    expect(oauthDiagnosticsResponse.status).toBe(401);
  }, 120_000);
});
