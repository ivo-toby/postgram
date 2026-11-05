// cli/src/tracking/scan.ts: pgm scan — discover worktrees and record their features.
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import type { Command } from 'commander';

import { shortId } from '../shared.js';
import { runTrackingCommand } from './api.js';
import type { TrackingClient } from './api.js';
import { expandHome, isIgnoredPath, slug, usageExit, UsageError } from './config.js';
import type { TrackingConfig } from './config.js';
import { readMarker, resolveLocalWorkspace, runGit, writeMarker } from './local.js';
import type { LocalWorkspace } from './local.js';
import { discoverWorktrees, findClaudeSessions, findPiSessions } from './scan-discovery.js';
import type { ScannedSession, ScannedWorktree } from './scan-discovery.js';
import type { ReportBody, ReportGit, ReportSession } from './types.js';
import { syncMissing } from './where.js';

export type Proposal = {
  kind: 'marker' | 'short-id' | 'search';
  featureId: string;
  title: string;
};

export const BRANCH_SHORT_ID = /(?:^|\/)([0-9a-f]{8})(?:-|$)/;

/** A feature task. `tasks` only ever holds features; `done` hides it from proposals. */
export type ScanTask = { id: string; title: string; done?: boolean };

/** Keeps the feature tasks of a task listing, so plain tasks are never offered or linked. */
export function featureTasks(
  items: ReadonlyArray<{
    id: string;
    content: string | null;
    status?: string | null;
    metadata: Record<string, unknown>;
  }>
): ScanTask[] {
  return items
    .filter((item) => item.metadata.kind === 'feature')
    .map((item) => ({
      id: item.id,
      title: firstLineTitle(item.content),
      done: item.status === 'done'
    }));
}

export type ScanDeps = {
  client: TrackingClient;
  config: TrackingConfig;
  hostname: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  /** Feature tasks only (see featureTasks). */
  tasks: () => Promise<ScanTask[]>;
  search: (
    query: string
  ) => Promise<Array<{ id: string; title: string }>>;
  ask: (question: string) => Promise<string>;
  discover: typeof discoverWorktrees;
  claudeSessions: typeof findClaudeSessions;
  piSessions: typeof findPiSessions;
  resolveWorkspace: (path: string) => Promise<LocalWorkspace>;
  readMarker: (worktree: string) => Promise<string | null>;
  writeMarker: (worktree: string, featureId: string) => Promise<void>;
  exists: (path: string) => boolean;
  isTty: () => boolean;
  realpath: (path: string) => Promise<string>;
  lastCommit: (worktree: string) => Promise<{ date: string; subject: string } | null>;
  info: (line: string) => void;
};

export type ScanOptions = {
  root: string[];
  depth?: string;
  yesExact: boolean;
  dryRun: boolean;
};

const DEFAULT_DEPTH = 3;

function parseDepth(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_DEPTH;
  }
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new UsageError(
      `invalid --depth '${raw}': must be a positive integer`
    );
  }
  return Number.parseInt(raw, 10);
}

function withoutFeatPrefix(branch: string): string {
  return branch.startsWith('feat/') ? branch.slice('feat/'.length) : branch;
}

function newFeatureTitle(branch: string | null, dirName: string): string {
  if (branch === null || branch === '') {
    return dirName;
  }
  return withoutFeatPrefix(branch).replaceAll('-', ' ');
}

async function buildProposals(
  worktree: ScannedWorktree,
  deps: ScanDeps,
  tasks: ScanTask[],
  yesExact: boolean
): Promise<Proposal[]> {
  const proposals: Proposal[] = [];
  const titleFor = (id: string): string =>
    tasks.find((task) => task.id === id)?.title ?? '';

  const marker = await deps.readMarker(worktree.path);
  if (marker !== null) {
    proposals.push({ kind: 'marker', featureId: marker, title: titleFor(marker) });
  }

  if (worktree.branch !== null) {
    const match = BRANCH_SHORT_ID.exec(worktree.branch);
    const short = match?.[1];
    if (short !== undefined) {
      const hits = tasks.filter((task) => task.id.startsWith(short));
      if (hits.length === 1) {
        const hit = hits[0];
        if (hit !== undefined) {
          proposals.push({ kind: 'short-id', featureId: hit.id, title: hit.title });
        }
      }
    }

    if (!yesExact) {
      let hits: Array<{ id: string; title: string }> = [];
      try {
        hits = await deps.search(slug(withoutFeatPrefix(worktree.branch)));
      } catch {
        hits = [];
      }
      // Search covers every task; only open features are worth proposing.
      const open = new Set(
        tasks.filter((task) => task.done !== true).map((task) => task.id)
      );
      for (const hit of hits.filter((h) => open.has(h.id)).slice(0, 3)) {
        proposals.push({ kind: 'search', featureId: hit.id, title: hit.title });
      }
    }
  }

  return proposals;
}

function sessionsFor(
  worktree: ScannedWorktree,
  claude: Map<string, ScannedSession[]>,
  pi: Map<string, ScannedSession[]>
): ReportSession[] {
  return [
    ...(claude.get(worktree.path) ?? []),
    ...(pi.get(worktree.path) ?? [])
  ];
}

function scanRoots(options: ScanOptions, deps: ScanDeps): string[] {
  const roots =
    options.root.length > 0
      ? options.root.map((root) => path.resolve(root))
      : deps.config.scanRoots;
  if (roots.length === 0) {
    throw new UsageError(
      'no scan roots: pass --root <dir> or set scan_roots in ~/.pgmrc'
    );
  }
  return roots;
}

async function discoverNotIgnored(
  roots: readonly string[],
  depth: number,
  deps: ScanDeps
): Promise<ScannedWorktree[]> {
  const worktrees = await deps.discover(roots, depth);
  return worktrees.filter(
    (worktree) => !isIgnoredPath(worktree.path, deps.config.ignorePaths)
  );
}

async function findSessions(
  paths: readonly string[],
  deps: ScanDeps
): Promise<{
  claude: Map<string, ScannedSession[]>;
  pi: Map<string, ScannedSession[]>;
}> {
  const claudeDir =
    deps.env.CLAUDE_CONFIG_DIR ?? path.join(deps.homeDir, '.claude');
  const piDir =
    deps.env.PI_CODING_AGENT_DIR ?? path.join(deps.homeDir, '.pi', 'agent');
  const claude = await deps.claudeSessions(paths, claudeDir);
  for (const note of claude.notes) {
    deps.info(note);
  }
  const pi = await deps.piSessions(paths, piDir);
  return { claude: claude.sessions, pi };
}

type OkLocal = Extract<LocalWorkspace, { kind: 'ok' }>;

async function recordLocal(
  local: OkLocal,
  featureId: string,
  sessions: ReportSession[],
  deps: ScanDeps
): Promise<void> {
  const body: ReportBody = {
    source: 'scan',
    machine: {
      alias: deps.config.alias,
      hostname: deps.hostname,
      boot_id: null
    },
    workspace: local.workspace,
    feature_id: featureId,
    sessions
  };
  await deps.client.report(body);

  if ((await deps.readMarker(local.path)) !== featureId) {
    await deps.writeMarker(local.path, featureId);
  }
}

export async function runScan(
  options: ScanOptions,
  deps: ScanDeps
): Promise<string[]> {
  if (!options.yesExact && !deps.isTty()) {
    throw new UsageError(
      'pgm scan needs a terminal for its interactive flow. Without one, use `pgm scan --json` to list worktrees, `pgm scan --apply <plan.json>` to apply a plan, or `pgm scan --yes-exact`.'
    );
  }
  const roots = scanRoots(options, deps);
  const depth = parseDepth(options.depth);

  const knownResponse = await deps.client.listWorkspaces({
    machine: deps.config.alias
  });
  if (!options.dryRun) {
    await syncMissing(knownResponse.workspaces, {
      localAlias: deps.config.alias,
      exists: deps.exists,
      patch: (id, missing) => deps.client.patchWorkspace(id, { missing })
    });
  }
  const known = new Set(knownResponse.workspaces.map((workspace) => workspace.path));

  const worktrees = await discoverNotIgnored(roots, depth, deps);
  const { claude, pi } = await findSessions(
    worktrees.map((worktree) => worktree.path),
    deps
  );

  const tasks = await deps.tasks();
  const lines: string[] = [];

  for (const worktree of worktrees) {
    if (known.has(worktree.path)) {
      lines.push(`known ${worktree.path}`);
      continue;
    }

    const proposals = await buildProposals(
      worktree,
      deps,
      tasks,
      options.yesExact
    );

    let featureId: string | null = null;

    if (options.yesExact) {
      const first = proposals[0];
      if (
        first !== undefined &&
        (first.kind === 'marker' || first.kind === 'short-id')
      ) {
        featureId = first.featureId;
      } else {
        lines.push(`skipped ${worktree.path}`);
        continue;
      }
    } else {
      deps.info(
        `${worktree.path}${
          worktree.branch !== null ? ` (${worktree.branch})` : ''
        }`
      );
      proposals.forEach((proposal, index) => {
        deps.info(
          `  ${index + 1}. ${proposal.kind}: ${
            proposal.title !== '' ? proposal.title : proposal.featureId
          }`
        );
      });
      const answer = (
        await deps.ask('[a]ccept, [1-3] pick, [n]ew feature, [s]kip')
      )
        .trim()
        .toLowerCase();
      if (answer === 'a') {
        const first = proposals[0];
        if (first !== undefined) {
          featureId = first.featureId;
        }
      } else if (/^[1-9]$/.test(answer)) {
        const picked = proposals[Number.parseInt(answer, 10) - 1];
        if (picked !== undefined) {
          featureId = picked.featureId;
        }
      } else if (answer === 'n') {
        const created = await deps.client.createFeature({
          content: newFeatureTitle(
            worktree.branch,
            path.basename(worktree.path)
          )
        });
        featureId = created.entity.id;
      }
      if (featureId === null) {
        lines.push(`skipped ${worktree.path}`);
        continue;
      }
    }

    const id = featureId;

    if (options.dryRun) {
      lines.push(`would record ${worktree.path} → ${shortId(id)}`);
      continue;
    }

    const local = await deps.resolveWorkspace(worktree.path);
    if (local.kind === 'timeout') {
      lines.push(`skipped ${worktree.path} (git timeout)`);
      continue;
    }

    await recordLocal(local, id, sessionsFor(worktree, claude, pi), deps);
    lines.push(`recorded ${worktree.path} → ${shortId(id)}`);
  }

  return lines;
}

export type InventoryEntry = {
  path: string;
  repo_remote: string | null;
  branch: string | null;
  last_commit: { date: string; subject: string } | null;
  git: ReportGit | null;
  workspace_id: string | null;
  feature: { id: string; title: string } | null;
  marker_feature_id: string | null;
  sessions: { count: number; last_activity_at: string } | null;
  candidates: Array<{ kind: Proposal['kind']; feature_id: string; title: string }>;
  note?: string;
};

export type Inventory = {
  machine: string;
  generated_at: string;
  roots: string[];
  worktrees: InventoryEntry[];
};

const INVENTORY_CONCURRENCY = 6;

function sessionSummary(
  sessions: ReportSession[]
): InventoryEntry['sessions'] {
  if (sessions.length === 0) {
    return null;
  }
  let latest = '';
  for (const session of sessions) {
    const observed = session.observed_at ?? '';
    if (observed > latest) {
      latest = observed;
    }
  }
  return { count: sessions.length, last_activity_at: latest };
}

/** Read-only: lists what is on disk and what Postgram knows. Sends nothing. */
export async function runScanInventory(
  options: ScanOptions,
  deps: ScanDeps
): Promise<Inventory> {
  const roots = scanRoots(options, deps);
  const depth = parseDepth(options.depth);

  const known = new Map(
    (
      await deps.client.listWorkspaces({ machine: deps.config.alias })
    ).workspaces.map((workspace) => [workspace.path, workspace])
  );
  const worktrees = await discoverNotIgnored(roots, depth, deps);
  const { claude, pi } = await findSessions(
    worktrees.map((worktree) => worktree.path),
    deps
  );
  const tasks = await deps.tasks();
  const titleFor = (id: string): string =>
    tasks.find((task) => task.id === id)?.title ?? '';

  const describe = async (worktree: ScannedWorktree): Promise<InventoryEntry> => {
    const [local, lastCommit] = await Promise.all([
      deps.resolveWorkspace(worktree.path),
      deps.lastCommit(worktree.path)
    ]);
    const workspace = known.get(worktree.path) ?? null;
    const linkedId = workspace?.feature_id ?? null;
    const marker = await deps.readMarker(worktree.path);
    const candidates = (
      linkedId === null
        ? await buildProposals(worktree, deps, tasks, false)
        : []
    ).map((proposal) => ({
      kind: proposal.kind,
      feature_id: proposal.featureId,
      title: proposal.title
    }));
    const entry: InventoryEntry = {
      path: worktree.path,
      repo_remote:
        local.kind === 'ok'
          ? (local.workspace.repo_remote ?? workspace?.repo_remote ?? null)
          : (workspace?.repo_remote ?? null),
      branch:
        local.kind === 'ok'
          ? (local.workspace.branch ?? worktree.branch)
          : worktree.branch,
      last_commit: lastCommit,
      git: local.kind === 'ok' ? (local.workspace.git ?? null) : null,
      workspace_id: workspace?.id ?? null,
      feature:
        linkedId !== null ? { id: linkedId, title: titleFor(linkedId) } : null,
      marker_feature_id: marker,
      sessions: sessionSummary(sessionsFor(worktree, claude, pi)),
      candidates
    };
    if (local.kind === 'timeout') {
      entry.note = 'git timeout';
    }
    return entry;
  };

  const entries: InventoryEntry[] = [];
  for (let i = 0; i < worktrees.length; i += INVENTORY_CONCURRENCY) {
    entries.push(
      ...(await Promise.all(
        worktrees.slice(i, i + INVENTORY_CONCURRENCY).map(describe)
      ))
    );
  }

  return {
    machine: deps.config.alias,
    generated_at: new Date().toISOString(),
    roots,
    worktrees: entries
  };
}

export type PlanEntry =
  | { path: string; action: 'link'; feature_id: string }
  | { path: string; action: 'create'; title: string }
  | { path: string; action: 'skip' };

export type ApplyResult = {
  path: string;
  action: PlanEntry['action'];
  status: 'linked' | 'created' | 'skipped' | 'failed' | 'would link' | 'would create';
  feature_id?: string;
  error?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_RE = /^[0-9a-f]{8}$/i;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveTaskId(
  raw: string,
  tasks: ReadonlyArray<{ id: string }>
): { id: string } | { error: string } {
  const lower = raw.toLowerCase();
  let hits: Array<{ id: string }> = [];
  if (UUID_RE.test(lower)) {
    hits = tasks.filter((task) => task.id === lower);
  } else if (SHORT_ID_RE.test(lower)) {
    hits = tasks.filter((task) => task.id.startsWith(lower));
  }
  const hit = hits[0];
  if (hit === undefined) {
    return { error: `no feature matches ${raw}` };
  }
  if (hits.length > 1) {
    return { error: `feature id ${raw} is ambiguous` };
  }
  return { id: hit.id };
}

type ValidEntry = {
  entry: PlanEntry;
  featureId?: string;
  local?: OkLocal;
};

/** Validates the whole plan; nothing is written while this runs. */
async function validatePlan(
  plan: unknown,
  deps: ScanDeps
): Promise<ValidEntry[]> {
  const rawEntries = Array.isArray(plan)
    ? plan
    : isRecordValue(plan) && Array.isArray(plan.entries)
      ? plan.entries
      : null;
  if (rawEntries === null) {
    throw new UsageError(
      'plan must be {"entries": [...]} or a JSON array of entries'
    );
  }

  const tasks = await deps.tasks();
  const errors: string[] = [];
  const valid: ValidEntry[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of rawEntries.entries()) {
    if (!isRecordValue(raw) || typeof raw.path !== 'string' || raw.path === '') {
      errors.push(`entry ${index + 1}: path is required`);
      continue;
    }
    const expanded = expandHome(raw.path, deps.homeDir);
    if (!path.isAbsolute(expanded)) {
      errors.push(`${raw.path}: path must be absolute`);
      continue;
    }
    const target = path.resolve(expanded);
    if (seen.has(target)) {
      errors.push(`duplicate path ${target}`);
      continue;
    }
    seen.add(target);

    const action = raw.action;
    if (action === 'skip') {
      valid.push({ entry: { path: target, action: 'skip' } });
      continue;
    }

    let item: ValidEntry;
    if (action === 'link') {
      if (typeof raw.feature_id !== 'string' || raw.feature_id === '') {
        errors.push(`${target}: link needs feature_id`);
        continue;
      }
      const resolved = resolveTaskId(raw.feature_id, tasks);
      if ('error' in resolved) {
        errors.push(`${target}: ${resolved.error}`);
        continue;
      }
      item = {
        entry: { path: target, action: 'link', feature_id: raw.feature_id },
        featureId: resolved.id
      };
    } else if (action === 'create') {
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (title === '') {
        errors.push(`${target}: create needs a non-empty title`);
        continue;
      }
      item = { entry: { path: target, action: 'create', title } };
    } else {
      errors.push(`${target}: unknown action '${String(action)}'`);
      continue;
    }

    if (isIgnoredPath(target, deps.config.ignorePaths)) {
      errors.push(`${target}: path is in ignore_paths`);
      continue;
    }
    if (!deps.exists(target)) {
      errors.push(`${target}: path does not exist`);
      continue;
    }
    const local = await deps.resolveWorkspace(target);
    if (local.kind === 'timeout') {
      errors.push(`${target}: git timed out`);
      continue;
    }
    if (local.repoRoot === null) {
      errors.push(`${target}: not a git worktree`);
      continue;
    }
    if (local.path !== (await deps.realpath(target))) {
      errors.push(`${target}: not the root of a worktree (${local.path})`);
      continue;
    }
    if (isIgnoredPath(local.path, deps.config.ignorePaths)) {
      errors.push(`${target}: path is in ignore_paths`);
      continue;
    }
    valid.push({ ...item, local });
  }

  if (errors.length > 0) {
    throw new UsageError(
      `plan rejected, nothing was written:\n${errors.map((line) => `  ${line}`).join('\n')}`
    );
  }
  return valid;
}

export async function runScanApply(
  plan: unknown,
  options: { dryRun: boolean },
  deps: ScanDeps
): Promise<{ results: ApplyResult[]; failed: number }> {
  const valid = await validatePlan(plan, deps);
  const paths = valid
    .filter((item) => item.entry.action !== 'skip')
    .map((item) => item.entry.path);
  const sessions =
    options.dryRun || paths.length === 0
      ? { claude: new Map<string, ScannedSession[]>(), pi: new Map<string, ScannedSession[]>() }
      : await findSessions(paths, deps);

  const results: ApplyResult[] = [];
  for (const item of valid) {
    const { entry } = item;
    if (entry.action === 'skip') {
      results.push({ path: entry.path, action: 'skip', status: 'skipped' });
      continue;
    }
    if (options.dryRun) {
      results.push({
        path: entry.path,
        action: entry.action,
        status: entry.action === 'link' ? 'would link' : 'would create',
        ...(item.featureId !== undefined ? { feature_id: item.featureId } : {})
      });
      continue;
    }

    let featureId = item.featureId;
    try {
      if (entry.action === 'create') {
        const created = await deps.client.createFeature({ content: entry.title });
        featureId = created.entity.id;
      }
      if (featureId === undefined || item.local === undefined) {
        throw new Error('internal: unresolved plan entry');
      }
      await recordLocal(
        item.local,
        featureId,
        sessionsFor({ path: entry.path, branch: null }, sessions.claude, sessions.pi),
        deps
      );
      results.push({
        path: entry.path,
        action: entry.action,
        status: entry.action === 'link' ? 'linked' : 'created',
        feature_id: featureId
      });
    } catch (error) {
      results.push({
        path: entry.path,
        action: entry.action,
        status: 'failed',
        ...(featureId !== undefined ? { feature_id: featureId } : {}),
        error: error instanceof Error ? error.message : 'unknown error'
      });
    }
  }

  return {
    results,
    failed: results.filter((result) => result.status === 'failed').length
  };
}

export function formatApplyResults(results: readonly ApplyResult[]): string[] {
  return results.map((result) => {
    const target =
      result.feature_id !== undefined ? ` → ${shortId(result.feature_id)}` : '';
    if (result.status === 'failed') {
      return `failed ${result.path}${target}: ${result.error ?? 'unknown error'}`;
    }
    return `${result.status} ${result.path}${target}`;
  });
}

function firstLineTitle(content: string | null | undefined): string {
  return (content ?? '').split('\n')[0]?.trim() ?? '';
}

function collectRoot(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function askLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr
    });
    const finish = (answer: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      resolve(answer.trim());
    };
    rl.question(question, (answer) => finish(answer));
    rl.on('close', () => finish(''));
    rl.on('SIGINT', () => finish(''));
  });
}

type ScanCommandOpts = {
  root?: string[];
  depth?: string;
  yesExact?: boolean;
  dryRun?: boolean;
  apply?: string;
};

async function readPlan(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new UsageError(
      `cannot read plan ${file}: ${error instanceof Error ? error.message : 'read failed'}`
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new UsageError(
      `plan ${file} is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`
    );
  }
}

export function registerScanCommand(program: Command): void {
  const command = usageExit(
    program
      .command('scan')
      .description(
        'Discover worktrees under the scan roots and record their features'
      )
      .option('--root <dir>', 'scan root (repeatable)', collectRoot, [])
      .option(
        '--depth <n>',
        `directory depth below each root (default ${DEFAULT_DEPTH})`
      )
      .option(
        '--yes-exact',
        'accept marker and short-id proposals, skip the rest'
      )
      .option('--dry-run', 'show what would be recorded without sending')
      .option(
        '--apply <plan.json>',
        'apply an approved plan (link, create or skip per worktree path)'
      )
  ).action(async () => {
    const opts = command.opts<ScanCommandOpts>();
    await runTrackingCommand(command, async (context) => {
      const scanOptions: ScanOptions = {
        root: opts.root ?? [],
        ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
        yesExact: opts.yesExact === true,
        dryRun: opts.dryRun === true
      };
      if (opts.apply !== undefined && scanOptions.yesExact) {
        throw new UsageError('--apply cannot be combined with --yes-exact');
      }
      const deps: ScanDeps = {
        client: context.client,
        config: context.config,
        hostname: os.hostname(),
        env: process.env,
        homeDir: context.homeDir,
        tasks: async () => {
          const items: ScanTask[] = [];
          for (let offset = 0; ; offset += 100) {
            const page = await context.pgm.listTasks({ limit: 100, offset });
            items.push(...featureTasks(page.items));
            if (page.items.length < 100) {
              break;
            }
          }
          return items;
        },
        search: async (query) => {
          const response = await context.pgm.searchEntities({
            query,
            type: 'task',
            limit: 10
          });
          return response.results.map((result) => ({
            id: result.entity.id,
            title: firstLineTitle(result.entity.content)
          }));
        },
        ask: askLine,
        discover: discoverWorktrees,
        claudeSessions: findClaudeSessions,
        piSessions: findPiSessions,
        resolveWorkspace: (p) => resolveLocalWorkspace(p),
        readMarker,
        writeMarker: (worktree, featureId) =>
          writeMarker(worktree, featureId, new Date()),
        exists: existsSync,
        isTty: () => process.stdin.isTTY === true,
        realpath: (p) => realpath(p),
        lastCommit: async (worktree) => {
          const result = await runGit(['log', '-1', '--format=%cI%n%s'], {
            cwd: worktree,
            timeoutMs: 5000
          });
          if (!result.ok || result.stdout === '') {
            return null;
          }
          const [date = '', ...subject] = result.stdout.split('\n');
          return { date, subject: subject.join('\n') };
        },
        info: (line) => process.stderr.write(`${line}\n`)
      };

      if (opts.apply !== undefined) {
        const plan = await readPlan(opts.apply);
        const applied = await runScanApply(
          plan,
          { dryRun: scanOptions.dryRun },
          deps
        );
        if (applied.failed > 0) {
          process.exitCode = 1;
        }
        return context.json ? applied : formatApplyResults(applied.results);
      }
      if (context.json && !scanOptions.yesExact) {
        return runScanInventory(scanOptions, deps);
      }
      return runScan(scanOptions, deps);
    });
  });
}
