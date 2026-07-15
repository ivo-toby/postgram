import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  createAdminSession,
  createAdminUser
} from '../../src/auth/admin-service.js';
import { createKey } from '../../src/auth/key-service.js';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/index.js';
import {
  applyProviderConfiguration,
  createProviderPolicyFetch,
  readAppliedProviderSettingKeys,
  readProviderConfiguration,
  resolveRuntimeProviderConfig,
  saveProviderConfiguration,
  saveProviderSecret,
  testProviderConnection,
  validateProviderBaseUrl,
  validateProviderConfiguration,
  type ProviderConfigDnsLookup
} from '../../src/services/admin-provider-config-service.js';
import {
  getRuntimeSecretMetadata,
  saveRuntimeSetting
} from '../../src/services/admin-settings-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const SECRET_PLAINTEXT = 'sk-provider-config-secret-value-must-not-leak';
const SECRET_PREFIX = SECRET_PLAINTEXT.slice(0, 16);
const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';

function encryptionKey(): string {
  return randomBytes(32).toString('base64url');
}

function env(overrides: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: 'postgres://localhost/postgram',
    EMBEDDING_PROVIDER: 'ollama',
    EMBEDDING_DIMENSIONS: '1024',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    ...overrides
  });
}

function publicDns(address = '93.184.216.34'): ProviderConfigDnsLookup {
  return () => Promise.resolve([{ address, family: 4 }]);
}

function privateDns(address = '10.0.0.7'): ProviderConfigDnsLookup {
  return () => Promise.resolve([{ address, family: 4 }]);
}

function assertNoSecretLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SECRET_PLAINTEXT);
  expect(serialized).not.toContain(SECRET_PREFIX);
  expect(serialized).not.toContain('authorization');
  expect(serialized).not.toContain('Bearer');
  expect(serialized).not.toContain('providerResponse');
  expect(serialized).not.toContain('response body');
}

async function createActor(database: TestDatabase): Promise<string> {
  const user = (
    await createAdminUser(database.pool, {
      email: `provider-${crypto.randomUUID()}@example.com`,
      password: STRONG_PASSWORD
    })
  )._unsafeUnwrap();
  return user.id;
}

async function createActiveAdminSession(
  database: TestDatabase,
  input: { freshStepUp: boolean }
): Promise<{
  adminUserId: string;
  cookie: string;
  csrfToken: string;
}> {
  const user = (
    await createAdminUser(database.pool, {
      email: `route-${crypto.randomUUID()}@example.com`,
      password: STRONG_PASSWORD
    })
  )._unsafeUnwrap();

  await database.pool.query(
    "UPDATE admin_users SET status = 'active' WHERE id = $1",
    [user.id]
  );

  const now = input.freshStepUp
    ? new Date()
    : new Date(Date.now() - 20 * 60 * 1000);
  const session = (
    await createAdminSession(database.pool, {
      adminUserId: user.id,
      ttlMs: 60 * 60 * 1000,
      mfaVerified: true,
      now
    })
  )._unsafeUnwrap();

  const app = createApp({ pool: database.pool });
  const csrfResponse = await app.request('/admin/api/session/csrf', {
    headers: {
      Cookie: `pgm_admin_session=${session.plaintextToken}`
    }
  });
  const csrfBody = (await csrfResponse.json()) as { csrfToken: string };
  expect(csrfResponse.status).toBe(200);

  return {
    adminUserId: user.id,
    cookie: `pgm_admin_session=${session.plaintextToken}`,
    csrfToken: csrfBody.csrfToken
  };
}

describe('admin provider config service', () => {
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

  it('reads redacted provider settings and secrets while preserving env fallback', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();

    const saved = await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_MODEL: 'local-json-model',
        EXTRACTION_BASE_URL: 'https://provider.example.test/v1'
      }
    });
    expect(saved.isOk()).toBe(true);

    const secret = await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId,
      validation: {
        status: 'error',
        message: 'Provider validation failed',
        metadata: {
          authorization: `Bearer ${SECRET_PLAINTEXT}`,
          providerResponse: {
            body: `response body ${SECRET_PREFIX}`
          }
        }
      }
    });
    expect(secret.isOk()).toBe(true);
    assertNoSecretLeak(secret._unsafeUnwrap());

    const snapshot = await readProviderConfiguration(database.pool, {
      envConfig: env({
        OPENAI_API_KEY: SECRET_PLAINTEXT,
        ANTHROPIC_API_KEY: 'anthropic-env-secret-must-not-leak',
        OLLAMA_BASE_URL: 'http://localhost:11434'
      })
    });

    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().settings.EXTRACTION_PROVIDER).toMatchObject(
      {
        value: 'openai-compatible',
        source: 'database',
        state: 'pending'
      }
    );
    expect(snapshot._unsafeUnwrap().settings.OLLAMA_BASE_URL).toMatchObject({
      value: 'http://localhost:11434',
      source: 'env'
    });
    expect(snapshot._unsafeUnwrap().secrets.EXTRACTION_API_KEY).toMatchObject({
      configured: true,
      provider: 'openai-compatible',
      purpose: 'extraction',
      validation: {
        status: 'error',
        message: 'Provider validation failed',
        metadata: {}
      }
    });
    expect(
      (
        snapshot._unsafeUnwrap() as typeof snapshot extends {
          _unsafeUnwrap: () => infer T;
        }
          ? T & { envSecrets: Record<string, boolean> }
          : never
      ).envSecrets
    ).toMatchObject({
      OPENAI_API_KEY: true,
      ANTHROPIC_API_KEY: true,
      OLLAMA_API_KEY: false,
      EXTRACTION_API_KEY: false,
      EMBEDDING_API_KEY: false
    });
    assertNoSecretLeak(snapshot._unsafeUnwrap());
    expect(JSON.stringify(snapshot._unsafeUnwrap())).not.toContain(
      'anthropic-env-secret-must-not-leak'
    );

    const metadata = await getRuntimeSecretMetadata(
      database.pool,
      'EXTRACTION_API_KEY'
    );
    expect(metadata.isOk()).toBe(true);
    expect(metadata._unsafeUnwrap()?.validation.metadata).toEqual({});
  }, 120_000);

  it('rejects invalid provider setting batches without partial writes', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const saved = await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EMBEDDING_DIMENSIONS: 0
      }
    });

    expect(saved.isErr()).toBe(true);
    expect(saved._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION
    });

    const count = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_runtime_settings'
    );
    expect(count.rows[0]?.count).toBe('0');
  }, 120_000);

  it('rejects provider base URLs with query strings, fragments, or credentials before save', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);

    for (const baseUrl of [
      'https://provider.example.test/v1?api_key=must-not-leak',
      'https://provider.example.test/v1#token=must-not-leak',
      'https://user:must-not-leak@provider.example.test/v1'
    ]) {
      const saved = await saveProviderConfiguration(database.pool, {
        actorAdminUserId: actorId,
        settings: {
          EXTRACTION_BASE_URL: baseUrl
        }
      });

      expect(saved.isErr()).toBe(true);
      expect(saved._unsafeUnwrapErr()).toMatchObject({
        code: ErrorCode.VALIDATION
      });
    }

    const count = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_runtime_settings'
    );
    expect(count.rows[0]?.count).toBe('0');
  }, 120_000);

  it('preserves env fallback values in provider setting save responses', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const saved = await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_PROVIDER: 'ollama'
      }),
      settings: {
        EXTRACTION_ENABLED: true
      }
    });

    expect(saved.isOk()).toBe(true);
    expect(saved._unsafeUnwrap().settings.EXTRACTION_ENABLED).toMatchObject({
      source: 'database',
      value: true
    });
    expect(saved._unsafeUnwrap().settings.EXTRACTION_PROVIDER).toMatchObject({
      source: 'env',
      value: 'ollama'
    });
  }, 120_000);

  it('defines an explicit provider URL egress policy before connection testing', async () => {
    const publicHttps = await validateProviderBaseUrl({
      settingKey: 'EXTRACTION_BASE_URL',
      provider: 'openai-compatible',
      baseUrl: 'https://public.example.test/v1',
      dnsLookup: publicDns()
    });
    expect(publicHttps).toMatchObject({
      safe: true,
      normalizedUrl: 'https://public.example.test/v1',
      localProviderException: false
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'ftp://public.example.test/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'scheme_not_allowed'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'http://public.example.test/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'http_requires_local_provider_exception'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'http://169.254.169.254/latest/meta-data',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://[::ffff:7f00:1]/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://[::ffff:a9fe:a9fe]/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://[64:ff9b::a9fe:a9fe]/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://[::a9fe:a9fe]/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://[fe90::1]/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://[ff02::1]/v1',
        dnsLookup: publicDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://private.example.test/v1',
        dnsLookup: privateDns()
      })
    ).resolves.toMatchObject({
      safe: false,
      reason: 'blocked_ip_range'
    });

    await expect(
      validateProviderBaseUrl({
        settingKey: 'OLLAMA_BASE_URL',
        provider: 'ollama',
        baseUrl: 'http://host.docker.internal:11434',
        dnsLookup: privateDns()
      })
    ).resolves.toMatchObject({
      safe: true,
      localProviderException: true
    });
  });

  it('redacts provider errors and refuses redirects during connection tests', async () => {
    const failingFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: `response body ${SECRET_PLAINTEXT}`
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
    );

    const failed = await testProviderConnection({
      settingKey: 'EXTRACTION_BASE_URL',
      provider: 'openai-compatible',
      baseUrl: 'https://public.example.test/v1',
      apiKey: SECRET_PLAINTEXT,
      dnsLookup: publicDns(),
      fetchImpl: failingFetch
    });

    expect(failed).toMatchObject({
      status: 'error',
      message: 'Provider connection failed with status 500',
      metadata: {
        status: 500
      }
    });
    assertNoSecretLeak(failed);
    expect(failingFetch).toHaveBeenCalledWith(
      'https://public.example.test/v1/models',
      expect.objectContaining({
        redirect: 'manual'
      })
    );

    const redirectFetch = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: {
            Location: 'http://169.254.169.254/latest/meta-data'
          }
        })
      )
    );
    const redirected = await testProviderConnection({
      settingKey: 'EXTRACTION_BASE_URL',
      provider: 'openai-compatible',
      baseUrl: 'https://public.example.test/v1',
      dnsLookup: publicDns(),
      fetchImpl: redirectFetch
    });

    expect(redirected).toMatchObject({
      status: 'invalid',
      message: 'Provider redirects are not followed',
      metadata: {
        status: 302
      }
    });
    assertNoSecretLeak(redirected);
    expect(redirectFetch).toHaveBeenCalledTimes(1);

    const productionFetchAttempt = await testProviderConnection({
      settingKey: 'EXTRACTION_BASE_URL',
      provider: 'openai-compatible',
      baseUrl: 'https://public.example.test:0/v1',
      dnsLookup: publicDns()
    });
    expect(productionFetchAttempt).toMatchObject({
      status: 'error',
      message: 'Provider connection failed',
      metadata: {
        reason: 'request_failed'
      }
    });

    const originalFetch = globalThis.fetch;
    const localFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve(
          new Response(JSON.stringify({ models: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        );
      }
    );
    vi.stubGlobal('fetch', localFetch);
    try {
      const local = await testProviderConnection({
        settingKey: 'OLLAMA_BASE_URL',
        provider: 'ollama',
        baseUrl: 'http://localhost:11434'
      });
      expect(local).toMatchObject({
        status: 'valid',
        metadata: {
          status: 200
        }
      });
      expect(localFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({
          redirect: 'manual'
        })
      );
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('guards runtime provider fetches against DNS rebinds and redirects', async () => {
    const rebindingFetch = vi.fn();
    const rebindingGuard = createProviderPolicyFetch({
      settingKey: 'EXTRACTION_BASE_URL',
      provider: 'openai-compatible',
      baseUrl: 'https://public.example.test/v1',
      dnsLookup: privateDns(),
      fetchImpl: rebindingFetch
    });

    await expect(
      rebindingGuard('https://public.example.test/v1/chat/completions', {
        method: 'POST',
        body: '{}'
      })
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        reason: 'blocked_ip_range'
      }
    });
    expect(rebindingFetch).not.toHaveBeenCalled();

    const redirectGuard = createProviderPolicyFetch({
      settingKey: 'EXTRACTION_BASE_URL',
      provider: 'openai-compatible',
      baseUrl: 'https://public.example.test/v1',
      dnsLookup: publicDns(),
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { Location: 'http://169.254.169.254/latest/meta-data' }
          })
        )
      )
    });

    await expect(
      redirectGuard('https://public.example.test/v1/chat/completions', {
        method: 'POST',
        body: '{}'
      })
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider redirects are not followed'
    });
  });

  it('preserves response bodies for DNS-pinned runtime provider fetches', async () => {
    const responseBody = JSON.stringify({ ok: true });
    const requestBody = JSON.stringify({ prompt: 'ping' });
    const sentBodies: string[] = [];
    const mockHttpsRequest = vi.fn(
      (
        _options: unknown,
        callback: (
          response: Readable & {
            headers: Record<string, string>;
            statusCode: number;
            statusMessage: string;
          }
        ) => void
      ) => {
        return {
          setTimeout: vi.fn(),
          on: vi.fn(),
          destroy: vi.fn(),
          end: (body?: string | Buffer | Uint8Array | ArrayBuffer) => {
            if (typeof body === 'string') {
              sentBodies.push(body);
            } else if (Buffer.isBuffer(body)) {
              sentBodies.push(body.toString('utf8'));
            } else if (body instanceof Uint8Array) {
              sentBodies.push(Buffer.from(body).toString('utf8'));
            } else if (body instanceof ArrayBuffer) {
              sentBodies.push(Buffer.from(body).toString('utf8'));
            }
            const response = Readable.from([
              Buffer.from(responseBody)
            ]) as Readable & {
              headers: Record<string, string>;
              statusCode: number;
              statusMessage: string;
            };
            response.headers = { 'content-type': 'application/json' };
            response.statusCode = 200;
            response.statusMessage = 'OK';
            callback(response);
          }
        };
      }
    );

    vi.doMock('node:https', () => ({ request: mockHttpsRequest }));
    vi.resetModules();
    try {
      const { createProviderPolicyFetch: createPinnedProviderPolicyFetch } =
        await import('../../src/services/admin-provider-config-service.js');
      const guardedFetch = createPinnedProviderPolicyFetch({
        settingKey: 'EXTRACTION_BASE_URL',
        provider: 'openai-compatible',
        baseUrl: 'https://public.example.test/v1',
        dnsLookup: publicDns()
      });

      const response = await guardedFetch(
        'https://public.example.test/v1/chat/completions',
        {
          method: 'POST',
          body: requestBody,
          headers: { 'content-type': 'application/json' }
        }
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(responseBody);
      expect(sentBodies).toEqual([requestBody]);
    } finally {
      vi.doUnmock('node:https');
      vi.resetModules();
    }
  });

  it('does not impose the validation timeout on runtime provider fetches', async () => {
    const originalFetch = globalThis.fetch;
    vi.useFakeTimers();

    let fetchSignal: AbortSignal | undefined;
    let resolveFetch: ((response: Response) => void) | undefined;
    const runtimeFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve, reject) => {
          resolveFetch = resolve;
          fetchSignal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
    );
    vi.stubGlobal('fetch', runtimeFetch);

    try {
      const guardedFetch = createProviderPolicyFetch({
        settingKey: 'OLLAMA_BASE_URL',
        provider: 'ollama',
        baseUrl: 'http://localhost:11434'
      });

      const responsePromise = guardedFetch('http://localhost:11434/api/chat', {
        method: 'POST',
        body: '{}'
      });

      await vi.advanceTimersByTimeAsync(10_500);
      expect(fetchSignal?.aborted ?? false).toBe(false);

      resolveFetch?.(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
      await expect(responsePromise).resolves.toMatchObject({ status: 200 });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      vi.useRealTimers();
    }
  });

  it('validates and applies extraction settings with explicit restart state and structured audit attribution', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_MODEL: 'local-json-model',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });
    const secret = await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId
    });
    expect(secret.isOk()).toBe(true);

    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: key,
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid',
      restartRequired: true,
      reembedRequired: false,
      connectionTests: {
        EXTRACTION_BASE_URL: {
          status: 'valid'
        }
      }
    });
    assertNoSecretLeak(validated._unsafeUnwrap());

    const storedValidation = await database.pool.query<{
      validation_status: string;
      validation_metadata: Record<string, unknown>;
    }>(
      `
        SELECT validation_status, validation_metadata
        FROM admin_runtime_settings
        WHERE key = 'EXTRACTION_BASE_URL'
      `
    );
    expect(storedValidation.rows[0]).toMatchObject({
      validation_status: 'valid',
      validation_metadata: {
        provider: 'openai-compatible',
        egressPolicy: 'provider-base-url-v1',
        connectionStatus: 200
      }
    });
    assertNoSecretLeak(storedValidation.rows[0]);
    const firstFetchCall = fetchImpl.mock.calls[0] as
      | [string, RequestInit]
      | undefined;
    expect(firstFetchCall?.[0]).toBe('https://public.example.test/v1/models');
    expect(
      (firstFetchCall?.[1].headers as Record<string, string> | undefined)
        ?.Authorization
    ).toBe(`Bearer ${SECRET_PLAINTEXT}`);

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      dnsLookup: publicDns()
    });

    expect(applied.isOk()).toBe(true);
    expect(applied._unsafeUnwrap()).toMatchObject({
      applied: true,
      restartRequired: true,
      reembedRequired: false,
      reload: {
        extraction: 'restart_required',
        embedding: 'unchanged'
      },
      appliedSettings: [
        'EXTRACTION_BASE_URL',
        'EXTRACTION_ENABLED',
        'EXTRACTION_MODEL',
        'EXTRACTION_PROVIDER'
      ]
    });
    const postApplySnapshot = await readProviderConfiguration(database.pool, {
      envConfig: env()
    });
    expect(postApplySnapshot.isOk()).toBe(true);
    expect(postApplySnapshot._unsafeUnwrap()).toMatchObject({
      restartRequired: true,
      reembedRequired: false,
      settings: {
        EXTRACTION_PROVIDER: {
          state: 'applied',
          restartRequired: true
        }
      }
    });

    const audit = await database.pool.query<{
      admin_user_id: string | null;
      operation: string;
      details: Record<string, unknown>;
    }>(
      `
        SELECT admin_user_id, operation, details
        FROM audit_log
        WHERE operation = 'admin.provider_config.apply'
        ORDER BY timestamp DESC
        LIMIT 1
      `
    );
    expect(audit.rows[0]).toMatchObject({
      admin_user_id: actorId,
      operation: 'admin.provider_config.apply',
      details: {
        restart_required: true,
        reembed_required: false
      }
    });
    assertNoSecretLeak(audit.rows[0]);
  }, 120_000);

  it('uses the database clock when applying connection-validated URL settings', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_MODEL: 'local-json-model',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });
    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId
    });

    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: key,
      dnsLookup: publicDns(),
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      ),
      testConnections: true
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid'
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    try {
      const applied = await applyProviderConfiguration(database.pool, {
        actorAdminUserId: actorId,
        envConfig: env(),
        encryptionKey: key,
        dnsLookup: publicDns()
      });

      expect(applied.isOk()).toBe(true);
      expect(applied._unsafeUnwrap().appliedSettings).toEqual([
        'EXTRACTION_BASE_URL',
        'EXTRACTION_ENABLED',
        'EXTRACTION_MODEL',
        'EXTRACTION_PROVIDER'
      ]);
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);

  it('keeps runtime resolution on last applied values while edits are pending', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const envConfig = env({
      EXTRACTION_ENABLED: 'false',
      OPENAI_API_KEY: 'sk-env-openai'
    });
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai',
        EXTRACTION_MODEL: 'gpt-4o-mini'
      }
    });
    const initialApplied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig,
      dnsLookup: publicDns()
    });
    expect(initialApplied.isOk()).toBe(true);

    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: false,
        EXTRACTION_PROVIDER: 'anthropic',
        EXTRACTION_MODEL: 'claude-3-5-haiku-latest'
      }
    });

    const snapshot = await readProviderConfiguration(database.pool, {
      envConfig
    });
    expect(snapshot.isOk()).toBe(true);
    expect(snapshot._unsafeUnwrap().settings.EXTRACTION_PROVIDER).toMatchObject(
      {
        source: 'database',
        state: 'pending',
        value: 'anthropic'
      }
    );

    const runtime = await resolveRuntimeProviderConfig(database.pool, {
      envConfig
    });
    expect(runtime.isOk()).toBe(true);
    expect(runtime._unsafeUnwrap()).toMatchObject({
      EXTRACTION_ENABLED: true,
      EXTRACTION_PROVIDER: 'openai',
      EXTRACTION_MODEL: 'gpt-4o-mini'
    });
  }, 120_000);

  it('keeps zero-version applied provider settings active while edits are pending', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const envConfig = env({
      OLLAMA_BASE_URL: 'http://env.example.test:11434'
    });
    const applied = await saveRuntimeSetting(database.pool, {
      key: 'OLLAMA_BASE_URL',
      value: 'http://applied.example.test:11434',
      classification: 'restart_required',
      state: 'applied',
      actorAdminUserId: actorId
    });
    expect(applied.isOk()).toBe(true);
    expect(applied._unsafeUnwrap().appliedVersion).toBe(0);
    expect(applied._unsafeUnwrap().appliedValue).toBe(
      'http://applied.example.test:11434'
    );

    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        OLLAMA_BASE_URL: 'http://pending.example.test:11434'
      }
    });

    const appliedKeys = await readAppliedProviderSettingKeys(database.pool);
    expect(appliedKeys.isOk()).toBe(true);
    expect(appliedKeys._unsafeUnwrap()).toEqual(['OLLAMA_BASE_URL']);

    const runtime = await resolveRuntimeProviderConfig(database.pool, {
      envConfig
    });
    expect(runtime.isOk()).toBe(true);
    expect(runtime._unsafeUnwrap().OLLAMA_BASE_URL).toBe(
      'http://applied.example.test:11434'
    );
  }, 120_000);

  it('skips stale extraction base URLs when the selected provider does not use them', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const envConfig = env({
      EXTRACTION_ENABLED: 'true',
      EXTRACTION_PROVIDER: 'openai-compatible',
      EXTRACTION_BASE_URL: 'http://localhost:8000/v1',
      OPENAI_API_KEY: 'sk-env-openai'
    });
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai'
      }
    });

    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig,
      dnsLookup: publicDns()
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid'
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig,
      dnsLookup: publicDns()
    });
    expect(applied.isOk()).toBe(true);
    expect(applied._unsafeUnwrap().appliedSettings).toEqual([
      'EXTRACTION_ENABLED',
      'EXTRACTION_PROVIDER'
    ]);
  }, 120_000);

  it('skips stale extraction URLs when the target configuration disables extraction', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const envConfig = env({
      EXTRACTION_ENABLED: 'true',
      EXTRACTION_PROVIDER: 'openai-compatible',
      EXTRACTION_BASE_URL: 'http://169.254.169.254/latest/meta-data'
    });
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: false
      }
    });

    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig,
      dnsLookup: publicDns()
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid'
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig,
      dnsLookup: publicDns()
    });
    expect(applied.isOk()).toBe(true);
    expect(applied._unsafeUnwrap().appliedSettings).toEqual([
      'EXTRACTION_ENABLED'
    ]);
  }, 120_000);

  it('does not apply provider settings saved after the validated apply snapshot', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const pool = database.pool;
    const actorId = await createActor(database);
    await saveProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai'
      }
    });

    const originalConnect = pool.connect.bind(pool);
    let injectedLateSave = false;
    const connectMock = ((callback?: unknown) => {
      if (typeof callback === 'function') {
        return (
          originalConnect as unknown as (
            callback: (error: Error | undefined, client: unknown) => void
          ) => void
        )(callback as (error: Error | undefined, client: unknown) => void);
      }

      const connect = async () => {
        if (!injectedLateSave) {
          injectedLateSave = true;
          await saveProviderConfiguration(pool, {
            actorAdminUserId: actorId,
            settings: {
              EXTRACTION_MODEL: 'late-unvalidated-model'
            }
          });
        }
        return originalConnect();
      };
      return connect();
    }) as typeof pool.connect;
    const connectSpy = vi.spyOn(pool, 'connect');
    // pg Pool.connect intentionally has callback and promise overloads here.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    connectSpy.mockImplementation(connectMock);

    try {
      const applied = await applyProviderConfiguration(database.pool, {
        actorAdminUserId: actorId,
        envConfig: env({
          EXTRACTION_ENABLED: 'true',
          EXTRACTION_PROVIDER: 'openai',
          OPENAI_API_KEY: 'sk-env-openai'
        }),
        dnsLookup: publicDns()
      });

      expect(applied.isOk()).toBe(true);
      expect(applied._unsafeUnwrap().appliedSettings).toEqual([
        'EXTRACTION_ENABLED',
        'EXTRACTION_PROVIDER'
      ]);
    } finally {
      connectSpy.mockRestore();
    }

    const states = await database.pool.query<{
      key: string;
      state: string;
    }>(
      `
        SELECT key, state
        FROM admin_runtime_settings
        WHERE key IN (
          'EXTRACTION_ENABLED',
          'EXTRACTION_PROVIDER',
          'EXTRACTION_MODEL'
        )
        ORDER BY key ASC
      `
    );

    expect(states.rows).toEqual([
      { key: 'EXTRACTION_ENABLED', state: 'applied' },
      { key: 'EXTRACTION_MODEL', state: 'pending' },
      { key: 'EXTRACTION_PROVIDER', state: 'applied' }
    ]);
  }, 120_000);

  it('requires connection validation when a DB-backed URL becomes newly relevant', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });
    const appliedUrlWhileDisabled = await applyProviderConfiguration(
      database.pool,
      {
        actorAdminUserId: actorId,
        envConfig: env(),
        dnsLookup: publicDns()
      }
    );
    expect(appliedUrlWhileDisabled.isOk()).toBe(true);
    expect(appliedUrlWhileDisabled._unsafeUnwrap().appliedSettings).toEqual([
      'EXTRACTION_BASE_URL'
    ]);

    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible'
      }
    });
    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      dnsLookup: publicDns()
    });

    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider connection validation must pass before apply',
      details: {
        settings: ['EXTRACTION_BASE_URL']
      }
    });
  }, 120_000);

  it('does not mark relevant DB-backed provider URLs valid without connection validation', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });

    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      dnsLookup: publicDns(),
      testConnections: false
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid'
    });

    const storedValidation = await database.pool.query<{
      validation_status: string;
      validation_message: string | null;
    }>(
      `
        SELECT validation_status, validation_message
        FROM admin_runtime_settings
        WHERE key = 'EXTRACTION_BASE_URL'
      `
    );
    expect(storedValidation.rows[0]).toEqual({
      validation_status: 'unvalidated',
      validation_message:
        'Provider base URL accepted by egress policy; run connection validation before apply'
    });
  }, 120_000);

  it('does not apply provider URLs after failed connection validation', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const pool = database.pool;
    const actorId = await createActor(database);
    await saveProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });
    const key = encryptionKey();
    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: `${SECRET_PLAINTEXT}-stored`,
      encryptionKey: key,
      actorAdminUserId: actorId
    });

    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'bad key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      encryptionKey: key,
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'error',
      connectionTests: {
        EXTRACTION_BASE_URL: {
          status: 'error'
        }
      }
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      encryptionKey: key,
      dnsLookup: publicDns()
    });
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider configuration validation must pass before apply',
      details: {
        status: 'error'
      }
    });
  }, 120_000);

  it('invalidates URL connection validation when a related provider secret changes', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      encryptionKey: key,
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid'
    });

    const initialApplied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      encryptionKey: key,
      dnsLookup: publicDns()
    });
    expect(initialApplied.isOk()).toBe(true);

    await database.pool.query(
      `
        UPDATE admin_runtime_settings
        SET applied_at = '2000-01-01T00:00:00Z'::timestamptz
        WHERE key IN (
          'EXTRACTION_ENABLED',
          'EXTRACTION_PROVIDER',
          'EXTRACTION_BASE_URL'
        )
      `
    );
    const beforeRotation = await readProviderConfiguration(database.pool, {
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      })
    });
    expect(beforeRotation.isOk()).toBe(true);
    expect(beforeRotation._unsafeUnwrap().restartRequired).toBe(false);

    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: `${SECRET_PLAINTEXT}-rotated`,
      encryptionKey: key,
      actorAdminUserId: actorId
    });

    const storedValidation = await database.pool.query<{
      validation_status: string;
      validation_metadata: Record<string, unknown>;
    }>(
      `
        SELECT validation_status, validation_metadata
        FROM admin_runtime_settings
        WHERE key = 'EXTRACTION_BASE_URL'
      `
    );
    expect(storedValidation.rows[0]).toMatchObject({
      validation_status: 'unvalidated',
      validation_metadata: {
        reason: 'secret_changed',
        secret: 'EXTRACTION_API_KEY'
      }
    });

    const afterRotation = await readProviderConfiguration(database.pool, {
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      })
    });
    expect(afterRotation.isOk()).toBe(true);
    expect(afterRotation._unsafeUnwrap().restartRequired).toBe(true);

    const resolved = await resolveRuntimeProviderConfig(database.pool, {
      envConfig: env({
        EXTRACTION_API_KEY: 'sk-env-after-rotation'
      }),
      encryptionKey: key
    });
    expect(resolved.isOk()).toBe(true);
    expect(resolved._unsafeUnwrap().EXTRACTION_API_KEY).toBe(
      'sk-env-after-rotation'
    );

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: key,
      dnsLookup: publicDns()
    });
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider connection validation must pass before apply',
      details: {
        settings: ['EXTRACTION_BASE_URL']
      }
    });
  }, 120_000);

  it('does not attach in-flight connection validation to a changed provider URL', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const pool = database.pool;
    const actorId = await createActor(database);
    await saveProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });

    const fetchImpl = vi.fn(async () => {
      await saveProviderConfiguration(pool, {
        actorAdminUserId: actorId,
        settings: {
          EXTRACTION_BASE_URL: 'https://new-public.example.test/v1'
        }
      });

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    const validated = await validateProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'error'
    });

    const storedValidation = await pool.query<{
      value: string;
      validation_status: string;
    }>(
      `
        SELECT value #>> '{}' AS value, validation_status
        FROM admin_runtime_settings
        WHERE key = 'EXTRACTION_BASE_URL'
      `
    );
    expect(storedValidation.rows[0]).toEqual({
      value: 'https://new-public.example.test/v1',
      validation_status: 'unvalidated'
    });

    const applied = await applyProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      dnsLookup: publicDns()
    });
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider connection validation must pass before apply',
      details: {
        settings: ['EXTRACTION_BASE_URL']
      }
    });
  }, 120_000);

  it('does not attach in-flight connection validation after a related secret rotates', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const pool = database.pool;
    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });
    await saveProviderSecret(pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId
    });

    const fetchImpl = vi.fn(async (_input: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${SECRET_PLAINTEXT}`
      );
      await saveProviderSecret(pool, {
        name: 'EXTRACTION_API_KEY',
        plaintext: `${SECRET_PLAINTEXT}-rotated`,
        encryptionKey: key,
        actorAdminUserId: actorId
      });

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    const validated = await validateProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: key,
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'error'
    });

    const storedValidation = await pool.query<{
      validation_status: string;
      validation_metadata: Record<string, unknown>;
    }>(
      `
        SELECT validation_status, validation_metadata
        FROM admin_runtime_settings
        WHERE key = 'EXTRACTION_BASE_URL'
      `
    );
    expect(storedValidation.rows[0]).toMatchObject({
      validation_status: 'unvalidated',
      validation_metadata: {
        reason: 'secret_changed',
        secret: 'EXTRACTION_API_KEY'
      }
    });

    const applied = await applyProviderConfiguration(pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: key,
      dnsLookup: publicDns()
    });
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider connection validation must pass before apply',
      details: {
        settings: ['EXTRACTION_BASE_URL']
      }
    });
  }, 120_000);

  it('uses env provider secrets as fallback during connection tests', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });

    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid',
      connectionTests: {
        EXTRACTION_BASE_URL: {
          status: 'valid'
        }
      },
      runtime: {
        constructible: true
      }
    });
    const firstFetchCall = fetchImpl.mock.calls[0] as
      | [string, RequestInit]
      | undefined;
    expect(firstFetchCall?.[0]).toBe('https://public.example.test/v1/models');
    expect(
      (firstFetchCall?.[1].headers as Record<string, string> | undefined)
        ?.Authorization
    ).toBe(`Bearer ${SECRET_PLAINTEXT}`);
    assertNoSecretLeak(validated._unsafeUnwrap());
  }, 120_000);

  it('does not validate stored provider secrets with env fallback credentials', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://public.example.test/v1'
      }
    });
    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: `${SECRET_PLAINTEXT}-stored`,
      encryptionKey: encryptionKey(),
      actorAdminUserId: actorId
    });

    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_API_KEY: SECRET_PLAINTEXT
      }),
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });

    expect(validated.isErr()).toBe(true);
    expect(validated._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.INTERNAL,
      message:
        'Admin settings encryption key is required to test stored provider secrets'
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  }, 120_000);

  it('validates shared Ollama base URLs with the embedding API key when embedding falls back to OLLAMA_BASE_URL', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        OLLAMA_BASE_URL: 'https://public.example.test/v1'
      }
    });

    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EMBEDDING_API_KEY: SECRET_PLAINTEXT,
        OLLAMA_API_KEY: 'wrong-credential-for-embedding'
      }),
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid',
      connectionTests: {
        OLLAMA_BASE_URL: {
          status: 'valid'
        }
      }
    });
    const firstFetchCall = fetchImpl.mock.calls[0] as
      | [string, RequestInit]
      | undefined;
    expect(firstFetchCall?.[0]).toBe('https://public.example.test/v1/api/tags');
    expect(
      (firstFetchCall?.[1].headers as Record<string, string> | undefined)
        ?.Authorization
    ).toBe(`Bearer ${SECRET_PLAINTEXT}`);
    assertNoSecretLeak(validated._unsafeUnwrap());

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EMBEDDING_API_KEY: SECRET_PLAINTEXT,
        OLLAMA_API_KEY: 'wrong-credential-for-embedding'
      }),
      dnsLookup: publicDns()
    });
    expect(applied.isOk()).toBe(true);
    expect(applied._unsafeUnwrap()).toMatchObject({
      reload: {
        extraction: 'unchanged',
        embedding: 'restart_required'
      },
      appliedSettings: ['OLLAMA_BASE_URL']
    });
  }, 120_000);

  it('validates shared Ollama base URLs with the extraction API key when extraction also uses OLLAMA_BASE_URL', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: 'https://public.example.test/v1'
      }
    });

    const fetchImpl = vi.fn((_input: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string> | undefined)
        ?.Authorization;
      return Promise.resolve(
        new Response(JSON.stringify({ models: [] }), {
          status: authorization === `Bearer ${SECRET_PLAINTEXT}` ? 200 : 401,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        EXTRACTION_ENABLED: 'true',
        EXTRACTION_PROVIDER: 'ollama',
        EMBEDDING_API_KEY: SECRET_PLAINTEXT,
        OLLAMA_API_KEY: 'wrong-credential-for-extraction'
      }),
      dnsLookup: publicDns(),
      fetchImpl,
      testConnections: true
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'error',
      connectionTests: {
        OLLAMA_BASE_URL: {
          status: 'error'
        }
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.map(
        (call) => (call[1].headers as Record<string, string>).Authorization
      )
    ).toEqual([
      `Bearer ${SECRET_PLAINTEXT}`,
      'Bearer wrong-credential-for-extraction'
    ]);
    assertNoSecretLeak(validated._unsafeUnwrap());
  }, 120_000);

  it('requires fresh shared URL validation when provider credential usage changes', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        OLLAMA_BASE_URL: 'https://public.example.test/v1'
      }
    });

    const fetchImpl = vi.fn((_input: string, init: RequestInit) => {
      const authorization = (init.headers as Record<string, string> | undefined)
        ?.Authorization;
      return Promise.resolve(
        new Response(JSON.stringify({ models: [] }), {
          status: authorization === `Bearer ${SECRET_PLAINTEXT}` ? 200 : 401,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });
    const validatedForEmbeddingOnly = await validateProviderConfiguration(
      database.pool,
      {
        actorAdminUserId: actorId,
        envConfig: env({
          EMBEDDING_API_KEY: SECRET_PLAINTEXT,
          OLLAMA_API_KEY: 'wrong-extraction-credential'
        }),
        dnsLookup: publicDns(),
        fetchImpl,
        testConnections: true
      }
    );
    expect(validatedForEmbeddingOnly.isOk()).toBe(true);
    expect(validatedForEmbeddingOnly._unsafeUnwrap()).toMatchObject({
      status: 'valid',
      connectionTests: {
        OLLAMA_BASE_URL: {
          status: 'valid'
        }
      }
    });

    const appliedForEmbeddingOnly = await applyProviderConfiguration(
      database.pool,
      {
        actorAdminUserId: actorId,
        envConfig: env({
          EMBEDDING_API_KEY: SECRET_PLAINTEXT,
          OLLAMA_API_KEY: 'wrong-extraction-credential'
        }),
        dnsLookup: publicDns()
      }
    );
    expect(appliedForEmbeddingOnly.isOk()).toBe(true);

    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'ollama'
      }
    });

    const appliedWithStaleUrlValidation = await applyProviderConfiguration(
      database.pool,
      {
        actorAdminUserId: actorId,
        envConfig: env({
          EMBEDDING_API_KEY: SECRET_PLAINTEXT,
          OLLAMA_API_KEY: 'wrong-extraction-credential'
        }),
        dnsLookup: publicDns()
      }
    );
    expect(appliedWithStaleUrlValidation.isErr()).toBe(true);
    expect(appliedWithStaleUrlValidation._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider connection validation must pass before apply',
      details: {
        settings: ['OLLAMA_BASE_URL']
      }
    });
  }, 120_000);

  it('keeps env secret fallback usable when a stored active provider secret cannot be decrypted without the settings key', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderSecret(database.pool, {
      name: 'OPENAI_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: encryptionKey(),
      actorAdminUserId: actorId
    });
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EMBEDDING_PROVIDER: 'openai',
        EMBEDDING_DIMENSIONS: 1536
      }
    });

    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        OPENAI_API_KEY: 'sk-env-fallback'
      }),
      dnsLookup: publicDns()
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid',
      runtime: {
        constructible: true
      }
    });
  }, 120_000);

  it('refuses apply when a stored required provider secret cannot decrypt with the current settings key', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderSecret(database.pool, {
      name: 'OPENAI_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: encryptionKey(),
      actorAdminUserId: actorId
    });
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EMBEDDING_PROVIDER: 'openai',
        EMBEDDING_DIMENSIONS: 1536
      }
    });

    const wrongKey = encryptionKey();
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: wrongKey,
      dnsLookup: publicDns()
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'invalid',
      runtime: {
        constructible: false,
        errors: [
          {
            field: 'OPENAI_API_KEY',
            message:
              'ADMIN_SETTINGS_ENCRYPTION_KEY could not decrypt stored provider secret'
          }
        ]
      }
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: wrongKey,
      dnsLookup: publicDns()
    });
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        status: 'invalid'
      }
    });
  }, 120_000);

  it('refuses apply when a stored optional extraction secret cannot decrypt with the current settings key', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: encryptionKey(),
      actorAdminUserId: actorId
    });
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible'
      }
    });

    const wrongKey = encryptionKey();
    const envConfig = env({
      EXTRACTION_BASE_URL: 'https://public.example.test/v1'
    });
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig,
      encryptionKey: wrongKey,
      dnsLookup: publicDns()
    });

    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'invalid',
      runtime: {
        constructible: false,
        errors: [
          {
            field: 'EXTRACTION_API_KEY',
            message:
              'ADMIN_SETTINGS_ENCRYPTION_KEY could not decrypt stored provider secret'
          }
        ]
      }
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig,
      encryptionKey: wrongKey,
      dnsLookup: publicDns()
    });
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        status: 'invalid'
      }
    });
  }, 120_000);

  it('refuses apply when target provider settings cannot construct at startup', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'anthropic'
      }
    });

    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      dnsLookup: publicDns()
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'invalid',
      runtime: {
        constructible: false,
        errors: [
          {
            field: 'ANTHROPIC_API_KEY',
            message:
              'ANTHROPIC_API_KEY is required for anthropic extraction provider'
          }
        ]
      }
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      dnsLookup: publicDns()
    });
    expect(applied.isErr()).toBe(true);
    expect(applied._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      message: 'Provider configuration validation must pass before apply',
      details: {
        status: 'invalid'
      }
    });

    const pending = await database.pool.query<{ state: string }>(
      `
        SELECT state
        FROM admin_runtime_settings
        WHERE key = 'EXTRACTION_PROVIDER'
      `
    );
    expect(pending.rows[0]?.state).toBe('pending');
  }, 120_000);

  it('applies validated embedding settings before migration and reports the remaining work', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'bge-m3',
        EMBEDDING_DIMENSIONS: 1024
      }
    });

    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      dnsLookup: publicDns()
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'requires_reembedding',
      restartRequired: true,
      reembedRequired: true,
      embedding: {
        current: {
          provider: 'openai',
          model: 'text-embedding-3-small',
          dimensions: 1536
        },
        target: {
          provider: 'ollama',
          model: 'bge-m3',
          dimensions: 1024
        }
      }
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      dnsLookup: publicDns()
    });

    expect(applied.isOk()).toBe(true);
    expect(applied._unsafeUnwrap()).toMatchObject({
      applied: true,
      restartRequired: true,
      reembedRequired: true,
      reload: {
        extraction: 'unchanged',
        embedding: 'restart_required'
      },
      appliedSettings: [
        'EMBEDDING_DIMENSIONS',
        'EMBEDDING_MODEL',
        'EMBEDDING_PROVIDER'
      ]
    });

    const postApply = await readProviderConfiguration(database.pool, {
      envConfig: env()
    });
    expect(postApply.isOk()).toBe(true);
    expect(postApply._unsafeUnwrap()).toMatchObject({
      restartRequired: true,
      reembedRequired: true,
      settings: {
        EMBEDDING_PROVIDER: { state: 'applied', value: 'ollama' },
        EMBEDDING_DIMENSIONS: { state: 'applied', value: 1024 }
      }
    });

    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_MODEL: 'gpt-4.1-mini'
      }
    });
    const unrelatedApply = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      dnsLookup: publicDns()
    });
    expect(unrelatedApply.isOk()).toBe(true);
    expect(unrelatedApply._unsafeUnwrap()).toMatchObject({
      reembedRequired: true,
      appliedSettings: ['EXTRACTION_MODEL']
    });
  }, 120_000);

  it('resolves applied DB provider settings and encrypted secrets over env values', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EMBEDDING_PROVIDER: 'openai',
        EMBEDDING_DIMENSIONS: 1536
      }
    });
    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        OPENAI_API_KEY: 'sk-env-fallback'
      }),
      dnsLookup: publicDns()
    });
    expect(applied.isOk()).toBe(true);
    await saveProviderSecret(database.pool, {
      name: 'OPENAI_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId
    });

    const resolved = await resolveRuntimeProviderConfig(database.pool, {
      envConfig: env({
        OPENAI_API_KEY: 'sk-env-fallback'
      }),
      encryptionKey: key
    });

    expect(resolved.isOk()).toBe(true);
    expect(resolved._unsafeUnwrap().EMBEDDING_PROVIDER).toBe('openai');
    expect(resolved._unsafeUnwrap().OPENAI_API_KEY).toBe(SECRET_PLAINTEXT);
  }, 120_000);

  it('keeps stored optional provider credentials when a pending URL edit is not active at runtime', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId
    });
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_BASE_URL: 'https://pending.example.test/v1'
      }
    });

    const resolved = await resolveRuntimeProviderConfig(database.pool, {
      envConfig: env({
        EXTRACTION_ENABLED: 'true',
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://active.example.test/v1'
      }),
      encryptionKey: key
    });

    expect(resolved.isOk()).toBe(true);
    expect(resolved._unsafeUnwrap().EXTRACTION_BASE_URL).toBe(
      'https://active.example.test/v1'
    );
    expect(resolved._unsafeUnwrap().EXTRACTION_API_KEY).toBe(SECRET_PLAINTEXT);
  }, 120_000);

  it('does not load a rotated stored secret for an active applied URL while a URL edit is pending', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_ENABLED: true,
        EXTRACTION_PROVIDER: 'openai-compatible',
        EXTRACTION_BASE_URL: 'https://active.example.test/v1'
      }
    });
    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId
    });
    const validated = await validateProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: key,
      dnsLookup: publicDns(),
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      ),
      testConnections: true
    });
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      status: 'valid'
    });

    const applied = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env(),
      encryptionKey: key,
      dnsLookup: publicDns()
    });
    expect(applied.isOk()).toBe(true);

    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EXTRACTION_BASE_URL: 'https://pending.example.test/v1'
      }
    });
    await saveProviderSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: `${SECRET_PLAINTEXT}-rotated`,
      encryptionKey: key,
      actorAdminUserId: actorId
    });

    const resolved = await resolveRuntimeProviderConfig(database.pool, {
      envConfig: env({
        EXTRACTION_API_KEY: 'sk-env-fallback-after-rotation'
      }),
      encryptionKey: key
    });

    expect(resolved.isOk()).toBe(true);
    expect(resolved._unsafeUnwrap()).toMatchObject({
      EXTRACTION_BASE_URL: 'https://active.example.test/v1',
      EXTRACTION_API_KEY: 'sk-env-fallback-after-rotation'
    });
  }, 120_000);

  it('reports restart requirements for active provider secret rotations', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();
    await saveProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      settings: {
        EMBEDDING_PROVIDER: 'openai',
        EMBEDDING_DIMENSIONS: 1536
      }
    });
    const appliedSettings = await applyProviderConfiguration(database.pool, {
      actorAdminUserId: actorId,
      envConfig: env({
        OPENAI_API_KEY: 'sk-env-active-openai'
      }),
      dnsLookup: publicDns()
    });
    expect(appliedSettings.isOk()).toBe(true);

    await saveProviderSecret(database.pool, {
      name: 'OPENAI_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: key,
      actorAdminUserId: actorId
    });

    const appliedSecretRotation = await applyProviderConfiguration(
      database.pool,
      {
        actorAdminUserId: actorId,
        envConfig: env({
          OPENAI_API_KEY: 'sk-env-active-openai'
        }),
        encryptionKey: key,
        dnsLookup: publicDns()
      }
    );

    expect(appliedSecretRotation.isOk()).toBe(true);
    expect(appliedSecretRotation._unsafeUnwrap()).toMatchObject({
      restartRequired: true,
      appliedSettings: [],
      reload: {
        embedding: 'restart_required',
        extraction: 'unchanged'
      }
    });
  }, 120_000);

  it('does not decrypt unused stored provider secrets during runtime resolution', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveProviderSecret(database.pool, {
      name: 'ANTHROPIC_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      encryptionKey: encryptionKey(),
      actorAdminUserId: actorId
    });

    const resolved = await resolveRuntimeProviderConfig(database.pool, {
      envConfig: env()
    });

    expect(resolved.isOk()).toBe(true);
    expect(resolved._unsafeUnwrap().EXTRACTION_ENABLED).toBe(false);
    expect(resolved._unsafeUnwrap().ANTHROPIC_API_KEY).toBeUndefined();
  }, 120_000);
});

describe('admin provider config routes', () => {
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

  it('requires active admin session, CSRF, and recent step-up for secret writes and apply', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const key = encryptionKey();
    const stale = await createActiveAdminSession(database, {
      freshStepUp: false
    });
    const fresh = await createActiveAdminSession(database, {
      freshStepUp: true
    });
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    const app = createApp({
      pool: database.pool,
      adminSettingsEncryptionKey: key,
      runtimeConfig: env(),
      providerConfigDnsLookup: publicDns(),
      providerConfigFetch: fetchImpl
    });

    const missingCsrfResponse = await app.request(
      '/admin/api/provider-config',
      {
        method: 'PUT',
        headers: {
          Cookie: fresh.cookie,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          settings: {
            EXTRACTION_ENABLED: true
          }
        })
      }
    );
    expect(missingCsrfResponse.status).toBe(403);

    const staleSecretResponse = await app.request(
      '/admin/api/provider-config/secrets',
      {
        method: 'POST',
        headers: {
          Cookie: stale.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': stale.csrfToken
        },
        body: JSON.stringify({
          name: 'EXTRACTION_API_KEY',
          plaintext: SECRET_PLAINTEXT
        })
      }
    );
    expect(staleSecretResponse.status).toBe(403);

    const secretResponse = await app.request(
      '/admin/api/provider-config/secrets',
      {
        method: 'PUT',
        headers: {
          Cookie: fresh.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': fresh.csrfToken
        },
        body: JSON.stringify({
          name: 'EXTRACTION_API_KEY',
          plaintext: SECRET_PLAINTEXT
        })
      }
    );
    const secretBody: unknown = await secretResponse.json();
    expect(secretResponse.status).toBe(200);
    expect(secretBody).toMatchObject({
      secret: {
        name: 'EXTRACTION_API_KEY',
        configured: true,
        validation: {
          metadata: {}
        }
      }
    });
    assertNoSecretLeak(secretBody);

    await app.request('/admin/api/provider-config', {
      method: 'PUT',
      headers: {
        Cookie: fresh.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': fresh.csrfToken
      },
      body: JSON.stringify({
        settings: {
          EXTRACTION_ENABLED: true,
          EXTRACTION_PROVIDER: 'openai-compatible',
          EXTRACTION_BASE_URL: 'https://public.example.test/v1'
        }
      })
    });

    const staleValidateResponse = await app.request(
      '/admin/api/provider-config/validate',
      {
        method: 'POST',
        headers: {
          Cookie: stale.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': stale.csrfToken
        },
        body: JSON.stringify({
          testConnections: true
        })
      }
    );
    expect(staleValidateResponse.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();

    const validateResponse = await app.request(
      '/admin/api/provider-config/validate',
      {
        method: 'POST',
        headers: {
          Cookie: fresh.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': fresh.csrfToken
        },
        body: JSON.stringify({
          testConnections: true
        })
      }
    );
    expect(validateResponse.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://public.example.test/v1/models',
      expect.objectContaining({
        redirect: 'manual'
      })
    );

    const staleApplyResponse = await app.request(
      '/admin/api/provider-config/apply',
      {
        method: 'POST',
        headers: {
          Cookie: stale.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': stale.csrfToken
        },
        body: JSON.stringify({})
      }
    );
    expect(staleApplyResponse.status).toBe(403);

    const applyResponse = await app.request(
      '/admin/api/provider-config/apply',
      {
        method: 'POST',
        headers: {
          Cookie: fresh.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': fresh.csrfToken
        },
        body: JSON.stringify({})
      }
    );
    expect(applyResponse.status).toBe(200);

    const audit = await database.pool.query<{
      admin_user_id: string | null;
      operation: string;
    }>(
      `
        SELECT admin_user_id, operation
        FROM audit_log
        WHERE operation IN ('admin.secrets.save', 'admin.provider_config.apply')
        ORDER BY timestamp ASC
      `
    );
    expect(audit.rows).toEqual([
      {
        admin_user_id: fresh.adminUserId,
        operation: 'admin.secrets.save'
      },
      {
        admin_user_id: fresh.adminUserId,
        operation: 'admin.provider_config.apply'
      }
    ]);
  }, 120_000);

  it('rejects ordinary API-key bearer credentials for provider config APIs', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      adminSettingsEncryptionKey: encryptionKey(),
      runtimeConfig: env()
    });
    const apiKey = (
      await createKey(database.pool, {
        name: 'ordinary-provider-config-denial',
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

    const response = await app.request('/admin/api/provider-config', {
      headers: {
        Authorization: `Bearer ${apiKey.plaintextKey}`
      }
    });
    expect(response.status).toBe(401);
  }, 120_000);
});
