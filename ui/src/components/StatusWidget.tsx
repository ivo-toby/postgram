import { useState } from 'react';
import type { QueueStatus } from '../lib/types.ts';

type Props = {
  status: QueueStatus | null;
};

function Dot({ color }: { color: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

export default function StatusWidget({ status }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!status) {
    return <div className="px-3 py-2 text-xs text-gray-500">Checking status…</div>;
  }

  const embFailed = status.embedding.failed > 0;
  const extFailed = (status.extraction?.failed ?? 0) > 0;
  const embPending = status.embedding.pending > 0;
  const extPending = (status.extraction?.pending ?? 0) > 0;

  const dotColor = embFailed || extFailed
    ? 'bg-red-500'
    : embPending || extPending
    ? 'bg-yellow-400'
    : 'bg-green-500';

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors"
      >
        <Dot color={dotColor} />
        <span>Queue status</span>
        <span className="ml-auto">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 text-xs text-gray-400 flex flex-col gap-1">
          <div className="font-medium text-gray-300 mb-1">Embedding</div>
          <div className="grid grid-cols-2 gap-x-4">
            <span>Pending</span>
            <span className={embPending ? 'text-yellow-400' : 'text-gray-500'}>{status.embedding.pending}</span>
            <span>Completed</span>
            <span className="text-gray-500">{status.embedding.completed}</span>
            <span>Failed</span>
            <span className={embFailed ? 'text-red-400' : 'text-gray-500'}>{status.embedding.failed}</span>
          </div>
          {status.embedding.oldest_pending_secs != null && (
            <div className="text-orange-400 mt-1">Oldest pending: {Math.round(status.embedding.oldest_pending_secs)}s</div>
          )}
          {status.extraction && (
            <>
              <div className="font-medium text-gray-300 mt-2 mb-1">Extraction</div>
              <div className="grid grid-cols-2 gap-x-4">
                <span>Pending</span>
                <span className={extPending ? 'text-yellow-400' : 'text-gray-500'}>{status.extraction.pending}</span>
                <span>Completed</span>
                <span className="text-gray-500">{status.extraction.completed}</span>
                <span>Failed</span>
                <span className={extFailed ? 'text-red-400' : 'text-gray-500'}>{status.extraction.failed}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
