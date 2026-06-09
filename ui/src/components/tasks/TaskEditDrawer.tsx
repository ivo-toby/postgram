import { useEffect, useState } from 'react';
import type { Entity, TaskStatus } from '../../lib/types.ts';
import { getTaskMetadata, STATUS_LABELS } from './taskModel.ts';

const EDIT_STATUSES: TaskStatus[] = ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'done'];

type Props = {
  task: Entity | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: {
    content: string;
    status: TaskStatus;
    context: string;
    dueDate: string;
    scheduledFor: string;
    priority: string;
    tags: string[];
    visibility: string;
  }) => void;
};

export default function TaskEditDrawer({ task, saving, error, onCancel, onSave }: Props) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<TaskStatus>('inbox');
  const [context, setContext] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [priority, setPriority] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState('personal');

  useEffect(() => {
    if (!task) return;
    const metadata = getTaskMetadata(task);
    setContent(task.content ?? '');
    setStatus((task.status as TaskStatus | null) ?? 'inbox');
    setContext(metadata.context ?? '');
    setDueDate(metadata.dueDate ?? '');
    setScheduledFor(metadata.scheduledFor ?? '');
    setPriority(metadata.priority !== undefined ? String(metadata.priority) : '');
    setTags(task.tags.join(', '));
    setVisibility(task.visibility);
  }, [task]);

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/50 md:flex md:justify-end">
      <aside className="fixed inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-xl border border-gray-800 bg-gray-900 p-4 shadow-2xl md:inset-y-0 md:left-auto md:w-[420px] md:rounded-none md:border-y-0 md:border-r-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Edit task</h2>
          <button type="button" onClick={onCancel} className="text-xl leading-none text-gray-500 hover:text-white">x</button>
        </div>

        <label className="mt-4 block text-xs uppercase tracking-wide text-gray-500">
          Task content
          <textarea
            value={content}
            onChange={event => setContent(event.target.value)}
            className="mt-1 min-h-32 w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm normal-case tracking-normal text-white"
          />
        </label>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {EDIT_STATUSES.map(option => (
              <button
                key={option}
                type="button"
                aria-label={`Set status ${STATUS_LABELS[option]}`}
                onClick={() => setStatus(option)}
                className={`rounded-md px-2 py-1 text-xs ${status === option ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
              >
                {STATUS_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Context
            <input value={context} onChange={event => setContext(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Due date
            <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Scheduled date
            <input type="date" value={scheduledFor} onChange={event => setScheduledFor(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500">
            Priority
            <input value={priority} onChange={event => setPriority(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500 sm:col-span-2">
            Tags
            <input aria-label="Tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="comma, separated" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white" />
          </label>
          <label className="block text-xs uppercase tracking-wide text-gray-500 sm:col-span-2">
            Visibility
            <select value={visibility} onChange={event => setVisibility(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm normal-case tracking-normal text-white">
              <option value="personal">personal</option>
              <option value="work">work</option>
              <option value="shared">shared</option>
            </select>
          </label>
        </div>

        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            type="button"
            disabled={saving || !content.trim()}
            onClick={() => onSave({
              content,
              status,
              context,
              dueDate,
              scheduledFor,
              priority,
              tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
              visibility,
            })}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save task'}
          </button>
        </div>
      </aside>
    </div>
  );
}
