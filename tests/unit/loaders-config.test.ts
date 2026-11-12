import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadLoadersConfig,
  parseLoadersConfig
} from '../../src/services/loaders/config-loader.js';
import { AppError, ErrorCode } from '../../src/util/errors.js';

describe('parseLoadersConfig', () => {
  it('accepts a minimal config and fills defaults', () => {
    const cfg = parseLoadersConfig({ version: 1 });
    expect(cfg.pluginsDir).toBeUndefined();
    expect('attachmentsDir' in cfg).toBe(false);
    expect(cfg.loaders).toEqual([]);
  });

  it('parses an in-process loader and a sidecar loader', () => {
    const cfg = parseLoadersConfig({
      version: 1,
      loaders: [
        {
          kind: 'in-process',
          name: 'pdf',
          package: '@postgram/loader-pdf',
          accepts: { mimeTypes: ['application/pdf'], extensions: ['.pdf'] }
        },
        {
          kind: 'sidecar',
          name: 'whisper',
          endpoint: 'http://loader-whisper:8080',
          accepts: { mimeTypes: ['audio/mpeg'] },
          transport: {
            mode: 'shared-volume',
            hostPath: '/var/postgram/uploads',
            sidecarPath: '/uploads'
          }
        }
      ]
    });
    expect(cfg.loaders).toHaveLength(2);
    const [pdf, whisper] = cfg.loaders;
    if (!pdf || pdf.kind !== 'in-process')
      throw new Error('pdf loader missing');
    expect(pdf.priority).toBe(0);
    expect(pdf.enabled).toBe(true);
    expect(pdf.options).toEqual({});
    if (!whisper || whisper.kind !== 'sidecar')
      throw new Error('whisper loader missing');
    expect(whisper.timeoutMs).toBeUndefined();
    expect(whisper.maxResponseBytes).toBe(64 * 1024 * 1024);
    expect('concurrency' in whisper).toBe(false);
    expect('healthCheckIntervalMs' in whisper).toBe(false);
    expect(whisper.transport.mode).toBe('shared-volume');
  });

  it('rejects accepts that declares nothing', () => {
    expect(() =>
      parseLoadersConfig({
        version: 1,
        loaders: [
          {
            kind: 'in-process',
            name: 'empty',
            package: '@x/empty',
            accepts: {}
          }
        ]
      })
    ).toThrowError(AppError);
  });

  it('rejects accepts that only declares urlPatterns (URL ingest is gone)', () => {
    expect(() =>
      parseLoadersConfig({
        version: 1,
        loaders: [
          {
            kind: 'in-process',
            name: 'web',
            package: '@x/web',
            accepts: { urlPatterns: ['^https://'] }
          }
        ]
      })
    ).toThrowError(/at least one of mimeTypes or extensions/);
  });

  it('keeps an explicit sidecar timeoutMs and maxResponseBytes', () => {
    const cfg = parseLoadersConfig({
      version: 1,
      loaders: [
        {
          kind: 'sidecar',
          name: 'w',
          endpoint: 'http://w:8080',
          accepts: { mimeTypes: ['audio/mpeg'] },
          timeoutMs: 1234,
          maxResponseBytes: 99
        }
      ]
    });
    const [w] = cfg.loaders;
    if (!w || w.kind !== 'sidecar') throw new Error('missing');
    expect(w.timeoutMs).toBe(1234);
    expect(w.maxResponseBytes).toBe(99);
  });

  it('rejects extensions without a leading dot', () => {
    expect(() =>
      parseLoadersConfig({
        version: 1,
        loaders: [
          {
            kind: 'in-process',
            name: 'bad',
            package: '@x/bad',
            accepts: { extensions: ['pdf'] }
          }
        ]
      })
    ).toThrowError(/extension must start with a dot/);
  });

  it('rejects shared-volume transport without hostPath/sidecarPath', () => {
    expect(() =>
      parseLoadersConfig({
        version: 1,
        loaders: [
          {
            kind: 'sidecar',
            name: 'w',
            endpoint: 'http://w:8080',
            accepts: { mimeTypes: ['audio/mpeg'] },
            transport: { mode: 'shared-volume' }
          }
        ]
      })
    ).toThrowError(/shared-volume transport requires/);
  });

  it('rejects duplicate loader names', () => {
    expect(() =>
      parseLoadersConfig({
        version: 1,
        loaders: [
          {
            kind: 'in-process',
            name: 'dup',
            package: '@x/a',
            accepts: { mimeTypes: ['a/b'] }
          },
          {
            kind: 'in-process',
            name: 'dup',
            package: '@x/b',
            accepts: { mimeTypes: ['c/d'] }
          }
        ]
      })
    ).toThrowError(/duplicate loader name/);
  });

  it('AppError carries VALIDATION code on invalid input', () => {
    try {
      parseLoadersConfig({ version: 2 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ErrorCode.VALIDATION);
    }
  });
});

describe('loadLoadersConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pgm-cfg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws a clear error naming the path when the file is missing', async () => {
    const missing = path.join(dir, 'absent.json');
    await expect(loadLoadersConfig(missing)).rejects.toThrowError(missing);
    await expect(loadLoadersConfig(missing)).rejects.toBeInstanceOf(AppError);
  });

  it('throws on a file that fails schema validation', async () => {
    const file = path.join(dir, 'invalid.json');
    await writeFile(file, JSON.stringify({ version: 2 }));
    await expect(loadLoadersConfig(file)).rejects.toThrowError(
      /invalid loaders config/
    );
  });

  it('returns the built-in default configuration when path is undefined', async () => {
    const cfg = await loadLoadersConfig(undefined);
    expect(cfg.version).toBe(1);
    expect(cfg.pluginsDir).toBeUndefined();
    expect(cfg.loaders).toHaveLength(1);
    const [pdf] = cfg.loaders;
    expect(pdf).toMatchObject({
      kind: 'in-process',
      name: 'pdf',
      package: '@ivotoby/postgram-loader-pdf',
      accepts: { mimeTypes: ['application/pdf'], extensions: ['.pdf'] },
      enabled: true
    });
  });

  it('returns an independent copy of the default configuration each call', async () => {
    const a = await loadLoadersConfig(undefined);
    a.loaders.pop();
    const b = await loadLoadersConfig(undefined);
    expect(b.loaders).toHaveLength(1);
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
            accepts: { extensions: ['.pdf'] }
          }
        ]
      })
    );
    const cfg = await loadLoadersConfig(file);
    expect(cfg.pluginsDir).toBe('/srv/plugins');
    expect(cfg.loaders).toHaveLength(1);
  });

  it('throws VALIDATION on malformed JSON', async () => {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{ not json');
    await expect(loadLoadersConfig(file)).rejects.toThrowError(
      /not valid JSON/
    );
  });
});
