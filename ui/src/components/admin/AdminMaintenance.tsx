import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createAdminApiClient,
  type AdminApiClient,
  type AdminAuthResponse,
  type AdminEntityType,
  type AdminJob,
  type AdminJobStatus,
  type AdminJsonValue,
  type AdminMaintenanceEntityScope,
  type AdminMaintenancePruneEdgesInput,
  type AdminMaintenanceReembedInput,
  type AdminMaintenanceReextractInput,
  type AdminStepUp
} from '../../lib/adminApi.ts';

const ENTITY_TYPES: AdminEntityType[] = [
  'memory',
  'person',
  'project',
  'task',
  'interaction',
  'document'
];
const POLL_INTERVAL_MS = 2_000;
const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

type MaintenanceOperation = 'reextract' | 'reembed' | 'prune-edges';
type ScopeKind = AdminMaintenanceEntityScope['kind'];
type BusyAction = 'dry-run' | 'apply' | null;

type AdminMaintenanceProps = {
  api?: AdminApiClient;
  initialStepUp?: AdminStepUp;
  onAuthUpdate?: (response: AdminAuthResponse) => void;
  onSessionExpired?: (error: unknown) => boolean;
};

type DryRunInput =
  | AdminMaintenanceReextractInput
  | AdminMaintenanceReembedInput
  | AdminMaintenancePruneEdgesInput;
type AdminJobReference = AdminJob | Pick<AdminJob, 'id' | 'status'>;

const operationLabels: Record<MaintenanceOperation, string> = {
  reextract: 'Re-extract',
  reembed: 'Re-embed',
  'prune-edges': 'Prune edges'
};

const terminalJobStatuses = new Set<AdminJobStatus>([
  'cancelled',
  'failed',
  'succeeded'
]);

const safeSummaryKeys = new Set([
  'activeModelChange',
  'archived',
  'autoCreated',
  'cancelPhase',
  'cancelRequested',
  'cancelled',
  'clearsExtractionErrors',
  'deleted',
  'deletedChunks',
  'deletedEdges',
  'deletesEmbeddings',
  'deletesLlmEdges',
  'destructive',
  'dryRun',
  'errorCode',
  'failed',
  'failedCount',
  'failureCount',
  'implications',
  'kind',
  'llmCost',
  'markedCount',
  'noContent',
  'permanentDelete',
  'phase',
  'providerWork',
  'relation',
  'scope',
  'scopedToLlmExtraction',
  'skipped',
  'skippedExtraction',
  'source',
  'successCount',
  'succeededCount',
  'threshold',
  'type',
  'wouldDelete',
  'wouldDeleteChunks',
  'wouldDeleteEdges',
  'wouldMark'
]);

const unsafeSummaryKeyPattern =
  /(api.?key|auth|body|cipher|credential|header|metadata|password|prefix|private|provider.?response|secret|token)/iu;
const unsafeSummaryValuePattern =
  /(bearer\s+|ciphertext|pgm-admin|sk-[a-z0-9_-]|-----BEGIN)/iu;

function inputClassName() {
  return 'rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:text-gray-500';
}

function buttonClassName(
  variant: 'primary' | 'secondary' | 'danger' = 'secondary'
) {
  const base =
    'rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500';
  if (variant === 'primary') {
    return `${base} bg-blue-600 text-white hover:bg-blue-500`;
  }
  if (variant === 'danger') {
    return `${base} bg-red-600 text-white hover:bg-red-500`;
  }
  return `${base} bg-gray-800 text-gray-100 hover:bg-gray-700`;
}

function badgeClassName(
  tone: 'default' | 'good' | 'warn' | 'danger' = 'default'
) {
  const base =
    'inline-flex min-h-6 items-center rounded-md border px-2 py-0.5 text-xs font-medium';
  if (tone === 'good') {
    return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`;
  }
  if (tone === 'warn') {
    return `${base} border-amber-500/30 bg-amber-500/10 text-amber-200`;
  }
  if (tone === 'danger') {
    return `${base} border-red-500/30 bg-red-500/10 text-red-200`;
  }
  return `${base} border-gray-700 bg-gray-800 text-gray-300`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function isTerminalStatus(status: AdminJobStatus): boolean {
  return terminalJobStatuses.has(status);
}

function isStepUpFresh(
  stepUp: AdminStepUp | undefined,
  nowMs: number
): boolean {
  if (!stepUp?.fresh || !stepUp.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(stepUp.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

function operationName(operation: MaintenanceOperation): string {
  return operation === 'prune-edges'
    ? 'maintenance.prune_edges'
    : `maintenance.${operation}`;
}

function fallbackJob(
  job: Pick<AdminJob, 'id' | 'status'>,
  operation: MaintenanceOperation,
  mode: AdminJob['mode']
): AdminJob {
  const now = new Date().toISOString();
  return {
    id: job.id,
    operation: operationName(operation),
    mode,
    status: job.status,
    idempotencyKey: null,
    requestedScope: {},
    requestSummary: {},
    resultSummary: {},
    progress: {
      current: 0,
      total: null,
      message: null
    },
    createdByAdminUserId: null,
    updatedByAdminUserId: null,
    startedAt: null,
    cancelRequestedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function normalizeJob(
  job: AdminJobReference,
  operation: MaintenanceOperation,
  mode: AdminJob['mode']
): AdminJob {
  return isFullJob(job) ? job : fallbackJob(job, operation, mode);
}

function isFullJob(job: AdminJobReference): job is AdminJob {
  return 'progress' in job;
}

function formatProgress(job: AdminJob): string {
  if (job.progress.total === null) {
    return String(job.progress.current);
  }
  return `${job.progress.current}/${job.progress.total}`;
}

function summaryValueIsSafe(value: unknown): value is AdminJsonValue {
  if (value === null) {
    return true;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value !== 'string' || !unsafeSummaryValuePattern.test(value);
  }
  if (Array.isArray(value)) {
    return value.every((item) => {
      if (item === null) {
        return true;
      }
      if (
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
      ) {
        return typeof item !== 'string' || !unsafeSummaryValuePattern.test(item);
      }
      return false;
    });
  }
  if (typeof value === 'object') {
    return Object.keys(value).some((key) => safeSummaryKey(key));
  }
  return false;
}

function safeSummaryKey(key: string): boolean {
  return safeSummaryKeys.has(key) && !unsafeSummaryKeyPattern.test(key);
}

function safeSummaryEntries(value: unknown): Array<[string, AdminJsonValue]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => {
      if (!safeSummaryKey(key) || !summaryValueIsSafe(nested)) {
        return [];
      }
      if (
        typeof nested === 'object' &&
        nested !== null &&
        !Array.isArray(nested)
      ) {
        const nestedEntries = safeSummaryEntries(nested);
        if (nestedEntries.length === 0) {
          return [];
        }
        return [[key, Object.fromEntries(nestedEntries) as AdminJsonValue]];
      }
      return [[key, nested as AdminJsonValue]];
    }
  );
}

function renderSummaryValue(value: AdminJsonValue): ReactNode {
  if (value === null) {
    return <span className="text-gray-500">null</span>;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div className="grid gap-1">
        {value.map((item, index) => (
          <div key={index}>{renderSummaryValue(item)}</div>
        ))}
      </div>
    );
  }
  return (
    <dl className="grid gap-1">
      {Object.entries(value).map(([key, nested]) => (
        <div key={key} className="grid grid-cols-[9rem_1fr] gap-2">
          <dt className="truncate text-gray-500">{key}</dt>
          <dd className="min-w-0 break-words text-gray-200">
            {renderSummaryValue(nested)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SafeSummary({ summary }: { summary: Record<string, unknown> }) {
  const entries = safeSummaryEntries(summary);
  if (entries.length === 0) {
    return <p className="mt-3 text-sm text-gray-500">No result summary yet</p>;
  }

  return (
    <dl className="mt-3 grid gap-2 text-xs">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[9rem_1fr] gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-2"
        >
          <dt className="truncate font-mono text-gray-500">{key}</dt>
          <dd className="min-w-0 break-words font-mono text-gray-200">
            {renderSummaryValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function JobPanel({
  job,
  title
}: {
  job: AdminJob | null;
  title: string;
}) {
  if (!job) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-3 text-sm text-gray-500">No job yet</p>
      </section>
    );
  }

  const tone =
    job.status === 'succeeded'
      ? 'good'
      : job.status === 'failed' || job.status === 'cancelled'
        ? 'danger'
        : 'warn';

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className={badgeClassName(tone)}>{job.status}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Job ID</dt>
          <dd className="mt-1 break-all font-mono text-gray-200">{job.id}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Progress</dt>
          <dd className="mt-1 font-mono text-gray-200">
            {formatProgress(job)}
          </dd>
        </div>
      </dl>
      {job.progress.message ? (
        <p className="mt-3 text-sm text-gray-300">{job.progress.message}</p>
      ) : null}
      <SafeSummary summary={job.resultSummary} />
    </section>
  );
}

function randomSuffix(): string {
  if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
    return globalThis.crypto.randomUUID().toLowerCase();
  }
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function idempotencyKeyFor(
  operation: MaintenanceOperation,
  previewJobId: string
): string {
  return `maintenance-${operation}:${previewJobId}-${randomSuffix()}`;
}

export default function AdminMaintenance({
  api,
  initialStepUp,
  onAuthUpdate,
  onSessionExpired
}: AdminMaintenanceProps) {
  const defaultApi = useMemo(() => createAdminApiClient(), []);
  const client = api ?? defaultApi;
  const [operation, setOperation] = useState<MaintenanceOperation>('reextract');
  const [scopeKind, setScopeKind] = useState<ScopeKind>('type');
  const [entityType, setEntityType] = useState<AdminEntityType>('memory');
  const [entityId, setEntityId] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [limit, setLimit] = useState('');
  const [cleanEdges, setCleanEdges] = useState(true);
  const [includeAutoCreated, setIncludeAutoCreated] = useState(false);
  const [noEdgesOnly, setNoEdgesOnly] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [threshold, setThreshold] = useState('0.3');
  const [relation, setRelation] = useState('');
  const [previewJob, setPreviewJob] = useState<AdminJob | null>(null);
  const [applyJob, setApplyJob] = useState<AdminJob | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [stepUp, setStepUp] = useState<AdminStepUp | undefined>(initialStepUp);
  const [stepUpClockMs, setStepUpClockMs] = useState(() => Date.now());
  const [stepUpCode, setStepUpCode] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function routeSessionExpiry(requestError: unknown): boolean {
    return onSessionExpired?.(requestError) ?? false;
  }

  async function resolveJobReference(
    job: AdminJobReference,
    jobOperation: MaintenanceOperation,
    mode: AdminJob['mode']
  ): Promise<AdminJob> {
    if (isFullJob(job)) {
      return job;
    }
    const response = await client.getJob(job.id);
    return normalizeJob(response.job, jobOperation, mode);
  }

  const stepUpIsFresh = isStepUpFresh(stepUp, stepUpClockMs);
  const requestFingerprint = useMemo(
    () =>
      JSON.stringify({
        operation,
        scopeKind,
        entityType,
        entityId,
        onlyFailed,
        limit,
        cleanEdges,
        includeAutoCreated,
        noEdgesOnly,
        showSkipped,
        threshold,
        relation
      }),
    [
      cleanEdges,
      entityId,
      entityType,
      includeAutoCreated,
      limit,
      noEdgesOnly,
      onlyFailed,
      operation,
      relation,
      scopeKind,
      showSkipped,
      threshold
    ]
  );

  useEffect(() => {
    setPreviewJob(null);
    setApplyJob(null);
    setReviewed(false);
    setIdempotencyKey(null);
    setNotice(null);
    setError(null);
  }, [requestFingerprint]);

  useEffect(() => {
    setStepUpClockMs(Date.now());
    if (!stepUp?.fresh || !stepUp.expiresAt) {
      return;
    }

    const expiresAtMs = Date.parse(stepUp.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }

    const timeoutMs = Math.max(0, expiresAtMs - Date.now()) + 1;
    if (timeoutMs > MAX_BROWSER_TIMEOUT_MS) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStepUpClockMs(Date.now());
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [stepUp?.expiresAt, stepUp?.fresh]);

  useEffect(() => {
    if (!previewJob || isTerminalStatus(previewJob.status)) {
      return;
    }

    let cancelled = false;
    let timeout: number | undefined;

    const poll = async () => {
      try {
        const response = await client.getJob(previewJob.id);
        if (cancelled) {
          return;
        }
        setError(null);
        setPreviewJob(response.job);
        if (!isTerminalStatus(response.job.status)) {
          timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (pollError) {
        if (cancelled || routeSessionExpiry(pollError)) {
          return;
        }
        setError(errorMessage(pollError, 'Unable to refresh preview job'));
        timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    };
  }, [client, previewJob?.id]);

  useEffect(() => {
    if (!applyJob || isTerminalStatus(applyJob.status)) {
      return;
    }

    let cancelled = false;
    let timeout: number | undefined;

    const poll = async () => {
      try {
        const response = await client.getJob(applyJob.id);
        if (cancelled) {
          return;
        }
        setError(null);
        setApplyJob(response.job);
        if (!isTerminalStatus(response.job.status)) {
          timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (pollError) {
        if (cancelled || routeSessionExpiry(pollError)) {
          return;
        }
        setError(errorMessage(pollError, 'Unable to refresh apply job'));
        timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timeout = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    };
  }, [client, applyJob?.id]);

  function buildScope(): AdminMaintenanceEntityScope | null {
    if (scopeKind === 'all') {
      return { kind: 'all' };
    }
    if (scopeKind === 'failed') {
      return { kind: 'failed' };
    }
    if (scopeKind === 'id') {
      const trimmedId = entityId.trim();
      if (!trimmedId) {
        setError('Enter an entity ID for ID-scoped maintenance.');
        return null;
      }
      return { kind: 'id', id: trimmedId };
    }
    return { kind: 'type', type: entityType };
  }

  function buildDryRunInput(): DryRunInput | null {
    setError(null);
    if (operation === 'prune-edges') {
      const below = Number(threshold);
      if (!Number.isFinite(below) || below < 0 || below > 1) {
        setError('Confidence threshold must be between 0 and 1.');
        return null;
      }
      return {
        below,
        source: 'llm-extraction',
        ...(relation.trim() ? { relation: relation.trim() } : {})
      };
    }

    const scope = buildScope();
    if (!scope) {
      return null;
    }

    if (operation === 'reembed') {
      return {
        scope,
        ...(onlyFailed ? { onlyFailed: true } : {})
      };
    }

    const trimmedLimit = limit.trim();
    if (trimmedLimit) {
      const parsedLimit = Number(trimmedLimit);
      if (
        !Number.isSafeInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > 10_000
      ) {
        setError('Limit must be a whole number between 1 and 10000.');
        return null;
      }
    }

    return {
      scope,
      ...(onlyFailed ? { onlyFailed: true } : {}),
      ...(trimmedLimit ? { limit: Number(trimmedLimit) } : {}),
      cleanEdges,
      ...(includeAutoCreated ? { includeAutoCreated: true } : {}),
      ...(noEdgesOnly ? { noEdgesOnly: true } : {}),
      ...(showSkipped ? { showSkipped: true } : {})
    };
  }

  async function ensureStepUp(): Promise<boolean> {
    if (isStepUpFresh(stepUp, Date.now())) {
      return true;
    }
    if (!stepUpCode.trim()) {
      setError('Enter a step-up code before applying maintenance.');
      return false;
    }

    const response = await client.stepUp({ code: stepUpCode.trim() });
    setStepUp(response.stepUp);
    setStepUpClockMs(Date.now());
    setStepUpCode('');
    onAuthUpdate?.(response);
    return true;
  }

  async function handleDryRun() {
    const input = buildDryRunInput();
    if (!input) {
      return;
    }

    setBusyAction('dry-run');
    setNotice(null);
    setError(null);
    setReviewed(false);
    setApplyJob(null);
    setIdempotencyKey(null);
    try {
      const response =
        operation === 'reextract'
          ? await client.dryRunReextractMaintenance(
              input as AdminMaintenanceReextractInput
            )
          : operation === 'reembed'
            ? await client.dryRunReembedMaintenance(
                input as AdminMaintenanceReembedInput
              )
            : await client.dryRunPruneEdgesMaintenance(
                input as AdminMaintenancePruneEdgesInput
              );
      setPreviewJob(normalizeJob(response.job, operation, 'dry_run'));
      setNotice('Dry-run preview started');
    } catch (dryRunError) {
      if (!routeSessionExpiry(dryRunError)) {
        setError(errorMessage(dryRunError, 'Unable to start dry-run preview'));
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApply() {
    if (!previewJob || previewJob.status !== 'succeeded') {
      setError('Run a successful dry-run preview before applying maintenance.');
      return;
    }
    if (!reviewed) {
      setError('Review the dry-run preview before applying maintenance.');
      return;
    }

    const input = buildDryRunInput();
    if (!input) {
      return;
    }

    setBusyAction('apply');
    setNotice(null);
    setError(null);
    try {
      if (!(await ensureStepUp())) {
        return;
      }

      const key =
        idempotencyKey ?? idempotencyKeyFor(operation, previewJob.id);
      setIdempotencyKey(key);
      const evidence = {
        previewJobId: previewJob.id,
        idempotencyKey: key
      };
      const response =
        operation === 'reextract'
          ? await client.applyReextractMaintenance({
              ...(input as AdminMaintenanceReextractInput),
              ...evidence
            })
          : operation === 'reembed'
            ? await client.applyReembedMaintenance({
                ...(input as AdminMaintenanceReembedInput),
                ...evidence
              })
            : await client.applyPruneEdgesMaintenance({
                ...(input as AdminMaintenancePruneEdgesInput),
                ...evidence
              });
      setApplyJob(await resolveJobReference(response.job, operation, 'apply'));
      setNotice(
        response.reused
          ? 'Idempotent retry reused the existing apply job'
          : 'Apply job started'
      );
    } catch (applyError) {
      if (!routeSessionExpiry(applyError)) {
        setError(errorMessage(applyError, 'Unable to start apply job'));
      }
    } finally {
      setBusyAction(null);
    }
  }

  const previewSucceeded = previewJob?.status === 'succeeded';
  const previewJobInFlight = Boolean(
    previewJob && !isTerminalStatus(previewJob.status)
  );
  const applyJobInFlight = Boolean(applyJob && !isTerminalStatus(applyJob.status));
  const requestControlsDisabled =
    busyAction !== null || previewJobInFlight || applyJobInFlight;
  const applyDisabled =
    requestControlsDisabled || !previewSucceeded || !reviewed;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Maintenance jobs</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Run approved maintenance with a dry-run preview, explicit review,
            recent step-up, and job progress polling.
          </p>
        </div>
        <span className={badgeClassName(stepUpIsFresh ? 'good' : 'warn')}>
          {stepUpIsFresh ? 'Step-up fresh' : 'Step-up required for apply'}
        </span>
      </div>

      <nav className="flex flex-wrap gap-2">
        {(['reextract', 'reembed', 'prune-edges'] as const).map((item) => (
          <button
            key={item}
            type="button"
            disabled={requestControlsDisabled}
            onClick={() => setOperation(item)}
            className={
              operation === item
                ? buttonClassName('primary')
                : buttonClassName('secondary')
            }
          >
            {operationLabels[item]}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-sm font-semibold text-white">Scope</h3>

          {operation === 'prune-edges' ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
                Confidence threshold
                <input
                  className={inputClassName()}
                  inputMode="decimal"
                  disabled={requestControlsDisabled}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
                Relation
                <input
                  className={inputClassName()}
                  disabled={requestControlsDisabled}
                  value={relation}
                  onChange={(event) => setRelation(event.target.value)}
                  placeholder="Optional relation"
                />
              </label>
              <p className="text-sm text-gray-300">Source: llm-extraction</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
                Scope
                <select
                  className={inputClassName()}
                  disabled={requestControlsDisabled}
                  value={scopeKind}
                  onChange={(event) =>
                    setScopeKind(event.target.value as ScopeKind)
                  }
                >
                  <option value="type">Entity type</option>
                  <option value="failed">Failed queue</option>
                  <option value="id">Single entity</option>
                  <option value="all">All entities</option>
                </select>
              </label>
              {scopeKind === 'type' ? (
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
                  Entity type
                  <select
                    className={inputClassName()}
                    disabled={requestControlsDisabled}
                    value={entityType}
                    onChange={(event) =>
                      setEntityType(event.target.value as AdminEntityType)
                    }
                  >
                    {ENTITY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {scopeKind === 'id' ? (
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
                  Entity ID
                  <input
                    className={inputClassName()}
                    disabled={requestControlsDisabled}
                    value={entityId}
                    onChange={(event) => setEntityId(event.target.value)}
                    placeholder="UUID"
                  />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-blue-600 focus:ring-blue-500"
                  type="checkbox"
                  disabled={requestControlsDisabled}
                  checked={onlyFailed}
                  onChange={(event) => setOnlyFailed(event.target.checked)}
                />
                Only failed records
              </label>
              {operation === 'reextract' ? (
                <>
                  <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
                    Limit
                    <input
                      className={inputClassName()}
                      inputMode="numeric"
                      disabled={requestControlsDisabled}
                      value={limit}
                      onChange={(event) => setLimit(event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-blue-600 focus:ring-blue-500"
                      type="checkbox"
                      disabled={requestControlsDisabled}
                      checked={cleanEdges}
                      onChange={(event) => setCleanEdges(event.target.checked)}
                    />
                    Clean LLM extraction edges
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-blue-600 focus:ring-blue-500"
                      type="checkbox"
                      disabled={requestControlsDisabled}
                      checked={includeAutoCreated}
                      onChange={(event) =>
                        setIncludeAutoCreated(event.target.checked)
                      }
                    />
                    Include auto-created records
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-blue-600 focus:ring-blue-500"
                      type="checkbox"
                      disabled={requestControlsDisabled}
                      checked={noEdgesOnly}
                      onChange={(event) => setNoEdgesOnly(event.target.checked)}
                    />
                    Only records without LLM edges
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      className="h-4 w-4 rounded border-gray-700 bg-gray-950 text-blue-600 focus:ring-blue-500"
                      type="checkbox"
                      disabled={requestControlsDisabled}
                      checked={showSkipped}
                      onChange={(event) => setShowSkipped(event.target.checked)}
                    />
                    Include skipped breakdown
                  </label>
                </>
              ) : null}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClassName('primary')}
              disabled={requestControlsDisabled}
              onClick={() => void handleDryRun()}
            >
              {busyAction === 'dry-run'
                ? 'Starting preview'
                : 'Run dry-run preview'}
            </button>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h3 className="text-sm font-semibold text-white">
              Apply confirmation
            </h3>
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-300">
              <input
                className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-950 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                type="checkbox"
                checked={reviewed}
                disabled={!previewSucceeded || requestControlsDisabled}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              I reviewed the dry-run preview
            </label>
            <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-300">
              Step-up code
              <input
                className={inputClassName()}
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value)}
                placeholder={
                  stepUpIsFresh ? 'Fresh step-up active' : 'Required for apply'
                }
              />
            </label>
            {idempotencyKey ? (
              <p className="mt-3 break-all font-mono text-[11px] text-gray-500">
                {idempotencyKey}
              </p>
            ) : null}
            <button
              type="button"
              className={`mt-3 w-full ${buttonClassName('danger')}`}
              disabled={applyDisabled}
              onClick={() => void handleApply()}
            >
              {busyAction === 'apply'
                ? 'Starting apply job'
                : 'Apply maintenance job'}
            </button>
          </section>
        </aside>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <JobPanel title="Dry-run preview" job={previewJob} />
        <JobPanel title="Apply result" job={applyJob} />
      </div>
    </section>
  );
}
