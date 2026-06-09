import type { Entity, TaskStatus } from '../../lib/types.ts';
import type { BoardStatus } from './taskModel.ts';
import { STATUS_LABELS } from './taskModel.ts';
import TaskCard from './TaskCard.tsx';

type Props = {
  status: BoardStatus;
  tasks: Entity[];
  loading: boolean;
  error: string | null;
  selectedIds: Set<string>;
  selectMode: boolean;
  onRetry: (status: BoardStatus) => void;
  onToggleSelectMode: (status: BoardStatus) => void;
  onToggleSelected: (taskId: string) => void;
  onEdit: (task: Entity) => void;
  onStatusChange: (task: Entity, status: TaskStatus) => void;
};

export default function TaskLane({
  status,
  tasks,
  loading,
  error,
  selectedIds,
  selectMode,
  onRetry,
  onToggleSelectMode,
  onToggleSelected,
  onEdit,
  onStatusChange,
}: Props) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-gray-800 bg-gray-950/70">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-800 bg-gray-950 px-3 py-2">
        <h2 className="text-sm font-semibold text-white">{STATUS_LABELS[status]}</h2>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">{tasks.length}</span>
        {loading && <span className="text-xs text-gray-500">Loading...</span>}
        <button
          type="button"
          onClick={() => onToggleSelectMode(status)}
          className="ml-auto rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
        >
          {selectMode ? 'Cancel' : 'Select'}
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <p>{error}</p>
            <button type="button" onClick={() => onRetry(status)} className="mt-2 underline">
              Retry {STATUS_LABELS[status]}
            </button>
          </div>
        )}
        {!error && !loading && tasks.length === 0 && (
          <p className="rounded-lg border border-dashed border-gray-800 p-4 text-center text-xs text-gray-500">No {STATUS_LABELS[status].toLowerCase()} tasks</p>
        )}
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            selected={selectedIds.has(task.id)}
            selectMode={selectMode}
            onToggleSelected={onToggleSelected}
            onEdit={onEdit}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    </section>
  );
}
