import {
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import {
  DEFAULT_RESUME,
  UsageError,
  defaultAlias,
  expandHome,
  isIgnoredPath,
  loadTrackingConfig,
  parseTrackingConfig,
  shq,
  slug,
  usageExit,
  writeMachineConfig
} from '../../src/tracking/config.js';

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pgm-t1-')));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('shq', () => {
  it('wraps plain values in single quotes', () => {
    expect(shq('hello')).toBe("'hello'");
  });

  it('escapes single quotes POSIX style', () => {
    expect(shq(`it's`)).toBe(`'it'\\''s'`);
    expect(shq(`a'b'c`)).toBe(`'a'\\''b'\\''c'`);
  });
});

describe('slug', () => {
  it('matches the contract example', () => {
    expect(slug('Keyword rank fusion!')).toBe('keyword-rank-fusion');
  });

  it('falls back to feature for symbols only', () => {
    expect(slug('!!!')).toBe('feature');
    expect(slug('')).toBe('feature');
  });

  it('caps at 40 characters without a trailing dash', () => {
    const long = slug('a'.repeat(100));
    expect(long).toHaveLength(40);
    expect(slug('a'.repeat(39) + '!')).toBe('a'.repeat(39));
  });
});

describe('defaultAlias', () => {
  it('lowercases and cuts at the first dot', () => {
    expect(defaultAlias('Ivo-MacBook.local')).toBe('ivo-macbook');
  });

  it('replaces characters outside [a-z0-9._-] with dashes', () => {
    expect(defaultAlias('my box')).toBe('my-box');
  });

  it('falls back to machine when empty', () => {
    expect(defaultAlias('')).toBe('machine');
  });
});

describe('expandHome', () => {
  it('expands ~ and ~/x only', () => {
    expect(expandHome('~', '/home/u')).toBe('/home/u');
    expect(expandHome('~/x', '/home/u')).toBe(path.join('/home/u', 'x'));
    expect(expandHome('/abs', '/home/u')).toBe('/abs');
    expect(expandHome('relative', '/home/u')).toBe('relative');
  });
});

describe('isIgnoredPath', () => {
  const ignore = ['/home/u/workspace', '/home/u/tmp/**'];

  it('matches an entry exactly, not its children', () => {
    expect(isIgnoredPath('/home/u/workspace', ignore)).toBe(true);
    expect(isIgnoredPath('/home/u/workspace/', ignore)).toBe(true);
    expect(isIgnoredPath('/home/u/workspace/postgram', ignore)).toBe(false);
    expect(isIgnoredPath('/home/u/workspace2', ignore)).toBe(false);
  });

  it('matches everything below an entry ending in /**', () => {
    expect(isIgnoredPath('/home/u/tmp/a/b', ignore)).toBe(true);
    expect(isIgnoredPath('/home/u/tmp', ignore)).toBe(false);
    expect(isIgnoredPath('/home/u/tmpfiles', ignore)).toBe(false);
  });

  it('ignores nothing for an empty list', () => {
    expect(isIgnoredPath('/home/u/workspace', [])).toBe(false);
  });
});

describe('parseTrackingConfig', () => {
  const input = { homeDir: '/home/u', hostname: 'My-Mac.local' };

  it('applies contract defaults for an empty pgmrc', () => {
    const config = parseTrackingConfig({}, input);
    expect(config.alias).toBe('my-mac');
    expect(config.connectTarget).toBe('my-mac');
    expect(config.scanRoots).toEqual([]);
    expect(config.worktreeRoot).toBeNull();
    expect(config.hereTimeoutMs).toBe(2000);
    expect(config.ignorePaths).toEqual([]);
    expect(config.resume).toEqual(DEFAULT_RESUME);
    expect(config.resume).not.toBe(DEFAULT_RESUME);
    expect(config.resume.pi).not.toBe(DEFAULT_RESUME.pi);
  });

  it('reads overrides, expands ~ and merges resume per kind and field', () => {
    const config = parseTrackingConfig(
      {
        machine: { alias: 'codebox', connect_target: 'box' },
        scan_roots: ['~/src', 42, '~/wt'],
        worktree_root: '~/wt',
        here_timeout_ms: 5000,
        ignore_paths: ['~/workspace', '~/tmp/**', 7, ''],
        resume: {
          pi: { with_id: 'pi -s {session_id}' },
          talon: { without_id: null }
        }
      },
      input
    );

    expect(config.alias).toBe('codebox');
    expect(config.connectTarget).toBe('box');
    expect(config.scanRoots).toEqual(['/home/u/src', '/home/u/wt']);
    expect(config.worktreeRoot).toBe('/home/u/wt');
    expect(config.hereTimeoutMs).toBe(5000);
    expect(config.ignorePaths).toEqual(['/home/u/workspace', '/home/u/tmp/**']);
    expect(config.resume['claude-code']).toEqual({
      with_id: 'claude --resume {session_id}',
      without_id: 'claude'
    });
    expect(config.resume.pi).toEqual({
      with_id: 'pi -s {session_id}',
      without_id: 'pi'
    });
    expect(config.resume.talon).toEqual({ with_id: null, without_id: null });
    expect(config.resume.other).toEqual({ with_id: null, without_id: null });
    expect(config.resume.pi).not.toBe(DEFAULT_RESUME.pi);
  });

  it('ignores wrong-typed values and unknown resume kinds', () => {
    const config = parseTrackingConfig(
      {
        machine: 'oops',
        scan_roots: 'nope',
        worktree_root: 5,
        here_timeout_ms: '5000',
        resume: { pi: { with_id: 42 }, bogus: { with_id: 'x' } }
      },
      input
    );

    expect(config.alias).toBe('my-mac');
    expect(config.connectTarget).toBe('my-mac');
    expect(config.scanRoots).toEqual([]);
    expect(config.worktreeRoot).toBeNull();
    expect(config.hereTimeoutMs).toBe(2000);
    expect(config.resume).toEqual(DEFAULT_RESUME);
  });

  it('derives connect_target from alias when missing', () => {
    const config = parseTrackingConfig(
      { machine: { alias: 'codebox' } },
      input
    );
    expect(config.alias).toBe('codebox');
    expect(config.connectTarget).toBe('codebox');
  });
});

describe('loadTrackingConfig', () => {
  it('reads ~/.pgmrc from the given home directory', async () => {
    const homeDir = tempHome();
    writeFileSync(
      path.join(homeDir, '.pgmrc'),
      JSON.stringify({ machine: { alias: 'box' } })
    );

    const config = await loadTrackingConfig({
      homeDir,
      hostname: 'Host.local'
    });
    expect(config.alias).toBe('box');
    expect(config.connectTarget).toBe('box');
  });

  it('falls back to defaults when the file is missing or invalid', async () => {
    const missing = tempHome();
    const invalid = tempHome();
    writeFileSync(path.join(invalid, '.pgmrc'), '{not json');

    const a = await loadTrackingConfig({
      homeDir: missing,
      hostname: 'Host.local'
    });
    const b = await loadTrackingConfig({
      homeDir: invalid,
      hostname: 'Host.local'
    });
    expect(a.alias).toBe('host');
    expect(b).toEqual(a);
  });
});

describe('writeMachineConfig', () => {
  it('sets machine keys, keeps other keys and writes mode 600', async () => {
    const homeDir = tempHome();
    const rcPath = path.join(homeDir, '.pgmrc');
    writeFileSync(
      rcPath,
      JSON.stringify({
        api_url: 'https://example.invalid',
        api_key: 'secret',
        machine: { alias: 'old', other: 1 }
      })
    );

    const result = await writeMachineConfig({ alias: 'new', homeDir });
    expect(result).toEqual({
      previousAlias: 'old',
      alias: 'new',
      connectTarget: 'new'
    });

    const doc = JSON.parse(await readFile(rcPath, 'utf8')) as {
      api_url: string;
      api_key: string;
      machine: { alias: string; connect_target: string; other: number };
    };
    expect(doc.api_url).toBe('https://example.invalid');
    expect(doc.api_key).toBe('secret');
    expect(doc.machine).toEqual({ alias: 'new', connect_target: 'new', other: 1 });
    expect((await readFile(rcPath, 'utf8')).endsWith('\n')).toBe(true);
    expect(statSync(rcPath).mode & 0o777).toBe(0o600);
  });

  it('creates the file with defaults when missing', async () => {
    const homeDir = tempHome();
    const result = await writeMachineConfig({ homeDir });

    expect(result.previousAlias).toBeNull();
    expect(result.alias).toBe(defaultAlias(os.hostname()));
    expect(result.connectTarget).toBe(result.alias);

    const doc = JSON.parse(
      await readFile(path.join(homeDir, '.pgmrc'), 'utf8')
    ) as { machine: { alias: string; connect_target: string } };
    expect(doc.machine.alias).toBe(result.alias);
    expect(doc.machine.connect_target).toBe(result.connectTarget);
  });

  it('keeps an existing connect_target when no input is given', async () => {
    const homeDir = tempHome();
    writeFileSync(
      path.join(homeDir, '.pgmrc'),
      JSON.stringify({ machine: { alias: 'a', connect_target: 'ct' } })
    );

    const result = await writeMachineConfig({ homeDir });
    expect(result).toEqual({
      previousAlias: 'a',
      alias: 'a',
      connectTarget: 'ct'
    });
  });

  it('throws UsageError on invalid JSON', async () => {
    const homeDir = tempHome();
    writeFileSync(path.join(homeDir, '.pgmrc'), '{not json');

    await expect(writeMachineConfig({ homeDir })).rejects.toThrow(UsageError);
  });
});

describe('usageExit', () => {
  it('maps parse errors to exit code 2', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    try {
      const program = usageExit(new Command().name('pgm'));
      program.parse(['node', 'pgm', '--unknown'], { from: 'node' });
      expect(exitSpy).toHaveBeenCalledWith(2);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
