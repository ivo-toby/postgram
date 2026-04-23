import { useCallback, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity } from '../lib/types.ts';
import MarkdownEditor from './MarkdownEditor.tsx';
import TagsInput from './TagsInput.tsx';

const ENTITY_TYPES = ['memory', 'task', 'document', 'project', 'person', 'interaction'];
const VISIBILITIES = ['personal', 'work', 'shared'] as const;
const STATUSES_BY_TYPE: Record<string, string[]> = {
  task: ['inbox', 'next', 'active', 'waiting', 'scheduled', 'someday', 'done', 'archived'],
  project: ['active', 'done', 'archived', 'scheduled', 'someday'],
  default: ['active', 'done', 'archived', 'inbox', 'next', 'waiting', 'scheduled', 'someday'],
};

type Props = {
  api: ApiClient;
  onCreated: (entity: Entity) => void;
  onClose: () => void;
  initialType?: string;
};

export default function CreateEntityModal({ api, onCreated, onClose, initialType }: Props) {
  const [type, setType] = useState(initialType ?? 'memory');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');
  const [visibility, setVisibility] = useState<typeof VISIBILITIES[number]>('personal');
  const [tags, setTags] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [context, setContext] = useState('');
  const [priority, setPriority] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTaskLike = type === 'task' || type === 'project';
  const statuses = STATUSES_BY_TYPE[type] ?? STATUSES_BY_TYPE.default!;

  const buildMetadata = useCallback((): Record<string, unknown> => {
    const metadata: Record<string, unknown> = {};
    if (context.trim()) metadata.context = context.trim();
    if (dueDate.trim()) metadata.due_date = dueDate.trim();
    if (priority.trim()) {
      const num = Number(priority);
      metadata.priority = Number.isFinite(num) && priority.trim() === String(num) ? num : priority.trim();
    }
    return metadata;
  }, [context, dueDate, priority]);

  async function handleCreate() {
    if (!content.trim()) {
      setError('Content is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const metadata = buildMetadata();
      const res = await api.createEntity({
        type,
        content,
        visibility,
        ...(status ? { status } : {}),
        tags,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      });
      onCreated(res.entity);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <h2 className="text-white font-semibold">Create entity</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Type</label>
              <select
                value={type}
                onChange={e => { setType(e.target.value); setStatus(''); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">—</option>
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Visibility</label>
              <select
                value={visibility}
                onChange={e => setVisibility(e.target.value as typeof VISIBILITIES[number])}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {VISIBILITIES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Content</label>
            <MarkdownEditor
              value={content}
              onChange={setContent}
              placeholder="Write markdown…"
              minHeight={type === 'document' ? 340 : 220}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Tags</label>
            <TagsInput value={tags} onChange={setTags} />
          </div>

          {isTaskLike && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Context</label>
                <input
                  type="text"
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  placeholder="@home"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Priority</label>
                <input
                  type="text"
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  placeholder="1-5"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex gap-2 justify-end shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={saving || !content.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
