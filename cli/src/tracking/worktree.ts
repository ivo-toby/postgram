// cli/src/tracking/worktree.ts: pgm worktree new — create a feature worktree.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { AppError, ErrorCode } from '../errors.js';
import { readStdinText, shortId } from '../shared.js';
import { runTrackingCommand } from './api.js';
import type { TrackingClient } from './api.js';
import { UsageError, slug, usageExit } from './config.js';
import type { TrackingConfig } from './config.js';
import { readBootId, resolveLocalWorkspace, runGit, writeMarker } from './local.js';
import type { GitRunner, LocalWorkspace } from './local.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_RE = /^[0-9a-f]{8}$/;
const GIT_TIMEOUT_MS = 10_000;

export type TaskSummary = { id: string; title: string; isFeature: boolean };

export function taskTitle(content: string | null): string {
  const first = (content ?? '').split('\n')[0] ?? '';
  return first.trim().slice(0, 80);
}

export function matchFeature(
  arg: string,
  tasks: readonly TaskSummary[]
): TaskSummary[] {
  if (UUID_RE.test(arg)) {
    return tasks.filter((task) => task.id === arg);
  }
  if (SHORT_ID_RE.test(arg)) {
    return tasks.filter((task) => task.id.startsWith(arg));
  }
  const title = arg.trim().toLowerCase();
  return tasks.filter(
    (task) => task.isFeature && task.title.toLowerCase() === title
  );
}

export async function listTaskSummaries(
  listTasks: (input: { limit: number; offset: number }) => Promise<{
    items: Array<{
      id: string;
      content: string | null;
      metadata: Record<string, unknown>;
    }>;
    total: number;
  }>
): Promise<TaskSummary[]> {
  const summaries: TaskSummary[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await listTasks({ limit: 100, offset });
    for (const item of page.items) {
      summaries.push({
        id: item.id,
        title: taskTitle(item.content),
        isFeature: item.metadata.kind === 'feature'
      });
    }
    if (offset + 100 >= page.total) {
      break;
    }
  }
  return summaries;
}

export type WorktreeDeps = {
  client: TrackingClient;
  config: TrackingConfig;
  cwd: string;
  hostname: string;
  listTasks: Parameters<typeof listTaskSummaries>[0];
  run: GitRunner;
  exists: (path: string) => boolean;
  confirm: (question: string) => Promise<boolean>;
  bootId: () => Promise<string | null>;
  resolveWorkspace: (cwd: string) => Promise<LocalWorkspace>;
  writeMarker: (worktree: string, featureId: string) => Promise<void>;
  warn: (line: string) => void;
};

export type WorktreeNewOptions = {
  base?: string;
  path?: string;
  create: boolean;
};

export async function runWorktreeNew(
  feature: string,
  options: WorktreeNewOptions,
  deps: WorktreeDeps
): Promise<string[]> {
  const git = (args: string[]) =>
    deps.run(args, { cwd: deps.cwd, timeoutMs: GIT_TIMEOUT_MS });

  const toplevel = await git(['rev-parse', '--show-toplevel']);
  if (toplevel.ok === false) {
    throw new AppError(ErrorCode.VALIDATION, 'not in a git repository');
  }

  const commonDir = await git([
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir'
  ]);
  if (commonDir.ok === false) {
    throw new AppError(
      ErrorCode.INTERNAL,
      'could not determine the git common dir'
    );
  }
  const repoRoot = path.dirname(commonDir.stdout);

  const tasks = await listTaskSummaries(deps.listTasks);
  const matches = matchFeature(feature, tasks);

  if (matches.length > 1) {
    for (const task of matches) {
      deps.warn(`${shortId(task.id)} ${task.title}`);
    }
    throw new AppError(
      ErrorCode.CONFLICT,
      `multiple features match '${feature}'`
    );
  }

  let featureId: string;
  let title: string;
  if (matches.length === 1) {
    const match = matches[0];
    if (match === undefined) {
      throw new AppError(ErrorCode.INTERNAL, 'no matching feature');
    }
    featureId = match.id;
    title = match.title;
  } else {
    if (!options.create) {
      const confirmed = await deps.confirm(`Create feature "${feature}"?`);
      if (!confirmed) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          `no feature matches '${feature}'`
        );
      }
    }
    const created = await deps.client.createFeature({ content: feature });
    featureId = created.entity.id;
    title = taskTitle(feature);
  }

  const short = shortId(featureId);
  const name = slug(title);
  const branch = `feat/${short}-${name}`;
  const worktreePath =
    options.path !== undefined
      ? path.resolve(deps.cwd, options.path)
      : path.join(
          deps.config.worktreeRoot ?? `${repoRoot}.worktrees`,
          `${short}-${name}`
        );

  if (deps.exists(worktreePath)) {
    throw new UsageError(`worktree path already exists: ${worktreePath}`);
  }
  const branchExists = await git([
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`
  ]);
  if (branchExists.ok) {
    throw new UsageError(`branch already exists: ${branch}`);
  }

  const originHead = await git([
    'rev-parse',
    '--verify',
    '--quiet',
    'refs/remotes/origin/HEAD'
  ]);
  const base = options.base ?? (originHead.ok ? 'origin/HEAD' : 'HEAD');
  const add = await git([
    'worktree',
    'add',
    '-b',
    branch,
    worktreePath,
    base
  ]);
  if (add.ok === false) {
    throw new AppError(
      ErrorCode.INTERNAL,
      `git worktree add failed${add.timedOut ? ' (timed out)' : ''} (branch: ${branch}, base: ${base})`
    );
  }

  await deps.writeMarker(worktreePath, featureId);

  const local = await deps.resolveWorkspace(worktreePath);
  if (local.kind === 'timeout') {
    deps.warn('git timed out; skipping the workspace report');
  } else {
    try {
      await deps.client.report({
        source: 'hook',
        machine: {
          alias: deps.config.alias,
          hostname: deps.hostname,
          boot_id: await deps.bootId()
        },
        workspace: local.workspace,
        feature_id: featureId
      });
    } catch (error) {
      deps.warn(
        `report failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }

  return [worktreePath];
}

type WorktreeNewOpts = {
  base?: string;
  path?: string;
  create?: boolean;
};

async function promptConfirm(question: string): Promise<boolean> {
  process.stderr.write(`${question} [y/N] `);
  const answer = (await readStdinText()).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

export function registerWorktreeCommand(program: Command): void {
  const worktree = usageExit(
    program
      .command('worktree')
      .description('Manage feature worktrees')
  );
  const newCommand = usageExit(
    worktree
      .command('new <feature>')
      .description(
        'Create a worktree for a feature (creating it with --create or when confirmed)'
      )
      .option('--base <ref>', 'base ref for the new branch (default: origin/HEAD or HEAD)')
      .option('--path <dir>', 'worktree path (default: <worktree_root>/<8-hex>-<slug>)')
      .option('--create', 'create the feature when it does not exist')
  );
  newCommand.action(async (feature: string) => {
    const opts = newCommand.opts<WorktreeNewOpts>();
    await runTrackingCommand(newCommand, async (context) => {
      const paths = await runWorktreeNew(
        feature,
        {
          create: opts.create === true,
          ...(opts.base !== undefined ? { base: opts.base } : {}),
          ...(opts.path !== undefined ? { path: opts.path } : {})
        },
        {
          client: context.client,
          config: context.config,
          cwd: process.cwd(),
          hostname: os.hostname(),
          listTasks: (input) => context.pgm.listTasks(input),
          run: runGit,
          exists: existsSync,
          confirm: promptConfirm,
          bootId: readBootId,
          resolveWorkspace: (cwd) => resolveLocalWorkspace(cwd),
          writeMarker,
          warn: (line) => process.stderr.write(`${line}\n`)
        }
      );
      return context.json ? { path: paths[0] ?? '' } : paths;
    });
  });
}
