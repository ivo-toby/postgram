import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseCommaList,
  parseJsonObject,
  resolvePgmConfig,
  shortId
} from '../../src/shared.js';
import { AppError, ErrorCode } from '../../src/errors.js';

let tempHomeDir: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();

  if (tempHomeDir) {
    await rm(tempHomeDir, { recursive: true, force: true });
    tempHomeDir = undefined;
  }
});

describe('parseCommaList', () => {
  it('returns undefined for undefined input', () => {
    expect(parseCommaList(undefined)).toBeUndefined();
  });

  it('splits comma-separated values and trims whitespace', () => {
    expect(parseCommaList('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('filters empty strings', () => {
    expect(parseCommaList('a,,b')).toEqual(['a', 'b']);
  });

  it('returns undefined for all-empty result', () => {
    expect(parseCommaList(' , , ')).toBeUndefined();
  });
});

describe('parseJsonObject', () => {
  it('returns fallback for undefined', () => {
    expect(parseJsonObject(undefined)).toEqual({});
  });

  it('parses valid JSON object', () => {
    expect(parseJsonObject('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('throws for non-object JSON', () => {
    expect(() => parseJsonObject('[1,2]')).toThrow(AppError);
  });

  it('throws for invalid JSON', () => {
    expect.assertions(4);

    try {
      parseJsonObject('not json');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.VALIDATION);
      expect((error as AppError).message).toContain('Invalid JSON:');
      expect((error as AppError).message).toContain(
        'Unexpected token'
      );
    }
  });
});

describe('shortId', () => {
  it('returns first 8 characters', () => {
    expect(shortId('abcdefgh-1234-5678')).toBe('abcdefgh');
  });
});

describe('resolvePgmConfig', () => {
  it('warns when ~/.pgmrc has insecure permissions', async () => {
    vi.stubEnv('PGM_API_URL', '');
    vi.stubEnv('PGM_API_KEY', '');
    tempHomeDir = await mkdtemp(path.join(os.tmpdir(), 'pgmrc-test-'));
    const rcPath = path.join(tempHomeDir, '.pgmrc');

    await writeFile(
      rcPath,
      JSON.stringify({
        api_url: 'http://localhost:3100/',
        api_key: 'secret-key'
      })
    );
    await chmod(rcPath, 0o644);

    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockReturnValue(true);

    const config = await resolvePgmConfig(tempHomeDir);

    expect(config).toEqual({
      apiUrl: 'http://localhost:3100',
      apiKey: 'secret-key'
    });
    expect(stderrWrite).toHaveBeenCalledWith(
      "Warning: ~/.pgmrc is accessible by other users. Run 'chmod 600 ~/.pgmrc' to fix.\n"
    );
  });

  it('does not warn when ~/.pgmrc permissions are restricted', async () => {
    vi.stubEnv('PGM_API_URL', '');
    vi.stubEnv('PGM_API_KEY', '');
    tempHomeDir = await mkdtemp(path.join(os.tmpdir(), 'pgmrc-test-'));
    const rcPath = path.join(tempHomeDir, '.pgmrc');

    await writeFile(
      rcPath,
      JSON.stringify({
        api_url: 'http://localhost:3100/',
        api_key: 'secret-key'
      })
    );
    await chmod(rcPath, 0o600);

    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockReturnValue(true);

    const config = await resolvePgmConfig(tempHomeDir);

    expect(config).toEqual({
      apiUrl: 'http://localhost:3100',
      apiKey: 'secret-key'
    });
    expect(stderrWrite).not.toHaveBeenCalled();
  });
});
