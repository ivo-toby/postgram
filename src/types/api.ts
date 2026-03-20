import type { ErrorCode } from '../util/errors.js';

export type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
};
