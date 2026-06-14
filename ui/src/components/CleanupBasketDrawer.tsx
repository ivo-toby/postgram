import { useMemo, useState } from 'react';
import type { ApiClient, BulkArchiveEntitiesResponse } from '../lib/api.ts';
import type { CleanupBasketItem } from '../hooks/useCleanupBasket.ts';

export type CleanupBasketDrawerProps = {
  api: Pick<ApiClient, 'bulkArchiveEntities'>;
  items: CleanupBasketItem[];
  onArchiveResult: (result: BulkArchiveEntitiesResponse) => void;
  onClear: () => void;
  onClose: () => void;
  onRemoveItem: (id: string) => void;
};

const BULK_ARCHIVE_BATCH_SIZE = 500;

type SummaryEntry = {
  label: string;
  count: number;
};

type ArchiveFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

function summarize(items: CleanupBasketItem[], field: 'type' | 'status' | 'visibility'): SummaryEntry[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = item[field]?.trim() || 'none';
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function itemLabel(item: CleanupBasketItem): string {
  const content = item.content?.trim();
  return content || item.id;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}...`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

function archiveRequestFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Archive failed.';
}

function archiveRequestFailures(ids: string[], error: unknown): BulkArchiveEntitiesResponse['failed'] {
  const message = archiveRequestFailureMessage(error);
  return ids.map(id => ({ id, code: 'REQUEST_FAILED', message }));
}

async function archiveIdsInBatches(
  api: Pick<ApiClient, 'bulkArchiveEntities'>,
  ids: string[]
): Promise<BulkArchiveEntitiesResponse> {
  const result: BulkArchiveEntitiesResponse = { archived: [], failed: [] };
  const batches = chunkIds(ids, BULK_ARCHIVE_BATCH_SIZE);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    try {
      const batchResult = await api.bulkArchiveEntities(batch);
      result.archived.push(...batchResult.archived);
      result.failed.push(...batchResult.failed);
    } catch (error) {
      result.failed.push(...archiveRequestFailures(batches.slice(batchIndex).flat(), error));
      break;
    }
  }

  return result;
}

function formatArchiveFeedback(result: BulkArchiveEntitiesResponse): ArchiveFeedback {
  const archivedCount = result.archived.length;
  const failedCount = result.failed.length;

  if (failedCount > 0) {
    const archivedText =
      archivedCount > 0
        ? `Archived ${archivedCount} ${pluralize(archivedCount, 'entity', 'entities')}.`
        : 'No entities archived.';
    const failureVerb = failedCount === 1 ? 'needs' : 'need';
    return {
      tone: 'warning',
      message: `${archivedText} ${failedCount} ${pluralize(failedCount, 'item')} ${failureVerb} attention.`,
    };
  }

  return {
    tone: 'success',
    message: `Archived ${archivedCount} ${pluralize(archivedCount, 'entity', 'entities')}.`,
  };
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function SummarySection({ id, title, entries }: { id: string; title: string; entries: SummaryEntry[] }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
      <h3 id={id} className="text-[10px] uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">None</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {entries.map(entry => (
            <li
              key={entry.label}
              aria-label={`${entry.label} ${entry.count}`}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="truncate text-gray-300">{entry.label}</span>
              <span className="tabular-nums text-gray-500">{entry.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CleanupBasketDrawer({
  api,
  items,
  onArchiveResult,
  onClear,
  onClose,
  onRemoveItem,
}: CleanupBasketDrawerProps) {
  const [archiving, setArchiving] = useState(false);
  const [feedback, setFeedback] = useState<ArchiveFeedback | null>(null);
  const typeSummary = useMemo(() => summarize(items, 'type'), [items]);
  const statusSummary = useMemo(() => summarize(items, 'status'), [items]);
  const visibilitySummary = useMemo(() => summarize(items, 'visibility'), [items]);
  const reviewedLabel = `${items.length} reviewed ${items.length === 1 ? 'ID' : 'IDs'}`;

  async function handleArchive() {
    if (items.length === 0 || archiving) return;
    setArchiving(true);
    setFeedback(null);

    try {
      const result = await archiveIdsInBatches(api, items.map(item => item.id));
      onArchiveResult(result);
      setFeedback(formatArchiveFeedback(result));
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Archive failed.',
      });
    } finally {
      setArchiving(false);
    }
  }

  const feedbackClass =
    feedback?.tone === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : feedback?.tone === 'warning'
        ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';

  return (
    <div className="fixed inset-0 z-40 bg-black/50 md:flex md:justify-end">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleanup-basket-title"
        className="fixed inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-xl border border-gray-800 bg-gray-900 shadow-2xl md:inset-y-0 md:left-auto md:w-[460px] md:rounded-none md:border-y-0 md:border-r-0"
      >
        <div className="shrink-0 border-b border-gray-800 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="cleanup-basket-title" className="text-sm font-semibold text-white">
                Cleanup basket
              </h2>
              <p className="mt-1 text-xs text-gray-500">{reviewedLabel}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-xl leading-none text-gray-500 hover:text-white"
              aria-label="Close cleanup basket"
            >
              x
            </button>
          </div>

          {feedback && (
            <p className={`mt-3 rounded-lg border p-2 text-xs ${feedbackClass}`}>
              {feedback.message}
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SummarySection id="cleanup-basket-type-summary" title="Type summary" entries={typeSummary} />
            <SummarySection id="cleanup-basket-status-summary" title="Status summary" entries={statusSummary} />
            <SummarySection
              id="cleanup-basket-visibility-summary"
              title="Visibility summary"
              entries={visibilitySummary}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="rounded-lg border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-500">
              Cleanup basket is empty.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map(item => {
                const label = itemLabel(item);
                return (
                  <li key={item.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="rounded-full bg-gray-800 px-2 py-0.5 font-medium text-gray-200">
                            {item.type}
                          </span>
                          {item.status && (
                            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-gray-300">
                              {item.status}
                            </span>
                          )}
                          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-gray-400">
                            {item.visibility}
                          </span>
                          <span className="text-gray-600">{formatUpdatedAt(item.updated_at)}</span>
                        </div>
                        <p className="mt-2 break-words text-sm text-gray-200">{truncate(label, 180)}</p>
                        <p className="mt-1 truncate font-mono text-[11px] text-gray-600">{item.id}</p>
                        {item.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.tags.slice(0, 8).map(tag => (
                              <span key={tag} className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.archiveError && (
                          <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                            {item.archiveError}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        disabled={archiving}
                        aria-label={`Remove ${label}`}
                        className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-800 p-4">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClear}
              disabled={items.length === 0 || archiving}
              className="rounded-md px-3 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-50"
            >
              Clear basket
            </button>
            <button
              type="button"
              onClick={handleArchive}
              disabled={items.length === 0 || archiving}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {archiving ? 'Archiving...' : `Archive ${reviewedLabel}`}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
