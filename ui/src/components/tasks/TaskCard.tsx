import type { Entity, TaskStatus } from '../../lib/types.ts';
import { getAvailableStatusActions, getTaskMetadata, taskTitle } from './taskModel.ts';

type Props = {
  task: Entity;
  selected: boolean;
  selectMode: boolean;
  onToggleSelected: (taskId: string) => void;
  onEdit: (task: Entity) => void;
  onStatusChange: (task: Entity, status: TaskStatus) => void;
};

export default function TaskCard({ task, selected, selectMode, onToggleSelected, onEdit, onStatusChange }: Props) {
  const metadata = getTaskMetadata(task);
  const actions = getAvailableStatusActions(task).slice(0, 5);

  return (
    <article
      className={`rounded-lg border bg-gray-900 p-3 text-sm shadow-sm ${selected ? 'border-blue-400' : 'border-gray-800'}`}
      onClick={() => { if (selectMode) onToggleSelected(task.id); }}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <input
            aria-label={`Select ${taskTitle(task)}`}
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(task.id)}
            onClick={event => event.stopPropagation()}
            className="mt-1 h-4 w-4 accent-blue-500"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium text-gray-100">{taskTitle(task)}</h3>
          {task.content && task.content !== taskTitle(task) && (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-gray-400">{task.content}</p>
          )}
        </div>
      </div>

      {(metadata.context || metadata.dueDate || metadata.scheduledFor || metadata.priority !== undefined || task.tags.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {metadata.context && <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">{metadata.context}</span>}
          {metadata.dueDate && <span className="rounded bg-yellow-500/10 px-1.5 py-0.5 text-yellow-300">Due {metadata.dueDate}</span>}
          {metadata.scheduledFor && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">Scheduled {metadata.scheduledFor}</span>}
          {metadata.priority !== undefined && <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-300">P{String(metadata.priority)}</span>}
          {task.tags.map(tag => <span key={tag} className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-400">{tag}</span>)}
        </div>
      )}

      {!selectMode && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {actions.map(action => (
            <button
              key={action.status}
              type="button"
              onClick={() => onStatusChange(task, action.status)}
              className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="ml-auto rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
          >
            Edit
          </button>
        </div>
      )}
    </article>
  );
}
