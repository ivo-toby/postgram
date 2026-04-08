// Standalone error types for the CLI package.
// This breaks the circular dependency that exists in the server package
// between src/util/errors.ts and src/types/api.ts.

export enum ErrorCode {
  VALIDATION = 'VALIDATION',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  INTERNAL = 'INTERNAL'
}

export type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
};

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

export function toErrorResponse(error: AppError): ErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  };
}