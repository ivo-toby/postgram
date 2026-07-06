import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createAdminUser
} from '../../src/auth/admin-service.js';
import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  completeAdminJob,
  createAdminJob,
  getAdminJob,
  listAdminJobs,
  requestAdminJobCancel,
  startAdminJob,
  updateAdminJobProgress
} from '../../src/services/admin-job-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';
const SECRET_PLAINTEXT = 'sk-job-foundation-secret-value-must-not-leak';
const SECRET_PREFIX = SECRET_PLAINTEXT.slice(0, 12);

async function createActor(database: TestDatabase): Promise<string> {
  const user = (
    await createAdminUser(database.pool, {
      email: `job-${crypto.randomUUID()}@example.com`,
      password: STRONG_PASSWORD
    })
  )._unsafeUnwrap();

  await database.pool.query(
    "UPDATE admin_users SET status = 'active' WHERE id = $1",
    [user.id]
  );

  return user.id;
}

async function createAdminCookie(
  database: TestDatabase,
  input: { active: boolean; mfaVerified: boolean }
): Promise<string> {
  const user = (
    await createAdminUser(database.pool, {
      email: `route-job-${crypto.randomUUID()}@example.com`,
      password: STRONG_PASSWORD
    })
  )._unsafeUnwrap();

  if (input.active) {
    await database.pool.query(
      "UPDATE admin_users SET status = 'active' WHERE id = $1",
      [user.id]
    );
  }

  const session = (
    await createAdminSession(database.pool, {
      adminUserId: user.id,
      ttlMs: 60 * 60 * 1000,
      mfaVerified: input.mfaVerified
    })
  )._unsafeUnwrap();

  return `pgm_admin_session=${session.plaintextToken}`;
}

function expectNoSecretLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SECRET_PLAINTEXT);
  expect(serialized).not.toContain(SECRET_PREFIX);
  expect(serialized).not.toContain('Bearer');
  expect(serialized).not.toContain('ciphertext');
  expect(serialized).not.toContain('tokenPrefix');
  expect(serialized).not.toContain('validationMetadata');
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(response.headers.get('Vary')).toBe('Cookie');
}

describe('admin-job-service', () => {
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

  it('persists an idempotent apply job and records audited lifecycle transitions', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const created = await createAdminJob(database.pool, {
      operation: 'embeddings.migrate',
      mode: 'apply',
      idempotencyKey: 'embeddings-migrate:active-model',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      },
      requestedScope: {
        settingKeys: ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL'],
        secretNames: ['OPENAI_API_KEY']
      },
      requestSummary: {
        dryRun: false,
        confirmation: 'operator-confirmed',
        restartRequired: true
      },
      now: new Date('2026-07-06T12:00:00.000Z')
    });

    expect(created.isOk()).toBe(true);
    expect(created._unsafeUnwrap()).toMatchObject({
      created: true,
      job: {
        operation: 'embeddings.migrate',
        mode: 'apply',
        status: 'queued',
        createdByAdminUserId: actorId,
        requestedScope: {
          settingKeys: ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL'],
          secretNames: ['OPENAI_API_KEY']
        },
        requestSummary: {
          dryRun: false,
          confirmation: 'operator-confirmed',
          restartRequired: true
        },
        progress: {
          current: 0,
          total: null,
          message: null
        }
      }
    });
    expectNoSecretLeak(created._unsafeUnwrap());

    const duplicate = await createAdminJob(database.pool, {
      operation: 'embeddings.migrate',
      mode: 'apply',
      idempotencyKey: 'embeddings-migrate:active-model',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      },
      requestedScope: {
        settingKeys: ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL'],
        secretNames: ['OPENAI_API_KEY']
      },
      requestSummary: {
        dryRun: false,
        confirmation: 'operator-confirmed',
        restartRequired: true
      }
    });

    expect(duplicate.isOk()).toBe(true);
    expect(duplicate._unsafeUnwrap()).toMatchObject({
      created: false,
      job: {
        id: created._unsafeUnwrap().job.id,
        status: 'queued'
      }
    });

    const started = await startAdminJob(database.pool, {
      jobId: created._unsafeUnwrap().job.id,
      actorAdminUserId: actorId,
      now: new Date('2026-07-06T12:01:00.000Z')
    });
    expect(started.isOk()).toBe(true);
    expect(started._unsafeUnwrap()).toMatchObject({
      status: 'running',
      startedAt: '2026-07-06T12:01:00.000Z'
    });

    const progressed = await updateAdminJobProgress(database.pool, {
      jobId: created._unsafeUnwrap().job.id,
      actorAdminUserId: actorId,
      progress: {
        current: 3,
        total: 10,
        message: 'Rebuilding vectors'
      },
      now: new Date('2026-07-06T12:02:00.000Z')
    });
    expect(progressed.isOk()).toBe(true);
    expect(progressed._unsafeUnwrap().progress).toEqual({
      current: 3,
      total: 10,
      message: 'Rebuilding vectors'
    });

    const completed = await completeAdminJob(database.pool, {
      jobId: created._unsafeUnwrap().job.id,
      actorAdminUserId: actorId,
      status: 'succeeded',
      resultSummary: {
        status: 'operator-summary',
        job_id: 'summary-job-id',
        processed: 10,
        failed: 0,
        restartRequired: true
      },
      now: new Date('2026-07-06T12:03:00.000Z')
    });
    expect(completed.isOk()).toBe(true);
    expect(completed._unsafeUnwrap()).toMatchObject({
      status: 'succeeded',
      finishedAt: '2026-07-06T12:03:00.000Z',
      resultSummary: {
        status: 'operator-summary',
        job_id: 'summary-job-id',
        processed: 10,
        failed: 0,
        restartRequired: true
      }
    });

    const jobs = await listAdminJobs(database.pool, {
      status: ['succeeded'],
      limit: 10,
      offset: 0
    });
    expect(jobs.isOk()).toBe(true);
    expect(jobs._unsafeUnwrap()).toMatchObject({
      total: 1,
      items: [
        {
          id: created._unsafeUnwrap().job.id,
          status: 'succeeded'
        }
      ]
    });

    const createEvents = await database.pool.query<{
      event_type: string;
      summary: Record<string, unknown>;
    }>(
      `
        SELECT event_type, summary
        FROM admin_job_events
        WHERE job_id = $1
          AND event_type = 'create'
      `,
      [created._unsafeUnwrap().job.id]
    );
    expect(createEvents.rows).toMatchObject([
      {
        event_type: 'create',
        summary: {
          requested_scope: {
            settingKeys: ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL'],
            secretNames: ['OPENAI_API_KEY']
          },
          request_summary: {
            dryRun: false,
            confirmation: 'operator-confirmed',
            restartRequired: true
          }
        }
      }
    ]);

    const audit = await database.pool.query<{
      admin_user_id: string | null;
      operation: string;
      details: Record<string, unknown>;
    }>(
      `
        SELECT admin_user_id, operation, details
        FROM audit_log
        WHERE operation LIKE 'admin.jobs.%'
        ORDER BY timestamp ASC
      `
    );
    expect(audit.rows).toMatchObject([
      {
        admin_user_id: actorId,
        operation: 'admin.jobs.create',
        details: {
          job_id: created._unsafeUnwrap().job.id,
          job_operation: 'embeddings.migrate',
          mode: 'apply',
          status: 'queued',
          event_summary: {
            requested_scope: {
              settingKeys: ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL'],
              secretNames: ['OPENAI_API_KEY']
            },
            request_summary: {
              dryRun: false,
              confirmation: 'operator-confirmed',
              restartRequired: true
            }
          }
        }
      },
      {
        admin_user_id: actorId,
        operation: 'admin.jobs.start'
      },
      {
        admin_user_id: actorId,
        operation: 'admin.jobs.progress'
      },
      {
        admin_user_id: actorId,
        operation: 'admin.jobs.succeed',
        details: {
          job_id: created._unsafeUnwrap().job.id,
          status: 'succeeded',
          result_summary: {
            status: 'operator-summary',
            job_id: 'summary-job-id',
            processed: 10,
            failed: 0,
            restartRequired: true
          }
        }
      }
    ]);
    expectNoSecretLeak(audit.rows);

    const persistedCount = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_jobs'
    );
    expect(persistedCount.rows[0]?.count).toBe('1');
  }, 120_000);

  it('enforces active MFA, recent step-up for apply jobs, legal transitions, and safe summaries', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);

    const noMfa = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'dry_run',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: false,
        stepUpFresh: false
      }
    });
    expect(noMfa.isErr()).toBe(true);
    expect(noMfa._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.FORBIDDEN
    });

    const staleStepUp = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'apply',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: false
      }
    });
    expect(staleStepUp.isErr()).toBe(true);
    expect(staleStepUp._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.FORBIDDEN
    });

    const missingApplyIdempotencyKey = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'apply',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      }
    });
    expect(missingApplyIdempotencyKey.isErr()).toBe(true);
    expect(missingApplyIdempotencyKey._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        field: 'idempotencyKey'
      }
    });

    const unsafeApplyIdempotencyKey = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'apply',
      idempotencyKey: `memory:${SECRET_PLAINTEXT}`,
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      }
    });
    expect(unsafeApplyIdempotencyKey.isErr()).toBe(true);
    expect(unsafeApplyIdempotencyKey._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        field: 'idempotencyKey'
      }
    });

    const unsafePayload = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'dry_run',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: false
      },
      requestSummary: {
        authorization: `Bearer ${SECRET_PLAINTEXT}`,
        validationMetadata: {
          tokenPrefix: SECRET_PREFIX
        }
      }
    });
    expect(unsafePayload.isErr()).toBe(true);
    expect(unsafePayload._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION
    });

    const genericSecretPayload = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'dry_run',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: false
      },
      requestSummary: {
        providerSecret: 'opaque-provider-secret'
      }
    });
    expect(genericSecretPayload.isErr()).toBe(true);
    expect(genericSecretPayload._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION
    });

    const nestedProviderMetadata = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'dry_run',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: false
      },
      requestSummary: {
        validation: {
          metadata: {
            raw: 'provider-supplied metadata'
          }
        },
        provider: {
          response: {
            body: 'provider body'
          }
        }
      }
    });
    expect(nestedProviderMetadata.isErr()).toBe(true);
    expect(nestedProviderMetadata._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        reason: 'sensitive_field'
      }
    });

    const providerContainerPayload = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'dry_run',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: false
      },
      requestSummary: {
        provider: {
          metadata: {
            raw: 'provider-supplied metadata'
          }
        }
      }
    });
    expect(providerContainerPayload.isErr()).toBe(true);
    expect(providerContainerPayload._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        reason: 'sensitive_field'
      }
    });

    const providerBodyPayload = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'dry_run',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: false
      },
      requestSummary: {
        provider: {
          body: 'provider response body'
        }
      }
    });
    expect(providerBodyPayload.isErr()).toBe(true);
    expect(providerBodyPayload._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        reason: 'sensitive_field'
      }
    });

    const unsafeReferencePayload = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'dry_run',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: false
      },
      requestedScope: {
        secretNames: ['plain-prod-password']
      }
    });
    expect(unsafeReferencePayload.isErr()).toBe(true);
    expect(unsafeReferencePayload._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION,
      details: {
        reason: 'invalid_reference'
      }
    });

    const safeJob = (
      await createAdminJob(database.pool, {
        operation: 'memory.groom',
        mode: 'dry_run',
        actorAdminUserId: actorId,
        authorization: {
          activeMfa: true,
          stepUpFresh: false
        }
      })
    )._unsafeUnwrap().job;

    const unsafeResult = await completeAdminJob(database.pool, {
      jobId: safeJob.id,
      actorAdminUserId: actorId,
      status: 'succeeded',
      resultSummary: {
        ciphertext: SECRET_PLAINTEXT
      }
    });
    expect(unsafeResult.isErr()).toBe(true);
    expect(unsafeResult._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.VALIDATION
    });

    const missingTransition = await updateAdminJobProgress(database.pool, {
      jobId: safeJob.id,
      actorAdminUserId: actorId,
      progress: {
        current: 1
      }
    });
    expect(missingTransition.isErr()).toBe(true);
    expect(missingTransition._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.CONFLICT
    });

    const persisted = await getAdminJob(database.pool, safeJob.id);
    expect(persisted.isOk()).toBe(true);
    expect(persisted._unsafeUnwrap()).toMatchObject({
      status: 'queued',
      resultSummary: {}
    });
    expectNoSecretLeak(persisted._unsafeUnwrap());
  }, 120_000);

  it('treats idempotency keys as bound to the original request shape', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const created = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'apply',
      idempotencyKey: 'maintenance:batch-1',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      },
      requestedScope: {
        clientScope: 'personal'
      }
    });
    expect(created.isOk()).toBe(true);
    const createdJob = created._unsafeUnwrap().job;

    const mismatchedOperation = await createAdminJob(database.pool, {
      operation: 'memory.apply_durable_grooming',
      mode: 'apply',
      idempotencyKey: 'maintenance:batch-1',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      },
      requestedScope: {
        clientScope: 'personal'
      }
    });
    expect(mismatchedOperation.isErr()).toBe(true);
    expect(mismatchedOperation._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.CONFLICT
    });

    const mismatchedScope = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'apply',
      idempotencyKey: 'maintenance:batch-1',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      },
      requestedScope: {
        clientScope: 'work'
      }
    });
    expect(mismatchedScope.isErr()).toBe(true);
    expect(mismatchedScope._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.CONFLICT
    });

    const started = await startAdminJob(database.pool, {
      jobId: createdJob.id,
      actorAdminUserId: actorId
    });
    expect(started.isOk()).toBe(true);
    const completed = await completeAdminJob(database.pool, {
      jobId: createdJob.id,
      actorAdminUserId: actorId,
      status: 'succeeded',
      resultSummary: {
        changedCount: 1
      }
    });
    expect(completed.isOk()).toBe(true);

    const retryAfterCompletion = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'apply',
      idempotencyKey: 'maintenance:batch-1',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      },
      requestedScope: {
        clientScope: 'personal'
      }
    });
    expect(retryAfterCompletion.isOk()).toBe(true);
    expect(retryAfterCompletion._unsafeUnwrap()).toMatchObject({
      created: false,
      job: {
        id: createdJob.id,
        status: 'succeeded'
      }
    });

    const terminalMismatchedScope = await createAdminJob(database.pool, {
      operation: 'memory.groom',
      mode: 'apply',
      idempotencyKey: 'maintenance:batch-1',
      actorAdminUserId: actorId,
      authorization: {
        activeMfa: true,
        stepUpFresh: true
      },
      requestedScope: {
        clientScope: 'shared'
      }
    });
    expect(terminalMismatchedScope.isErr()).toBe(true);
    expect(terminalMismatchedScope._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.CONFLICT
    });
  }, 120_000);

  it('records cooperative cancellation requests and final cancelled status', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const job = (
      await createAdminJob(database.pool, {
        operation: 'memory.apply_durable_grooming',
        mode: 'apply',
        idempotencyKey: 'durable-grooming:batch-1',
        actorAdminUserId: actorId,
        authorization: {
          activeMfa: true,
          stepUpFresh: true
        },
        requestedScope: {
          clientScope: 'personal',
          dryRun: false
        }
      })
    )._unsafeUnwrap().job;

    await startAdminJob(database.pool, {
      jobId: job.id,
      actorAdminUserId: actorId
    });

    const cancel = await requestAdminJobCancel(database.pool, {
      jobId: job.id,
      actorAdminUserId: actorId,
      reason: 'Operator cancelled from admin UI',
      now: new Date('2026-07-06T12:10:00.000Z')
    });
    expect(cancel.isOk()).toBe(true);
    expect(cancel._unsafeUnwrap()).toMatchObject({
      status: 'cancel_requested',
      cancelRequestedAt: '2026-07-06T12:10:00.000Z'
    });

    const cancelled = await completeAdminJob(database.pool, {
      jobId: job.id,
      actorAdminUserId: actorId,
      status: 'cancelled',
      resultSummary: {
        cancelled: true,
        processed: 2
      }
    });
    expect(cancelled.isOk()).toBe(true);
    expect(cancelled._unsafeUnwrap()).toMatchObject({
      status: 'cancelled',
      resultSummary: {
        cancelled: true,
        processed: 2
      }
    });

    const audit = await database.pool.query<{ operation: string }>(
      `
        SELECT operation
        FROM audit_log
        WHERE operation IN ('admin.jobs.cancel_request', 'admin.jobs.cancel')
        ORDER BY timestamp ASC
      `
    );
    expect(audit.rows.map((row) => row.operation)).toEqual([
      'admin.jobs.cancel_request',
      'admin.jobs.cancel'
    ]);

    const queuedJob = (
      await createAdminJob(database.pool, {
        operation: 'memory.apply_durable_grooming',
        mode: 'apply',
        idempotencyKey: 'durable-grooming:queued-cancel',
        actorAdminUserId: actorId,
        authorization: {
          activeMfa: true,
          stepUpFresh: true
        }
      })
    )._unsafeUnwrap().job;
    const queuedCancel = await requestAdminJobCancel(database.pool, {
      jobId: queuedJob.id,
      actorAdminUserId: actorId
    });
    expect(queuedCancel.isOk()).toBe(true);

    const queuedProgress = await updateAdminJobProgress(database.pool, {
      jobId: queuedJob.id,
      actorAdminUserId: actorId,
      progress: {
        current: 1,
        total: 10,
        message: 'Should not record progress before start'
      }
    });
    expect(queuedProgress.isErr()).toBe(true);
    expect(queuedProgress._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.CONFLICT
    });

    const queuedSucceeded = await completeAdminJob(database.pool, {
      jobId: queuedJob.id,
      actorAdminUserId: actorId,
      status: 'succeeded'
    });
    expect(queuedSucceeded.isErr()).toBe(true);
    expect(queuedSucceeded._unsafeUnwrapErr()).toMatchObject({
      code: ErrorCode.CONFLICT
    });

    const queuedCancelled = await completeAdminJob(database.pool, {
      jobId: queuedJob.id,
      actorAdminUserId: actorId,
      status: 'cancelled',
      resultSummary: {
        cancelledBeforeStart: true
      }
    });
    expect(queuedCancelled.isOk()).toBe(true);
    expect(queuedCancelled._unsafeUnwrap()).toMatchObject({
      status: 'cancelled',
      startedAt: null,
      resultSummary: {
        cancelledBeforeStart: true
      }
    });
  }, 120_000);

  it('exposes read-only job status routes behind active-MFA admin sessions', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const app = createApp({ pool: database.pool });
    const activeCookie = await createAdminCookie(database, {
      active: true,
      mfaVerified: true
    });
    const pendingCookie = await createAdminCookie(database, {
      active: false,
      mfaVerified: false
    });
    const job = (
      await createAdminJob(database.pool, {
        operation: 'link-neighbors',
        mode: 'dry_run',
        actorAdminUserId: actorId,
        authorization: {
          activeMfa: true,
          stepUpFresh: false
        },
        requestedScope: {
          entityTypes: ['memory'],
          limit: 100
        }
      })
    )._unsafeUnwrap().job;

    const detailResponse = await app.request(`/admin/api/jobs/${job.id}`, {
      headers: {
        Cookie: activeCookie
      }
    });
    const detailBody = (await detailResponse.json()) as {
      job: {
        id: string;
        operation: string;
        status: string;
      };
    };
    expect(detailResponse.status).toBe(200);
    expectPrivateNoStore(detailResponse);
    expect(detailBody.job).toMatchObject({
      id: job.id,
      operation: 'link-neighbors',
      status: 'queued'
    });
    expectNoSecretLeak(detailBody);

    const listResponse = await app.request('/admin/api/jobs?status=queued', {
      headers: {
        Cookie: activeCookie
      }
    });
    const listBody = (await listResponse.json()) as {
      jobs: Array<{ id: string }>;
      total: number;
    };
    expect(listResponse.status).toBe(200);
    expect(listBody.total).toBe(1);
    expect(listBody.jobs.map((item) => item.id)).toEqual([job.id]);

    const pendingResponse = await app.request(`/admin/api/jobs/${job.id}`, {
      headers: {
        Cookie: pendingCookie
      }
    });
    expect(pendingResponse.status).toBe(403);

    const apiKey = (
      await createKey(database.pool, {
        name: 'ordinary-job-route-denial',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work', 'personal']
      })
    )._unsafeUnwrap();
    const bearerResponse = await app.request(`/admin/api/jobs/${job.id}`, {
      headers: {
        Authorization: `Bearer ${apiKey.plaintextKey}`
      }
    });
    expect(bearerResponse.status).toBe(401);
  }, 120_000);
});
