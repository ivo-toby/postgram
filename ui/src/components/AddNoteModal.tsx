import { useState, type SyntheticEvent } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity } from '../lib/types.ts';

type Props = {
  sourceEntityId: string;
  api: ApiClient;
  onCreated: (entity: Entity) => void;
  onClose: () => void;
};

const ENTITY_TYPES = ['memory', 'interaction', 'project', 'person', 'task', 'document'];
const VISIBILITIES = ['personal', 'work', 'shared'];

export default function AddNoteModal({ sourceEntityId, api, onCreated, onClose }: Props) {
  const [content, setContent] = useState('');
  const [type, setType] = useState('memory');
  const [visibility, setVisibility] = useState('personal');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      const res = await api.createEntity({
        type,
        content,
        visibility,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      });
      await api.createEdge({
        source_id: res.entity.id,
        target_id: sourceEntityId,
        relation: 'related_to',
        confidence: 1,
      });
      onCreated(res.entity);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-white font-semibold mb-4">Add Note</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Note content…"
            className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none h-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <div className="flex gap-3">
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
            >
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
            >
              {VISIBILITIES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !content.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
