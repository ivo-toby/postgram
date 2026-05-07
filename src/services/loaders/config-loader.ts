import { readFile } from 'node:fs/promises';

import { ZodError } from 'zod';

import {
  postgramConfigSchema,
  type PostgramConfig,
} from '../../types/postgram-config.js';
import { AppError, ErrorCode } from '../../util/errors.js';

/**
 * Load and validate `postgram.config.json`. Missing file is treated as an
 * empty (zero-loader) config — a brand-new install with no plugins still
 * needs to start.
 */
export async function loadPostgramConfig(
  path: string | undefined,
): Promise<PostgramConfig> {
  if (!path) {
    return parsePostgramConfig({ version: 1 });
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (isNoEnt(err)) {
      return parsePostgramConfig({ version: 1 });
    }
    throw new AppError(
      ErrorCode.INTERNAL,
      `failed to read postgram config at ${path}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `postgram config at ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }

  return parsePostgramConfig(parsed);
}

export function parsePostgramConfig(input: unknown): PostgramConfig {
  try {
    return postgramConfigSchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError(ErrorCode.VALIDATION, formatZodError(err), {
        issues: err.issues,
      });
    }
    throw err;
  }
}

function formatZodError(err: ZodError): string {
  const lines = err.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
  return `invalid postgram config — ${lines.join('; ')}`;
}

function isNoEnt(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
