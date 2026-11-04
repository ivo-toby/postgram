// cli/src/tracking/scan-discovery.ts: pgm scan repository and session discovery (research R9).
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { GitRunner } from './local.js';
import { runGit } from './local.js';

export type ScannedWorktree = { path: string; branch: string | null };
export type ScannedSession = {
  agent_kind: 'claude-code' | 'pi';
  agent_session_id: string;
  cwd: string | null;
  transcript_path: string;
  observed_at: string;
};

async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
}

async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    await stat(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function findRepositories(
  roots: readonly string[],
  depth: number
): Promise<string[]> {
  const found = new Set<string>();
  const visit = async (dir: string, level: number): Promise<void> => {
    if (await hasGitEntry(dir)) {
      found.add(await realpath(dir));
      return;
    }
    if (level >= depth) {
      return;
    }
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) {
        continue;
      }
      const child = path.join(dir, name);
      if (await isDirectory(child)) {
        await visit(child, level + 1);
      }
    }
  };
  for (const root of roots) {
    let resolved: string;
    try {
      resolved = await realpath(root);
    } catch {
      continue;
    }
    if (!(await isDirectory(resolved))) {
      continue;
    }
    await visit(resolved, 0);
  }
  return [...found].sort();
}

export async function listWorktrees(
  repo: string,
  run?: GitRunner
): Promise<ScannedWorktree[]> {
  const runner = run ?? runGit;
  const result = await runner(['worktree', 'list', '--porcelain'], {
    cwd: repo,
    timeoutMs: 5000
  });
  if (!result.ok) {
    return [];
  }
  const out: ScannedWorktree[] = [];
  for (const block of result.stdout.split('\n\n')) {
    const trimmed = block.trim();
    if (trimmed === '') {
      continue;
    }
    let worktree: string | null = null;
    let branch: string | null = null;
    let bare = false;
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('worktree ')) {
        worktree = line.slice('worktree '.length);
      } else if (line.startsWith('branch refs/heads/')) {
        branch = line.slice('branch refs/heads/'.length);
      } else if (line === 'bare') {
        bare = true;
      }
    }
    if (worktree === null || bare) {
      continue;
    }
    if (!(await isDirectory(worktree))) {
      continue;
    }
    out.push({ path: await realpath(worktree), branch });
  }
  return out;
}

export async function discoverWorktrees(
  roots: readonly string[],
  depth: number,
  run?: GitRunner
): Promise<ScannedWorktree[]> {
  const repos = await findRepositories(roots, depth);
  const byPath = new Map<string, ScannedWorktree>();
  for (const repo of repos) {
    for (const worktree of await listWorktrees(repo, run)) {
      byPath.set(worktree.path, worktree);
    }
  }
  return [...byPath.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
}

export function claudeEncode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '-');
}

function bySessionId(a: ScannedSession, b: ScannedSession): number {
  return a.agent_session_id < b.agent_session_id
    ? -1
    : a.agent_session_id > b.agent_session_id
      ? 1
      : 0;
}

function lineCwd(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const cwd = (parsed as { cwd?: unknown }).cwd;
  return typeof cwd === 'string' ? cwd : null;
}

async function claudeSession(
  transcript: string,
  worktree: string
): Promise<ScannedSession | null> {
  let text: string;
  try {
    text = await readFile(transcript, 'utf8');
  } catch {
    return null;
  }
  let cwd: string | null = null;
  for (const line of text.split('\n').slice(0, 200)) {
    const value = lineCwd(line);
    if (value !== null) {
      cwd = value;
      break;
    }
  }
  if (cwd !== null && cwd !== worktree && !cwd.startsWith(worktree + '/')) {
    return null;
  }
  const mtime = (await stat(transcript)).mtime;
  return {
    agent_kind: 'claude-code',
    agent_session_id: path.basename(transcript, '.jsonl'),
    cwd,
    transcript_path: transcript,
    observed_at: mtime.toISOString()
  };
}

export async function findClaudeSessions(
  worktrees: readonly string[],
  claudeDir: string
): Promise<{ sessions: Map<string, ScannedSession[]>; notes: string[] }> {
  const notes: string[] = [];
  const encs = new Map<string, string>();
  for (const worktree of worktrees) {
    const enc = claudeEncode(worktree);
    if (enc.length > 200) {
      notes.push(`skipped ${worktree}: encoded path too long`);
      continue;
    }
    encs.set(worktree, enc);
  }
  const sessions = new Map<string, ScannedSession[]>();
  const projectsDir = path.join(claudeDir, 'projects');
  let entries: string[];
  try {
    entries = await readdir(projectsDir);
  } catch {
    return { sessions, notes };
  }
  for (const name of entries) {
    const dir = path.join(projectsDir, name);
    if (!(await isDirectory(dir))) {
      continue;
    }
    let best: string | null = null;
    let bestLen = -1;
    for (const [worktree, enc] of encs) {
      if (name === enc || name.startsWith(enc + '-')) {
        if (enc.length > bestLen) {
          bestLen = enc.length;
          best = worktree;
        }
      }
    }
    if (best === null) {
      continue;
    }
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    const found: ScannedSession[] = [];
    for (const file of files) {
      if (!file.endsWith('.jsonl')) {
        continue;
      }
      const session = await claudeSession(path.join(dir, file), best);
      if (session !== null) {
        found.push(session);
      }
    }
    if (found.length > 0) {
      const existing = sessions.get(best) ?? [];
      existing.push(...found);
      existing.sort(bySessionId);
      sessions.set(best, existing);
    }
  }
  return { sessions, notes };
}

async function piSession(transcript: string): Promise<ScannedSession | null> {
  let text: string;
  try {
    text = await readFile(transcript, 'utf8');
  } catch {
    return null;
  }
  const first = text.split('\n')[0];
  if (first === undefined || first.trim() === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(first);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const header = parsed as { id?: unknown; cwd?: unknown };
  if (typeof header.id !== 'string') {
    return null;
  }
  const mtime = (await stat(transcript)).mtime;
  return {
    agent_kind: 'pi',
    agent_session_id: header.id,
    cwd: typeof header.cwd === 'string' ? header.cwd : null,
    transcript_path: transcript,
    observed_at: mtime.toISOString()
  };
}

export async function findPiSessions(
  worktrees: readonly string[],
  piDir: string
): Promise<Map<string, ScannedSession[]>> {
  const sessions = new Map<string, ScannedSession[]>();
  for (const worktree of worktrees) {
    const dir = path.join(
      piDir,
      'sessions',
      `--${worktree.replace(/^\/+/, '').replaceAll('/', '-')}--`
    );
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    const found: ScannedSession[] = [];
    for (const file of files) {
      if (!file.endsWith('.jsonl')) {
        continue;
      }
      const session = await piSession(path.join(dir, file));
      if (session !== null) {
        found.push(session);
      }
    }
    if (found.length > 0) {
      found.sort(bySessionId);
      sessions.set(worktree, found);
    }
  }
  return sessions;
}
