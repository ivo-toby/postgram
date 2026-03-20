import { describe, expect, it } from 'vitest';

import {
  checkTypeAccess,
  checkVisibilityAccess,
  requireScope
} from '../../src/auth/key-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import { AppError, ErrorCode } from '../../src/util/errors.js';

function makeAuthContext(
  overrides: Partial<AuthContext> = {}
): AuthContext {
  return {
    apiKeyId: 'key-1',
    keyName: 'test-key',
    scopes: ['read', 'write'],
    allowedTypes: null,
    allowedVisibility: ['shared', 'work'],
    ...overrides
  };
}

function expectAppError(
  callback: () => void,
  code: ErrorCode
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }

  throw new Error('expected AppError to be thrown');
}

describe('requireScope', () => {
  it('allows a granted scope', () => {
    expect(() => requireScope(makeAuthContext(), 'read')).not.toThrow();
  });

  it('throws FORBIDDEN when the scope is missing', () => {
    expectAppError(
      () => requireScope(makeAuthContext({ scopes: ['read'] }), 'delete'),
      ErrorCode.FORBIDDEN
    );
  });
});

describe('checkTypeAccess', () => {
  it('allows all types when the key has no type restriction', () => {
    expect(() =>
      checkTypeAccess(makeAuthContext({ allowedTypes: null }), 'memory')
    ).not.toThrow();
  });

  it('throws FORBIDDEN when the entity type is not allowed', () => {
    expectAppError(
      () =>
        checkTypeAccess(
          makeAuthContext({ allowedTypes: ['task', 'project'] }),
          'memory'
        ),
      ErrorCode.FORBIDDEN
    );
  });
});

describe('checkVisibilityAccess', () => {
  it('allows matching visibility values', () => {
    expect(() =>
      checkVisibilityAccess(makeAuthContext(), 'shared')
    ).not.toThrow();
  });

  it('throws FORBIDDEN when the visibility is not allowed', () => {
    expectAppError(
      () =>
        checkVisibilityAccess(
          makeAuthContext({ allowedVisibility: ['shared'] }),
          'personal'
        ),
      ErrorCode.FORBIDDEN
    );
  });
});
