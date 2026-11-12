import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type * as PoolModule from '../../src/db/pool.js';

const startupMocks = vi.hoisted(() => ({ createPoolCalls: 0 }));

vi.mock('../../src/db/pool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PoolModule>();
  return {
    ...actual,
    createPool: () => {
      startupMocks.createPoolCalls += 1;
      throw new Error('createPool must not be reached in this test');
    }
  };
});

import { startServer } from '../../src/index.js';

const ORIGINAL_ENV = { ...process.env };

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

describe('startServer loader wiring', () => {
  let tmp: string;

  beforeEach(async () => {
    restoreEnvironment();
    startupMocks.createPoolCalls = 0;
    tmp = await mkdtemp(path.join(tmpdir(), 'pgm-startup-'));
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://startup-test/postgram',
      OPENAI_API_KEY: 'sk-fake-for-test',
      LOG_LEVEL: 'fatal',
      LOADERS_ENABLED: 'true'
    });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  afterAll(() => {
    restoreEnvironment();
  });

  it('fails before any database work when the loaders config file is missing', async () => {
    process.env.LOADERS_CONFIG_PATH = path.join(tmp, 'missing.json');
    process.env.ATTACHMENTS_DIR = path.join(tmp, 'attachments');

    await expect(startServer()).rejects.toThrow(/loader config.*not found/);
    expect(startupMocks.createPoolCalls).toBe(0);
  });

  it('fails before any database work when the attachments directory is unusable', async () => {
    const file = path.join(tmp, 'a-file');
    await writeFile(file, 'x');
    const config = path.join(tmp, 'loaders.json');
    await writeFile(config, JSON.stringify({ version: 1, loaders: [] }));
    process.env.LOADERS_CONFIG_PATH = config;
    process.env.ATTACHMENTS_DIR = path.join(file, 'sub');

    await expect(startServer()).rejects.toThrow(
      /ATTACHMENTS_DIR.*attachments directory|attachments directory.*ATTACHMENTS_DIR/s
    );
    expect(startupMocks.createPoolCalls).toBe(0);
  });
});
