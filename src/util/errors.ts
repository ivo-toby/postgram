import type { ErrorResponse } from '../types/api.js';

export enum ErrorCode {
  VALIDATION = 'VALIDATION',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  INTERNAL = 'INTERNAL'
}

export class AppError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function toHttpStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.VALIDATION:
      return 400;
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.FORBIDDEN:
      return 403;
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.CONFLICT:
      return 409;
    case ErrorCode.EMBEDDING_FAILED:
      return 502;
    case ErrorCode.INTERNAL:
      return 500;
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, error.message);
  }

  return new AppError(ErrorCode.INTERNAL, 'Unexpected server error');
}

export function toErrorResponse(error: AppError): ErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  };
}
