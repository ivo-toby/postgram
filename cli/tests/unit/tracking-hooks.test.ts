import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { shq } from '../../src/tracking/config.js';
import {
  HOOK_EVENTS,
  hookCommand,
  installHooks,
  isPostgramHook,
  piExtensionPath,
  renderPiExtension,
  runHooksInstall,
  runHooksUninstall,
  settingsPath,
  uninstallHooks,
  unifiedDiff
} from '../../src/tracking/hooks.js';
import type { ClaudeSettings, HooksDeps } from '../../src/tracking/hooks.js';

type HookEntry = {
  matcher?: string;
  hooks: Array<{ type: string; command: string; timeout?: number }>;
};

const CMD = hookCommand('/opt/node/bin/node', '/opt/pgm/pgm.js');

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pgm-t6-')));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function deps(home: string, overrides: Partial<HooksDeps> = {}): HooksDeps {
  return {
    homeDir: home,
    env: {
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent')
    },
    nodePath: '/opt/node/bin/node',
    scriptPath: '/opt/pgm/pgm.js',
    piTemplatePath: path.join(
      import.meta.dirname,
      '../../integrations/pi/postgram.ts'
    ),
    confirm: () => Promise.resolve(true),
    hasCredentials: () => Promise.resolve(true),
    ...overrides
  };
}

function entriesOf(settings: ClaudeSettings, event: string): HookEntry[] {
  const hooks = settings.hooks;
  const value =
    typeof hooks === 'object' && hooks !== null && !Array.isArray(hooks)
      ? (hooks as Record<string, unknown>)[event]
      : undefined;
  return Array.isArray(value) ? (value as HookEntry[]) : [];
}

function postgramCommands(settings: ClaudeSettings, event: string): string[] {
  return entriesOf(settings, event)
    .flatMap((entry) => entry.hooks.map((hook) => hook.command))
    .filter(isPostgramHook);
}

describe('hookCommand and isPostgramHook', () => {
  it('builds the exact command with quoted absolute paths', () => {
    expect(CMD).toBe(
      `${shq('/opt/node/bin/node')} ${shq('/opt/pgm/pgm.js')} here --hook`
    );
  });

  it('detects only postgram here --hook commands', () => {
    expect(isPostgramHook(CMD)).toBe(true);
    expect(isPostgramHook('my-pgm here --hook extra')).toBe(true);
    expect(isPostgramHook('echo other')).toBe(false);
    expect(isPostgramHook('pgm here')).toBe(false);
    expect(isPostgramHook('/opt/node/bin/node /opt/cli.js here --hook')).toBe(
      false
    );
  });
});

describe('installHooks', () => {
  it('installs one hook per event with timeout 5 and no matcher', () => {
    const next = installHooks({}, CMD, null);
    const hooks = next.hooks as Record<string, HookEntry[]>;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    for (const event of HOOK_EVENTS) {
      const entries = hooks[event] ?? [];
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        hooks: [{ type: 'command', command: CMD, timeout: 5 }]
      });
    }
  });

  it('replaces an existing postgram hook and keeps other hooks', () => {
    const settings: ClaudeSettings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'echo other' }] },
          {
            matcher: 'all',
            hooks: [
              { type: 'command', command: 'old pgm here --hook' },
              { type: 'command', command: 'echo keep' }
            ]
          }
        ]
      }
    };
    const before = JSON.stringify(settings);
    const next = installHooks(settings, CMD, null);
    expect(JSON.stringify(settings)).toBe(before);

    const commands = entriesOf(next, 'Stop').flatMap((entry) =>
      entry.hooks.map((hook) => hook.command)
    );
    expect(commands).toContain('echo other');
    expect(commands).toContain('echo keep');
    expect(postgramCommands(next, 'Stop')).toEqual([CMD]);
  });

  it('is idempotent', () => {
    const once = installHooks({}, CMD, null);
    const twice = installHooks(once, CMD, null);
    for (const event of HOOK_EVENTS) {
      expect(postgramCommands(twice, event)).toEqual([CMD]);
    }
  });

  it('applies the retention rules', () => {
    expect(installHooks({}, CMD, null).cleanupPeriodDays).toBeUndefined();
    expect(
      installHooks({ cleanupPeriodDays: 500 }, CMD, null).cleanupPeriodDays
    ).toBe(500);
    expect(installHooks({ cleanupPeriodDays: 500 }, CMD, 365).cleanupPeriodDays).toBe(
      500
    );
    expect(installHooks({ cleanupPeriodDays: 500 }, CMD, 900).cleanupPeriodDays).toBe(
      900
    );
    expect(installHooks({}, CMD, 365).cleanupPeriodDays).toBe(365);
  });
});

describe('uninstallHooks', () => {
  it('removes only postgram hooks and keeps other hooks', () => {
    const settings: ClaudeSettings = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'echo other' }] },
          {
            hooks: [
              { type: 'command', command: CMD },
              { type: 'command', command: 'echo keep' }
            ]
          }
        ]
      }
    };
    const next = uninstallHooks(settings);
    const commands = entriesOf(next, 'Stop').flatMap((entry) =>
      entry.hooks.map((hook) => hook.command)
    );
    expect(commands).toEqual(['echo other', 'echo keep']);
    expect(Object.keys(next.hooks as Record<string, unknown>).sort()).toEqual(
      [...HOOK_EVENTS].sort()
    );
    for (const event of HOOK_EVENTS) {
      expect(postgramCommands(next, event)).toEqual([]);
    }
  });
});

describe('runHooksInstall', () => {
  it('writes the settings file with --yes and reports the path', async () => {
    const home = tempHome();
    const target = path.join(home, '.claude', 'settings.json');
    const result = await runHooksInstall({ yes: true, pi: false }, deps(home));
    expect(result).toEqual([`installed hooks in ${target}`]);
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as {
      hooks: Record<string, HookEntry[]>;
      cleanupPeriodDays?: number;
    };
    for (const event of HOOK_EVENTS) {
      const commands = (parsed.hooks[event] ?? []).flatMap((entry) =>
        entry.hooks.map((hook) => hook.command)
      );
      expect(commands.filter(isPostgramHook)).toEqual([CMD]);
    }
    expect(parsed.cleanupPeriodDays).toBeUndefined();
  });

  it('aborts without writing when the answer is no', async () => {
    const home = tempHome();
    const d = deps(home, { confirm: () => Promise.resolve(false) });
    await expect(
      runHooksInstall({ yes: false, pi: false }, d)
    ).rejects.toThrow('aborted');
    expect(existsSync(path.join(home, '.claude', 'settings.json'))).toBe(
      false
    );
  });

  it('warns when credentials are missing', async () => {
    const home = tempHome();
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let written = '';
    try {
      await runHooksInstall(
        { yes: true, pi: false },
        deps(home, { hasCredentials: () => Promise.resolve(false) })
      );
      written = spy.mock.calls.map((call) => String(call[0])).join('');
    } finally {
      spy.mockRestore();
    }
    expect(written).toContain('PGM_API');
  });

  it('rejects a non-positive --keep-transcripts', async () => {
    const home = tempHome();
    await expect(
      runHooksInstall({ yes: true, pi: false, keepTranscripts: '0' }, deps(home))
    ).rejects.toThrow('--keep-transcripts');
    await expect(
      runHooksInstall({ yes: true, pi: false, keepTranscripts: 'ten' }, deps(home))
    ).rejects.toThrow('--keep-transcripts');
  });
});

describe('runHooksInstall --pi and runHooksUninstall --pi', () => {
  it('copies the template with placeholders replaced and leaves Claude settings untouched', async () => {
    const home = tempHome();
    const d = deps(home);
    const target = piExtensionPath(d.env, home);
    const result = await runHooksInstall({ pi: true, yes: true }, d);
    expect(result).toEqual([`installed pi extension ${target}`]);
    const source = readFileSync(target, 'utf8');
    expect(source).not.toContain('__PGM_NODE__');
    expect(source).not.toContain('__PGM_SCRIPT__');
    expect(source).toContain(d.nodePath);
    expect(source).toContain(d.scriptPath);
    expect(source).toContain('getSessionId()');
    expect(existsSync(path.join(home, '.claude', 'settings.json'))).toBe(
      false
    );

    const removed = await runHooksUninstall({ pi: true }, d);
    expect(removed).toEqual([`removed pi extension ${target}`]);
    expect(existsSync(target)).toBe(false);
  });

  it('uninstall --pi is a no-op when the extension is absent', async () => {
    const home = tempHome();
    const d = deps(home);
    await runHooksUninstall({ pi: true }, d);
    expect(existsSync(piExtensionPath(d.env, home))).toBe(false);
  });
});

describe('renderPiExtension', () => {
  it('replaces the quoted placeholders with JSON strings', () => {
    const out = renderPiExtension(
      "const PGM_NODE: string = '__PGM_NODE__'; const PGM_SCRIPT: string = '__PGM_SCRIPT__';",
      '/opt/node/bin/node',
      '/opt/pgm/pgm.js'
    );
    expect(out).toBe(
      'const PGM_NODE: string = "/opt/node/bin/node"; const PGM_SCRIPT: string = "/opt/pgm/pgm.js";'
    );
  });
});

describe('settingsPath and piExtensionPath', () => {
  const env: NodeJS.ProcessEnv = {
    CLAUDE_CONFIG_DIR: '/cc',
    PI_CODING_AGENT_DIR: '/pi'
  };

  it('prefers the flag, then the env dir, then the home default', () => {
    expect(settingsPath({ flag: '/custom.json', env, homeDir: '/home' })).toBe(
      '/custom.json'
    );
    expect(settingsPath({ env, homeDir: '/home' })).toBe('/cc/settings.json');
    expect(settingsPath({ env: {}, homeDir: '/home' })).toBe(
      path.join('/home', '.claude', 'settings.json')
    );
  });

  it('resolves the pi extension path from the env or home dir', () => {
    expect(piExtensionPath(env, '/home')).toBe(
      path.join('/pi', 'extensions', 'postgram.ts')
    );
    expect(piExtensionPath({}, '/home')).toBe(
      path.join('/home', '.pi', 'agent', 'extensions', 'postgram.ts')
    );
  });
});

describe('unifiedDiff', () => {
  it('is empty when the inputs are equal', () => {
    expect(unifiedDiff('a\n', 'a\n', 'settings.json')).toBe('');
  });

  it('lists removed and added lines under a header', () => {
    const diff = unifiedDiff('a\nb\n', 'a\nc\n', 'settings.json');
    expect(diff.split('\n')).toEqual([
      '--- settings.json',
      '+++ settings.json',
      '-b',
      '+c'
    ]);
  });
});
