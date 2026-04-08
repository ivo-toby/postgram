import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, toErrorResponse } from '../../src/errors.js';

describe('AppError', () => {
  it('creates an error with code and message', () => {
    const error = new AppError(ErrorCode.VALIDATION, 'test message');
    expect(error.code).toBe(ErrorCode.VALIDATION);
    expect(error.message).toBe('test message');
    expect(error.details).toEqual({});
  });

  it('creates an error with details', () => {
    const error = new AppError(ErrorCode.INTERNAL, 'fail', { key: 'value' });
    expect(error.details).toEqual({ key: 'value' });
  });
});

describe('toErrorResponse', () => {
  it('formats error response', () => {
    const error = new AppError(ErrorCode.NOT_FOUND, 'missing', { id: 'abc' });
    const response = toErrorResponse(error);
    expect(response).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'missing',
        details: { id: 'abc' }
      }
    });
  });
});

describe('ErrorCode', () => {
  it('contains all expected codes', () => {
    expect(ErrorCode.VALIDATION).toBe('VALIDATION');
    expect(ErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCode.FORBIDDEN).toBe('FORBIDDEN');
    expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
    expect(ErrorCode.CONFLICT).toBe('CONFLICT');
    expect(ErrorCode.EMBEDDING_FAILED).toBe('EMBEDDING_FAILED');
    expect(ErrorCode.INTERNAL).toBe('INTERNAL');
  });
});