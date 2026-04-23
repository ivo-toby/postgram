import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Entity } from '../lib/types.ts';
import type { ApiClient } from '../lib/api.ts';
import MarkdownEditor from './MarkdownEditor.tsx';
import TagsInput from './TagsInput.tsx';

const STATUSES_BY_TYPE: Record<string, string[]> = {
  task: ['inbox', 'next', 'active', 'waiting', 'scheduled', 'someday', 'done', 'archived'],
  project: ['active', 'done', 'archived', 'scheduled', 'someday'],
  default: ['active', 'done', 'archived', 'inbox', 'next', 'waiting', 'scheduled', 'someday'],
};

const VISIBILITIES = ['personal', 'work', 'shared'] as const;

type Props = {
  entity: Entity;
  api: ApiClient;
  onSaved: (entity: Entity) => void;
  onCancel: () => void;
};

type Draft = {
  content: string;
  status: string;
  visibility: string;
  tags: string[];
  dueDate: string;
  context: string;
  scheduledFor: string;
  completedAt: string;
  priority: string;
  extraMetadata: string;
};

function toDraft(entity: Entity): Draft {
  const md = entity.metadata ?? {};
  const dueDate = typeof md.due_date === 'string' ? md.due_date : '';
  const context = typeof md.context === 'string' ? md.context : '';
  const scheduledFor = typeof md.scheduled_for === 'string' ? md.scheduled_for : '';
  const completedAt = typeof md.completed_at === 'string' ? md.completed_at : '';
  const priority =
    typeof md.priority === 'string' ? md.priority :
    typeof md.priority === 'number' ? String(md.priority) :
    '';

  const known = new Set(['due_date', 'context', 'scheduled_for', 'completed_at', 'priority']);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(md)) if (!known.has(k)) rest[k] = v;

  return {
    content: entity.content ?? '',
    status: entity.status ?? '',
    visibility: entity.visibility ?? 'shared',
    tags: entity.tags ?? [],
    dueDate,
    context,
    scheduledFor,
    completedAt,
    priority,
    extraMetadata: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '',
  };
}

function toDateInputValue(iso: string): string {
  if (!iso) return '';
  // Accept either a full ISO or an already-YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export default function EntityEditor({ entity, api, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(entity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toDraft(entity));
    setError(null);
  }, [entity.id, entity.version]);

  const statuses = useMemo(() => STATUSES_BY_TYPE[entity.type] ?? STATUSES_BY_TYPE.default!, [entity.type]);
  const isTaskLike = entity.type === 'task' || entity.type === 'project';

  const patch = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  }, []);

  const buildMetadata = useCallback((): Record<string, unknown> => {
    const metadata: Record<string, unknown> = {};
    if (draft.extraMetadata.trim()) {
      const parsed = JSON.parse(draft.extraMetadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(metadata, parsed);
      } else {
        throw new Error('Extra metadata must be a JSON object');
      }
    }
    if (draft.context.trim()) metadata.context = draft.context.trim();
    if (draft.dueDate.trim()) metadata.due_date = draft.dueDate.trim();
    if (draft.scheduledFor.trim()) metadata.scheduled_for = draft.scheduledFor.trim();
    if (draft.completedAt.trim()) metadata.completed_at = draft.completedAt.trim();
    if (draft.priority.trim()) {
      const num = Number(draft.priority);
      metadata.priority = Number.isFinite(num) && draft.priority.trim() === String(num) ? num : draft.priority.trim();
    }
    return metadata;
  }, [draft]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const metadata = buildMetadata();
      const res = await api.updateEntity(entity.id, {
        version: entity.version,
        content: draft.content,
        visibility: draft.visibility,
        status: draft.status ? draft.status : null,
        tags: draft.tags,
        metadata,
      });
      onSaved(res.entity);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkDone() {
    if (entity.type !== 'task') return;
    setError(null);
    setSaving(true);
    try {
      const metadata = buildMetadata();
      metadata.completed_at = new Date().toISOString();
      const res = await api.updateEntity(entity.id, {
        version: entity.version,
        status: 'done',
        metadata,
      });
      onSaved(res.entity);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Content</label>
        <MarkdownEditor
          value={draft.content}
          onChange={v => patch('content', v)}
          placeholder="Write markdown…"
          minHeight={entity.type === 'document' ? 520 : 360}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Status</label>
          <select
            value={draft.status}
            onChange={e => patch('status', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">—</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Visibility</label>
          <select
            value={draft.visibility}
            onChange={e => patch('visibility', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {VISIBILITIES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Tags</label>
        <TagsInput value={draft.tags} onChange={tags => patch('tags', tags)} />
      </div>

      {isTaskLike && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Due date</label>
            <input
              type="date"
              value={toDateInputValue(draft.dueDate)}
              onChange={e => patch('dueDate', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Scheduled for</label>
            <input
              type="date"
              value={toDateInputValue(draft.scheduledFor)}
              onChange={e => patch('scheduledFor', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Context</label>
            <input
              type="text"
              value={draft.context}
              onChange={e => patch('context', e.target.value)}
              placeholder="e.g. @home, @errands"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">Priority</label>
            <input
              type="text"
              value={draft.priority}
              onChange={e => patch('priority', e.target.value)}
              placeholder="1-5 or high/low"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      )}

      <details className="bg-gray-950 border border-gray-800 rounded-lg">
        <summary className="cursor-pointer px-3 py-2 text-xs text-gray-400 hover:text-white">
          Extra metadata (JSON)
        </summary>
        <textarea
          value={draft.extraMetadata}
          onChange={e => patch('extraMetadata', e.target.value)}
          placeholder='{"key": "value"}'
          spellCheck={false}
          className="w-full bg-gray-900 border-0 rounded-b-lg p-3 text-[11px] font-mono text-gray-200 placeholder-gray-500 focus:outline-none"
          style={{ minHeight: 120 }}
        />
      </details>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300"
        >
          Cancel
        </button>
        {entity.type === 'task' && entity.status !== 'done' && (
          <button
            type="button"
            onClick={handleMarkDone}
            disabled={saving}
            className="px-3 py-2 text-sm rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Mark done'}
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
