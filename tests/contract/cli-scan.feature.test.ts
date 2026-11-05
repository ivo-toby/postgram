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

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV }
  }).trim();
}

function initRepo(dir: string, branch: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', branch]);
  writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

function enc(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '-');
}

function writeLines(file: string, lines: Json[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

describe('pgm scan (feature)', () => {
  let database: TestDatabase | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';
  let apiKey = '';
  let tmp = '';
  let home = '';
  let root = '';

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  function pgm(args: string[]): Promise<Run> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [TSX_CLI, PGM, ...args], {
        cwd: tmp,
        env: {
          ...process.env,
          ...GIT_ENV,
          HOME: home,
          PGM_API_URL: '',
          PGM_API_KEY: '',
          CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
          PI_CODING_AGENT_DIR: path.join(home, '.pi/agent')
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
      child.stdin.end('');
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

  async function workspaces(): Promise<Json[]> {
    const body = await api('GET', '/api/workspaces?machine=devbox&include_ended=true');
    return body.workspaces as Json[];
  }

  async function createFeature(title: string): Promise<string> {
    const body = await api('POST', '/api/features', { content: title });
    return (body.entity as Json).id as string;
  }

  function sessionIds(workspace: Json | undefined): string[] {
    return ((workspace?.sessions as Json[] | undefined) ?? [])
      .map((session) => session.agent_session_id as string)
      .sort();
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
    const name = `scan-${crypto.randomUUID()}`;
    apiKey = (
      await createKey(db().pool, {
        name,
        clientId: name,
        scopes: ['read', 'write', 'delete'],
        allowedTypes: null,
        allowedVisibility: ['personal', 'work', 'shared']
      })
    )._unsafeUnwrap().plaintextKey;
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pgm-scan-')));
    home = path.join(tmp, 'home');
    mkdirSync(home, { recursive: true });
    const rc = path.join(home, '.pgmrc');
    writeFileSync(
      rc,
      JSON.stringify({ api_url: baseUrl, api_key: apiKey, machine: { alias: 'devbox' } })
    );
    chmodSync(rc, 0o600);
    root = path.join(tmp, 'src');
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

  it('needs scan roots (C6)', async () => {
    const run = await pgm(['scan']);
    expect(run.code).toBe(2);
    expect(await workspaces()).toEqual([]);
  }, 120_000);

  it('records exact matches with their Claude and pi sessions and lists them as known afterwards (C6)', async () => {
    const branchFeature = await createFeature('Branch feature');
    const markerFeature = await createFeature('Marker feature');
    const short = branchFeature.slice(0, 8);

    const alpha = path.join(root, 'alpha');
    initRepo(alpha, `feat/${short}-thing`);
    const worktree = path.join(root, 'alpha.worktrees/x');
    git(alpha, ['worktree', 'add', '-q', '-b', 'side', worktree]);
    mkdirSync(path.join(worktree, '.postgram'));
    writeFileSync(
      path.join(worktree, '.postgram/feature.json'),
      JSON.stringify({ feature_id: markerFeature, created_at: '2026-10-01T00:00:00.000Z' })
    );
    writeFileSync(path.join(worktree, '.postgram/.gitignore'), '*\n');
    const beta = path.join(root, 'beta');
    initRepo(beta, 'main');
    initRepo(path.join(root, 'node_modules/hidden'), 'main');

    const projects = path.join(home, '.claude/projects');
    writeLines(path.join(projects, enc(alpha), 'sess-a.jsonl'), [
      { type: 'user', cwd: alpha, sessionId: 'sess-a' }
    ]);
    writeLines(path.join(projects, `${enc(alpha)}-sub`, 'sess-b.jsonl'), [
      { type: 'user', cwd: path.join(alpha, 'sub'), sessionId: 'sess-b' }
    ]);
    writeLines(path.join(projects, `${enc(alpha)}-sub`, 'sess-c.jsonl'), [
      { type: 'user', cwd: '/elsewhere', sessionId: 'sess-c' }
    ]);
    writeLines(path.join(projects, enc(worktree), 'sess-x.jsonl'), [
      { type: 'summary', summary: 'no cwd here' }
    ]);
    writeLines(path.join(projects, enc(beta), 'sess-beta.jsonl'), [
      { type: 'user', cwd: beta }
    ]);
    const piDir = `--${alpha.slice(1).replaceAll('/', '-')}--`;
    writeLines(
      path.join(home, '.pi/agent/sessions', piDir, '2026-10-01T10-00-00-000Z_pi-1.jsonl'),
      [{ type: 'session', version: 3, id: 'pi-1', timestamp: '2026-10-01T10:00:00.000Z', cwd: alpha }]
    );

    const dry = await pgm(['scan', '--root', root, '--yes-exact', '--dry-run']);
    expect(dry.code).toBe(0);
    expect(await workspaces()).toEqual([]);
    expect(existsSync(path.join(alpha, '.postgram/feature.json'))).toBe(false);

    const run = await pgm(['scan', '--root', root, '--yes-exact']);
    expect(run.code).toBe(0);

    const stored = await workspaces();
    expect(stored.map((w) => w.path).sort()).toEqual([alpha, worktree].sort());
    const storedAlpha = stored.find((w) => w.path === alpha);
    const storedWorktree = stored.find((w) => w.path === worktree);
    expect(storedAlpha).toMatchObject({ feature_id: branchFeature, branch: `feat/${short}-thing` });
    expect(storedWorktree).toMatchObject({ feature_id: markerFeature, branch: 'side' });
    expect(sessionIds(storedAlpha)).toEqual(['pi-1', 'sess-a', 'sess-b']);
    expect(sessionIds(storedWorktree)).toEqual(['sess-x']);
    const alphaSessions = storedAlpha?.sessions as Json[];
    expect(alphaSessions.every((session) => session.status === 'idle')).toBe(true);
    expect(alphaSessions.find((s) => s.agent_session_id === 'pi-1')).toMatchObject({
      agent_kind: 'pi',
      cwd: alpha
    });
    expect(alphaSessions.find((s) => s.agent_session_id === 'sess-b')).toMatchObject({
      agent_kind: 'claude-code',
      cwd: path.join(alpha, 'sub'),
      transcript_path: path.join(projects, `${enc(alpha)}-sub`, 'sess-b.jsonl')
    });

    const marker = JSON.parse(
      readFileSync(path.join(alpha, '.postgram/feature.json'), 'utf8')
    ) as Json;
    expect(marker.feature_id).toBe(branchFeature);
    expect(existsSync(path.join(beta, '.postgram'))).toBe(false);

    const again = await pgm(['scan', '--root', root, '--yes-exact']);
    expect(again.code).toBe(0);
    expect(`${again.stdout}${again.stderr}`).toContain('known');
    expect((await workspaces()).length).toBe(2);
  }, 180_000);

  it('inventories, applies a plan, hides done features and prunes gone worktrees', async () => {
    const existing = await createFeature('Existing feature');
    const alpha = path.join(root, 'alpha');
    initRepo(alpha, 'main');
    const beta = path.join(root, 'beta');
    initRepo(beta, 'feat/spike');
    const skipped = path.join(root, 'gamma');
    initRepo(skipped, 'main');

    const inventoryRun = await pgm(['scan', '--root', root, '--json']);
    expect(inventoryRun.code).toBe(0);
    const inventory = JSON.parse(inventoryRun.stdout) as { worktrees: Json[] };
    expect(inventory.worktrees.map((w) => w.path)).toEqual([alpha, beta, skipped]);
    expect(inventory.worktrees[1]).toMatchObject({
      branch: 'feat/spike',
      workspace_id: null,
      feature: null,
      git: { dirty_count: 0, has_upstream: false }
    });
    expect((inventory.worktrees[1]?.last_commit as Json).subject).toBe('init');
    expect(await workspaces()).toEqual([]);

    const plan = path.join(tmp, 'plan.json');
    writeFileSync(
      plan,
      JSON.stringify({
        entries: [
          { path: alpha, action: 'link', feature_id: existing.slice(0, 8) },
          { path: beta, action: 'create', title: 'Spike feature' },
          { path: skipped, action: 'skip' }
        ]
      })
    );
    const rejected = path.join(tmp, 'bad.json');
    writeFileSync(
      rejected,
      JSON.stringify([
        { path: alpha, action: 'link', feature_id: existing },
        { path: beta, action: 'link', feature_id: 'deadbeef' }
      ])
    );
    const bad = await pgm(['scan', '--apply', rejected]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('no feature matches deadbeef');
    expect(await workspaces()).toEqual([]);

    const applied = await pgm(['scan', '--apply', plan, '--json']);
    expect(applied.code).toBe(0);
    const outcome = JSON.parse(applied.stdout) as { results: Json[]; failed: number };
    expect(outcome.failed).toBe(0);
    expect(outcome.results.map((r) => r.status)).toEqual(['linked', 'created', 'skipped']);
    const stored = await workspaces();
    expect(stored.map((w) => w.path).sort()).toEqual([alpha, beta].sort());
    expect(stored.find((w) => w.path === alpha)?.feature_id).toBe(existing);
    const created = stored.find((w) => w.path === beta)?.feature_id as string;
    expect(created).toBeTruthy();

    const where = await pgm(['where']);
    expect(where.stdout).toContain('Existing feature');
    expect(where.stdout).toContain('Spike feature');
    const done = await pgm(['feature', 'done', existing.slice(0, 8)]);
    expect(done.code).toBe(0);
    const hidden = await pgm(['where']);
    expect(hidden.stdout).not.toContain('Existing feature');
    expect(hidden.stdout).toContain('Spike feature');
    expect((await pgm(['where', '--all'])).stdout).toContain('Existing feature');

    rmSync(alpha, { recursive: true, force: true });
    const dry = await pgm(['workspace', 'prune', '--dry-run']);
    expect(dry.stdout).toContain(`would remove ${alpha}`);
    expect((await workspaces()).length).toBe(2);
    const prune = await pgm(['workspace', 'prune']);
    expect(prune.code).toBe(0);
    expect((await workspaces()).map((w) => w.path)).toEqual([beta]);
    const entity = await api('GET', `/api/entities/${existing}`);
    expect((entity.entity as Json).id).toBe(existing);

    const refused = await pgm(['worktree', 'rm', beta]);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain('main working tree');
    expect(existsSync(beta)).toBe(true);
  }, 240_000);
});
