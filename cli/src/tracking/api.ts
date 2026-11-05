// cli/src/tracking/api.ts
import os from 'node:os';

import type { Command } from 'commander';

import { createPgmClient, request } from '../client.js';
import type { StoredEntityResponse } from '../client.js';
import {
  handleCliFailure,
  isJsonMode,
  printHuman,
  printJson,
  resolvePgmConfig
} from '../shared.js';
import { UsageError, loadTrackingConfig } from './config.js';
import type { TrackingConfig } from './config.js';
import type {
  FeatureStage,
  LookupResponse,
  MachineView,
  ReportBody,
  ReportResponse,
  WhereResponse,
  WorkspaceView
} from './types.js';

export type TrackingClient = {
  report(
    body: ReportBody,
    options?: { timeoutMs?: number }
  ): Promise<ReportResponse>;
  patchWorkspace(
    id: string,
    body: { feature_id?: string | null; missing?: boolean }
  ): Promise<{ workspace: WorkspaceView }>;
  deleteWorkspace(id: string): Promise<{ deleted: true; workspace: WorkspaceView }>;
  putMachine(
    alias: string,
    connectTarget: string | null
  ): Promise<{ machine: MachineView }>;
  listMachines(): Promise<{ machines: MachineView[] }>;
  putRepository(
    remote: string,
    releaseOnMerge: boolean
  ): Promise<{ repository: { remote: string; release_on_merge: boolean } }>;
  createFeature(input: {
    content: string;
    tags?: string[];
    visibility?: string;
  }): Promise<StoredEntityResponse>;
  setStage(
    id: string,
    stage: FeatureStage
  ): Promise<StoredEntityResponse & { previous_stage: string | null }>;
  addPullRequest(
    id: string,
    input: { url: string; state?: 'open' | 'merged' | 'closed' }
  ): Promise<
    StoredEntityResponse & { stage_changed: boolean; from: string; to: string }
  >;
  lookup(machine: string, path: string): Promise<LookupResponse>;
  listWorkspaces(query: {
    machine?: string;
    repo?: string;
    featureId?: string;
    unassigned?: boolean;
    includeEnded?: boolean;
  }): Promise<{ workspaces: WorkspaceView[] }>;
  where(query: {
    view?: 'stage' | 'actions';
    machine?: string;
    repo?: string;
    includeReleased?: boolean;
    includeDone?: boolean;
    includeEnded?: boolean;
  }): Promise<WhereResponse>;
};

function toQuery(params: Record<string, string>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function createTrackingClient(
  options: { apiUrl: string; apiKey: string }
): TrackingClient {
  return {
    report(body, reportOptions) {
      return request<ReportResponse>(options, '/api/workspaces/report', {
        method: 'POST',
        body,
        ...(reportOptions?.timeoutMs !== undefined
          ? { signal: AbortSignal.timeout(reportOptions.timeoutMs) }
          : {})
      });
    },
    patchWorkspace(id, body) {
      return request<{ workspace: WorkspaceView }>(
        options,
        `/api/workspaces/${encodeURIComponent(id)}`,
        { method: 'PATCH', body }
      );
    },
    deleteWorkspace(id) {
      return request<{ deleted: true; workspace: WorkspaceView }>(
        options,
        `/api/workspaces/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
    },
    putMachine(alias, connectTarget) {
      return request<{ machine: MachineView }>(
        options,
        `/api/machines/${encodeURIComponent(alias)}`,
        { method: 'PUT', body: { connect_target: connectTarget } }
      );
    },
    listMachines() {
      return request<{ machines: MachineView[] }>(options, '/api/machines');
    },
    putRepository(remote, releaseOnMerge) {
      return request<{
        repository: { remote: string; release_on_merge: boolean };
      }>(options, '/api/repositories', {
        method: 'PUT',
        body: { remote, release_on_merge: releaseOnMerge }
      });
    },
    createFeature(input) {
      return request<StoredEntityResponse>(options, '/api/features', {
        method: 'POST',
        body: input
      });
    },
    setStage(id, stage) {
      return request<StoredEntityResponse & { previous_stage: string | null }>(
        options,
        `/api/features/${encodeURIComponent(id)}/stage`,
        { method: 'POST', body: { stage } }
      );
    },
    addPullRequest(id, input) {
      return request<
        StoredEntityResponse & {
          stage_changed: boolean;
          from: string;
          to: string;
        }
      >(options, `/api/features/${encodeURIComponent(id)}/pull-requests`, {
        method: 'POST',
        body: input
      });
    },
    lookup(machine, path) {
      return request<LookupResponse>(
        options,
        `/api/workspaces/lookup${toQuery({ machine, path })}`
      );
    },
    listWorkspaces(query) {
      const params: Record<string, string> = {};
      if (query.machine !== undefined) {
        params.machine = query.machine;
      }
      if (query.repo !== undefined) {
        params.repo = query.repo;
      }
      if (query.featureId !== undefined) {
        params.feature_id = query.featureId;
      }
      if (query.unassigned) {
        params.unassigned = 'true';
      }
      if (query.includeEnded) {
        params.include_ended = 'true';
      }
      return request<{ workspaces: WorkspaceView[] }>(
        options,
        `/api/workspaces${toQuery(params)}`
      );
    },
    where(query) {
      const params: Record<string, string> = {};
      if (query.view !== undefined) {
        params.view = query.view;
      }
      if (query.machine !== undefined) {
        params.machine = query.machine;
      }
      if (query.repo !== undefined) {
        params.repo = query.repo;
      }
      if (query.includeReleased) {
        params.include_released = 'true';
      }
      if (query.includeDone) {
        params.include_done = 'true';
      }
      if (query.includeEnded) {
        params.include_ended = 'true';
      }
      return request<WhereResponse>(options, `/api/where${toQuery(params)}`);
    }
  };
}

export type TrackingContext = {
  json: boolean;
  config: TrackingConfig;
  client: TrackingClient;
  pgm: ReturnType<typeof createPgmClient>;
  homeDir: string;
};

export async function runTrackingCommand(
  command: Command,
  handler: (context: TrackingContext) => Promise<unknown>
): Promise<void> {
  const json = isJsonMode(command);

  let result: unknown;
  try {
    const homeDir = os.homedir();
    const config = await loadTrackingConfig();
    const credentials = await resolvePgmConfig();
    result = await handler({
      json,
      config,
      client: createTrackingClient(credentials),
      pgm: createPgmClient(credentials),
      homeDir
    });
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    await handleCliFailure(error, json);
    return;
  }

  if (result === undefined) {
    return;
  }
  if (Array.isArray(result)) {
    if (json) {
      printJson(result);
    } else {
      printHuman(result.map(String));
    }
  } else {
    printJson(result);
  }
}
