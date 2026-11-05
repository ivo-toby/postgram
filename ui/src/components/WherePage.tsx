import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import { useWhere } from '../hooks/useWhere.ts';
import {
  formatAge,
  groupCount,
  isGroupEmpty,
  pullRequestNumber,
  renderResume,
  stageLabel,
  type FeaturePullRequest,
  type GitSnapshot,
  type Risk,
  type SessionView,
  type WhereFeature,
  type WhereGroup,
  type WhereView,
  type WorkspaceView,
} from '../lib/where.ts';

type Props = {
  api: ApiClient;
};

const COPIED_MS = 2000;

const VIEWS: { view: WhereView; label: string }[] = [
  { view: 'actions', label: 'Actions' },
  { view: 'stage', label: 'Stage' },
];

export default function WherePage({ api }: Props) {
  const [view, setView] = useState<WhereView>('actions');
  const [includeReleasedAndDone, setIncludeReleasedAndDone] = useState(false);
  const { data, loading, error, refresh } = useWhere(api, { view, includeReleasedAndDone });

  const now = new Date();
  const visibleGroups = data === null ? [] : data.groups.filter((group) => !isGroupEmpty(group));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-gray-950 p-3 text-gray-100 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="flex gap-1">
          {VIEWS.map((option) => (
            <button
              key={option.view}
              type="button"
              aria-pressed={view === option.view}
              onClick={() => setView(option.view)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                view === option.view
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={includeReleasedAndDone}
            onChange={(event) => setIncludeReleasedAndDone(event.target.checked)}
            className="accent-blue-500"
          />
          <span>Show released and done</span>
        </label>
        <button
          type="button"
          onClick={refresh}
          className="ml-auto rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          <span className="min-w-0 break-words">{error.message}</span>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-red-500/40 px-2 py-0.5 text-xs text-red-200 hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {data !== null && visibleGroups.length === 0 && (
        <p className="text-sm text-gray-400">Nothing to do</p>
      )}

      {visibleGroups.map((group) => (
        <GroupSection key={group.key} group={group} now={now} />
      ))}
    </div>
  );
}

function GroupSection({ group, now }: { group: WhereGroup; now: Date }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-semibold text-white">{`${group.label} (${groupCount(group)})`}</h2>
      {group.features !== undefined ? (
        <ul className="flex flex-col gap-3">
          {group.features.map((feature) => (
            <FeatureCard key={feature.id} feature={feature} now={now} />
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-3">
          {(group.workspaces ?? []).map((workspace) => (
            <WorkspaceRow key={workspace.id} workspace={workspace} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeatureCard({ feature, now }: { feature: WhereFeature; now: Date }) {
  const showStatus = feature.task_status === 'done' || feature.task_status === 'archived';
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-gray-500">{feature.id.slice(0, 8)}</span>
        <h3 className="min-w-0 break-words text-sm font-medium text-white">{feature.title}</h3>
        <span
          title={feature.stage_source === null ? feature.stage : `${feature.stage} (${feature.stage_source})`}
          className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300"
        >
          {stageLabel(feature.stage)}
        </span>
        {feature.stage_set_at !== null && (
          <span className="text-xs text-gray-500">{formatAge(feature.stage_set_at, now)}</span>
        )}
        {showStatus && (
          <span className="rounded-md border border-gray-700 px-2 py-0.5 text-xs text-gray-400">
            {feature.task_status}
          </span>
        )}
      </div>

      {feature.pull_requests.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {feature.pull_requests.map((pr) => (
            <PullRequestChip key={pr.url} pr={pr} />
          ))}
        </div>
      )}

      {feature.workspaces.length === 0 ? (
        <p className="text-xs text-gray-500">no worktrees</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {feature.workspaces.map((workspace) => (
            <WorkspaceRow key={workspace.id} workspace={workspace} now={now} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PullRequestChip({ pr }: { pr: FeaturePullRequest }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer noopener"
      className="rounded-md border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:border-gray-500 hover:text-white"
    >
      {`#${pullRequestNumber(pr.url) ?? '?'} ${pr.state}`}
    </a>
  );
}

function WorkspaceRow({ workspace, now }: { workspace: WorkspaceView; now: Date }) {
  const resume = renderResume(workspace);
  const gitAge = gitAgeLabel(workspace, now);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-gray-800 bg-gray-950 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
        <span className="text-gray-200">{workspace.machine}</span>
        <span className="min-w-0 break-all">{workspace.branch ?? '-'}</span>
        {gitAge !== null && <span>{gitAge}</span>}
      </div>

      <p className="min-w-0 break-all font-mono text-xs text-gray-300">{workspace.path}</p>

      {workspace.risks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {workspace.risks.map((risk, index) => (
            <span
              key={`${risk}-${index}`}
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300"
            >
              {riskLabel(risk, workspace.git)}
            </span>
          ))}
        </div>
      )}

      {workspace.sessions.length === 0 ? (
        <p className="text-xs text-gray-500">no sessions</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {workspace.sessions.map((session) => (
            <SessionChip key={session.id} session={session} now={now} />
          ))}
        </div>
      )}

      <div className="flex min-w-0 items-start gap-2">
        <code className="min-w-0 flex-1 break-all whitespace-pre-wrap font-mono text-xs text-gray-400">
          {resume}
        </code>
        <CopyResumeButton text={resume} />
      </div>
    </li>
  );
}

function SessionChip({ session, now }: { session: SessionView; now: Date }) {
  const age = formatAge(session.last_activity_at, now);
  return (
    <span className="rounded-md border border-gray-700 px-2 py-0.5 font-mono text-xs text-gray-300">
      {`${session.agent_kind}/${session.status} ${age}${session.dormant ? ' dormant' : ''}`}
    </span>
  );
}

function gitAgeLabel(workspace: WorkspaceView, now: Date): string | null {
  if (workspace.git === null) return null;
  if (workspace.git_state_at === null) return 'git ?';
  return `git ${formatAge(workspace.git_state_at, now)}`;
}

function riskLabel(risk: Risk, git: GitSnapshot | null): string {
  switch (risk) {
    case 'dirty':
      return countLabel('dirty', git?.dirty_count);
    case 'unpushed':
      return countLabel('unpushed', git?.unpushed_count);
    case 'no_upstream':
      return 'no upstream';
    case 'interrupted':
      return 'interrupted';
    case 'missing':
      return 'missing';
  }
}

function countLabel(label: string, count: number | null | undefined): string {
  return count === null || count === undefined ? label : `${label} ${count}`;
}

type CopyState = 'idle' | 'copied' | 'failed';

function CopyResumeButton({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  async function copy(): Promise<void> {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    let copied = false;
    try {
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (clipboard === undefined) throw new Error('clipboard unavailable');
      await clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
    if (!mounted.current) return;
    if (!copied) {
      setState('failed');
      return;
    }
    setState('copied');
    timer.current = setTimeout(() => {
      timer.current = null;
      if (mounted.current) setState('idle');
    }, COPIED_MS);
  }

  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy';

  return (
    <button
      type="button"
      aria-label="Copy resume command"
      aria-live="polite"
      onClick={() => {
        void copy();
      }}
      className="shrink-0 rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
    >
      {label}
    </button>
  );
}
