import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  type AdminApiClient,
  type AdminAuditEntry,
} from '../../lib/adminApi.ts';

type AdminAuditProps = {
  api: AdminApiClient;
  onSessionExpired: (error: unknown) => boolean;
};

const AUDIT_PAGE_SIZE = 50;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function inputClassName() {
  return 'rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
}

function buttonClassName() {
  return 'rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-500';
}

function renderDetailValue(value: unknown): ReactNode {
  if (value === null) {
    return <span className="text-gray-500">null</span>;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="flex flex-col gap-1">
        {value.map((item, index) => (
          <div key={index} className="pl-2">
            {renderDetailValue(item)}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    return (
      <dl className="grid gap-1">
        {Object.entries(value as Record<string, unknown>).map(([key, nested]) => (
          <div key={key} className="grid grid-cols-[8rem_1fr] gap-2">
            <dt className="truncate text-gray-500">{key}</dt>
            <dd className="min-w-0 break-words text-gray-300">
              {renderDetailValue(nested)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span>{String(value)}</span>;
}

export default function AdminAudit({
  api,
  onSessionExpired,
}: AdminAuditProps) {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [operation, setOperation] = useState('');
  const [appliedOperation, setAppliedOperation] = useState('');
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAudit(filterOperation = operation, offset = 0, append = false) {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    const trimmedOperation = filterOperation.trim();
    try {
      const response = await api.getAudit({
        ...(trimmedOperation ? { operation: trimmedOperation } : {}),
        limit: AUDIT_PAGE_SIZE,
        offset,
      });
      setEntries(current => append
        ? [
            ...current,
            ...response.audit.entries.filter(entry =>
              !current.some(existing => existing.id === entry.id)
            ),
          ]
        : response.audit.entries
      );
      setAppliedOperation(trimmedOperation);
      setNextOffset(response.audit.pagination.nextOffset);
    } catch (loadError) {
      if (!onSessionExpired(loadError)) {
        setError(errorMessage(loadError, 'Unable to load audit entries'));
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialAudit() {
      setLoading(true);
      setError(null);
      try {
        const response = await api.getAudit({ limit: AUDIT_PAGE_SIZE, offset: 0 });
        if (!cancelled) {
          setEntries(response.audit.entries);
          setAppliedOperation('');
          setNextOffset(response.audit.pagination.nextOffset);
        }
      } catch (loadError) {
        if (!cancelled) {
          if (onSessionExpired(loadError)) {
            return;
          }
          setError(errorMessage(loadError, 'Unable to load audit entries'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInitialAudit();
    return () => {
      cancelled = true;
    };
  }, [api, onSessionExpired]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadAudit(operation, 0, false);
  }

  function handleLoadMore() {
    if (nextOffset !== null) {
      void loadAudit(appliedOperation, nextOffset, true);
    }
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-white">Audit log</h2>
        <span className="text-xs text-gray-500">{entries.length} rows</span>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
          Audit operation
          <input
            className={inputClassName()}
            placeholder="key.create,key.revoke"
            value={operation}
            onChange={event => setOperation(event.target.value)}
          />
        </label>
        <button type="submit" className={`${buttonClassName()} self-end`} disabled={loading}>
          Apply audit filters
        </button>
      </form>

      {error ? (
        <p className="mt-3 text-sm text-red-200">{error}</p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-gray-800 text-gray-500">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">Time</th>
              <th scope="col" className="px-2 py-2 font-medium">Operation</th>
              <th scope="col" className="px-2 py-2 font-medium">Actor</th>
              <th scope="col" className="px-2 py-2 font-medium">Target</th>
              <th scope="col" className="px-2 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr>
                <td className="px-2 py-3 text-gray-500" colSpan={5}>Loading audit</td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-gray-500" colSpan={5}>No audit rows</td>
              </tr>
            ) : entries.map(entry => (
              <tr key={entry.id} className="align-top text-gray-300">
                <td className="whitespace-nowrap px-2 py-2 text-gray-500">
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
                <td className="px-2 py-2 font-medium text-gray-100">{entry.operation}</td>
                <td className="px-2 py-2">{entry.adminEmail ?? entry.adminUserId ?? 'system'}</td>
                <td className="px-2 py-2">{entry.keyName ?? entry.entityId ?? entry.apiKeyId ?? '-'}</td>
                <td className="min-w-[18rem] px-2 py-2 font-mono text-[11px] leading-5">
                  {renderDetailValue(entry.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nextOffset !== null ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className={buttonClassName()}
            disabled={loading || loadingMore}
            onClick={handleLoadMore}
          >
            {loadingMore ? 'Loading audit rows' : 'Load more audit rows'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
