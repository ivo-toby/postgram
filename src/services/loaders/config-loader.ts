import { readFile } from 'node:fs/promises';

import { ZodError } from 'zod';

import {
  loadersConfigSchema,
  type LoadersConfig
} from '../../types/loaders-config.js';
import { AppError, ErrorCode } from '../../util/errors.js';

/**
 * Built-in configuration used when no config file path is given. The in-process
 * PDF loader is a first-party workspace package.
 */
const DEFAULT_CONFIG_INPUT = {
  version: 1,
  loaders: [
    {
      kind: 'in-process',
      name: 'pdf',
      package: '@ivotoby/postgram-loader-pdf',
      accepts: { mimeTypes: ['application/pdf'], extensions: ['.pdf'] }
    }
  ]
};

/**
 * Load and validate the loader configuration. Without a path the built-in
 * default applies. With a path, a missing, unreadable or invalid file is an
 * error: a configured file that does not load must not silently fall back.
 */
export async function loadLoadersConfig(
  path: string | undefined
): Promise<LoadersConfig> {
  if (!path) {
    return parseLoadersConfig(structuredClone(DEFAULT_CONFIG_INPUT));
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const reason = isNoEnt(err) ? 'file not found' : (err as Error).message;
    throw new AppError(
      ErrorCode.INTERNAL,
      `failed to read loader config at ${path}: ${reason}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `loader config at ${path} is not valid JSON: ${(err as Error).message}`
    );
  }
  return parseLoadersConfig(parsed);
}

export function parseLoadersConfig(input: unknown): LoadersConfig {
  try {
    return loadersConfigSchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError(ErrorCode.VALIDATION, formatZodError(err), {
        issues: err.issues
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
  return `invalid loaders config — ${lines.join('; ')}`;
}

function isNoEnt(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
