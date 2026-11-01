// cli/src/tracking/hooks.ts: pgm hooks install / uninstall.
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';

import {
  handleCliFailure,
  isJsonMode,
  printHuman,
  printJson
} from '../shared.js';
import { UsageError, shq, usageExit } from './config.js';

export type ClaudeSettings = Record<string, unknown>;

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
  'SessionEnd'
] as const;

export function hookCommand(nodePath: string, scriptPath: string): string {
  return `${shq(nodePath)} ${shq(scriptPath)} here --hook`;
}

export function isPostgramHook(command: string): boolean {
  return command.includes('pgm') && /\bhere --hook\b/.test(command);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOurHook(hook: unknown): boolean {
  return (
    isRecord(hook) &&
    typeof hook.command === 'string' &&
    isPostgramHook(hook.command)
  );
}

function withoutPostgramHooks(entries: unknown): unknown[] {
  const kept: unknown[] = [];
  if (!Array.isArray(entries)) {
    return kept;
  }
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter((hook) => !isOurHook(hook));
    if (hooks.length === 0) {
      continue;
    }
    kept.push({ ...entry, hooks });
  }
  return kept;
}

export function installHooks(
  settings: ClaudeSettings,
  command: string,
  keepTranscripts: number | null
): ClaudeSettings {
  const next: ClaudeSettings = structuredClone(settings);
  const hooks: ClaudeSettings = isRecord(next.hooks) ? next.hooks : {};
  for (const event of HOOK_EVENTS) {
    const kept = withoutPostgramHooks(hooks[event]);
    kept.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
    hooks[event] = kept;
  }
  next.hooks = hooks;

  if (typeof keepTranscripts === 'number') {
    const current = next.cleanupPeriodDays;
    if (!(typeof current === 'number' && current >= keepTranscripts)) {
      next.cleanupPeriodDays = keepTranscripts;
    }
  }
  return next;
}

export function uninstallHooks(settings: ClaudeSettings): ClaudeSettings {
  const next: ClaudeSettings = structuredClone(settings);
  const hooks: ClaudeSettings = isRecord(next.hooks) ? next.hooks : {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = withoutPostgramHooks(hooks[event]);
  }
  next.hooks = hooks;
  return next;
}

export function unifiedDiff(
  before: string,
  after: string,
  label: string
): string {
  if (before === after) {
    return '';
  }
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i];
    const below = lcs[i + 1];
    if (row === undefined || below === undefined) {
      continue;
    }
    for (let j = m - 1; j >= 0; j--) {
      const ai = a[i];
      const bj = b[j];
      if (ai !== undefined && bj !== undefined && ai === bj) {
        row[j] = (below[j + 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(row[j + 1] ?? 0, below[j] ?? 0);
      }
    }
  }

  const lines: string[] = [`--- ${label}`, `+++ ${label}`];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i];
    const bj = b[j];
    if (ai !== undefined && bj !== undefined && ai === bj) {
      i += 1;
      j += 1;
      continue;
    }
    const down = lcs[i + 1]?.[j] ?? 0;
    const right = lcs[i]?.[j + 1] ?? 0;
    if (down >= right) {
      if (ai !== undefined) {
        lines.push(`-${ai}`);
      }
      i += 1;
    } else {
      if (bj !== undefined) {
        lines.push(`+${bj}`);
      }
      j += 1;
    }
  }
  while (i < n) {
    const ai = a[i];
    if (ai !== undefined) {
      lines.push(`-${ai}`);
    }
    i += 1;
  }
  while (j < m) {
    const bj = b[j];
    if (bj !== undefined) {
      lines.push(`+${bj}`);
    }
    j += 1;
  }
  return lines.join('\n');
}

export function renderPiExtension(
  template: string,
  nodePath: string,
  scriptPath: string
): string {
  return template
    .replaceAll("'__PGM_NODE__'", JSON.stringify(nodePath))
    .replaceAll("'__PGM_SCRIPT__'", JSON.stringify(scriptPath));
}

export function settingsPath(input: {
  flag?: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}): string {
  if (input.flag !== undefined) {
    return input.flag;
  }
  const configDir = input.env.CLAUDE_CONFIG_DIR;
  if (configDir !== undefined && configDir !== '') {
    return path.join(configDir, 'settings.json');
  }
  return path.join(input.homeDir, '.claude', 'settings.json');
}

export function piExtensionPath(
  env: NodeJS.ProcessEnv,
  homeDir: string
): string {
  const piDir = env.PI_CODING_AGENT_DIR;
  const base =
    piDir !== undefined && piDir !== ''
      ? piDir
      : path.join(homeDir, '.pi', 'agent');
  return path.join(base, 'extensions', 'postgram.ts');
}

export type HooksDeps = {
  homeDir: string;
  env: NodeJS.ProcessEnv;
  nodePath: string;
  scriptPath: string;
  piTemplatePath: string;
  confirm: (question: string) => Promise<boolean>;
  hasCredentials: () => Promise<boolean>;
};

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function runHooksInstall(
  options: {
    settings?: string;
    yes: boolean;
    keepTranscripts?: string;
    pi: boolean;
  },
  deps: HooksDeps
): Promise<string[]> {
  let keep: number | null = null;
  if (options.keepTranscripts !== undefined) {
    const value = Number(options.keepTranscripts);
    if (!Number.isInteger(value) || value <= 0) {
      throw new UsageError('--keep-transcripts must be a positive integer');
    }
    keep = value;
  }

  if (options.pi) {
    const target = piExtensionPath(deps.env, deps.homeDir);
    const template = await readFile(deps.piTemplatePath, 'utf8');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      renderPiExtension(template, deps.nodePath, deps.scriptPath),
      'utf8'
    );
    return [`installed pi extension ${target}`];
  }

  const target = settingsPath({
    ...(options.settings !== undefined
      ? { flag: options.settings }
      : {}),
    env: deps.env,
    homeDir: deps.homeDir
  });

  let settings: ClaudeSettings = {};
  try {
    const text = await readFile(target, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new UsageError(
        `settings file ${target} must contain a JSON object`
      );
    }
    settings = parsed;
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    if (!isEnoent(error)) {
      throw new UsageError(
        `cannot read settings ${target}: ${
          error instanceof Error ? error.message : 'read failed'
        }`
      );
    }
    settings = {};
  }

  const next = installHooks(
    settings,
    hookCommand(deps.nodePath, deps.scriptPath),
    keep ?? (options.yes ? null : 365)
  );

  const diff = unifiedDiff(
    JSON.stringify(settings, null, 2),
    JSON.stringify(next, null, 2),
    target
  );
  if (diff !== '') {
    process.stderr.write(`${diff}\n`);
  }

  if (!options.yes) {
    const confirmed = await deps.confirm(`Write ${target}?`);
    if (!confirmed) {
      throw new UsageError('aborted');
    }
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  if (!(await deps.hasCredentials())) {
    process.stderr.write(
      'Warning: ~/.pgmrc has no api_url or api_key; hooks may not inherit PGM_API_*.\n'
    );
  }

  return [`installed hooks in ${target}`];
}

export async function runHooksUninstall(
  options: { settings?: string; pi: boolean },
  deps: HooksDeps
): Promise<string[]> {
  if (options.pi) {
    const target = piExtensionPath(deps.env, deps.homeDir);
    try {
      await rm(target);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
    }
    return [`removed pi extension ${target}`];
  }

  const target = settingsPath({
    ...(options.settings !== undefined
      ? { flag: options.settings }
      : {}),
    env: deps.env,
    homeDir: deps.homeDir
  });

  try {
    const text = await readFile(target, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new UsageError(
        `settings file ${target} must contain a JSON object`
      );
    }
    await writeFile(
      target,
      `${JSON.stringify(uninstallHooks(parsed), null, 2)}\n`,
      'utf8'
    );
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    if (!isEnoent(error)) {
      throw error;
    }
  }
  return [`removed hooks in ${target}`];
}

async function hasCredentials(homeDir: string): Promise<boolean> {
  try {
    const text = await readFile(path.join(homeDir, '.pgmrc'), 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return false;
    }
    return (
      typeof parsed.api_url === 'string' &&
      parsed.api_url !== '' &&
      typeof parsed.api_key === 'string' &&
      parsed.api_key !== ''
    );
  } catch {
    return false;
  }
}

function confirmStdin(question: string): Promise<boolean> {
  process.stderr.write(`${question} [y/N] `);
  return new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false
    });
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      resolve(value);
    };
    rl.on('line', (line) => {
      const answer = line.trim().toLowerCase();
      done(answer === 'y' || answer === 'yes');
    });
    rl.on('close', () => done(false));
  });
}

function realDeps(): HooksDeps {
  const homeDir = os.homedir();
  return {
    homeDir,
    env: process.env,
    nodePath: process.execPath,
    scriptPath: realpathSync(process.argv[1] ?? ''),
    piTemplatePath: fileURLToPath(
      new URL('../../integrations/pi/postgram.ts', import.meta.url)
    ),
    confirm: confirmStdin,
    hasCredentials: () => hasCredentials(homeDir)
  };
}

async function runHooksCommand(
  command: Command,
  run: () => Promise<string[]>
): Promise<void> {
  const json = isJsonMode(command);
  try {
    const lines = await run();
    if (json) {
      printJson(lines);
    } else {
      printHuman(lines);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    await handleCliFailure(error, json);
  }
}

type HooksInstallOptions = {
  settings?: string;
  yes?: boolean;
  keepTranscripts?: string;
  pi?: boolean;
};

type HooksUninstallOptions = {
  settings?: string;
  pi?: boolean;
};

export function registerHooksCommands(program: Command): void {
  const hooks = usageExit(
    program
      .command('hooks')
      .description('Install and remove Postgram agent hooks')
  );

  const install = hooks
    .command('install')
    .description(
      'Install the Claude Code settings hooks (or the pi extension with --pi)'
    )
    .option('--settings <path>', 'path to the Claude Code settings file')
    .option('--yes', 'write without confirming')
    .option(
      '--keep-transcripts <days>',
      'set cleanupPeriodDays to this many days'
    )
    .option('--pi', 'install only the pi extension');
  usageExit(install);
  install.action(async (options: HooksInstallOptions, command: Command) => {
    await runHooksCommand(command, () =>
      runHooksInstall(
        {
          yes: options.yes === true,
          pi: options.pi === true,
          ...(options.settings !== undefined
            ? { settings: options.settings }
            : {}),
          ...(options.keepTranscripts !== undefined
            ? { keepTranscripts: options.keepTranscripts }
            : {})
        },
        realDeps()
      )
    );
  });

  const uninstall = hooks
    .command('uninstall')
    .description(
      'Remove the Postgram hooks (or the pi extension with --pi)'
    )
    .option('--settings <path>', 'path to the Claude Code settings file')
    .option('--pi', 'remove the pi extension');
  usageExit(uninstall);
  uninstall.action(
    async (options: HooksUninstallOptions, command: Command) => {
      await runHooksCommand(command, () =>
        runHooksUninstall(
          {
            pi: options.pi === true,
            ...(options.settings !== undefined
              ? { settings: options.settings }
              : {})
          },
          realDeps()
        )
      );
    }
  );
}
