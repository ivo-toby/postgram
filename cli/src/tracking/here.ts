// cli/src/tracking/here.ts: pgm here — hook and manual workspace/session reports.
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { readStdinText, resolvePgmConfig, shortId } from '../shared.js';
import { createTrackingClient } from './api.js';
import type { TrackingClient } from './api.js';
import { loadTrackingConfig, usageExit } from './config.js';
import type { TrackingConfig } from './config.js';
import { readBootId, readMarker, resolveLocalWorkspace } from './local.js';
import type { LocalWorkspace } from './local.js';
import { AGENT_KINDS } from './types.js';
import type { AgentKind, ReportBody, SessionEvent } from './types.js';

const HOOK_EVENTS: Record<string, SessionEvent> = {
  SessionStart: 'start',
  UserPromptSubmit: 'activity',
  Stop: 'stop',
  SessionEnd: 'end'
};

const SESSION_EVENTS: readonly SessionEvent[] = ['start', 'activity', 'stop', 'end'];

const LOG_ROTATE_BYTES = 1_048_576;

export type HookInput =
  | {
      kind: 'report';
      event: SessionEvent;
      sessionId: string | null;
      cwd?: string;
      transcriptPath?: string | null;
      reason?: string;
      hookEvent: string;
    }
  | { kind: 'ignore' }
  | { kind: 'invalid' };

export function parseHookInput(raw: string): HookInput {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { kind: 'invalid' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'invalid' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'invalid' };
  }

  const obj = parsed as Record<string, unknown>;
  const hookEvent = obj.hook_event_name;
  if (typeof hookEvent !== 'string') {
    return { kind: 'invalid' };
  }

  const event = HOOK_EVENTS[hookEvent];
  if (event === undefined) {
    return { kind: 'ignore' };
  }

  const sessionId =
    typeof obj.session_id === 'string' && obj.session_id !== ''
      ? obj.session_id
      : null;
  const cwd = typeof obj.cwd === 'string' ? obj.cwd : undefined;
  const transcriptRaw = obj.transcript_path;
  const transcriptPath =
    typeof transcriptRaw === 'string' || transcriptRaw === null
      ? transcriptRaw
      : undefined;
  const reasonRaw =
    hookEvent === 'SessionStart'
      ? obj.source
      : hookEvent === 'SessionEnd'
        ? obj.reason
        : undefined;
  const reason =
    typeof reasonRaw === 'string' && reasonRaw !== '' ? reasonRaw : undefined;

  return {
    kind: 'report',
    event,
    sessionId,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(transcriptPath !== undefined ? { transcriptPath } : {}),
    ...(reason !== undefined ? { reason } : {}),
    hookEvent
  };
}

export type HereOptions = {
  hook: boolean;
  quiet: boolean;
  agent?: string;
  sessionId?: string;
  event?: string;
  reason?: string;
  cwd?: string;
  transcript?: string;
};

export type HereDeps = {
  config: TrackingConfig | null;
  client: TrackingClient | null;
  stdin: () => Promise<string>;
  cwd: string;
  hostname: string;
  homeDir: string;
  now: () => number;
  bootId: () => Promise<string | null>;
  resolveWorkspace: (cwd: string, budgetMs: number) => Promise<LocalWorkspace>;
  readMarker: (worktree: string) => Promise<string | null>;
  log: (line: string) => Promise<void>;
};

function asAgentKind(value: string | undefined): AgentKind | null {
  if (value !== undefined && (AGENT_KINDS as readonly string[]).includes(value)) {
    return value as AgentKind;
  }
  return null;
}

function asSessionEvent(value: string | undefined): SessionEvent | null {
  if (
    value !== undefined &&
    (SESSION_EVENTS as readonly string[]).includes(value)
  ) {
    return value as SessionEvent;
  }
  return null;
}

function featureLine(feature: { id: string; title: string; stage: string | null }): string {
  return `Postgram: this worktree belongs to feature ${shortId(feature.id)} "${feature.title}" (stage: ${feature.stage ?? 'building'}).`;
}

export async function runHere(
  options: HereOptions,
  deps: HereDeps
): Promise<{ stdout: string; exitCode: 0 | 2 }> {
  let agent: AgentKind;
  let sessionId: string | null;
  let event: SessionEvent | null;
  let cwd: string;
  let transcriptPath: string | null;
  let reason: string | undefined;
  let hookEvent: string | null = null;

  if (options.hook) {
    const parsed = parseHookInput(await deps.stdin());
    if (parsed.kind === 'invalid') {
      await deps.log('invalid hook input');
      return { stdout: '', exitCode: 0 };
    }
    if (parsed.kind === 'ignore') {
      return { stdout: '', exitCode: 0 };
    }
    agent = asAgentKind(options.agent) ?? 'claude-code';
    sessionId = parsed.sessionId ?? options.sessionId ?? null;
    event = parsed.event;
    cwd = parsed.cwd ?? options.cwd ?? deps.cwd;
    transcriptPath = parsed.transcriptPath ?? options.transcript ?? null;
    reason = parsed.reason ?? options.reason;
    hookEvent = parsed.hookEvent;
  } else {
    if (options.agent !== undefined && asAgentKind(options.agent) === null) {
      process.stderr.write(`pgm here: invalid --agent '${options.agent}'\n`);
      return { stdout: '', exitCode: 2 };
    }
    if (options.event !== undefined && asSessionEvent(options.event) === null) {
      process.stderr.write(`pgm here: invalid --event '${options.event}'\n`);
      return { stdout: '', exitCode: 2 };
    }
    agent = asAgentKind(options.agent) ?? 'claude-code';
    sessionId = options.sessionId ?? null;
    event = asSessionEvent(options.event);
    cwd = options.cwd ?? deps.cwd;
    transcriptPath = options.transcript ?? null;
    reason = options.reason;
  }

  if (deps.config === null) {
    await deps.log('missing config');
    return { stdout: '', exitCode: 0 };
  }
  const config = deps.config;

  if (deps.client === null) {
    await deps.log('missing credentials');
    return { stdout: '', exitCode: 0 };
  }
  const client = deps.client;

  const start = deps.now();
  const local = await deps.resolveWorkspace(cwd, 800);
  if (local.kind === 'timeout') {
    await deps.log('git timeout');
    return { stdout: '', exitCode: 0 };
  }

  const marker = await deps.readMarker(local.path);
  const bootId = await deps.bootId();

  const session =
    sessionId !== null || event !== null
      ? {
          agent_kind: agent,
          agent_session_id: sessionId,
          event: event ?? 'activity',
          ...(reason !== undefined ? { reason } : {}),
          cwd,
          transcript_path: transcriptPath
        }
      : undefined;

  const body: ReportBody = {
    source: 'hook',
    machine: { alias: config.alias, hostname: deps.hostname, boot_id: bootId },
    workspace: local.workspace,
    ...(marker !== null ? { feature_id: marker } : {}),
    ...(session !== undefined ? { session } : {})
  };

  const timeoutMs = Math.max(
    100,
    config.hereTimeoutMs - (deps.now() - start) - 100
  );

  let feature: { id: string; title: string; stage: string | null } | null;
  try {
    const response = await client.report(body, { timeoutMs });
    feature = response.feature;
  } catch (error) {
    await deps.log(error instanceof Error ? error.message : 'report failed');
    return { stdout: '', exitCode: 0 };
  }

  if (options.hook) {
    if (
      event === 'start' &&
      hookEvent === 'SessionStart' &&
      options.quiet === false &&
      feature !== null
    ) {
      return { stdout: `${featureLine(feature)}\n`, exitCode: 0 };
    }
    return { stdout: '', exitCode: 0 };
  }

  const line =
    feature !== null
      ? `registered ${config.alias}:${local.path} → feature ${shortId(feature.id)} (${feature.stage ?? 'building'})`
      : `registered ${config.alias}:${local.path} (unassigned)`;
  return { stdout: `${line}\n`, exitCode: 0 };
}

export async function appendHereLog(
  homeDir: string,
  message: string,
  now?: Date
): Promise<void> {
  const dir = path.join(homeDir, '.pgm');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'here.log');
  const rotated = path.join(dir, 'here.log.1');

  try {
    const existing = await stat(file);
    if (existing.size >= LOG_ROTATE_BYTES) {
      await rename(file, rotated);
    }
  } catch {
    // no existing log file
  }

  const line = `${(now ?? new Date()).toISOString()} ${message.replace(/\r?\n/g, ' ')}\n`;
  await appendFile(file, line, 'utf8');
}

type HereCommandOpts = {
  agent?: string;
  sessionId?: string;
  event?: string;
  reason?: string;
  cwd?: string;
  transcript?: string;
  hook?: boolean;
  quiet?: boolean;
};

export function registerHereCommand(program: Command): void {
  const command = usageExit(
    program
      .command('here')
      .description('Report this workspace (and session) to Postgram')
      .option('--agent <kind>', 'agent kind (claude-code, pi, talon, other)')
      .option('--session-id <id>', 'agent session id')
      .option('--event <event>', 'session event (start, activity, stop, end)')
      .option('--reason <text>', 'reason text')
      .option('--cwd <dir>', 'working directory to report')
      .option('--transcript <path>', 'transcript path')
      .option('--hook', 'read the Claude Code hook JSON from stdin')
      .option('--quiet', 'suppress the SessionStart feature line')
  ).action(async () => {
    const opts = command.opts<HereCommandOpts>();

    let config: TrackingConfig | null = null;
    try {
      config = await loadTrackingConfig();
    } catch {
      config = null;
    }

    let client: TrackingClient | null = null;
    try {
      client = createTrackingClient(await resolvePgmConfig());
    } catch {
      client = null;
    }

    const homeDir = os.homedir();
    const deps: HereDeps = {
      config,
      client,
      stdin: readStdinText,
      cwd: process.cwd(),
      hostname: os.hostname(),
      homeDir,
      now: Date.now,
      bootId: readBootId,
      resolveWorkspace: (cwd, budgetMs) => resolveLocalWorkspace(cwd, { budgetMs }),
      readMarker,
      log: (line) => appendHereLog(homeDir, line)
    };

    try {
      const result = await runHere(
        {
          hook: opts.hook === true,
          quiet: opts.quiet === true,
          ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
          ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
          ...(opts.event !== undefined ? { event: opts.event } : {}),
          ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          ...(opts.transcript !== undefined ? { transcript: opts.transcript } : {})
        },
        deps
      );
      if (result.stdout !== '') {
        process.stdout.write(result.stdout);
      }
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    } catch (error) {
      try {
        await appendHereLog(
          homeDir,
          error instanceof Error ? error.message : 'here failed'
        );
      } catch {
        // the hook must still exit 0
      }
    }
  });
}
