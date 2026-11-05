import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { TrackingClient } from '../../src/tracking/api.js';
import { DEFAULT_RESUME } from '../../src/tracking/config.js';
import type { TrackingConfig } from '../../src/tracking/config.js';
import { appendHereLog, parseHookInput, runHere } from '../../src/tracking/here.js';
import type { HereDeps } from '../../src/tracking/here.js';
import type { ReportBody, ReportResponse } from '../../src/tracking/types.js';

const FEATURE_ID = '1a2b3c4d-0000-4000-8000-000000000000';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type ReportCall = { body: ReportBody; options?: { timeoutMs?: number } };

function firstCall(calls: ReportCall[]): ReportCall {
  const call = calls[0];
  if (call === undefined) {
    throw new Error('expected a report call');
  }
  return call;
}

function makeClient(feature: ReportResponse['feature']): {
  client: TrackingClient;
  calls: ReportCall[];
} {
  const calls: ReportCall[] = [];
  const client = {
    report: (
      body: ReportBody,
      options?: { timeoutMs?: number }
    ): Promise<ReportResponse> => {
      calls.push({ body, ...(options !== undefined ? { options } : {}) });
      return Promise.resolve({
        workspace: null,
        feature,
        interrupted_sessions: 0,
        warnings: []
      });
    }
  } as TrackingClient;
  return { client, calls };
}

function makeConfig(overrides?: Partial<TrackingConfig>): TrackingConfig {
  return {
    alias: 'devbox',
    connectTarget: 'devbox',
    scanRoots: [],
    worktreeRoot: null,
    hereTimeoutMs: 2000,
    ignorePaths: [],
    resume: DEFAULT_RESUME,
    ...overrides
  };
}

function pushLog(logs: string[]): (line: string) => Promise<void> {
  return (line) => {
    logs.push(line);
    return Promise.resolve();
  };
}

function makeDeps(overrides?: Partial<HereDeps>): HereDeps {
  return {
    config: makeConfig(),
    client: makeClient(null).client,
    stdin: () => Promise.resolve(''),
    cwd: '/w',
    hostname: 'host',
    homeDir: os.tmpdir(),
    now: () => 0,
    bootId: () => Promise.resolve('boot'),
    resolveWorkspace: () =>
      Promise.resolve({ kind: 'ok', path: '/w', repoRoot: '/w', workspace: { path: '/w' } }),
    readMarker: () => Promise.resolve(null),
    log: () => Promise.resolve(),
    ...overrides
  };
}

describe('parseHookInput', () => {
  it('maps SessionStart with the stdin fields', () => {
    expect(
      parseHookInput(
        JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 's-1',
          cwd: '/a/b',
          transcript_path: '/t.jsonl',
          source: 'resume'
        })
      )
    ).toEqual({
      kind: 'report',
      event: 'start',
      sessionId: 's-1',
      cwd: '/a/b',
      transcriptPath: '/t.jsonl',
      reason: 'resume',
      hookEvent: 'SessionStart'
    });
  });

  it('maps UserPromptSubmit, Stop and SessionEnd', () => {
    expect(
      parseHookInput(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's-1' }))
    ).toEqual({
      kind: 'report',
      event: 'activity',
      sessionId: 's-1',
      hookEvent: 'UserPromptSubmit'
    });
    expect(parseHookInput(JSON.stringify({ hook_event_name: 'Stop', session_id: 's-1' }))).toEqual({
      kind: 'report',
      event: 'stop',
      sessionId: 's-1',
      hookEvent: 'Stop'
    });
    expect(
      parseHookInput(JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 's-1', reason: 'exit' }))
    ).toEqual({
      kind: 'report',
      event: 'end',
      sessionId: 's-1',
      reason: 'exit',
      hookEvent: 'SessionEnd'
    });
  });

  it('ignores hook events outside the four', () => {
    expect(
      parseHookInput(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's-1' }))
    ).toEqual({ kind: 'ignore' });
  });

  it('rejects empty, non-JSON, non-object input and a missing hook_event_name', () => {
    expect(parseHookInput('')).toEqual({ kind: 'invalid' });
    expect(parseHookInput('   ')).toEqual({ kind: 'invalid' });
    expect(parseHookInput('not json')).toEqual({ kind: 'invalid' });
    expect(parseHookInput('[1,2]')).toEqual({ kind: 'invalid' });
    expect(parseHookInput('{"session_id":"s-1"}')).toEqual({ kind: 'invalid' });
  });

  it('nulls a missing session id', () => {
    expect(parseHookInput(JSON.stringify({ hook_event_name: 'Stop' }))).toEqual({
      kind: 'report',
      event: 'stop',
      sessionId: null,
      hookEvent: 'Stop'
    });
  });
});

describe('runHere --hook', () => {
  const sessionStart = (cwd: string): string =>
    JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's-1', cwd });

  it('sends the hook report with the marker feature id and stdin cwd, and prints the feature line', async () => {
    const feature = { id: FEATURE_ID, title: 'Tracking CLI', stage: 'building' };
    const { client, calls } = makeClient(feature);
    const deps = makeDeps({
      client,
      stdin: () => Promise.resolve(sessionStart('/stdin-dir')),
      readMarker: () => Promise.resolve(FEATURE_ID)
    });

    const result = await runHere({ hook: true, quiet: false }, deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      'Postgram: this worktree belongs to feature 1a2b3c4d "Tracking CLI" (stage: building).\n'
    );
    expect(calls).toHaveLength(1);
    expect(firstCall(calls).body).toMatchObject({
      source: 'hook',
      machine: { alias: 'devbox', hostname: 'host', boot_id: 'boot' },
      workspace: { path: '/w' },
      feature_id: FEATURE_ID,
      session: {
        agent_kind: 'claude-code',
        agent_session_id: 's-1',
        event: 'start',
        cwd: '/stdin-dir',
        transcript_path: null
      }
    });
  });

  it('lets stdin values override flags, with flags as fallback', async () => {
    const { client, calls } = makeClient(null);
    const deps = makeDeps({
      client,
      stdin: () => Promise.resolve(sessionStart('/stdin-dir'))
    });

    await runHere(
      {
        hook: true,
        quiet: true,
        sessionId: 'flag-sid',
        cwd: '/flag-dir',
        transcript: '/flag-t',
        reason: 'flag-reason'
      },
      deps
    );

    const session = firstCall(calls).body.session;
    expect(session).toMatchObject({
      agent_session_id: 's-1',
      cwd: '/stdin-dir',
      transcript_path: '/flag-t',
      reason: 'flag-reason'
    });
  });

  it('suppresses the feature line with --quiet, on other events, and when unlinked', async () => {
    const feature = { id: FEATURE_ID, title: 'Tracking CLI', stage: 'review' };

    const quietClient = makeClient(feature);
    const quiet = await runHere(
      { hook: true, quiet: true },
      makeDeps({ client: quietClient.client, stdin: () => Promise.resolve(sessionStart('/w')) })
    );
    expect(quiet.stdout).toBe('');

    const stopClient = makeClient(feature);
    const stop = await runHere(
      { hook: true, quiet: false },
      makeDeps({
        client: stopClient.client,
        stdin: () => Promise.resolve(JSON.stringify({ hook_event_name: 'Stop', session_id: 's-1' }))
      })
    );
    expect(stop.stdout).toBe('');

    const unlinkedClient = makeClient(null);
    const unlinked = await runHere(
      { hook: true, quiet: false },
      makeDeps({ client: unlinkedClient.client, stdin: () => Promise.resolve(sessionStart('/w')) })
    );
    expect(unlinked.stdout).toBe('');
  });

  it('logs invalid stdin and sends nothing, exiting 0', async () => {
    const { client, calls } = makeClient(null);
    const logs: string[] = [];
    const deps = makeDeps({
      client,
      stdin: () => Promise.resolve('not json'),
      log: pushLog(logs)
    });

    const result = await runHere({ hook: true, quiet: true }, deps);

    expect(result).toEqual({ stdout: '', exitCode: 0 });
    expect(logs).toEqual(['invalid hook input']);
    expect(calls).toHaveLength(0);
  });

  it('sends nothing for ignored events', async () => {
    const { client, calls } = makeClient(null);
    const logs: string[] = [];
    const deps = makeDeps({
      client,
      stdin: () => Promise.resolve(JSON.stringify({ hook_event_name: 'PreToolUse' })),
      log: pushLog(logs)
    });

    const result = await runHere({ hook: true, quiet: true }, deps);

    expect(result.stdout).toBe('');
    expect(calls).toHaveLength(0);
  });
});

describe('runHere without --hook', () => {
  it('sends a workspace-only report and prints the unassigned line', async () => {
    const { client, calls } = makeClient(null);
    const deps = makeDeps({ client });

    const result = await runHere({ hook: false, quiet: false }, deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('registered devbox:/w (unassigned)\n');
    const body = firstCall(calls).body;
    expect(body.session).toBeUndefined();
    expect(body.feature_id).toBeUndefined();
  });

  it('sends a session with event default activity and agent default claude-code for --session-id only', async () => {
    const { client, calls } = makeClient(null);
    const result = await runHere({ hook: false, quiet: false, sessionId: 's-1' }, makeDeps({ client }));

    expect(result.exitCode).toBe(0);
    expect(firstCall(calls).body.session).toMatchObject({
      agent_kind: 'claude-code',
      agent_session_id: 's-1',
      event: 'activity'
    });
  });

  it('prints the linked feature line', async () => {
    const feature = { id: FEATURE_ID, title: 'Tracking CLI', stage: 'review' };
    const { client } = makeClient(feature);

    const result = await runHere({ hook: false, quiet: false }, makeDeps({ client }));

    expect(result.stdout).toBe('registered devbox:/w → feature 1a2b3c4d (review)\n');
  });

  it('exits 2 without sending anything on a bad --event', async () => {
    const { client, calls } = makeClient(null);
    const result = await runHere({ hook: false, quiet: false, event: 'bogus' }, makeDeps({ client }));

    expect(result).toEqual({ stdout: '', exitCode: 2 });
    expect(calls).toHaveLength(0);
  });

  it('exits 2 without sending anything on a bad --agent', async () => {
    const { client, calls } = makeClient(null);
    const result = await runHere({ hook: false, quiet: false, agent: 'bogus' }, makeDeps({ client }));

    expect(result).toEqual({ stdout: '', exitCode: 2 });
    expect(calls).toHaveLength(0);
  });
});

describe('runHere outside git', () => {
  it('sends nothing for a directory that is not in a git repository', async () => {
    const { client, calls } = makeClient(null);
    const logs: string[] = [];
    const deps = makeDeps({
      client,
      cwd: '/notes',
      stdin: () =>
        Promise.resolve(
          JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's-1', cwd: '/notes' })
        ),
      log: pushLog(logs),
      resolveWorkspace: () =>
        Promise.resolve({ kind: 'ok', path: '/notes', repoRoot: null, workspace: { path: '/notes', git: null } })
    });

    const plain = await runHere({ hook: false, quiet: false }, deps);
    expect(plain).toEqual({ stdout: 'skipped /notes (not a git repository)\n', exitCode: 0 });

    const hooked = await runHere({ hook: true, quiet: false }, deps);
    expect(hooked).toEqual({ stdout: '', exitCode: 0 });
    expect(calls).toHaveLength(0);
    expect(logs).toEqual([]);
  });
});

describe('runHere ignore_paths', () => {
  it('sends nothing and stays silent for an ignored directory in hook mode', async () => {
    const { client, calls } = makeClient({ id: FEATURE_ID, title: 'T', stage: 'building' });
    const logs: string[] = [];
    const resolved: string[] = [];
    const deps = makeDeps({
      client,
      config: makeConfig({ ignorePaths: ['/w'] }),
      stdin: () =>
        Promise.resolve(
          JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's-1', cwd: '/w' })
        ),
      log: pushLog(logs),
      resolveWorkspace: (cwd) => {
        resolved.push(cwd);
        return Promise.resolve({ kind: 'ok', path: '/w', repoRoot: null, workspace: { path: '/w' } });
      }
    });

    const result = await runHere({ hook: true, quiet: false }, deps);

    expect(result).toEqual({ stdout: '', exitCode: 0 });
    expect(calls).toHaveLength(0);
    expect(logs).toEqual([]);
    expect(resolved).toEqual([]);
  });

  it('checks the resolved worktree root too and says so without --hook', async () => {
    const { client, calls } = makeClient(null);
    const deps = makeDeps({
      client,
      config: makeConfig({ ignorePaths: ['/w'] }),
      cwd: '/w/sub',
      resolveWorkspace: () =>
        Promise.resolve({ kind: 'ok', path: '/w', repoRoot: '/w', workspace: { path: '/w' } })
    });

    const result = await runHere({ hook: false, quiet: false }, deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ignored /w (ignore_paths)\n');
    expect(calls).toHaveLength(0);
  });

  it('keeps registering a child of an exactly ignored directory', async () => {
    const { client, calls } = makeClient(null);
    const deps = makeDeps({
      client,
      config: makeConfig({ ignorePaths: ['/w'] }),
      cwd: '/w/app',
      resolveWorkspace: () =>
        Promise.resolve({ kind: 'ok', path: '/w/app', repoRoot: '/w/app', workspace: { path: '/w/app' } })
    });

    await runHere({ hook: false, quiet: false }, deps);

    expect(calls).toHaveLength(1);
  });
});

describe('runHere failure paths', () => {
  it('logs git timeout, sends nothing and exits 0', async () => {
    const { client, calls } = makeClient(null);
    const logs: string[] = [];
    const deps = makeDeps({
      client,
      resolveWorkspace: () => Promise.resolve({ kind: 'timeout' }),
      log: pushLog(logs)
    });

    const result = await runHere({ hook: false, quiet: false }, deps);

    expect(result).toEqual({ stdout: '', exitCode: 0 });
    expect(logs).toEqual(['git timeout']);
    expect(calls).toHaveLength(0);
  });

  it('logs the client error and exits 0', async () => {
    const failing: TrackingClient = {
      ...makeClient(null).client,
      report: () => Promise.reject(new Error('boom'))
    };
    const logs: string[] = [];
    const deps = makeDeps({ client: failing, log: pushLog(logs) });

    const result = await runHere({ hook: false, quiet: false }, deps);

    expect(result).toEqual({ stdout: '', exitCode: 0 });
    expect(logs).toEqual(['boom']);
  });

  it('logs and exits 0 when the client is missing', async () => {
    const logs: string[] = [];
    const deps = makeDeps({ client: null, log: pushLog(logs) });

    const result = await runHere({ hook: false, quiet: false }, deps);

    expect(result).toEqual({ stdout: '', exitCode: 0 });
    expect(logs).toEqual(['missing credentials']);
  });

  it('logs and exits 0 when the config is missing', async () => {
    const logs: string[] = [];
    const deps = makeDeps({ config: null, log: pushLog(logs) });

    const result = await runHere({ hook: false, quiet: false }, deps);

    expect(result).toEqual({ stdout: '', exitCode: 0 });
    expect(logs).toEqual(['missing config']);
  });
});

describe('runHere HTTP timeout', () => {
  it('uses here_timeout_ms minus elapsed minus 100, with a minimum of 100', async () => {
    const { client, calls } = makeClient(null);
    const times = [0, 300];
    const deps = makeDeps({ client, now: () => (times.shift() ?? 0) });

    await runHere({ hook: false, quiet: false }, deps);

    expect(firstCall(calls).options).toEqual({ timeoutMs: 1600 });
  });

  it('clamps to 100 when the elapsed time exceeds the budget', async () => {
    const { client, calls } = makeClient(null);
    const times = [0, 5000];
    const deps = makeDeps({ client, now: () => (times.shift() ?? 0) });

    await runHere({ hook: false, quiet: false }, deps);

    expect(firstCall(calls).options).toEqual({ timeoutMs: 100 });
  });
});

describe('appendHereLog', () => {
  it('appends one line to a fresh home, flattening newlines', async () => {
    const home = tempDir('pgm-t5-log-');

    await appendHereLog(home, 'hello\nworld', new Date('2026-01-01T00:00:00.000Z'));

    expect(readFileSync(path.join(home, '.pgm/here.log'), 'utf8')).toBe(
      '2026-01-01T00:00:00.000Z hello world\n'
    );
  });

  it('rotates a file of 1 MB to here.log.1 before appending', async () => {
    const home = tempDir('pgm-t5-rotate-');
    const dir = path.join(home, '.pgm');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'here.log');
    writeFileSync(file, 'x'.repeat(1_048_576));

    await appendHereLog(home, 'after', new Date('2026-01-01T00:00:01.000Z'));

    expect(readFileSync(file, 'utf8')).toBe('2026-01-01T00:00:01.000Z after\n');
    expect(readFileSync(path.join(dir, 'here.log.1'), 'utf8')).toBe('x'.repeat(1_048_576));
  });

  it('keeps a file just under 1 MB in place', async () => {
    const home = tempDir('pgm-t5-norotate-');
    const dir = path.join(home, '.pgm');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'here.log');
    writeFileSync(file, 'y'.repeat(1_048_575));

    await appendHereLog(home, 'next', new Date('2026-01-01T00:00:02.000Z'));

    expect(readFileSync(file, 'utf8')).toBe(
      `y`.repeat(1_048_575) + '2026-01-01T00:00:02.000Z next\n'
    );
    expect(existsSync(path.join(dir, 'here.log.1'))).toBe(false);
  });
});
