// Shared MCP tool result helpers (moved from mcp.ts so the workspace tool
// file can reuse them; D11).
import { z } from 'zod';

import type { ServiceResult } from '../types/common.js';
import type { AppError } from '../util/errors.js';
import { toErrorResponse } from '../util/errors.js';

export type ToolPayload = Record<string, unknown>;

export const boolishSchema = () =>
  z.preprocess((value) => {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return value;
  }, z.boolean());

export const fullResponseSchema = boolishSchema()
  .optional()
  .describe(
    'If true, return the full legacy JSON response. Defaults to compact output for lower agent token use.'
  );

export function toToolSuccess(payload: ToolPayload) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload)
      }
    ],
    structuredContent: payload
  };
}

export function toToolError(error: AppError) {
  const payload = toErrorResponse(error);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload)
      }
    ],
    structuredContent: payload,
    isError: true
  };
}

export async function toolFromService<T, P extends ToolPayload>(
  result: ServiceResult<T>,
  map: (value: T) => P,
  renderSuccess: (payload: P) => ReturnType<typeof toToolSuccess> = toToolSuccess
) {
  return result.match(
    (value) => renderSuccess(map(value)),
    (error) => toToolError(error)
  );
}
