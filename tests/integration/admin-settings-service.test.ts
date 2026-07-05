import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAdminUser } from '../../src/auth/admin-service.js';
import {
  ADMIN_SETTINGS_HTTP_AUTHORITY_CONTRACT,
  getRuntimeSecretMetadata,
  getRuntimeSetting,
  listRuntimeSecrets,
  saveRuntimeSecret,
  saveRuntimeSetting,
  updateRuntimeSettingValidation
} from '../../src/services/admin-settings-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const SECRET_PLAINTEXT = 'sk-postgram-secret-value-must-not-leak-1234567890';
const SECRET_PREFIX = SECRET_PLAINTEXT.slice(0, 16);

function encryptionKey(): string {
  return randomBytes(32).toString('base64url');
}

async function createActor(database: TestDatabase): Promise<string> {
  const created = await createAdminUser(database.pool, {
    email: `settings-${crypto.randomUUID()}@example.com`,
    password: 'Correct-Horse-Battery-42!'
  });

  return created._unsafeUnwrap().id;
}

function assertSafeJson(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SECRET_PLAINTEXT);
  expect(serialized).not.toContain(SECRET_PREFIX);
  expect(serialized).not.toContain('ciphertext');
  expect(serialized).not.toContain('nonce');
  expect(serialized).not.toContain('authTag');
  expect(serialized).not.toContain('auth_tag');
}

describe('admin-settings-service', () => {
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

  it('persists runtime settings with validation state and admin audit metadata', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const now = new Date('2026-07-05T17:00:00.000Z');

    const saved = await saveRuntimeSetting(database.pool, {
      key: 'EXTRACTION_ENABLED',
      value: true,
      classification: 'runtime_editable',
      actorAdminUserId: actorId,
      validation: {
        status: 'valid',
        message: 'Boolean value accepted',
        metadata: { schema: 'boolean' },
        validatedAt: now
      },
      now
    });

    expect(saved.isOk()).toBe(true);
    expect(saved._unsafeUnwrap()).toMatchObject({
      key: 'EXTRACTION_ENABLED',
      value: true,
      valueType: 'boolean',
      classification: 'runtime_editable',
      state: 'pending',
      validation: {
        status: 'valid',
        message: 'Boolean value accepted',
        metadata: { schema: 'boolean' },
        validatedAt: now.toISOString()
      },
      updatedByAdminUserId: actorId
    });

    const found = await getRuntimeSetting(database.pool, 'EXTRACTION_ENABLED');
    expect(found.isOk()).toBe(true);
    expect(found._unsafeUnwrap()).toMatchObject({
      key: 'EXTRACTION_ENABLED',
      value: true,
      classification: 'runtime_editable',
      updatedByAdminUserId: actorId
    });

    const audit = await database.pool.query<{
      admin_user_id: string | null;
      operation: string;
      details: Record<string, unknown>;
    }>(
      `
        SELECT admin_user_id, operation, details
        FROM audit_log
        WHERE operation = 'admin.settings.save'
        ORDER BY timestamp DESC
        LIMIT 1
      `
    );

    expect(audit.rows[0]).toMatchObject({
      admin_user_id: actorId,
      operation: 'admin.settings.save',
      details: {
        key: 'EXTRACTION_ENABLED',
        classification: 'runtime_editable',
        state: 'pending',
        validation_status: 'valid',
        value_changed: true
      }
    });
  }, 120_000);

  it('updates validation metadata without replacing the stored setting value', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    await saveRuntimeSetting(database.pool, {
      key: 'EXTRACTION_MODEL',
      value: 'gpt-4o-mini',
      classification: 'restart_required',
      actorAdminUserId: actorId
    });

    const updated = await updateRuntimeSettingValidation(database.pool, {
      key: 'EXTRACTION_MODEL',
      status: 'invalid',
      message: 'Model is unavailable from the selected provider',
      metadata: { provider: 'openai' },
      actorAdminUserId: actorId,
      validatedAt: new Date('2026-07-05T17:05:00.000Z')
    });

    expect(updated.isOk()).toBe(true);
    expect(updated._unsafeUnwrap()).toMatchObject({
      key: 'EXTRACTION_MODEL',
      value: 'gpt-4o-mini',
      validation: {
        status: 'invalid',
        message: 'Model is unavailable from the selected provider',
        metadata: { provider: 'openai' },
        validatedAt: '2026-07-05T17:05:00.000Z'
      }
    });
  }, 120_000);

  it('stores provider secrets as encrypted write-only records and returns only redacted metadata', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();

    const saved = await saveRuntimeSecret(database.pool, {
      name: 'OPENAI_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      provider: 'openai',
      purpose: 'embedding',
      encryptionKey: key,
      actorAdminUserId: actorId,
      validation: {
        status: 'unvalidated',
        metadata: { reason: 'saved-not-tested' }
      }
    });

    expect(saved.isOk()).toBe(true);
    expect(saved._unsafeUnwrap()).toMatchObject({
      name: 'OPENAI_API_KEY',
      configured: true,
      provider: 'openai',
      purpose: 'embedding',
      validation: {
        status: 'unvalidated',
        metadata: {}
      },
      updatedByAdminUserId: actorId
    });
    assertSafeJson(saved._unsafeUnwrap());

    const metadata = await getRuntimeSecretMetadata(
      database.pool,
      'OPENAI_API_KEY'
    );
    expect(metadata.isOk()).toBe(true);
    expect(metadata._unsafeUnwrap()).toMatchObject({
      name: 'OPENAI_API_KEY',
      configured: true,
      provider: 'openai'
    });
    assertSafeJson(metadata._unsafeUnwrap());

    const listed = await listRuntimeSecrets(database.pool);
    expect(listed.isOk()).toBe(true);
    expect(listed._unsafeUnwrap()).toHaveLength(1);
    assertSafeJson(listed._unsafeUnwrap());

    const stored = await database.pool.query<{
      ciphertext: string;
      nonce: string;
      auth_tag: string;
    }>(
      `
        SELECT ciphertext, nonce, auth_tag
        FROM admin_runtime_secrets
        WHERE name = 'OPENAI_API_KEY'
      `
    );

    expect(stored.rows[0]?.ciphertext).toBeTruthy();
    expect(stored.rows[0]?.ciphertext).not.toContain(SECRET_PLAINTEXT);
    expect(stored.rows[0]?.nonce).toBeTruthy();
    expect(stored.rows[0]?.auth_tag).toBeTruthy();
  }, 120_000);

  it('does not persist or return arbitrary validation metadata for secrets', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const key = encryptionKey();
    const saved = await saveRuntimeSecret(database.pool, {
      name: 'OPENAI_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      provider: 'openai',
      purpose: 'embedding',
      encryptionKey: key,
      validation: {
        status: 'error',
        message: 'Provider validation failed',
        metadata: {
          authorization: `Bearer ${SECRET_PLAINTEXT}`,
          tokenPrefix: SECRET_PREFIX,
          providerResponse: {
            headers: {
              authorization: `Bearer ${SECRET_PLAINTEXT}`
            },
            body: {
              sample: SECRET_PREFIX
            }
          }
        }
      }
    });

    expect(saved.isOk()).toBe(true);
    expect(saved._unsafeUnwrap().validation).toMatchObject({
      status: 'error',
      message: 'Provider validation failed',
      metadata: {}
    });
    assertSafeJson(saved._unsafeUnwrap());

    const metadata = await getRuntimeSecretMetadata(
      database.pool,
      'OPENAI_API_KEY'
    );
    expect(metadata.isOk()).toBe(true);
    expect(metadata._unsafeUnwrap()?.validation.metadata).toEqual({});
    assertSafeJson(metadata._unsafeUnwrap());

    const stored = await database.pool.query<{
      validation_metadata: Record<string, unknown>;
    }>(
      `
        SELECT validation_metadata
        FROM admin_runtime_secrets
        WHERE name = 'OPENAI_API_KEY'
      `
    );
    expect(stored.rows[0]?.validation_metadata).toEqual({});
  }, 120_000);

  it('replaces secret values without leaking plaintext or reusable prefixes to audit rows', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const actorId = await createActor(database);
    const key = encryptionKey();

    await saveRuntimeSecret(database.pool, {
      name: 'ANTHROPIC_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      provider: 'anthropic',
      purpose: 'extraction',
      encryptionKey: key,
      actorAdminUserId: actorId
    });
    const replacement = await saveRuntimeSecret(database.pool, {
      name: 'ANTHROPIC_API_KEY',
      plaintext: `${SECRET_PLAINTEXT}-replacement`,
      provider: 'anthropic',
      purpose: 'extraction',
      encryptionKey: key,
      actorAdminUserId: actorId,
      keyVersion: 'v2'
    });

    expect(replacement.isOk()).toBe(true);
    expect(replacement._unsafeUnwrap()).toMatchObject({
      name: 'ANTHROPIC_API_KEY',
      configured: true,
      keyVersion: 'v2'
    });
    assertSafeJson(replacement._unsafeUnwrap());

    const audit = await database.pool.query<{
      details: Record<string, unknown>;
    }>(
      `
        SELECT details
        FROM audit_log
        WHERE operation = 'admin.secrets.save'
        ORDER BY timestamp DESC
      `
    );

    expect(audit.rows).toHaveLength(2);
    for (const row of audit.rows) {
      expect(row.details).toMatchObject({
        name: 'ANTHROPIC_API_KEY',
        configured: true,
        value_changed: true
      });
      assertSafeJson(row.details);
    }
  }, 120_000);

  it('rejects invalid setting, secret, and encryption-key input without writing rows', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const badSetting = await saveRuntimeSetting(database.pool, {
      key: 'bad lowercase key',
      value: true,
      classification: 'runtime_editable'
    });
    expect(badSetting.isErr()).toBe(true);
    expect(badSetting._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);

    const badClassification = await saveRuntimeSetting(database.pool, {
      key: 'EXTRACTION_ENABLED',
      value: true,
      classification: 'hot_reload' as never
    });
    expect(badClassification.isErr()).toBe(true);
    expect(badClassification._unsafeUnwrapErr().code).toBe(
      ErrorCode.VALIDATION
    );

    const secretSetting = await saveRuntimeSetting(database.pool, {
      key: 'OPENAI_API_KEY',
      value: SECRET_PLAINTEXT,
      classification: 'runtime_editable'
    });
    expect(secretSetting.isErr()).toBe(true);
    expect(secretSetting._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);

    const secretSettingRead = await getRuntimeSetting(
      database.pool,
      'OPENAI_API_KEY'
    );
    expect(secretSettingRead.isErr()).toBe(true);
    expect(secretSettingRead._unsafeUnwrapErr().code).toBe(
      ErrorCode.VALIDATION
    );

    const badSecret = await saveRuntimeSecret(database.pool, {
      name: 'OPENAI_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      provider: 'openai',
      purpose: 'embedding',
      encryptionKey: 'short'
    });
    expect(badSecret.isErr()).toBe(true);
    expect(badSecret._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);

    const malformedKeySecret = await saveRuntimeSecret(database.pool, {
      name: 'ANTHROPIC_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      provider: 'anthropic',
      purpose: 'extraction',
      encryptionKey: `${encryptionKey()}!`
    });
    expect(malformedKeySecret.isErr()).toBe(true);
    expect(malformedKeySecret._unsafeUnwrapErr().code).toBe(
      ErrorCode.VALIDATION
    );

    const counts = await database.pool.query<{
      settings: string;
      secrets: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM admin_runtime_settings) AS settings,
        (SELECT COUNT(*)::text FROM admin_runtime_secrets) AS secrets
    `);
    expect(counts.rows[0]).toEqual({ settings: '0', secrets: '0' });
  }, 120_000);

  it('resets runtime settings and secrets in the shared test helper', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await saveRuntimeSetting(database.pool, {
      key: 'EXTRACTION_MEMORY_MODE',
      value: 'extract_durable',
      classification: 'restart_required'
    });
    await saveRuntimeSecret(database.pool, {
      name: 'EXTRACTION_API_KEY',
      plaintext: SECRET_PLAINTEXT,
      provider: 'openai-compatible',
      purpose: 'extraction',
      encryptionKey: encryptionKey()
    });

    await resetTestDatabase(database.pool);

    const counts = await database.pool.query<{
      settings: string;
      secrets: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM admin_runtime_settings) AS settings,
        (SELECT COUNT(*)::text FROM admin_runtime_secrets) AS secrets
    `);
    expect(counts.rows[0]).toEqual({ settings: '0', secrets: '0' });
  }, 120_000);

  it('documents the future HTTP handoff to admin session, CSRF, and step-up guards', () => {
    expect(ADMIN_SETTINGS_HTTP_AUTHORITY_CONTRACT).toEqual({
      namespace: '/admin/api/*',
      ordinaryApiKeyBearer: 'rejected',
      mcpOAuthBearer: 'rejected',
      requiresAdminSessionCookie: true,
      requiresCsrfForMutations: true,
      secretWritesRequireStepUp: true
    });
  });
});
