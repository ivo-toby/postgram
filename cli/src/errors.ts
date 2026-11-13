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
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  UNAVAILABLE = 'UNAVAILABLE',
  // CLI-side outcomes of `pgm ingest --wait`; the server never sends these.
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  PROCESSING_TIMEOUT = 'PROCESSING_TIMEOUT',
  UPLOAD_INTERRUPTED = 'UPLOAD_INTERRUPTED',
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