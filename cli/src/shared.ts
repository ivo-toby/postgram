import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { AppError, ErrorCode, toErrorResponse } from './errors.js';

export type JsonMode = {
  json: boolean;
};

export function isJsonMode(command: Command): boolean {
  return Boolean(command.optsWithGlobals<JsonMode>().json);
}

export function parseCommaList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

export function parseJsonObject(
  value: string | undefined,
  fallback: Record<string, unknown> = {}
): Record<string, unknown> {
  if (value === undefined) {
    return fallback;
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(ErrorCode.VALIDATION, 'Metadata must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

export async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  return await new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

export type PgmRc = {
  api_url?: string;
  api_key?: string;
};

export type PgmConfig = {
  apiUrl: string;
  apiKey: string;
};

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function resolvePgmConfig(): Promise<PgmConfig> {
  const envUrl = process.env.PGM_API_URL;
  const envKey = process.env.PGM_API_KEY;

  if (envUrl && envKey) {
    return {
      apiUrl: normalizeUrl(envUrl),
      apiKey: envKey
    };
  }

  const rcPath = path.join(os.homedir(), '.pgmrc');
  try {
    const raw = await readFile(rcPath, 'utf8');
    const parsed = JSON.parse(raw) as PgmRc;

    if (!parsed.api_url || !parsed.api_key) {
      throw new Error('missing api_url or api_key');
    }

    return {
      apiUrl: normalizeUrl(parsed.api_url),
      apiKey: parsed.api_key
    };
  } catch (error) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'PGM_API_URL and PGM_API_KEY must be set or ~/.pgmrc must exist',
      error instanceof Error ? { cause: error.message } : {}
    );
  }
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printHuman(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function formatAppError(error: AppError): string[] {
  const payload = toErrorResponse(error);
  return [`${payload.error.code}: ${payload.error.message}`];
}

export async function handleCliFailure(
  error: unknown,
  json: boolean
): Promise<void> {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(
          ErrorCode.INTERNAL,
          error instanceof Error ? error.message : 'Unexpected CLI failure'
        );

  if (json) {
    printJson(toErrorResponse(appError));
  } else {
    printHuman(formatAppError(appError));
  }

  process.exitCode = 1;
}