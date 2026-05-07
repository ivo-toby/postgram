import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadPostgramConfig,
  parsePostgramConfig,
} from '../../src/services/loaders/config-loader.js';
import { AppError, ErrorCode } from '../../src/util/errors.js';

describe('parsePostgramConfig', () => {
  it('accepts a minimal config and fills defaults', () => {
    const cfg = parsePostgramConfig({ version: 1 });
    expect(cfg.pluginsDir).toBe('/etc/postgram/plugins');
    expect(cfg.attachmentsDir).toBe('/var/postgram/attachments');
    expect(cfg.loaders).toEqual([]);
  });

  it('parses an in-process loader and a sidecar loader', () => {
    const cfg = parsePostgramConfig({
      version: 1,
      loaders: [
        {
          kind: 'in-process',
          name: 'pdf',
          package: '@postgram/loader-pdf',
          accepts: { mimeTypes: ['application/pdf'], extensions: ['.pdf'] },
        },
        {
          kind: 'sidecar',
          name: 'whisper',
          endpoint: 'http://loader-whisper:8080',
          accepts: { mimeTypes: ['audio/mpeg'] },
          transport: {
            mode: 'shared-volume',
            hostPath: '/var/postgram/uploads',
            sidecarPath: '/uploads',
          },
        },
      ],
    });
    expect(cfg.loaders).toHaveLength(2);
    const [pdf, whisper] = cfg.loaders;
    if (!pdf || pdf.kind !== 'in-process') throw new Error('pdf loader missing');
    expect(pdf.priority).toBe(0);
    expect(pdf.enabled).toBe(true);
    expect(pdf.options).toEqual({});
    if (!whisper || whisper.kind !== 'sidecar') throw new Error('whisper loader missing');
    expect(whisper.timeoutMs).toBe(120_000);
    expect(whisper.transport.mode).toBe('shared-volume');
  });

  it('rejects accepts that declares nothing', () => {
    expect(() =>
      parsePostgramConfig({
        version: 1,
        loaders: [
          {
            kind: 'in-process',
            name: 'empty',
            package: '@x/empty',
            accepts: {},
          },
        ],
      }),
    ).toThrowError(AppError);
  });

  it('rejects extensions without a leading dot', () => {
    expect(() =>
      parsePostgramConfig({
        version: 1,
        loaders: [
          {
            kind: 'in-process',
            name: 'bad',
            package: '@x/bad',
            accepts: { extensions: ['pdf'] },
          },
        ],
      }),
    ).toThrowError(/extension must start with a dot/);
  });

  it('rejects shared-volume transport without hostPath/sidecarPath', () => {
    expect(() =>
      parsePostgramConfig({
        version: 1,
        loaders: [
          {
            kind: 'sidecar',
            name: 'w',
            endpoint: 'http://w:8080',
            accepts: { mimeTypes: ['audio/mpeg'] },
            transport: { mode: 'shared-volume' },
          },
        ],
      }),
    ).toThrowError(/shared-volume transport requires/);
  });

  it('rejects duplicate loader names', () => {
    expect(() =>
      parsePostgramConfig({
        version: 1,
        loaders: [
          {
            kind: 'in-process',
            name: 'dup',
            package: '@x/a',
            accepts: { mimeTypes: ['a/b'] },
          },
          {
            kind: 'in-process',
            name: 'dup',
            package: '@x/b',
            accepts: { mimeTypes: ['c/d'] },
          },
        ],
      }),
    ).toThrowError(/duplicate loader name/);
  });

  it('AppError carries VALIDATION code on invalid input', () => {
    try {
      parsePostgramConfig({ version: 2 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ErrorCode.VALIDATION);
    }
  });
});

describe('loadPostgramConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pgm-cfg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the empty config when the file is missing', async () => {
    const cfg = await loadPostgramConfig(path.join(dir, 'absent.json'));
    expect(cfg.loaders).toEqual([]);
    expect(cfg.version).toBe(1);
  });

  it('returns the empty config when path is undefined', async () => {
    const cfg = await loadPostgramConfig(undefined);
    expect(cfg.loaders).toEqual([]);
  });

  it('parses a real file from disk', async () => {
    const file = path.join(dir, 'postgram.config.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        pluginsDir: '/srv/plugins',
        loaders: [
          {
            kind: 'in-process',
            name: 'pdf',
            package: '@postgram/loader-pdf',
            accepts: { extensions: ['.pdf'] },
          },
        ],
      }),
    );
    const cfg = await loadPostgramConfig(file);
    expect(cfg.pluginsDir).toBe('/srv/plugins');
    expect(cfg.loaders).toHaveLength(1);
  });

  it('throws VALIDATION on malformed JSON', async () => {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{ not json');
    await expect(loadPostgramConfig(file)).rejects.toThrowError(
      /not valid JSON/,
    );
  });
});
