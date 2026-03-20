import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createKey,
  revokeKey,
  validateKey
} from '../../src/auth/key-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

describe('key-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('creates hashed API keys and validates them by prefix', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const result = await createKey(database.pool, {
      name: 'agent-alpha',
      scopes: ['read', 'write'],
      allowedTypes: ['memory'],
      allowedVisibility: ['shared']
    });

    expect(result.isOk()).toBe(true);

    const created = result._unsafeUnwrap();
    expect(created.plaintextKey).toMatch(/^pgm-agent-alpha-/);
    expect(created.record.keyHash).not.toContain(created.plaintextKey);
    expect(created.record.keyPrefix).toBe(created.plaintextKey.slice(0, 8));

    const validated = await validateKey(database.pool, created.plaintextKey);
    expect(validated.isOk()).toBe(true);
    expect(validated._unsafeUnwrap()).toMatchObject({
      apiKeyId: created.record.id,
      keyName: 'agent-alpha',
      scopes: ['read', 'write'],
      allowedTypes: ['memory'],
      allowedVisibility: ['shared']
    });
  }, 120_000);

  it('rejects revoked keys', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = (await createKey(database.pool, {
      name: 'agent-beta',
      scopes: ['read'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();

    const revoked = await revokeKey(database.pool, created.record.id);
    expect(revoked.isOk()).toBe(true);

    const validated = await validateKey(database.pool, created.plaintextKey);
    expect(validated.isErr()).toBe(true);
    expect(validated._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
  }, 120_000);
});
