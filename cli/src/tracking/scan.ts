// cli/src/tracking/scan.ts: pgm scan — discover worktrees and record their features.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import type { Command } from 'commander';

import { shortId } from '../shared.js';
import { runTrackingCommand } from './api.js';
import type { TrackingClient } from './api.js';
import { slug, usageExit, UsageError } from './config.js';
import type { TrackingConfig } from './config.js';
import { readMarker, resolveLocalWorkspace, writeMarker } from './local.js';
import type { LocalWorkspace } from './local.js';
import { discoverWorktrees, findClaudeSessions, findPiSessions } from './scan-discovery.js';
import type { ScannedSession, ScannedWorktree } from './scan-discovery.js';
import type { ReportBody, ReportSession } from './types.js';
import { syncMissing } from './where.js';

export type Proposal = {
  kind: 'marker' | 'short-id' | 'search';
  featureId: string;
  title: string;
};

export const BRANCH_SHORT_ID = /(?:^|\/)([0-9a-f]{8})(?:-|$)/;

export type ScanDeps = {
  client: TrackingClient;
  config: TrackingConfig;
  hostname: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  tasks: () => Promise<Array<{ id: string; title: string }>>;
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
  tasks: Array<{ id: string; title: string }>,
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
      for (const hit of hits.slice(0, 3)) {
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

export async function runScan(
  options: ScanOptions,
  deps: ScanDeps
): Promise<string[]> {
  const roots =
    options.root.length > 0
      ? options.root.map((root) => path.resolve(root))
      : deps.config.scanRoots;
  if (roots.length === 0) {
    throw new UsageError(
      'no scan roots: pass --root <dir> or set scan_roots in ~/.pgmrc'
    );
  }
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

  const worktrees = await deps.discover(roots, depth);
  const paths = worktrees.map((worktree) => worktree.path);
  const claudeDir =
    deps.env.CLAUDE_CONFIG_DIR ?? path.join(deps.homeDir, '.claude');
  const piDir =
    deps.env.PI_CODING_AGENT_DIR ?? path.join(deps.homeDir, '.pi', 'agent');
  const claude = await deps.claudeSessions(paths, claudeDir);
  for (const note of claude.notes) {
    deps.info(note);
  }
  const pi = await deps.piSessions(paths, piDir);

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

    const body: ReportBody = {
      source: 'scan',
      machine: {
        alias: deps.config.alias,
        hostname: deps.hostname,
        boot_id: null
      },
      workspace: local.workspace,
      feature_id: id,
      sessions: sessionsFor(worktree, claude.sessions, pi)
    };
    await deps.client.report(body);

    if ((await deps.readMarker(worktree.path)) !== id) {
      await deps.writeMarker(worktree.path, id);
    }
    lines.push(`recorded ${worktree.path} → ${shortId(id)}`);
  }

  return lines;
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
};

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
  ).action(async () => {
    const opts = command.opts<ScanCommandOpts>();
    await runTrackingCommand(command, (context) =>
      runScan(
        {
          root: opts.root ?? [],
          ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
          yesExact: opts.yesExact === true,
          dryRun: opts.dryRun === true
        },
        {
          client: context.client,
          config: context.config,
          hostname: os.hostname(),
          env: process.env,
          homeDir: context.homeDir,
          tasks: async () => {
            const items: Array<{ id: string; title: string }> = [];
            for (let offset = 0; ; offset += 100) {
              const page = await context.pgm.listTasks({ limit: 100, offset });
              for (const item of page.items) {
                items.push({ id: item.id, title: firstLineTitle(item.content) });
              }
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
              limit: 3
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
          info: (line) => process.stderr.write(`${line}\n`)
        }
      )
    );
  });
}
