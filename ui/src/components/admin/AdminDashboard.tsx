import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  type AdminApiClient,
  type AdminAuthResponse,
  type AdminConfigStatus,
  type AdminEmbeddingModel,
  type AdminHealth,
  type AdminJob,
  type AdminQueueStatus,
  type AdminSession,
  type AdminStats,
  type AdminStepUp,
  type AdminUser,
} from '../../lib/adminApi.ts';
import AdminApiKeys from './AdminApiKeys.tsx';
import AdminAudit from './AdminAudit.tsx';
import AdminConfig from './AdminConfig.tsx';

type AdminDashboardProps = {
  api: AdminApiClient;
  user: AdminUser;
  session: AdminSession;
  stepUp?: AdminStepUp;
  onAuthUpdate: (response: AdminAuthResponse) => void;
  onSessionExpired: (error: unknown) => boolean;
};

type ResourceState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

type DashboardPanel = 'overview' | 'provider-config';

function pendingResource<T>(): ResourceState<T> {
  return {
    data: null,
    error: null,
    loading: true,
  };
}

function loadedResource<T>(data: T): ResourceState<T> {
  return {
    data,
    error: null,
    loading: false,
  };
}

function failedResource<T>(error: string): ResourceState<T> {
  return {
    data: null,
    error,
    loading: false,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 60 * 60) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll('_', ' ');
}

function Panel({
  children,
  className = '',
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function ErrorText({ message }: { message: string }) {
  return <p className="mt-3 text-sm text-red-200">{message}</p>;
}

function InlineMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2">
      <p className="text-[11px] uppercase text-gray-500">{label}</p>
      <div className="mt-1 text-sm font-medium text-gray-100">{value}</div>
    </div>
  );
}

function DashboardNavButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:bg-gray-800/60 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function HealthPanel({ state }: { state: ResourceState<AdminHealth> }) {
  return (
    <Panel title="Health">
      {state.loading ? (
        <p className="mt-3 text-sm text-gray-500">Checking health</p>
      ) : state.error ? (
        <ErrorText message={state.error} />
      ) : state.data ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <InlineMetric label="Service" value={titleCase(state.data.status)} />
          <InlineMetric
            label="Database"
            value={state.data.postgres === 'connected' ? 'Postgres connected' : state.data.postgres}
          />
          <InlineMetric label="Embedding" value={state.data.embeddingModel ?? 'Not configured'} />
        </div>
      ) : null}
    </Panel>
  );
}

function QueuePanel({ state }: { state: ResourceState<AdminQueueStatus> }) {
  const pending = state.data
    ? state.data.embedding.pending + (state.data.extraction?.pending ?? 0)
    : 0;
  const extractionFailed = state.data?.extraction?.failed ?? 0;

  return (
    <Panel title="Queue">
      {state.loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading queue</p>
      ) : state.error ? (
        <ErrorText message={state.error} />
      ) : state.data ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <InlineMetric label="Queue pending" value={pending} />
          <InlineMetric label="Embedding failed" value={`${state.data.embedding.failed} failed`} />
          <InlineMetric
            label="Extraction failed"
            value={state.data.extraction ? `${extractionFailed} failed` : 'Disabled'}
          />
        </div>
      ) : null}
    </Panel>
  );
}

function StatsPanel({ state }: { state: ResourceState<AdminStats> }) {
  return (
    <Panel title="Stats">
      {state.loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading stats</p>
      ) : state.error ? (
        <ErrorText message={state.error} />
      ) : state.data ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <InlineMetric label="Memory" value={state.data.entityCounts.memory ?? 0} />
          <InlineMetric label="Chunks" value={`${state.data.chunkCount} chunks`} />
          <InlineMetric label="Keys" value={`${state.data.keyCount} keys`} />
          <InlineMetric label="Database" value={formatBytes(state.data.databaseSizeBytes)} />
          <InlineMetric label="Uptime" value={formatDuration(state.data.uptimeSeconds)} />
        </div>
      ) : null}
    </Panel>
  );
}

function ModelsPanel({ state }: { state: ResourceState<AdminEmbeddingModel[]> }) {
  return (
    <Panel title="Models">
      {state.loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading models</p>
      ) : state.error ? (
        <ErrorText message={state.error} />
      ) : state.data ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-gray-800 text-gray-500">
              <tr>
                <th scope="col" className="px-2 py-2 font-medium">Model</th>
                <th scope="col" className="px-2 py-2 font-medium">Provider</th>
                <th scope="col" className="px-2 py-2 font-medium">Dimensions</th>
                <th scope="col" className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {state.data.map(model => (
                <tr key={model.id} className="text-gray-300">
                  <td className="px-2 py-2 font-medium text-gray-100">{model.name}</td>
                  <td className="px-2 py-2">{model.provider}</td>
                  <td className="px-2 py-2">{model.dimensions}</td>
                  <td className="px-2 py-2">{model.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

function ConfigStatusPanel({ state }: { state: ResourceState<AdminConfigStatus> }) {
  const pending = state.data?.settings.byState.pending ?? 0;

  return (
    <Panel title="Config status">
      {state.loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading config status</p>
      ) : state.error ? (
        <ErrorText message={state.error} />
      ) : state.data ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <InlineMetric label="Settings" value={`${state.data.settings.total} settings`} />
          <InlineMetric label="Config pending" value={pending} />
          <InlineMetric label="Secrets" value={`${state.data.secrets.totalConfigured} configured`} />
        </div>
      ) : null}
    </Panel>
  );
}

function JobsPanel({ state }: { state: ResourceState<AdminJob[]> }) {
  return (
    <Panel title="Jobs">
      {state.loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading jobs</p>
      ) : state.error ? (
        <ErrorText message={state.error} />
      ) : state.data && state.data.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-gray-800 text-gray-500">
              <tr>
                <th scope="col" className="px-2 py-2 font-medium">Operation</th>
                <th scope="col" className="px-2 py-2 font-medium">Mode</th>
                <th scope="col" className="px-2 py-2 font-medium">Status</th>
                <th scope="col" className="px-2 py-2 font-medium">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {state.data.map(job => (
                <tr key={job.id} className="text-gray-300">
                  <td className="px-2 py-2 font-medium text-gray-100">{job.operation}</td>
                  <td className="px-2 py-2">{job.mode}</td>
                  <td className="px-2 py-2">{job.status}</td>
                  <td className="px-2 py-2">
                    {job.progress.total === null
                      ? String(job.progress.current)
                      : `${job.progress.current}/${job.progress.total}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-500">No jobs</p>
      )}
    </Panel>
  );
}

export default function AdminDashboard({
  api,
  onAuthUpdate,
  onSessionExpired,
  session,
  stepUp,
  user,
}: AdminDashboardProps) {
  const [activePanel, setActivePanel] = useState<DashboardPanel>('overview');
  const [health, setHealth] = useState<ResourceState<AdminHealth>>(() => pendingResource());
  const [queue, setQueue] = useState<ResourceState<AdminQueueStatus>>(() => pendingResource());
  const [models, setModels] = useState<ResourceState<AdminEmbeddingModel[]>>(() => pendingResource());
  const [configStatus, setConfigStatus] = useState<ResourceState<AdminConfigStatus>>(() => pendingResource());
  const [stats, setStats] = useState<ResourceState<AdminStats>>(() => pendingResource());
  const [jobs, setJobs] = useState<ResourceState<AdminJob[]>>(() => pendingResource());

  const stepUpValue = useMemo(() => {
    if (stepUp?.fresh) {
      return stepUp.expiresAt ? `Fresh until ${new Date(stepUp.expiresAt).toLocaleTimeString()}` : 'Fresh';
    }
    return 'Required for sensitive actions';
  }, [stepUp]);

  useEffect(() => {
    let cancelled = false;

    async function loadResource<T>(
      loader: () => Promise<T>,
      setter: (state: ResourceState<T>) => void,
      fallback: string
    ) {
      setter(pendingResource());
      try {
        const data = await loader();
        if (!cancelled) {
          setter(loadedResource(data));
        }
      } catch (error) {
        if (!cancelled) {
          if (onSessionExpired(error)) {
            return;
          }
          setter(failedResource(errorMessage(error, fallback)));
        }
      }
    }

    void loadResource(() => api.getHealth().then(response => response.health), setHealth, 'Unable to load health');
    void loadResource(() => api.getQueueStatus().then(response => response.queue), setQueue, 'Unable to load queue');
    void loadResource(() => api.listModels().then(response => response.models), setModels, 'Unable to load models');
    void loadResource(() => api.getConfigStatus().then(response => response.configStatus), setConfigStatus, 'Unable to load config status');
    void loadResource(() => api.getStats().then(response => response.stats), setStats, 'Unable to load stats');
    void loadResource(() => api.listJobs().then(response => response.jobs), setJobs, 'Unable to load jobs');

    return () => {
      cancelled = true;
    };
  }, [api, onSessionExpired]);

  return (
    <section className="flex w-full max-w-7xl flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Operations dashboard</h1>
          <p className="mt-1 text-sm text-gray-400">{user.email}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InlineMetric label="Session" value={session.mfaVerified ? 'MFA verified' : 'MFA pending'} />
        <InlineMetric label="Expires" value={new Date(session.expiresAt).toLocaleString()} />
        <InlineMetric label="Step-up" value={stepUpValue} />
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
        <DashboardNavButton
          active={activePanel === 'overview'}
          onClick={() => setActivePanel('overview')}
        >
          Overview
        </DashboardNavButton>
        <DashboardNavButton
          active={activePanel === 'provider-config'}
          onClick={() => setActivePanel('provider-config')}
        >
          Config
        </DashboardNavButton>
      </nav>

      {activePanel === 'provider-config' ? (
        <AdminConfig
          api={api}
          initialStepUp={stepUp}
          onAuthUpdate={onAuthUpdate}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <>
          <div className="grid gap-3 xl:grid-cols-2">
            <HealthPanel state={health} />
            <QueuePanel state={queue} />
            <StatsPanel state={stats} />
            <ConfigStatusPanel state={configStatus} />
            <ModelsPanel state={models} />
            <JobsPanel state={jobs} />
          </div>

          <AdminApiKeys
            api={api}
            onAuthUpdate={onAuthUpdate}
            onSessionExpired={onSessionExpired}
          />
          <AdminAudit api={api} onSessionExpired={onSessionExpired} />
        </>
      )}
    </section>
  );
}
