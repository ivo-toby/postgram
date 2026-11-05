import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import { useWhere } from '../hooks/useWhere.ts';
import {
  formatAge,
  pullRequestNumber,
  renderResume,
  stageLabel,
  type FeaturePullRequest,
  type GitSnapshot,
  type Risk,
  type SessionView,
  type WhereFeature,
  type WorkspaceView,
} from '../lib/where.ts';
import {
  buildLanes,
  featureRiskLabel,
  type LaneColumn,
  type Lanes,
  type ProjectLanes,
} from '../lib/lanes.ts';

type Props = {
  api: ApiClient;
};

const COPIED_MS = 2000;


export default function WherePage({ api }: Props) {
  const [includeReleasedAndDone, setIncludeReleasedAndDone] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, loading, error, refresh } = useWhere(api, { view: 'stage', includeReleasedAndDone });

  const now = new Date();
  const lanes = data === null ? null : buildLanes(data, { includeReleased: includeReleasedAndDone });
  const selected = lanes === null || selectedId === null ? null : findFeature(lanes, selectedId);
  const isEmpty = lanes !== null && lanes.projects.length === 0 && lanes.unassigned.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto bg-gray-950 p-3 text-gray-100 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {lanes !== null && !isEmpty && (
          <p className="text-sm text-gray-400">{summaryText(lanes)}</p>
        )}
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

      {isEmpty && <p className="text-sm text-gray-400">Nothing to do</p>}

      {lanes?.projects.map((project) => (
        <ProjectSection
          key={project.key}
          project={project}
          now={now}
          selectedId={selected?.feature.id ?? null}
          onSelect={setSelectedId}
        />
      ))}

      {lanes !== null && lanes.unassigned.length > 0 && (
        <section className="flex min-w-0 flex-col gap-2">
          <details className="group">
            <summary className="cursor-pointer text-sm text-gray-400 hover:text-white">
              <h2 className="inline text-sm font-semibold">{`Unassigned worktrees (${lanes.unassigned.length})`}</h2>
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {lanes.unassigned.map((workspace) => (
                <WorkspaceRow key={workspace.id} workspace={workspace} now={now} />
              ))}
            </ul>
          </details>
        </section>
      )}

      {selected !== null && (
        <FeatureDetails
          feature={selected.feature}
          projectName={selected.projectName}
          now={now}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function summaryText(lanes: Lanes): string {
  const features = lanes.featureCount === 1 ? '1 feature' : `${lanes.featureCount} features`;
  const projects = lanes.projects.length === 1 ? '1 project' : `${lanes.projects.length} projects`;
  return `${features} in ${projects} · ${needYouText(lanes.needsYouCount)}`;
}

function needYouText(count: number): string {
  return count === 1 ? '1 needs you' : `${count} need you`;
}

function findFeature(lanes: Lanes, id: string): { feature: WhereFeature; projectName: string } | null {
  for (const project of lanes.projects) {
    for (const column of project.columns) {
      const feature = column.features.find((candidate) => candidate.id === id);
      if (feature !== undefined) return { feature, projectName: project.name };
    }
  }
  return null;
}

function ProjectSection({
  project,
  now,
  selectedId,
  onSelect,
}: {
  project: ProjectLanes;
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-white">{project.name}</h2>
        {project.repo !== null && (
          <span className="hidden font-mono text-xs text-gray-500 sm:inline">{project.repo}</span>
        )}
        <span className="text-xs text-gray-400">
          {project.featureCount === 1 ? '1 feature' : `${project.featureCount} features`}
        </span>
        {project.needsYouCount > 0 && (
          <span className="text-xs text-amber-300">{needYouText(project.needsYouCount)}</span>
        )}
      </div>
      <div className="overflow-x-auto pb-1">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${project.columns.length}, minmax(10rem, 1fr))`,
          }}
        >
          {project.columns.map((column) => (
            <LaneColumnView
              key={column.stage}
              column={column}
              now={now}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function LaneColumnView({
  column,
  now,
  selectedId,
  onSelect,
}: {
  column: LaneColumn;
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-h-24 min-w-0 flex-col gap-2 rounded-lg border border-gray-800 bg-gray-900/40 p-2">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <h3 className="font-semibold text-gray-300">{column.label}</h3>
        <span>{column.features.length}</span>
        {column.needsYou && column.features.length > 0 && (
          <span className="ml-auto text-[11px] text-gray-400">needs you</span>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {column.features.map((feature) => (
          <li key={feature.id}>
            <FeatureCard
              feature={feature}
              now={now}
              selected={feature.id === selectedId}
              onSelect={() => onSelect(feature.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureCard({
  feature,
  now,
  selected,
  onSelect,
}: {
  feature: WhereFeature;
  now: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const risk = featureRiskLabel(feature);
  const pr = feature.pull_requests[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-haspopup="dialog"
      className={`flex w-full flex-col items-start gap-1.5 rounded-md border p-2 text-left transition-colors ${
        selected
          ? 'border-blue-500 bg-gray-800'
          : 'border-gray-800 bg-gray-900 hover:border-gray-600'
      }`}
    >
      <span className="break-words text-sm font-medium leading-snug text-white">{feature.title}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
        {pr !== undefined && (
          <span className="rounded border border-gray-700 px-1.5 text-gray-300">
            {`#${pullRequestNumber(pr.url) ?? '?'}`}
          </span>
        )}
        {feature.stage_set_at !== null && <span>{formatAge(feature.stage_set_at, now)}</span>}
        {(feature.task_status === 'done' || feature.task_status === 'archived') && (
          <span>{feature.task_status}</span>
        )}
        {risk !== null && (
          <span className="flex items-center gap-1 text-amber-300">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>{risk}</span>
          </span>
        )}
      </span>
    </button>
  );
}

function FeatureDetails({
  feature,
  projectName,
  now,
  onClose,
}: {
  feature: WhereFeature;
  projectName: string;
  now: Date;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titleId = `feature-${feature.id}-title`;
  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-gray-950/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-gray-800 bg-gray-900 p-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="font-mono text-xs text-gray-500">{`${feature.id.slice(0, 8)} · ${projectName}`}</span>
            <h2 id={titleId} className="break-words text-base font-semibold text-white">
              {feature.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span
                title={feature.stage_source === null ? feature.stage : `${feature.stage} (${feature.stage_source})`}
                className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300"
              >
                {stageLabel(feature.stage)}
              </span>
              {feature.stage_set_at !== null && (
                <span className="text-xs text-gray-500">{formatAge(feature.stage_set_at, now)}</span>
              )}
              {(feature.task_status === 'done' || feature.task_status === 'archived') && (
                <span className="rounded-md border border-gray-700 px-2 py-0.5 text-xs text-gray-400">
                  {feature.task_status}
                </span>
              )}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            Close
          </button>
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
      </aside>
    </div>
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
