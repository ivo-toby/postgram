import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
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

import { Command } from 'commander';

import { AppError, ErrorCode } from '../../src/errors.js';
import {
  createTrackingClient,
  runTrackingCommand
} from '../../src/tracking/api.js';
import { UsageError } from '../../src/tracking/config.js';
import type { ReportBody } from '../../src/tracking/types.js';

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

const tempDirs: string[] = [];
const calls: FetchCall[] = [];

function tempHome(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pgm-t3-')));
  tempDirs.push(dir);
  return dir;
}

function callUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function stubFetch(responseBody: unknown, status = 200): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: callUrl(input), init: init ?? undefined });
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    );
  });
}

function lastCall(): FetchCall {
  const call = calls[calls.length - 1];
  expect(call).toBeDefined();
  return call as FetchCall;
}

function lastHeaders(): Record<string, string> {
  return (lastCall().init?.headers ?? {}) as Record<string, string>;
}

function lastBody(): Record<string, unknown> {
  return JSON.parse(
    lastCall().init?.body as string
  ) as Record<string, unknown>;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createTrackingClient', () => {
  const client = createTrackingClient({
    apiUrl: 'http://api.test',
    apiKey: 'key-123'
  });

  afterEach(() => {
    calls.length = 0;
    vi.unstubAllGlobals();
  });

  it('posts a report body with bearer auth', async () => {
    stubFetch({});
    const body: ReportBody = {
      source: 'hook',
      machine: { alias: 'codebox', hostname: 'codebox', boot_id: null },
      workspace: { path: '/home/ivo/wt/a' },
      feature_id: '11111111-1111-1111-1111-111111111111',
      session: {
        agent_kind: 'pi',
        agent_session_id: null,
        event: 'start',
        cwd: '/home/ivo',
        transcript_path: null
      }
    };

    await client.report(body);

    expect(lastCall().url).toBe('http://api.test/api/workspaces/report');
    expect(lastCall().init?.method).toBe('POST');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastBody()).toEqual(body);
  });

  it('passes an AbortSignal to fetch when report gets a timeoutMs', async () => {
    stubFetch({});

    await client.report(
      {
        source: 'scan',
        machine: { alias: 'codebox', hostname: 'codebox', boot_id: null },
        sessions: []
      },
      { timeoutMs: 250 }
    );

    expect(lastCall().init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('patches a workspace by encoded id', async () => {
    stubFetch({});

    await client.patchWorkspace('ws 1', { feature_id: null, missing: true });

    expect(lastCall().url).toBe('http://api.test/api/workspaces/ws%201');
    expect(lastCall().init?.method).toBe('PATCH');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastBody()).toEqual({ feature_id: null, missing: true });
  });

  it('puts a machine with connect_target', async () => {
    stubFetch({});

    await client.putMachine('codebox', null);

    expect(lastCall().url).toBe('http://api.test/api/machines/codebox');
    expect(lastCall().init?.method).toBe('PUT');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastBody()).toEqual({ connect_target: null });
  });

  it('lists machines with GET', async () => {
    stubFetch({});

    await client.listMachines();

    expect(lastCall().url).toBe('http://api.test/api/machines');
    expect(lastCall().init?.method).toBe('GET');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastCall().init?.body).toBeUndefined();
  });

  it('puts a repository with release_on_merge', async () => {
    stubFetch({});

    await client.putRepository('github.com/ivo-toby/postgram', true);

    expect(lastCall().url).toBe('http://api.test/api/repositories');
    expect(lastCall().init?.method).toBe('PUT');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastBody()).toEqual({
      remote: 'github.com/ivo-toby/postgram',
      release_on_merge: true
    });
  });

  it('creates a feature', async () => {
    stubFetch({});

    await client.createFeature({
      content: 'Keyword rank fusion',
      tags: ['search'],
      visibility: 'work'
    });

    expect(lastCall().url).toBe('http://api.test/api/features');
    expect(lastCall().init?.method).toBe('POST');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastBody()).toEqual({
      content: 'Keyword rank fusion',
      tags: ['search'],
      visibility: 'work'
    });
  });

  it('sets a feature stage', async () => {
    stubFetch({});

    await client.setStage('feat-1', 'review');

    expect(lastCall().url).toBe('http://api.test/api/features/feat-1/stage');
    expect(lastCall().init?.method).toBe('POST');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastBody()).toEqual({ stage: 'review' });
  });

  it('adds a pull request', async () => {
    stubFetch({});

    await client.addPullRequest('feat-1', {
      url: 'https://github.com/ivo-toby/postgram/pull/12',
      state: 'open'
    });

    expect(lastCall().url).toBe(
      'http://api.test/api/features/feat-1/pull-requests'
    );
    expect(lastCall().init?.method).toBe('POST');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
    expect(lastBody()).toEqual({
      url: 'https://github.com/ivo-toby/postgram/pull/12',
      state: 'open'
    });
  });

  it('looks up a workspace by machine and path', async () => {
    stubFetch({});

    await client.lookup('codebox', '/home/ivo');

    const url = new URL(lastCall().url);
    expect(url.pathname).toBe('/api/workspaces/lookup');
    expect(url.searchParams.get('machine')).toBe('codebox');
    expect(url.searchParams.get('path')).toBe('/home/ivo');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
  });

  it('lists workspaces with query parameters', async () => {
    stubFetch({});

    await client.listWorkspaces({
      machine: 'codebox',
      repo: 'github.com/ivo-toby/postgram',
      featureId: 'feat-9',
      unassigned: true,
      includeEnded: true
    });

    const url = new URL(lastCall().url);
    expect(url.pathname).toBe('/api/workspaces');
    expect(url.searchParams.get('machine')).toBe('codebox');
    expect(url.searchParams.get('repo')).toBe('github.com/ivo-toby/postgram');
    expect(url.searchParams.get('feature_id')).toBe('feat-9');
    expect(url.searchParams.get('unassigned')).toBe('true');
    expect(url.searchParams.get('include_ended')).toBe('true');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
  });

  it('queries where with view and include flags', async () => {
    stubFetch({});

    await client.where({
      view: 'actions',
      includeReleased: true,
      includeDone: true,
      includeEnded: true
    });

    const url = new URL(lastCall().url);
    expect(url.pathname).toBe('/api/where');
    expect(url.searchParams.get('view')).toBe('actions');
    expect(url.searchParams.get('include_released')).toBe('true');
    expect(url.searchParams.get('include_done')).toBe('true');
    expect(url.searchParams.get('include_ended')).toBe('true');
    expect(lastHeaders().Authorization).toBe('Bearer key-123');
  });

  it('maps an error envelope to an AppError', async () => {
    stubFetch(
      { error: { code: 'NOT_FOUND', message: 'workspace not found' } },
      404
    );

    const promise = client.listMachines();
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'workspace not found'
    });
  });
});

describe('runTrackingCommand', () => {
  let savedHome: string | undefined;
  let savedUrl: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedHome = process.env.HOME;
    savedUrl = process.env.PGM_API_URL;
    savedKey = process.env.PGM_API_KEY;
  });

  afterEach(() => {
    process.env.HOME = savedHome;
    if (savedUrl === undefined) {
      delete process.env.PGM_API_URL;
    } else {
      process.env.PGM_API_URL = savedUrl;
    }
    if (savedKey === undefined) {
      delete process.env.PGM_API_KEY;
    } else {
      process.env.PGM_API_KEY = savedKey;
    }
    calls.length = 0;
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  function tempHomeWithRc(): string {
    const home = tempHome();
    const rcPath = path.join(home, '.pgmrc');
    writeFileSync(
      rcPath,
      JSON.stringify({ api_url: 'http://api.test', api_key: 'key-123' }),
      'utf8'
    );
    chmodSync(rcPath, 0o600);
    process.env.HOME = home;
    delete process.env.PGM_API_URL;
    delete process.env.PGM_API_KEY;
    return home;
  }

  it('exits 2 with a stderr message for UsageError', async () => {
    tempHomeWithRc();
    const stderr = vi.spyOn(process.stderr, 'write');

    await runTrackingCommand(new Command(), () => {
      throw new UsageError('bad value');
    });

    expect(process.exitCode).toBe(2);
    expect(stderr).toHaveBeenCalledWith('bad value\n');
    stderr.mockRestore();
  });

  it('prints string results as lines', async () => {
    tempHomeWithRc();
    const stdout = vi.spyOn(process.stdout, 'write');

    await runTrackingCommand(new Command(), () =>
      Promise.resolve(['line-a', 'line-b'])
    );

    expect(stdout).toHaveBeenCalledWith('line-a\nline-b\n');
    expect(process.exitCode).toBeUndefined();
    stdout.mockRestore();
  });

  it('reports other errors as a JSON envelope and exits 1 in json mode', async () => {
    tempHomeWithRc();
    const command = new Command();
    command.option('--json');
    command.parse(['--json'], { from: 'user' });
    const stdout = vi.spyOn(process.stdout, 'write');

    await runTrackingCommand(command, () => Promise.reject(new Error('boom')));

    expect(process.exitCode).toBe(1);
    const written = stdout.mock.calls
      .map((args) => String(args[0]))
      .join('');
    const envelope = JSON.parse(written) as {
      error: { code: string; message: string };
    };
    expect(envelope.error.code).toBe('INTERNAL');
    expect(envelope.error.message).toBe('boom');
    stdout.mockRestore();
  });
});
