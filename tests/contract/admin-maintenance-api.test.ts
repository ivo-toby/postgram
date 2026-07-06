import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBootstrapToken } from '../../src/auth/admin-service.js';
import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { requestAdminJobCancel } from '../../src/services/admin-job-service.js';
import { chunkText } from '../../src/services/chunking-service.js';
import {
  createEmbeddingService,
  vectorToSql
} from '../../src/services/embedding-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
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
  adminUserId: string;
  cookie: string;
  csrfToken: string;
  sessionId: string;
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
  const verifyBody = (await verifyResponse.json()) as {
    user: { id: string };
    session: { id: string };
  };
  expect(verifyResponse.status).toBe(200);

  return {
    app: setup.app,
    adminUserId: verifyBody.user.id,
    cookie: setup.cookie,
    csrfToken: setup.csrfToken,
    sessionId: verifyBody.session.id
  };
}

function makeAuthContext(apiKeyId: string): AuthContext {
  return {
    apiKeyId,
    keyName: 'admin-maintenance-seed',
    clientId: 'admin-maintenance-seed',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

async function seedChunkedMemory(
  database: TestDatabase,
  input: { content: string; status?: 'completed' | 'failed' }
): Promise<string> {
  const apiKey = (
    await createKey(database.pool, {
      name: `maintenance-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    })
  )._unsafeUnwrap();
  const stored = (
    await storeEntity(database.pool, makeAuthContext(apiKey.record.id), {
      type: 'memory',
      content: input.content
    })
  )._unsafeUnwrap();
  const embeddingService = createEmbeddingService();
  const chunks = chunkText(input.content);
  const model = await database.pool.query<{ id: string }>(
    'SELECT id FROM embedding_models WHERE is_active = true LIMIT 1'
  );
  const modelId = model.rows[0]?.id;
  if (!modelId) {
    throw new Error('Missing active embedding model');
  }
  const embeddings = await embeddingService.embedBatch(
    chunks.map((chunk) => chunk.content)
  );
  for (const chunk of chunks) {
    const embedding = embeddings[chunk.chunkIndex];
    if (!embedding) {
      throw new Error('Missing test embedding');
    }
    await database.pool.query(
      `
        INSERT INTO chunks (entity_id, chunk_index, content, embedding, model_id, token_count)
        VALUES ($1, $2, $3, $4::vector, $5, $6)
      `,
      [
        stored.id,
        chunk.chunkIndex,
        chunk.content,
        vectorToSql(embedding),
        modelId,
        chunk.tokenCount
      ]
    );
  }
  await database.pool.query(
    'UPDATE entities SET enrichment_status = $2 WHERE id = $1',
    [stored.id, input.status ?? 'completed']
  );
  return stored.id;
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(response.headers.get('Vary')).toBe('Cookie');
}

function expectNoMaintenanceSecretLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('sk-');
  expect(serialized).not.toContain('Bearer');
  expect(serialized).not.toContain('ciphertext');
  expect(serialized).not.toContain('tokenPrefix');
  expect(serialized).not.toContain('validationMetadata');
  expect(serialized).not.toContain('providerResponse');
}

type MaintenanceJobResponse = {
  id: string;
  status: string;
  requestSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
};

async function waitForMaintenanceJob(input: {
  app: ReturnType<typeof createApp>;
  cookie: string;
  jobId: string;
}): Promise<MaintenanceJobResponse> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await input.app.request(`/admin/api/jobs/${input.jobId}`, {
      headers: {
        Cookie: input.cookie
      }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { job: MaintenanceJobResponse };
    if (['succeeded', 'failed', 'cancelled'].includes(body.job.status)) {
      return body.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for maintenance job ${input.jobId}`);
}

describe('admin maintenance API', () => {
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

  it('previews and applies re-extraction through admin jobs with explicit scope, step-up, and audit', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    const apiKey = (
      await createKey(database.pool, {
        name: `maintenance-reextract-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete']
      })
    )._unsafeUnwrap();
    const failed = (
      await storeEntity(database.pool, makeAuthContext(apiKey.record.id), {
        type: 'memory',
        content: 'failed extraction entity'
      })
    )._unsafeUnwrap();
    const completed = (
      await storeEntity(database.pool, makeAuthContext(apiKey.record.id), {
        type: 'memory',
        content: 'completed extraction entity'
      })
    )._unsafeUnwrap();
    const failedTask = (
      await storeEntity(database.pool, makeAuthContext(apiKey.record.id), {
        type: 'task',
        content: 'failed task extraction entity'
      })
    )._unsafeUnwrap();
    await database.pool.query(
      `
        UPDATE entities
        SET extraction_status = 'failed',
            extraction_error = 'provider said sk-should-not-leak'
        WHERE id = ANY($1)
      `,
      [[failed.id, failedTask.id]]
    );
    await database.pool.query(
      "UPDATE entities SET extraction_status = 'completed' WHERE id = $1",
      [completed.id]
    );
    await database.pool.query(
      `
        INSERT INTO edges (source_id, target_id, relation, source, confidence)
        VALUES ($1, $2, 'related_to', 'llm-extraction', 0.7)
      `,
      [failed.id, completed.id]
    );

    const previewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          limit: 5,
          cleanEdges: true,
          showSkipped: true
        })
      }
    );
    const previewBody = (await previewResponse.json()) as {
      operation: 'reextract';
      dryRun: true;
      job: {
        id: string;
        operation: string;
        mode: string;
        status: string;
      };
      metadata: Record<string, unknown>;
    };
    expect(previewResponse.status).toBe(202);
    expectPrivateNoStore(previewResponse);
    expect(previewBody.operation).toBe('reextract');
    expect(previewBody.dryRun).toBe(true);
    expect(previewBody.metadata).toMatchObject({
      destructive: false,
      llmCost: true,
      requiresStepUp: false
    });
    expect(previewBody.job).toMatchObject({
      operation: 'maintenance.reextract',
      mode: 'dry_run',
      status: 'running'
    });
    const previewJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: previewBody.job.id
    });
    expect(previewJob).toMatchObject({
      status: 'succeeded'
    });
    expect(previewJob.resultSummary).toMatchObject({
      wouldMark: 1,
      wouldDeleteEdges: 1,
      scope: {
        kind: 'type',
        type: 'memory',
        onlyFailed: true,
        limit: 5,
        cleanEdges: true
      },
      implications: {
        llmCost: true,
        destructive: true,
        clearsExtractionErrors: true
      }
    });
    expect(previewJob.requestSummary).toMatchObject(previewBody.metadata);
    expectNoMaintenanceSecretLeak(previewBody);
    expectNoMaintenanceSecretLeak(previewJob);

    await database.pool.query(
      `
        UPDATE admin_sessions
        SET mfa_verified_at = now() - interval '11 minutes'
        WHERE id = $1
      `,
      [admin.sessionId]
    );
    const staleApplyResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          cleanEdges: true,
          showSkipped: true,
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-reextract:stale'
        })
      }
    );
    expect(staleApplyResponse.status).toBe(403);

    await database.pool.query(
      "UPDATE admin_sessions SET mfa_verified_at = now() - interval '1 second' WHERE id = $1",
      [admin.sessionId]
    );
    const mismatchedPreviewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          cleanEdges: true,
          noEdgesOnly: true,
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-reextract:mismatched-preview'
        })
      }
    );
    expect(mismatchedPreviewResponse.status).toBe(403);

    const guardedPreviewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          cleanEdges: true,
          noEdgesOnly: true
        })
      }
    );
    const guardedPreviewBody = (await guardedPreviewResponse.json()) as {
      job: { id: string; status: string };
    };
    expect(guardedPreviewResponse.status).toBe(202);
    const guardedPreviewJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: guardedPreviewBody.job.id
    });
    expect(guardedPreviewJob.resultSummary).toMatchObject({
      wouldMark: 0,
      wouldDeleteEdges: 0
    });

    const guardedApplyResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          cleanEdges: true,
          noEdgesOnly: true,
          previewJobId: guardedPreviewBody.job.id,
          idempotencyKey: 'maintenance-reextract:no-edges-only'
        })
      }
    );
    const guardedApplyBody = (await guardedApplyResponse.json()) as {
      job: { id: string; status: string };
    };
    expect(guardedApplyResponse.status).toBe(202);
    expect(guardedApplyBody.job.status).toBe('running');
    const guardedApplyJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: guardedApplyBody.job.id
    });
    expect(guardedApplyJob.resultSummary).toMatchObject({
      markedCount: 0,
      deletedEdges: 0
    });
    const guardedEdgeCount = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edges'
    );
    expect(guardedEdgeCount.rows[0]?.count).toBe('1');

    const applyResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          limit: 5,
          cleanEdges: true,
          showSkipped: true,
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-reextract:failed-scope'
        })
      }
    );
    const applyBody = (await applyResponse.json()) as {
      operation: 'reextract';
      dryRun: false;
      job: { id: string; status: string };
      metadata: Record<string, unknown>;
    };
    expect(applyResponse.status).toBe(202);
    expect(applyBody).toMatchObject({
      operation: 'reextract',
      dryRun: false,
      job: {
        status: 'running'
      },
      metadata: {
        destructive: true,
        llmCost: true,
        requiresStepUp: true
      }
    });
    const applyJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: applyBody.job.id
    });
    expect(applyJob).toMatchObject({
      status: 'succeeded',
      resultSummary: {
        markedCount: 1,
        deletedEdges: 1
      }
    });
    expectNoMaintenanceSecretLeak(applyBody);
    expectNoMaintenanceSecretLeak(applyJob);

    const rows = await database.pool.query<{
      id: string;
      extraction_status: string | null;
      extraction_error: string | null;
    }>('SELECT id, extraction_status, extraction_error FROM entities');
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
    expect(byId[failed.id]).toMatchObject({
      extraction_status: 'pending',
      extraction_error: null
    });
    expect(byId[completed.id]?.extraction_status).toBe('completed');
    expect(byId[failedTask.id]?.extraction_status).toBe('failed');

    const edgeCount = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM edges'
    );
    expect(edgeCount.rows[0]?.count).toBe('0');

    const duplicateResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          limit: 5,
          cleanEdges: true,
          showSkipped: true,
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-reextract:failed-scope'
        })
      }
    );
    const duplicateBody = (await duplicateResponse.json()) as {
      job: { id: string; status: string };
      reused: boolean;
    };
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody).toEqual({
      job: {
        id: applyBody.job.id,
        status: 'succeeded'
      },
      reused: true
    });

    const consumedPreviewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          limit: 5,
          cleanEdges: true,
          showSkipped: true,
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-reextract:used-preview'
        })
      }
    );
    expect(consumedPreviewResponse.status).toBe(409);

    await database.pool.query(
      `
        UPDATE admin_jobs
        SET finished_at = now() - interval '11 minutes'
        WHERE id = $1
      `,
      [previewBody.job.id]
    );
    const lateDuplicateResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          limit: 5,
          cleanEdges: true,
          showSkipped: true,
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-reextract:failed-scope'
        })
      }
    );
    const lateDuplicateBody = (await lateDuplicateResponse.json()) as {
      job: { id: string; status: string };
      reused: boolean;
    };
    expect(lateDuplicateResponse.status).toBe(200);
    expect(lateDuplicateBody).toEqual({
      job: {
        id: applyBody.job.id,
        status: 'succeeded'
      },
      reused: true
    });

    const expiredPreviewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'id', id: completed.id }
        })
      }
    );
    const expiredPreviewBody = (await expiredPreviewResponse.json()) as {
      job: { id: string };
    };
    expect(expiredPreviewResponse.status).toBe(202);
    await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: expiredPreviewBody.job.id
    });
    await database.pool.query(
      `
        UPDATE admin_jobs
        SET created_at = now() - interval '12 minutes',
            finished_at = now() - interval '11 minutes'
        WHERE id = $1
      `,
      [expiredPreviewBody.job.id]
    );
    const expiredApplyResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'id', id: completed.id },
          previewJobId: expiredPreviewBody.job.id,
          idempotencyKey: 'maintenance-reextract:expired-preview'
        })
      }
    );
    expect(expiredApplyResponse.status).toBe(403);

    const concurrentPreviewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'id', id: completed.id }
        })
      }
    );
    const concurrentPreviewBody = (await concurrentPreviewResponse.json()) as {
      job: { id: string };
    };
    expect(concurrentPreviewResponse.status).toBe(202);
    await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: concurrentPreviewBody.job.id
    });
    const concurrentApplyBodies = [
      {
        scope: { kind: 'id', id: completed.id },
        previewJobId: concurrentPreviewBody.job.id,
        idempotencyKey: 'maintenance-reextract:concurrent-a'
      },
      {
        scope: { kind: 'id', id: completed.id },
        previewJobId: concurrentPreviewBody.job.id,
        idempotencyKey: 'maintenance-reextract:concurrent-b'
      }
    ];
    const concurrentApplyResponses = await Promise.all(
      concurrentApplyBodies.map(async (body) =>
        admin.app.request('/admin/api/maintenance/reextract/apply', {
          method: 'POST',
          headers: {
            Cookie: admin.cookie,
            'Content-Type': 'application/json',
            'X-CSRF-Token': admin.csrfToken
          },
          body: JSON.stringify(body)
        })
      )
    );
    expect(
      concurrentApplyResponses
        .map((response) => response.status)
        .sort((left, right) => left - right)
    ).toEqual([202, 409]);
    const acceptedConcurrentApply = concurrentApplyResponses.find(
      (response) => response.status === 202
    );
    if (!acceptedConcurrentApply) {
      throw new Error('Expected one concurrent apply to be accepted');
    }
    const acceptedConcurrentBody = (await acceptedConcurrentApply.json()) as {
      job: { id: string };
    };
    await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: acceptedConcurrentBody.job.id
    });

    const cancellablePreviewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'id', id: failedTask.id }
        })
      }
    );
    const cancellablePreviewBody = (await cancellablePreviewResponse.json()) as {
      job: { id: string };
    };
    expect(cancellablePreviewResponse.status).toBe(202);
    await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: cancellablePreviewBody.job.id
    });
    const cancellableApplyResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'id', id: failedTask.id },
          previewJobId: cancellablePreviewBody.job.id,
          idempotencyKey: 'maintenance-reextract:cancel-before-run'
        })
      }
    );
    const cancellableApplyBody = (await cancellableApplyResponse.json()) as {
      job: { id: string };
    };
    expect(cancellableApplyResponse.status).toBe(202);
    const cancelResult = await requestAdminJobCancel(database.pool, {
      jobId: cancellableApplyBody.job.id,
      actorAdminUserId: admin.adminUserId,
      reason: 'Operator cancelled before maintenance execution'
    });
    expect(cancelResult.isOk()).toBe(true);
    const cancelledJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: cancellableApplyBody.job.id
    });
    expect(cancelledJob).toMatchObject({
      status: 'cancelled',
      resultSummary: {
        cancelled: true,
        phase: 'before_execution'
      }
    });
    const cancelledEntity = await database.pool.query<{
      extraction_status: string | null;
    }>('SELECT extraction_status FROM entities WHERE id = $1', [failedTask.id]);
    expect(cancelledEntity.rows[0]?.extraction_status).toBe('failed');

    const afterExecutionPreviewResponse = await admin.app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'id', id: failedTask.id }
        })
      }
    );
    const afterExecutionPreviewBody =
      (await afterExecutionPreviewResponse.json()) as {
        job: { id: string };
      };
    expect(afterExecutionPreviewResponse.status).toBe(202);
    await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: afterExecutionPreviewBody.job.id
    });
    await database.pool.query(`
      DROP TRIGGER IF EXISTS test_cancel_reextract_after_update ON entities;
      DROP FUNCTION IF EXISTS test_cancel_reextract_after_update();
      CREATE FUNCTION test_cancel_reextract_after_update()
      RETURNS trigger AS $$
      BEGIN
        UPDATE admin_jobs
        SET status = 'cancel_requested',
            cancel_requested_at = now()
        WHERE idempotency_key = 'maintenance-reextract:cancel-after-execution'
          AND status = 'running';
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_cancel_reextract_after_update
      AFTER UPDATE OF extraction_status ON entities
      FOR EACH ROW
      WHEN (NEW.extraction_status = 'pending')
      EXECUTE FUNCTION test_cancel_reextract_after_update();
    `);
    try {
      const afterExecutionApplyResponse = await admin.app.request(
        '/admin/api/maintenance/reextract/apply',
        {
          method: 'POST',
          headers: {
            Cookie: admin.cookie,
            'Content-Type': 'application/json',
            'X-CSRF-Token': admin.csrfToken
          },
          body: JSON.stringify({
            scope: { kind: 'id', id: failedTask.id },
            previewJobId: afterExecutionPreviewBody.job.id,
            idempotencyKey: 'maintenance-reextract:cancel-after-execution'
          })
        }
      );
      const afterExecutionApplyBody =
        (await afterExecutionApplyResponse.json()) as {
          job: { id: string };
        };
      expect(afterExecutionApplyResponse.status).toBe(202);
      const completedAfterExecutionCancel = await waitForMaintenanceJob({
        app: admin.app,
        cookie: admin.cookie,
        jobId: afterExecutionApplyBody.job.id
      });
      expect(completedAfterExecutionCancel).toMatchObject({
        status: 'succeeded',
        resultSummary: {
          markedCount: 1,
          cancelRequested: true,
          cancelPhase: 'after_execution'
        }
      });
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS test_cancel_reextract_after_update ON entities;
        DROP FUNCTION IF EXISTS test_cancel_reextract_after_update();
      `);
    }

    const audit = await database.pool.query<{
      operation: string;
      admin_user_id: string | null;
      details: Record<string, unknown>;
    }>(
      `
        SELECT operation, admin_user_id, details
        FROM audit_log
        WHERE operation IN ('reextract.start', 'admin.jobs.create', 'admin.jobs.succeed')
        ORDER BY timestamp ASC
      `
    );
    const reextractAudit = audit.rows.find(
      (row) =>
        row.operation === 'reextract.start' &&
        row.details.markedCount === 1
    );
    expect(reextractAudit?.admin_user_id).toBe(admin.adminUserId);
    expect(reextractAudit?.details.markedCount).toBe(1);
    expect(reextractAudit?.details.cleanEdges).toBe(true);
    expect(reextractAudit?.details.limit).toBe(5);
    expect(reextractAudit?.details.onlyFailed).toBe(true);
    expect(
      audit.rows.some(
        (row) =>
          row.operation === 'admin.jobs.create' &&
          row.admin_user_id === admin.adminUserId
      )
    ).toBe(true);
    expect(
      audit.rows.some(
        (row) =>
          row.operation === 'admin.jobs.succeed' &&
          row.admin_user_id === admin.adminUserId
      )
    ).toBe(true);
  }, 120_000);

  it('previews and applies re-embedding with destructive metadata and chunk cleanup', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    const targetId = await seedChunkedMemory(database, {
      content: 'failed memory that will be re-embedded',
      status: 'failed'
    });
    const completedMemoryId = await seedChunkedMemory(database, {
      content: 'completed memory should be left alone'
    });
    const otherId = await seedChunkedMemory(database, {
      content: 'failed task entity should be left alone',
      status: 'failed'
    });
    await database.pool.query("UPDATE entities SET type = 'task' WHERE id = $1", [
      otherId
    ]);

    const previewResponse = await admin.app.request(
      '/admin/api/maintenance/reembed/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true
        })
      }
    );
    const previewBody = (await previewResponse.json()) as {
      job: { id: string; status: string };
      metadata: Record<string, unknown>;
    };
    expect(previewResponse.status).toBe(202);
    expect(previewBody.job.status).toBe('running');
    expect(previewBody.metadata).toMatchObject({
      destructive: false,
      providerWork: true,
      requiresStepUp: false
    });
    const previewJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: previewBody.job.id
    });
    expect(previewJob.resultSummary).toMatchObject({
      wouldMark: 1,
      scope: {
        kind: 'type',
        type: 'memory',
        onlyFailed: true
      },
      implications: {
        destructive: true,
        deletesEmbeddings: true,
        providerWork: true
      }
    });
    expect(previewJob.resultSummary.wouldDeleteChunks).toBeGreaterThan(0);

    const applyResponse = await admin.app.request(
      '/admin/api/maintenance/reembed/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          scope: { kind: 'type', type: 'memory' },
          onlyFailed: true,
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-reembed:memory'
        })
      }
    );
    const applyBody = (await applyResponse.json()) as {
      job: { id: string; status: string };
      metadata: Record<string, unknown>;
    };
    expect(applyResponse.status).toBe(202);
    expect(applyBody).toMatchObject({
      job: {
        status: 'running'
      },
      metadata: {
        destructive: true,
        providerWork: true,
        requiresStepUp: true
      }
    });
    const applyJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: applyBody.job.id
    });
    expect(applyJob).toMatchObject({
      status: 'succeeded',
      resultSummary: {
        markedCount: 1
      }
    });
    expect(applyJob.resultSummary.deletedChunks).toBeGreaterThan(0);

    const chunkRows = await database.pool.query<{ entity_id: string }>(
      'SELECT entity_id FROM chunks ORDER BY entity_id'
    );
    expect(chunkRows.rows.map((row) => row.entity_id).sort()).toEqual(
      [completedMemoryId, otherId].sort()
    );
    const entityRows = await database.pool.query<{
      id: string;
      enrichment_status: string | null;
    }>('SELECT id, enrichment_status FROM entities WHERE id = ANY($1)', [
      [targetId, completedMemoryId, otherId]
    ]);
    const byId = Object.fromEntries(entityRows.rows.map((row) => [row.id, row]));
    expect(byId[targetId]?.enrichment_status).toBe('pending');
    expect(byId[completedMemoryId]?.enrichment_status).toBe('completed');
    expect(byId[otherId]?.enrichment_status).toBe('failed');
  }, 120_000);

  it('previews and applies constrained edge pruning without exposing generic purge or SQL', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    const apiKey = (
      await createKey(database.pool, {
        name: `maintenance-prune-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete']
      })
    )._unsafeUnwrap();
    const source = (
      await storeEntity(database.pool, makeAuthContext(apiKey.record.id), {
        type: 'memory',
        content: 'source'
      })
    )._unsafeUnwrap();
    const target = (
      await storeEntity(database.pool, makeAuthContext(apiKey.record.id), {
        type: 'project',
        content: 'target'
      })
    )._unsafeUnwrap();
    await database.pool.query(
      `
        INSERT INTO edges (source_id, target_id, relation, source, confidence)
        VALUES
          ($1, $2, 'related_to', 'llm-extraction', 0.2),
          ($2, $1, 'related_to', 'manual', 0.2)
      `,
      [source.id, target.id]
    );

    const rejectedAnySourceResponse = await admin.app.request(
      '/admin/api/maintenance/prune-edges/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          below: 1,
          source: 'any'
        })
      }
    );
    expect(rejectedAnySourceResponse.status).toBe(400);

    const rejectedManualSourceApplyResponse = await admin.app.request(
      '/admin/api/maintenance/prune-edges/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          below: 1,
          source: 'manual',
          previewJobId: crypto.randomUUID(),
          idempotencyKey: 'maintenance-prune-edges:manual-source'
        })
      }
    );
    expect(rejectedManualSourceApplyResponse.status).toBe(400);

    const previewResponse = await admin.app.request(
      '/admin/api/maintenance/prune-edges/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          below: 0.4,
          source: 'llm-extraction',
          relation: 'related_to'
        })
      }
    );
    const previewBody = (await previewResponse.json()) as {
      job: { id: string; status: string };
      metadata: Record<string, unknown>;
    };
    expect(previewResponse.status).toBe(202);
    expect(previewBody.job.status).toBe('running');
    expect(previewBody.metadata).toMatchObject({
      destructive: false,
      permanentDelete: true,
      requiresStepUp: false
    });
    const previewJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: previewBody.job.id
    });
    expect(previewJob.resultSummary).toMatchObject({
      wouldDelete: 1,
      implications: {
        destructive: true,
        permanentDelete: true
      }
    });

    const applyResponse = await admin.app.request(
      '/admin/api/maintenance/prune-edges/apply',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({
          below: 0.4,
          source: 'llm-extraction',
          relation: 'related_to',
          previewJobId: previewBody.job.id,
          idempotencyKey: 'maintenance-prune-edges:related'
        })
      }
    );
    const applyBody = (await applyResponse.json()) as {
      job: { id: string; status: string };
      metadata: Record<string, unknown>;
    };
    expect(applyResponse.status).toBe(202);
    expect(applyBody).toMatchObject({
      job: {
        status: 'running'
      },
      metadata: {
        destructive: true,
        permanentDelete: true,
        requiresStepUp: true
      }
    });
    const applyJob = await waitForMaintenanceJob({
      app: admin.app,
      cookie: admin.cookie,
      jobId: applyBody.job.id
    });
    expect(applyJob).toMatchObject({
      status: 'succeeded',
      resultSummary: {
        deleted: 1
      }
    });

    const remaining = await database.pool.query<{
      source: string | null;
    }>('SELECT source FROM edges ORDER BY source');
    expect(remaining.rows).toEqual([{ source: 'manual' }]);

    const sqlResponse = await admin.app.request('/admin/api/maintenance/sql', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({ sql: 'SELECT 1' })
    });
    expect(sqlResponse.status).toBe(404);

    const purgeResponse = await admin.app.request('/admin/api/maintenance/purge', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({ all: true })
    });
    expect(purgeResponse.status).toBe(404);
  }, 120_000);

  it('preserves admin-route denial for pending-MFA sessions and ordinary bearer tokens', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const pending = await setupPendingFirstAdmin(database);
    const pendingResponse = await pending.app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Cookie: pending.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': pending.csrfToken
        },
        body: JSON.stringify({ scope: { kind: 'all' } })
      }
    );
    const pendingBody: unknown = await pendingResponse.json();
    expect(pendingResponse.status).toBe(403);
    expect(pendingBody).toMatchObject({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: 'Active admin MFA is required'
      }
    });

    await resetTestDatabase(database.pool);
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
        name: 'ordinary-maintenance-route-denial',
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

    const apiKeyResponse = await app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.plaintextKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ scope: { kind: 'all' } })
      }
    );
    expect(apiKeyResponse.status).toBe(401);

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

    const oauthResponse = await app.request(
      '/admin/api/maintenance/reextract/dry-run',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${oauthToken.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ scope: { kind: 'all' } })
      }
    );
    expect(oauthResponse.status).toBe(401);
  }, 120_000);
});
