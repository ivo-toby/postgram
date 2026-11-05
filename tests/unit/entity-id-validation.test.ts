import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import type { AuthContext } from '../../src/auth/types.js';
import { recallEntity } from '../../src/services/entity-service.js';
import { ErrorCode } from '../../src/util/errors.js';

const auth: AuthContext = {
  apiKeyId: '00000000-0000-0000-0000-000000000105',
  keyName: 'recall-key',
  clientId: 'recall-key',
  scopes: ['read'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

describe('recallEntity id validation', () => {
  it('rejects a short or malformed id as a validation error without querying', async () => {
    const query = vi.fn(() => Promise.reject(new Error('invalid input syntax for type uuid')));
    const pool = { query } as unknown as Pool;

    const result = await recallEntity(pool, auth, '9d35e241');

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(ErrorCode.VALIDATION);
    expect(error.message).toMatch(/full UUID/);
    expect(query).not.toHaveBeenCalled();
  });
});
