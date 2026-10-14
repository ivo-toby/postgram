import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createJevShadowFileRecorder,
  resolveEnvJevRecorder
} from '../../src/services/jev-shadow-recorder.js';
import type { JevShadowRecord } from '../../src/services/jev-shadow-recorder.js';

function record(searchId: string): JevShadowRecord {
  return {
    recordedAt: '2026-10-06T00:00:00.000Z',
    searchId,
    clientId: 'client-a',
    query: 'postgres search',
    queryHash: 'hash',
    jevMs: 12,
    candidates: []
  };
}

describe('createJevShadowFileRecorder', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jev-shadow-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends one JSON line per record and creates the parent directory', async () => {
    const filePath = join(dir, 'nested', 'shadow.jsonl');
    const recorder = createJevShadowFileRecorder(filePath);

    await Promise.all([recorder(record('a')), recorder(record('b'))]);
    await recorder(record('c'));

    const lines = (await readFile(filePath, 'utf8')).trimEnd().split('\n');
    expect(lines.map((line) => (JSON.parse(line) as JevShadowRecord).searchId))
      .toEqual(['a', 'b', 'c']);
  });

  it('keeps writing after a failed append', async () => {
    // A directory at the target path makes the first append fail.
    const filePath = join(dir, 'shadow.jsonl');
    const { mkdir, rmdir } = await import('node:fs/promises');
    await mkdir(filePath);
    const recorder = createJevShadowFileRecorder(filePath);

    await expect(recorder(record('a'))).rejects.toThrow();
    await rmdir(filePath);
    await recorder(record('b'));

    const content = await readFile(filePath, 'utf8');
    expect((JSON.parse(content) as JevShadowRecord).searchId).toBe('b');
  });
});

describe('resolveEnvJevRecorder', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns no recorder without JEV_SHADOW_FILE and a recorder with it', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/postgram');
    vi.stubEnv('JEV_SHADOW_FILE', '');
    expect(resolveEnvJevRecorder()).toBeUndefined();

    vi.stubEnv('JEV_SHADOW_FILE', '/tmp/jev-shadow-test.jsonl');
    expect(typeof resolveEnvJevRecorder()).toBe('function');
  });
});
