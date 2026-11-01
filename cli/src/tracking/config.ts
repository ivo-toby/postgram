// cli/src/tracking/config.ts
import { chmod, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { AGENT_KINDS } from './types.js';
import type { AgentKind } from './types.js';

export type ResumeTemplate = {
  with_id: string | null;
  without_id: string | null;
};

export type ResumeTemplates = Record<AgentKind, ResumeTemplate>;

export const DEFAULT_RESUME: ResumeTemplates = {
  'claude-code': { with_id: 'claude --resume {session_id}', without_id: 'claude' },
  pi: { with_id: 'pi --session {session_id}', without_id: 'pi' },
  talon: { with_id: null, without_id: null },
  other: { with_id: null, without_id: null }
};

export type TrackingConfig = {
  alias: string;
  connectTarget: string;
  scanRoots: string[];
  worktreeRoot: string | null;
  hereTimeoutMs: number;
  resume: ResumeTemplates;
};

export class UsageError extends Error {}

export function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'feature'
  );
}

export function defaultAlias(hostname: string): string {
  const head = hostname.toLowerCase().split('.')[0] ?? '';
  return head.replace(/[^a-z0-9._-]/g, '-') || 'machine';
}

export function expandHome(value: string, homeDir: string): string {
  if (value === '~') {
    return homeDir;
  }
  if (value.startsWith('~/')) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function cloneResume(templates: ResumeTemplates): ResumeTemplates {
  const result = {} as Record<AgentKind, ResumeTemplate>;
  for (const kind of AGENT_KINDS) {
    const base = templates[kind];
    result[kind] = { with_id: base.with_id, without_id: base.without_id };
  }
  return result;
}

export function parseTrackingConfig(
  raw: unknown,
  input: { homeDir: string; hostname: string }
): TrackingConfig {
  const machine = isRecord(raw) ? (isRecord(raw.machine) ? raw.machine : {}) : {};

  const alias =
    nonEmptyString(machine.alias) ?? defaultAlias(input.hostname);
  const connectTarget = nonEmptyString(machine.connect_target) ?? alias;

  const scanRoots: string[] = [];
  if (isRecord(raw) && Array.isArray(raw.scan_roots)) {
    for (const entry of raw.scan_roots) {
      if (typeof entry === 'string') {
        scanRoots.push(expandHome(entry, input.homeDir));
      }
    }
  }

  const worktreeRoot =
    isRecord(raw) && typeof raw.worktree_root === 'string'
      ? expandHome(raw.worktree_root, input.homeDir)
      : null;

  const timeout = isRecord(raw) ? raw.here_timeout_ms : undefined;
  const hereTimeoutMs =
    typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
      ? timeout
      : 2000;

  const resume = cloneResume(DEFAULT_RESUME);
  const rawResume = isRecord(raw) && isRecord(raw.resume) ? raw.resume : {};
  for (const kind of AGENT_KINDS) {
    const kindConfig = rawResume[kind];
    if (!isRecord(kindConfig)) {
      continue;
    }
    if (typeof kindConfig.with_id === 'string' || kindConfig.with_id === null) {
      resume[kind].with_id = kindConfig.with_id;
    }
    if (
      typeof kindConfig.without_id === 'string' ||
      kindConfig.without_id === null
    ) {
      resume[kind].without_id = kindConfig.without_id;
    }
  }

  return { alias, connectTarget, scanRoots, worktreeRoot, hereTimeoutMs, resume };
}

export async function loadTrackingConfig(
  input?: { homeDir?: string; hostname?: string }
): Promise<TrackingConfig> {
  const homeDir = input?.homeDir ?? os.homedir();
  const hostname = input?.hostname ?? os.hostname();

  let raw: unknown = {};
  try {
    const text = await readFile(path.join(homeDir, '.pgmrc'), 'utf8');
    raw = JSON.parse(text);
  } catch {
    raw = {};
  }

  return parseTrackingConfig(raw, { homeDir, hostname });
}

export async function writeMachineConfig(
  input: { alias?: string; connectTarget?: string; homeDir?: string }
): Promise<{
  previousAlias: string | null;
  alias: string;
  connectTarget: string;
}> {
  const homeDir = input.homeDir ?? os.homedir();
  const rcPath = path.join(homeDir, '.pgmrc');

  let doc: Record<string, unknown> = {};
  let text: string | null = null;
  try {
    text = await readFile(rcPath, 'utf8');
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
  if (text !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new UsageError(
        `~/.pgmrc contains invalid JSON: ${
          error instanceof Error ? error.message : 'parse failed'
        }`
      );
    }
    if (!isRecord(parsed)) {
      throw new UsageError('~/.pgmrc must be a JSON object');
    }
    doc = parsed;
  }

  const machine = isRecord(doc.machine) ? doc.machine : {};
  const previousAlias = nonEmptyString(machine.alias);

  const alias =
    nonEmptyString(input.alias) ??
    previousAlias ??
    defaultAlias(os.hostname());
  const connectTarget =
    nonEmptyString(input.connectTarget) ??
    nonEmptyString(machine.connect_target) ??
    alias;

  doc.machine = { ...machine, alias, connect_target: connectTarget };

  await writeFile(rcPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await chmod(rcPath, 0o600);

  return { previousAlias, alias, connectTarget };
}

export function usageExit(command: Command): Command {
  command.exitOverride((error) => {
    process.exit(error.exitCode === 0 ? 0 : 2);
  });
  return command;
}
