// cli/src/tracking/workspace-commands.ts: pgm workspace prune.
import { existsSync } from 'node:fs';

import type { Command } from 'commander';

import { shortId } from '../shared.js';
import { runTrackingCommand } from './api.js';
import type { TrackingClient } from './api.js';
import { isIgnoredPath, usageExit } from './config.js';
import type { TrackingConfig } from './config.js';

export type PruneDeps = {
  client: TrackingClient;
  config: TrackingConfig;
  exists: (path: string) => boolean;
};

export type PruneResult = {
  removed: Array<{
    id: string;
    path: string;
    feature_id: string | null;
    reason: 'missing' | 'ignored';
  }>;
  failed: Array<{ id: string; path: string; error: string }>;
  dry_run: boolean;
};

/**
 * Removes workspace registrations of this machine whose directory is gone
 * (and, with `ignored`, those under ignore_paths). Features are never touched.
 */
export async function runWorkspacePrune(
  options: { dryRun: boolean; ignored?: boolean },
  deps: PruneDeps
): Promise<PruneResult> {
  const { workspaces } = await deps.client.listWorkspaces({
    machine: deps.config.alias
  });
  const result: PruneResult = {
    removed: [],
    failed: [],
    dry_run: options.dryRun
  };

  for (const workspace of workspaces) {
    if (workspace.machine !== deps.config.alias) {
      continue;
    }
    let reason: 'missing' | 'ignored' | null = null;
    if (!deps.exists(workspace.path)) {
      reason = 'missing';
    } else if (
      options.ignored === true &&
      isIgnoredPath(workspace.path, deps.config.ignorePaths)
    ) {
      reason = 'ignored';
    }
    if (reason === null) {
      continue;
    }
    if (!options.dryRun) {
      try {
        await deps.client.deleteWorkspace(workspace.id);
      } catch (error) {
        result.failed.push({
          id: workspace.id,
          path: workspace.path,
          error: error instanceof Error ? error.message : 'delete failed'
        });
        continue;
      }
    }
    result.removed.push({
      id: workspace.id,
      path: workspace.path,
      feature_id: workspace.feature_id,
      reason
    });
  }

  return result;
}

export function formatPrune(result: PruneResult): string[] {
  const verb = result.dry_run ? 'would remove' : 'removed';
  const lines = result.removed.map((entry) => {
    const feature =
      entry.feature_id !== null ? ` (feature ${shortId(entry.feature_id)})` : '';
    return `${verb} ${entry.path} [${entry.reason}]${feature}`;
  });
  for (const entry of result.failed) {
    lines.push(`failed ${entry.path}: ${entry.error}`);
  }
  if (lines.length === 0) {
    lines.push('nothing to prune');
  }
  return lines;
}

type PruneOpts = { dryRun?: boolean; ignored?: boolean };

export function registerWorkspaceCommands(program: Command): void {
  const workspace = usageExit(
    program.command('workspace').description('Manage workspace registrations')
  );

  const prune = usageExit(
    workspace
      .command('prune')
      .description(
        'Remove registrations of this machine whose directory is gone (features are kept)'
      )
      .option('--dry-run', 'show what would be removed without deleting')
      .option(
        '--ignored',
        'also remove registrations that match ignore_paths in ~/.pgmrc'
      )
  );
  prune.action(async () => {
    const opts = prune.opts<PruneOpts>();
    await runTrackingCommand(prune, async (context) => {
      const result = await runWorkspacePrune(
        {
          dryRun: opts.dryRun === true,
          ...(opts.ignored === true ? { ignored: true } : {})
        },
        {
          client: context.client,
          config: context.config,
          exists: existsSync
        }
      );
      if (result.failed.length > 0) {
        process.exitCode = 1;
      }
      return context.json ? result : formatPrune(result);
    });
  });
}
