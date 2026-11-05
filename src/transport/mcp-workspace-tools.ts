// MCP workspace & feature tools (spec 004, contracts/mcp.md). Each tool is a
// thin adapter over the same service functions as the REST routes: compact
// output by default, the full REST-shaped payload with `full_response`.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { AuthContext } from '../auth/types.js';
import type { WorkspaceView } from '../types/workspaces.js';
import {
  addFeaturePullRequest,
  setFeatureStage
} from '../services/feature-service.js';
import { getWhere, type WhereResult } from '../services/where-service.js';
import { lookupWorkspace } from '../services/workspace-lookup.js';
import { reportWorkspace } from '../services/workspace-service.js';
import { deleteWorkspace } from '../services/workspace-delete.js';
import { updateWorkspace } from '../services/workspace-update.js';
import {
  boolishSchema,
  fullResponseSchema,
  toToolSuccess,
  toolFromService
} from './mcp-results.js';

export type WorkspaceToolsOptions = { dormantAfterDays: number };

function compactWhereWorkspace(view: WorkspaceView) {
  const latest = view.sessions[0];

  return {
    machine: view.machine,
    connect_target: view.connect_target,
    path: view.path,
    branch: view.branch,
    risks: view.risks,
    resume_session:
      view.resume_session === null
        ? null
        : {
            agent_kind: view.resume_session.agent_kind,
            agent_session_id: view.resume_session.agent_session_id,
            status: view.resume_session.status,
            cwd: view.resume_session.cwd
          },
    latest_session:
      latest === undefined
        ? null
        : {
            agent_kind: latest.agent_kind,
            agent_session_id: latest.agent_session_id,
            status: latest.status
          }
  };
}

function compactWhereResult(result: WhereResult) {
  return {
    view: result.view,
    generated_at: result.generated_at,
    dormant_after_days: result.dormant_after_days,
    groups: result.groups.map((group) =>
      'features' in group
        ? {
            ...group,
            features: group.features.map((feature) => ({
              ...feature,
              workspaces: feature.workspaces.map(compactWhereWorkspace)
            }))
          }
        : { ...group, workspaces: group.workspaces.map(compactWhereWorkspace) }
    )
  };
}

export function registerWorkspaceTools(
  server: McpServer,
  pool: Pool,
  auth: AuthContext,
  options: WorkspaceToolsOptions
): void {
  server.registerTool(
    'workspace_report',
    {
      description:
        'Register that you are working in a directory on a machine. Call it at session start and when you finish a piece of work. It does not create features.',
      inputSchema: {
        source: z.enum(['hook', 'scan']).optional(),
        machine: z.record(z.unknown()),
        workspace: z.record(z.unknown()).optional(),
        feature_id: z.string().nullable().optional(),
        session: z.record(z.unknown()).optional(),
        sessions: z.array(z.unknown()).optional(),
        full_response: fullResponseSchema
      }
    },
    (args) =>
      toolFromService(
        reportWorkspace(
          pool,
          auth,
          {
            ...(args.source !== undefined ? { source: args.source } : {}),
            machine: args.machine,
            ...(args.workspace !== undefined
              ? { workspace: args.workspace }
              : {}),
            ...(args.feature_id !== undefined
              ? { feature_id: args.feature_id }
              : {}),
            ...(args.session !== undefined ? { session: args.session } : {}),
            ...(args.sessions !== undefined ? { sessions: args.sessions } : {})
          },
          { dormantAfterDays: options.dormantAfterDays }
        ),
        (value) => ({
          workspace: value.workspace,
          ...(value.session !== undefined ? { session: value.session } : {}),
          ...(value.sessions !== undefined ? { sessions: value.sessions } : {}),
          feature: value.feature,
          interrupted_sessions: value.interrupted_sessions,
          warnings: value.warnings
        }),
        (payload) =>
          args.full_response
            ? toToolSuccess(payload)
            : toToolSuccess({
                workspace_id: payload.workspace?.id ?? null,
                session_id: payload.session?.id ?? null,
                session_status: payload.session?.status ?? null,
                feature: payload.feature,
                interrupted_sessions: payload.interrupted_sessions,
                warnings: payload.warnings
              })
      )
  );

  server.registerTool(
    'workspace_lookup',
    {
      description:
        'Find which feature the current worktree belongs to and its delivery stage.',
      inputSchema: {
        machine: z.string(),
        path: z.string(),
        full_response: fullResponseSchema
      }
    },
    (args) =>
      toolFromService(
        lookupWorkspace(
          pool,
          auth,
          { machine: args.machine, path: args.path },
          { dormantAfterDays: options.dormantAfterDays }
        ),
        (value) => ({ workspace: value.workspace, feature: value.feature }),
        (payload) =>
          args.full_response
            ? toToolSuccess(payload)
            : toToolSuccess({
                workspace_id: payload.workspace?.id ?? null,
                feature: payload.feature
              })
      )
  );

  server.registerTool(
    'workspace_link',
    {
      description:
        'Link a workspace to a feature, or unlink it with feature_id null. A feature marker in the worktree overrides this link on the next hook report.',
      inputSchema: {
        workspace_id: z.string(),
        feature_id: z.string().nullable(),
        full_response: fullResponseSchema
      }
    },
    (args) =>
      toolFromService(
        updateWorkspace(
          pool,
          auth,
          { id: args.workspace_id, featureId: args.feature_id },
          { dormantAfterDays: options.dormantAfterDays }
        ),
        (value) => ({ workspace: value }),
        (payload) =>
          args.full_response
            ? toToolSuccess(payload)
            : toToolSuccess({
                workspace_id: payload.workspace.id,
                feature_id: payload.workspace.feature_id
              })
      )
  );

  server.registerTool(
    'workspace_delete',
    {
      description:
        'Remove a workspace registration (for example one whose directory is gone). Its sessions are removed with it; the linked feature is never touched. Needs the delete scope.',
      inputSchema: {
        workspace_id: z.string(),
        full_response: fullResponseSchema
      }
    },
    (args) =>
      toolFromService(
        deleteWorkspace(
          pool,
          auth,
          { id: args.workspace_id },
          { dormantAfterDays: options.dormantAfterDays }
        ),
        (value) => ({ deleted: true, workspace: value }),
        (payload) =>
          args.full_response
            ? toToolSuccess(payload)
            : toToolSuccess({
                deleted: true,
                workspace_id: payload.workspace.id,
                path: payload.workspace.path
              })
      )
  );

  server.registerTool(
    'feature_stage',
    {
      description:
        'Set a feature\'s delivery stage. Move to `review` after opening a PR. Never set `released` unless a release was actually published.',
      inputSchema: {
        id: z.string(),
        stage: z.string(),
        full_response: fullResponseSchema
      }
    },
    (args) =>
      toolFromService(
        setFeatureStage(pool, auth, { id: args.id, stage: args.stage }),
        (value) => ({
          entity: { id: value.entity.id, metadata: value.entity.metadata },
          previous_stage: value.previous_stage
        }),
        (payload) =>
          args.full_response
            ? toToolSuccess(payload)
            : toToolSuccess({
                id: payload.entity.id,
                stage: payload.entity.metadata.stage,
                previous_stage: payload.previous_stage
              })
      )
  );

  server.registerTool(
    'feature_pr',
    {
      description:
        'Attach a PR to a feature. Opening a PR moves `building` to `review`; merging moves it to `awaiting_release`.',
      inputSchema: {
        id: z.string(),
        url: z.string(),
        state: z.string().optional(),
        full_response: fullResponseSchema
      }
    },
    (args) =>
      toolFromService(
        addFeaturePullRequest(pool, auth, {
          id: args.id,
          url: args.url,
          ...(args.state !== undefined ? { state: args.state } : {})
        }),
        (value) => ({
          entity: { id: value.entity.id, metadata: value.entity.metadata },
          stage_changed: value.stage_changed,
          from: value.from,
          to: value.to
        }),
        (payload) =>
          args.full_response
            ? toToolSuccess(payload)
            : toToolSuccess({
                id: payload.entity.id,
                stage: payload.to,
                stage_changed: payload.stage_changed
              })
      )
  );

  server.registerTool(
    'where',
    {
      description:
        'List where active features live (machine, worktree, sessions, risks). Use view `actions` to see what the human needs to do.',
      inputSchema: {
        view: z.string().optional(),
        machine: z.string().optional(),
        repo: z.string().optional(),
        include_released: boolishSchema().optional(),
        include_done: boolishSchema().optional(),
        include_ended: boolishSchema().optional(),
        full_response: fullResponseSchema
      }
    },
    (args) =>
      toolFromService(
        getWhere(
          pool,
          auth,
          {
            ...(args.view !== undefined ? { view: args.view } : {}),
            ...(args.machine !== undefined ? { machine: args.machine } : {}),
            ...(args.repo !== undefined ? { repo: args.repo } : {}),
            ...(args.include_released !== undefined
              ? { includeReleased: args.include_released }
              : {}),
            ...(args.include_done !== undefined
              ? { includeDone: args.include_done }
              : {}),
            ...(args.include_ended !== undefined
              ? { includeEnded: args.include_ended }
              : {})
          },
          { dormantAfterDays: options.dormantAfterDays }
        ),
        (value) => value,
        (payload) =>
          args.full_response
            ? toToolSuccess(payload)
            : toToolSuccess(compactWhereResult(payload))
      )
  );
}
