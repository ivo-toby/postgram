import { useEffect, useMemo, useState } from 'react';
import {
  createAdminApiClient,
  type AdminApiClient,
  type AdminAuthResponse,
  type AdminBackupRestoreStageResponse,
  type AdminBackupRestoreValidationResponse,
  type AdminStepUp
} from '../../lib/adminApi.ts';
import { HelpLabel } from './AdminHelp.tsx';

type AdminBackupProps = {
  api?: AdminApiClient;
  initialStepUp?: AdminStepUp;
  onAuthUpdate?: (response: AdminAuthResponse) => void;
  onSessionExpired?: (error: unknown) => boolean;
};

const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

function buttonClassName(
  variant: 'primary' | 'secondary' | 'danger' = 'secondary'
) {
  const base =
    'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500';
  if (variant === 'primary') {
    return `${base} bg-blue-600 text-white hover:bg-blue-500`;
  }
  if (variant === 'danger') {
    return `${base} bg-red-600 text-white hover:bg-red-500`;
  }
  return `${base} bg-gray-800 text-gray-100 hover:bg-gray-700`;
}

function inputClassName() {
  return 'rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:text-gray-500';
}

function badgeClassName(tone: 'good' | 'warn' = 'warn') {
  const base =
    'inline-flex min-h-6 items-center rounded-md border px-2 py-0.5 text-xs font-medium';
  if (tone === 'good') {
    return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`;
  }
  return `${base} border-amber-500/30 bg-amber-500/10 text-amber-200`;
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
    />
  );
}

function LoadingStatus({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="mt-3 inline-flex items-center gap-2 text-sm text-blue-200"
    >
      <Spinner />
      {children}
    </p>
  );
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AdminBackup({
  api,
  initialStepUp,
  onAuthUpdate,
  onSessionExpired
}: AdminBackupProps) {
  const defaultApi = useMemo(() => createAdminApiClient(), []);
  const client = api ?? defaultApi;
  const [stepUp, setStepUp] = useState<AdminStepUp | undefined>(initialStepUp);
  const [stepUpClockMs, setStepUpClockMs] = useState(() => Date.now());
  const [backupStepUpCode, setBackupStepUpCode] = useState('');
  const [restoreStepUpCode, setRestoreStepUpCode] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [validatedRestore, setValidatedRestore] =
    useState<AdminBackupRestoreValidationResponse['restore'] | null>(null);
  const [stagedRestore, setStagedRestore] =
    useState<AdminBackupRestoreStageResponse['restore'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState<
    'validate' | 'stage' | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stepUpIsFresh = isStepUpFresh(stepUp, stepUpClockMs);

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

  function routeSessionExpiry(requestError: unknown): boolean {
    return onSessionExpired?.(requestError) ?? false;
  }

  async function ensureStepUp({
    code,
    missingMessage,
    onConsumed
  }: {
    code: string;
    missingMessage: string;
    onConsumed: () => void;
  }): Promise<boolean> {
    if (isStepUpFresh(stepUp, Date.now())) {
      return true;
    }
    if (!code.trim()) {
      setError(missingMessage);
      return false;
    }

    const response = await client.stepUp({ code: code.trim() });
    setStepUp(response.stepUp);
    setStepUpClockMs(Date.now());
    onConsumed();
    onAuthUpdate?.(response);
    return true;
  }

  async function handleDownload() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      if (
        !(await ensureStepUp({
          code: backupStepUpCode,
          missingMessage:
            'Enter the backup MFA confirmation code before downloading.',
          onConsumed: () => setBackupStepUpCode('')
        }))
      ) {
        return;
      }
      const backup = await client.downloadBackup();
      saveBlob(backup.blob, backup.filename);
      setNotice(`Backup download started: ${backup.filename}`);
    } catch (downloadError) {
      if (!routeSessionExpiry(downloadError)) {
        setError(errorMessage(downloadError, 'Unable to download backup'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleValidateRestore() {
    if (!restoreFile) {
      setError('Choose a backup archive before validation.');
      return;
    }

    setRestoreBusy('validate');
    setNotice(null);
    setError(null);
    setValidatedRestore(null);
    setStagedRestore(null);
    try {
      const response = await client.validateBackupRestore(restoreFile);
      setValidatedRestore(response.restore);
      setNotice('Backup archive validated and ready for staging.');
    } catch (validateError) {
      if (!routeSessionExpiry(validateError)) {
        setError(errorMessage(validateError, 'Unable to validate backup'));
      }
    } finally {
      setRestoreBusy(null);
    }
  }

  async function handleStageRestore() {
    if (!validatedRestore) {
      setError('Validate a backup before restoring it.');
      return;
    }

    setRestoreBusy('stage');
    setNotice(null);
    setError(null);
    try {
      if (
        !(await ensureStepUp({
          code: restoreStepUpCode,
          missingMessage:
            'Enter the restore MFA confirmation code before restoring to staging.',
          onConsumed: () => setRestoreStepUpCode('')
        }))
      ) {
        return;
      }
      const response = await client.stageBackupRestore({
        restoreToken: validatedRestore.token,
        confirmation: 'RESTORE TO STAGING'
      });
      setStagedRestore(response.restore);
      setNotice('Staging restore completed.');
    } catch (stageError) {
      if (!routeSessionExpiry(stageError)) {
        setError(errorMessage(stageError, 'Unable to stage restore'));
      }
    } finally {
      setRestoreBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Backups</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-400">
            Download a gzipped backup archive containing a PostgreSQL custom
            dump and redacted runtime configuration. Treat the archive as
            sensitive because the database dump includes application data and
            encrypted admin secrets.
          </p>
        </div>
        <span className={badgeClassName(stepUpIsFresh ? 'good' : 'warn')}>
          {stepUpIsFresh ? 'MFA confirmed' : 'MFA confirmation required'}
        </span>
      </div>

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

      <div data-testid="backup-layout" className="space-y-4">
        <section
          aria-labelledby="download-backup-title"
          className="rounded-lg border border-gray-800 bg-gray-900 p-4"
        >
          <h3
            id="download-backup-title"
            className="text-sm font-semibold text-white"
          >
            Download backup
          </h3>
          <p className="mt-2 text-sm leading-6 text-gray-300">
            The archive contains <span className="font-mono">database.dump</span>,
            <span className="font-mono"> manifest.json</span>, and
            <span className="font-mono"> configuration.json</span>. The
            manifest records how to validate the dump before any restore.
          </p>
          <label className="mt-4 flex flex-col gap-1 text-xs font-medium text-gray-300">
            <HelpLabel help="Use the current six-digit authenticator code. Backup archives contain sensitive data, so downloads require fresh MFA confirmation.">
              Backup MFA confirmation code
            </HelpLabel>
            <input
              className={inputClassName()}
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              disabled={busy}
              value={backupStepUpCode}
              onChange={(event) => setBackupStepUpCode(event.target.value)}
              placeholder={
                stepUpIsFresh
                  ? 'MFA confirmation active'
                  : 'Required before download'
              }
            />
          </label>
          <button
            type="button"
            className={`mt-3 ${buttonClassName('primary')}`}
            disabled={busy}
            onClick={() => void handleDownload()}
          >
            {busy ? (
              <>
                <Spinner />
                Preparing backup
              </>
            ) : (
              'Download backup'
            )}
          </button>
          {busy ? (
            <LoadingStatus>Preparing backup archive...</LoadingStatus>
          ) : null}
        </section>

        <section
          aria-labelledby="restore-backup-title"
          className="rounded-lg border border-gray-800 bg-gray-900 p-4"
        >
          <h3
            id="restore-backup-title"
            className="text-sm font-semibold text-white"
          >
            Restore backup
          </h3>
          <p className="mt-2 text-sm leading-6 text-gray-300">
            Restore is staged deliberately: validate the archive, restore into a
            new database name, run health checks, then switch the app over when
            you are ready. The current database is left untouched for rollback.
          </p>
          <label className="mt-4 flex flex-col gap-1 text-xs font-medium text-gray-300">
            <HelpLabel help="Upload a Postgram backup tarball. Validation checks manifest.json, configuration.json, database.dump, and pg_restore --list before any database is created.">
              Backup archive
            </HelpLabel>
            <input
              aria-label="Backup archive"
              className={inputClassName()}
              type="file"
              accept=".tar.gz,application/gzip,application/x-gzip"
              disabled={restoreBusy !== null}
              onChange={(event) => {
                setRestoreFile(event.target.files?.[0] ?? null);
                setValidatedRestore(null);
                setStagedRestore(null);
              }}
            />
          </label>
          <button
            type="button"
            className={`mt-3 ${buttonClassName('secondary')}`}
            disabled={!restoreFile || restoreBusy !== null}
            onClick={() => void handleValidateRestore()}
          >
            {restoreBusy === 'validate' ? (
              <>
                <Spinner />
                Validating backup
              </>
            ) : (
              'Validate backup'
            )}
          </button>
          {restoreBusy === 'validate' ? (
            <LoadingStatus>Validating backup archive...</LoadingStatus>
          ) : null}

          {validatedRestore ? (
            <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              <p className="font-semibold">Backup validation passed</p>
              <dl className="mt-2 space-y-1 text-emerald-50/90">
                <div>
                  <dt className="text-xs uppercase text-emerald-100/60">
                    Staging database
                  </dt>
                  <dd className="font-mono">
                    {validatedRestore.stagingDatabaseName}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-emerald-100/60">
                    Source database
                  </dt>
                  <dd className="font-mono">
                    {validatedRestore.sourceDatabase.redactedUrl}
                  </dd>
                </div>
              </dl>
              <label className="mt-4 flex flex-col gap-1 text-xs font-medium text-emerald-50/90">
                <HelpLabel help="Use your current six-digit authenticator code to approve creating the staging restore database. This code is separate from the backup download confirmation.">
                  Restore MFA confirmation code
                </HelpLabel>
                <input
                  className={inputClassName()}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  autoComplete="one-time-code"
                  disabled={restoreBusy !== null}
                  value={restoreStepUpCode}
                  onChange={(event) =>
                    setRestoreStepUpCode(event.target.value)
                  }
                  placeholder={
                    stepUpIsFresh
                      ? 'MFA confirmation active'
                      : 'Required before restore'
                  }
                />
              </label>
              <button
                type="button"
                className={`mt-3 ${buttonClassName('danger')}`}
                disabled={restoreBusy !== null}
                onClick={() => void handleStageRestore()}
              >
                {restoreBusy === 'stage' ? (
                  <>
                    <Spinner />
                    Restoring to staging database
                  </>
                ) : (
                  'Restore to staging database'
                )}
              </button>
              {restoreBusy === 'stage' ? (
                <LoadingStatus>
                  Restoring backup into staging database...
                </LoadingStatus>
              ) : null}
            </div>
          ) : null}

          {stagedRestore ? (
            <div className="mt-4 rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
              <p className="font-semibold">Restore staged</p>
              <p className="mt-2">
                Staging database was created, migrations were applied, and the
                health check passed.
              </p>
            </div>
          ) : null}

          {(stagedRestore ?? validatedRestore) ? (
            <div className="mt-4 space-y-3 text-sm leading-6 text-gray-300">
              <div>
                <h4 className="text-xs font-semibold uppercase text-gray-500">
                  Switch-over
                </h4>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {(stagedRestore ?? validatedRestore)?.switchOver.dockerCompose.map(
                    (item) => <li key={item}>{item}</li>
                  )}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase text-gray-500">
                  Emergency rollback
                </h4>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {(stagedRestore ?? validatedRestore)?.switchOver.emergencyRollback.map(
                    (item) => <li key={item}>{item}</li>
                  )}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
