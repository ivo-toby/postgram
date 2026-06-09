import type { TaskStatus } from '../../lib/types.ts';
import { STATUS_LABELS } from './taskModel.ts';

const BULK_STATUSES: TaskStatus[] = ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'done'];

type Props = {
  count: number;
  failureCount: number;
  onClear: () => void;
  onMove: (status: TaskStatus) => void;
};

export default function BulkActionBar({ count, failureCount, onClear, onMove }: Props) {
  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-800 bg-gray-900 p-3 shadow-2xl md:sticky md:bottom-auto md:top-0">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
        <span className="text-sm text-white">{count} selected</span>
        {failureCount > 0 && (
          <span className="rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-300">
            {failureCount} {failureCount === 1 ? 'task' : 'tasks'} failed to update
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {BULK_STATUSES.map(status => (
            <button
              key={status}
              type="button"
              onClick={() => onMove(status)}
              className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
              Bulk {status === 'scheduled' ? 'Schedule' : STATUS_LABELS[status]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClear} className="ml-auto rounded-md px-2 py-1 text-xs text-gray-400 hover:text-white">
          Clear
        </button>
      </div>
    </div>
  );
}
