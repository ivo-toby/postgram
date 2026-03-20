import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode, toHttpStatus } from '../../src/util/errors.js';

describe('toHttpStatus', () => {
  it('maps common application errors to HTTP status codes', () => {
    expect(toHttpStatus(ErrorCode.VALIDATION)).toBe(400);
    expect(toHttpStatus(ErrorCode.UNAUTHORIZED)).toBe(401);
    expect(toHttpStatus(ErrorCode.FORBIDDEN)).toBe(403);
    expect(toHttpStatus(ErrorCode.NOT_FOUND)).toBe(404);
    expect(toHttpStatus(ErrorCode.CONFLICT)).toBe(409);
    expect(toHttpStatus(ErrorCode.EMBEDDING_FAILED)).toBe(502);
    expect(toHttpStatus(ErrorCode.INTERNAL)).toBe(500);
  });
});

describe('AppError', () => {
  it('captures code, message, and optional details', () => {
    const error = new AppError(ErrorCode.VALIDATION, 'Invalid request', {
      field: 'content'
    });

    expect(error.code).toBe(ErrorCode.VALIDATION);
    expect(error.message).toBe('Invalid request');
    expect(error.details).toEqual({ field: 'content' });
  });

  it('defaults details to an empty object', () => {
    const error = new AppError(ErrorCode.INTERNAL, 'Unexpected failure');

    expect(error.details).toEqual({});
  });
});
