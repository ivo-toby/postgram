import { spawn, execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { serve } from '@hono/node-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;
type Run = { code: number | null; stdout: string; stderr: string };

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const PGM = path.join(REPO_ROOT, 'cli/src/pgm.ts');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function shq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    }
  }).trim();
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['remote', 'add', 'origin', 'git@github.com:Ivo-Toby/app.git']);
  writeFileSync(path.join(dir, 'README.md'), 'app\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

describe('pgm tracking commands (feature)', () => {
  let database: TestDatabase | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';
  let apiKey = '';
  let tmp = '';
  let home = '';
  let repo = '';

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  function writeRc(dir: string, rc: Json): void {
    const file = path.join(dir, '.pgmrc');
    writeFileSync(file, JSON.stringify(rc));
    chmodSync(file, 0o600);
  }

  function pgm(
    args: string[],
    options: { cwd?: string; input?: string; home?: string } = {}
  ): Promise<Run> {
    const homeDir = options.home ?? home;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [TSX_CLI, PGM, ...args], {
        cwd: options.cwd ?? repo,
        env: {
          ...process.env,
          HOME: homeDir,
          PGM_API_URL: '',
          PGM_API_KEY: '',
          CLAUDE_CONFIG_DIR: path.join(homeDir, '.claude'),
          PI_CODING_AGENT_DIR: path.join(homeDir, '.pi/agent'),
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1'
        }
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(options.input ?? '');
    });
  }

  async function api(method: string, route: string, body?: Json): Promise<Json> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return (await response.json()) as Json;
  }

  async function workspaces(query = 'machine=devbox&include_ended=true'): Promise<Json[]> {
    const body = await api('GET', `/api/workspaces?${query}`);
    return body.workspaces as Json[];
  }

  async function addFeature(title: string): Promise<string> {
    const run = await pgm(['feature', 'add', title]);
    expect(run.code).toBe(0);
    const id = run.stdout.trim();
    expect(id).toMatch(UUID);
    return id;
  }

  function sessionStart(cwd: string, transcript: string | null = null): string {
    return JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: 's-1',
      cwd,
      transcript_path: transcript,
      source: 'startup'
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const app = createApp({ pool: database.pool });
    server = serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
      (info) => {
        baseUrl = `http://${info.address}:${info.port}`;
      }
    );
  }, 120_000);

  beforeEach(async () => {
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    const name = `cli-${crypto.randomUUID()}`;
    apiKey = (
      await createKey(db().pool, {
        name,
        clientId: name,
        scopes: ['read', 'write'],
        allowedTypes: null,
        allowedVisibility: ['personal', 'work', 'shared']
      })
    )._unsafeUnwrap().plaintextKey;
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pgm-cli-')));
    home = path.join(tmp, 'home');
    mkdirSync(home, { recursive: true });
    writeRc(home, {
      api_url: baseUrl,
      api_key: apiKey,
      machine: { alias: 'devbox' },
      here_timeout_ms: 5000
    });
    repo = path.join(tmp, 'src/app');
    initRepo(repo);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    }
    if (database) {
      await database.close();
    }
  });

  it('registers a Claude Code session from the hook payload (C1)', async () => {
    const sub = path.join(repo, 'cli');
    mkdirSync(sub);

    const run = await pgm(['here', '--hook'], {
      cwd: tmp,
      input: sessionStart(sub)
    });
    expect(run).toMatchObject({ code: 0, stdout: '' });

    const [workspace, ...rest] = await workspaces();
    expect(rest).toEqual([]);
    expect(workspace).toMatchObject({
      machine: 'devbox',
      path: repo,
      repo_remote: 'github.com/ivo-toby/app',
      branch: 'main',
      feature_id: null,
      git: { dirty_count: 0, unpushed_count: 1, has_upstream: false },
      risks: ['unpushed', 'no_upstream']
    });
    expect(workspace?.sessions).toEqual([
      expect.objectContaining({
        agent_kind: 'claude-code',
        agent_session_id: 's-1',
        status: 'running',
        cwd: sub
      })
    ]);

    const other = await pgm(['here', '--hook'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's-1', cwd: repo })
    });
    expect(other).toMatchObject({ code: 0, stdout: '' });

    const stop = await pgm(['here', '--hook'], {
      input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's-1', cwd: repo })
    });
    expect(stop).toMatchObject({ code: 0, stdout: '' });
    const [stopped] = await workspaces();
    expect((stopped?.sessions as Json[])[0]?.status).toBe('idle');
  }, 120_000);

  it('prints the human line without --hook and the feature line on SessionStart (C1, C4)', async () => {
    const unassigned = await pgm(['here']);
    expect(unassigned.code).toBe(0);
    expect(unassigned.stdout.trim()).toBe(`registered devbox:${repo} (unassigned)`);

    const featureId = await addFeature('Tracking CLI\nbody');
    const short = featureId.slice(0, 8);
    const linked = await pgm(['feature', 'link', short]);
    expect(linked.code).toBe(0);

    const marker = JSON.parse(
      readFileSync(path.join(repo, '.postgram/feature.json'), 'utf8')
    ) as Json;
    expect(marker.feature_id).toBe(featureId);
    expect(readFileSync(path.join(repo, '.postgram/.gitignore'), 'utf8').trim()).toBe('*');

    const human = await pgm(['here']);
    expect(human.stdout.trim()).toBe(
      `registered devbox:${repo} → feature ${short} (building)`
    );

    const hook = await pgm(['here', '--hook'], { input: sessionStart(repo) });
    expect(hook.code).toBe(0);
    expect(hook.stdout).toBe(
      `Postgram: this worktree belongs to feature ${short} "Tracking CLI" (stage: building).\n`
    );

    const quiet = await pgm(['here', '--hook', '--quiet'], { input: sessionStart(repo) });
    expect(quiet).toMatchObject({ code: 0, stdout: '' });

    const unlinked = await pgm(['feature', 'unlink']);
    expect(unlinked.code).toBe(0);
    expect(existsSync(path.join(repo, '.postgram/feature.json'))).toBe(false);
    const [workspace] = await workspaces();
    expect(workspace?.feature_id).toBeNull();
  }, 120_000);

  it('never fails a hook: bad stdin, server down and bad flags (C1)', async () => {
    const offline = path.join(tmp, 'offline');
    mkdirSync(offline);
    writeRc(offline, {
      api_url: 'http://127.0.0.1:9',
      api_key: 'pgm-none',
      machine: { alias: 'devbox' },
      here_timeout_ms: 1500
    });

    const down = await pgm(['here', '--hook'], { home: offline, input: sessionStart(repo) });
    expect(down).toMatchObject({ code: 0, stdout: '' });
    const bad = await pgm(['here', '--hook'], { home: offline, input: 'not json' });
    expect(bad).toMatchObject({ code: 0, stdout: '' });
    const log = readFileSync(path.join(offline, '.pgm/here.log'), 'utf8');
    expect(log.trim().split('\n')).toHaveLength(2);

    const empty = await pgm(['here', '--hook'], { input: '' });
    expect(empty).toMatchObject({ code: 0, stdout: '' });
    expect(await workspaces()).toEqual([]);

    const usage = await pgm(['here', '--event', 'bogus']);
    expect(usage.code).toBe(2);
    expect(await workspaces()).toEqual([]);
  }, 120_000);

  it('renders where with resume commands, transcript state and remote machines (C3)', async () => {
    const featureId = await addFeature('Tracking CLI');
    const short = featureId.slice(0, 8);
    expect((await pgm(['feature', 'link', featureId])).code).toBe(0);
    const sub = path.join(repo, 'cli');
    mkdirSync(sub);
    const transcript = path.join(tmp, 's-1.jsonl');
    await pgm(['here', '--hook'], { input: sessionStart(sub, transcript) });

    await api('POST', '/api/workspaces/report', {
      source: 'hook',
      machine: { alias: 'otherbox', hostname: 'otherbox-host', boot_id: null },
      workspace: { path: "/home/ivo/wt/it's", git: null }
    });

    const gone = await pgm(['where', '--json']);
    expect(gone.code).toBe(0);
    const goneBody = JSON.parse(gone.stdout) as Json;
    const groups = goneBody.groups as Json[];
    expect(groups.map((g) => g.key)).toEqual([
      'building',
      'review',
      'functional_test',
      'ready_to_merge',
      'awaiting_release',
      'unassigned'
    ]);
    const feature = (groups[0]?.features as Json[])[0];
    const local = (feature?.workspaces as Json[])[0];
    expect(local).toMatchObject({
      path: repo,
      transcript_gone: true,
      resume: `cd ${shq(sub)} && claude`
    });
    const remote = (groups[5]?.workspaces as Json[])[0];
    expect(remote).toMatchObject({
      machine: 'otherbox',
      transcript_gone: false,
      resume: `ssh -t otherbox ${shq(`cd ${shq("/home/ivo/wt/it's")} && claude`)}`
    });

    writeFileSync(transcript, '{}\n');
    const present = JSON.parse((await pgm(['where', '--json'])).stdout) as Json;
    const presentLocal = (
      ((present.groups as Json[])[0]?.features as Json[])[0]?.workspaces as Json[]
    )[0];
    expect(presentLocal).toMatchObject({
      transcript_gone: false,
      resume: `cd ${shq(sub)} && claude --resume 's-1'`
    });

    const human = await pgm(['where']);
    expect(human.code).toBe(0);
    const lines = human.stdout.split('\n');
    expect(lines).toContain('== Building (1) ==');
    expect(lines).toContain('== Unassigned (1) ==');
    expect(lines).not.toContain('== Review (0) ==');
    expect(lines).toContain(`${short} Tracking CLI  [building]`);
    expect(lines).toContain('  devbox  main  unpushed:1 no_upstream');
    expect(lines).toContain(`  resume: cd ${shq(sub)} && claude --resume 's-1'`);

    const actions = JSON.parse((await pgm(['where', '--actions', '--json'])).stdout) as Json;
    expect(actions.view).toBe('actions');

    const usage = await pgm(['where', '--bogus']);
    expect(usage.code).toBe(2);
  }, 120_000);

  it('marks a vanished local workspace missing before rendering (C3)', async () => {
    const scratch = path.join(tmp, 'scratch');
    mkdirSync(scratch);
    await pgm(['here', '--hook'], { cwd: scratch, input: sessionStart(scratch) });
    rmSync(scratch, { recursive: true });

    const run = await pgm(['where', '--json']);
    expect(run.code).toBe(0);
    const [stored] = await workspaces();
    expect(stored?.path).toBe(scratch);
    expect(stored?.missing_since).not.toBeNull();
    const unassigned = (JSON.parse(run.stdout) as Json).groups as Json[];
    const listed = (unassigned.at(-1)?.workspaces as Json[])[0];
    expect(listed?.risks).toContain('missing');

    mkdirSync(scratch);
    await pgm(['where']);
    const [found] = await workspaces();
    expect(found?.missing_since).toBeNull();
  }, 120_000);

  it('moves a feature stage, attaches a pull request and sets machine and repo settings (C4)', async () => {
    const featureId = await addFeature('Stage me');
    const short = featureId.slice(0, 8);

    expect((await pgm(['feature', 'stage', short, 'functional_test'])).code).toBe(0);
    expect((await pgm(['feature', 'stage', short, 'building'])).code).toBe(0);
    const pr = await pgm([
      'feature',
      'pr',
      featureId,
      'https://github.com/ivo-toby/app/pull/3'
    ]);
    expect(pr.code).toBe(0);
    const entity = (await api('GET', `/api/entities/${featureId}`)).entity as Json;
    const metadata = entity.metadata as Json;
    expect(metadata.stage).toBe('review');
    expect(metadata.pull_requests).toEqual([
      expect.objectContaining({ url: 'https://github.com/ivo-toby/app/pull/3', state: 'open' })
    ]);

    expect((await pgm(['here'])).code).toBe(0);
    const set = await pgm(['machine', 'set', '--connect', 'devbox.lan']);
    expect(set.code).toBe(0);
    const rc = JSON.parse(readFileSync(path.join(home, '.pgmrc'), 'utf8')) as Json;
    expect(rc.machine).toEqual({ alias: 'devbox', connect_target: 'devbox.lan' });
    expect(rc.api_key).toBe(apiKey);
    const list = await pgm(['machine', 'list', '--json']);
    expect(JSON.parse(list.stdout)).toMatchObject({
      machines: [{ alias: 'devbox', connect_target: 'devbox.lan' }]
    });

    const repoSet = await pgm([
      'repo',
      'set',
      'git@github.com:Ivo-Toby/app.git',
      '--release-on-merge',
      'true'
    ]);
    expect(repoSet.code).toBe(0);
    const stored = await db().pool.query<{ remote: string; release_on_merge: boolean }>(
      'SELECT remote, release_on_merge FROM repositories'
    );
    expect(stored.rows).toEqual([
      { remote: 'github.com/ivo-toby/app', release_on_merge: true }
    ]);
    const badFlag = await pgm(['repo', 'set', 'x', '--release-on-merge', 'maybe']);
    expect(badFlag.code).toBe(2);
  }, 120_000);

  it('creates a feature worktree with its marker and refuses an existing one (C5)', async () => {
    const featureId = await addFeature('Tracking CLI');
    const short = featureId.slice(0, 8);
    const expected = `${repo}.worktrees/${short}-tracking-cli`;

    const run = await pgm(['worktree', 'new', short]);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`${expected}\n`);
    expect(git(expected, ['symbolic-ref', '--short', 'HEAD'])).toBe(
      `feat/${short}-tracking-cli`
    );
    const marker = JSON.parse(
      readFileSync(path.join(expected, '.postgram/feature.json'), 'utf8')
    ) as Json;
    expect(marker.feature_id).toBe(featureId);
    expect(git(expected, ['status', '--porcelain'])).toBe('');
    const linked = await workspaces(`feature_id=${featureId}`);
    expect(linked.map((w) => w.path)).toEqual([expected]);

    const again = await pgm(['worktree', 'new', 'tracking cli']);
    expect(again.code).toBe(2);
    expect(again.stdout).toBe('');

    const missing = await pgm(['worktree', 'new', 'Brand new idea']);
    expect(missing.code).toBe(1);
    const created = await pgm(['worktree', 'new', 'Brand new idea', '--create']);
    expect(created.code).toBe(0);
    const createdPath = created.stdout.trim();
    expect(createdPath).toMatch(/\.worktrees\/[0-9a-f]{8}-brand-new-idea$/);
    const tasks = (await api('GET', '/api/tasks?limit=100')).items as Json[];
    expect(tasks.filter((t) => t.content === 'Brand new idea')).toHaveLength(1);
  }, 120_000);

  it('installs, re-installs and removes the Claude Code hooks and the pi extension (C2)', async () => {
    const settings = path.join(tmp, 'claude-settings.json');
    writeFileSync(
      settings,
      JSON.stringify({
        cleanupPeriodDays: 500,
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }]
        }
      })
    );

    const first = await pgm(['hooks', 'install', '--settings', settings, '--yes']);
    expect(first.code).toBe(0);
    const second = await pgm([
      'hooks',
      'install',
      '--settings',
      settings,
      '--yes',
      '--keep-transcripts',
      '365'
    ]);
    expect(second.code).toBe(0);

    type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> };
    const installed = JSON.parse(readFileSync(settings, 'utf8')) as {
      cleanupPeriodDays: number;
      hooks: Record<string, HookEntry[]>;
    };
    expect(installed.cleanupPeriodDays).toBe(500);
    expect(Object.keys(installed.hooks).sort()).toEqual([
      'SessionEnd',
      'SessionStart',
      'Stop',
      'UserPromptSubmit'
    ]);
    for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
      const commands = (installed.hooks[event] ?? []).flatMap((entry) => entry.hooks);
      const ours = commands.filter((hook) => / here --hook$/.test(hook.command));
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatchObject({ type: 'command', timeout: 5 });
      expect(ours[0]?.command.startsWith(shq(process.execPath))).toBe(true);
    }
    const stopCommands = (installed.hooks.Stop ?? []).flatMap((entry) => entry.hooks);
    expect(stopCommands.map((hook) => hook.command)).toContain('echo other');

    const raised = await pgm([
      'hooks',
      'install',
      '--settings',
      settings,
      '--yes',
      '--keep-transcripts',
      '900'
    ]);
    expect(raised.code).toBe(0);
    expect(
      (JSON.parse(readFileSync(settings, 'utf8')) as { cleanupPeriodDays: number })
        .cleanupPeriodDays
    ).toBe(900);

    const removed = await pgm(['hooks', 'uninstall', '--settings', settings]);
    expect(removed.code).toBe(0);
    const after = JSON.parse(readFileSync(settings, 'utf8')) as {
      hooks: Record<string, HookEntry[]>;
    };
    const remaining = Object.values(after.hooks)
      .flat()
      .flatMap((entry) => entry.hooks)
      .map((hook) => hook.command);
    expect(remaining).toEqual(['echo other']);

    const pi = await pgm(['hooks', 'install', '--pi', '--settings', path.join(tmp, 'untouched.json')]);
    expect(pi.code).toBe(0);
    expect(existsSync(path.join(tmp, 'untouched.json'))).toBe(false);
    const extension = path.join(home, '.pi/agent/extensions/postgram.ts');
    const source = readFileSync(extension, 'utf8');
    expect(source).not.toContain('__PGM_NODE__');
    expect(source).not.toContain('__PGM_SCRIPT__');
    expect(source).toContain(process.execPath);
    expect(source).toContain('getSessionId()');

    const piRemoved = await pgm(['hooks', 'uninstall', '--pi']);
    expect(piRemoved.code).toBe(0);
    expect(existsSync(extension)).toBe(false);
  }, 120_000);
});
