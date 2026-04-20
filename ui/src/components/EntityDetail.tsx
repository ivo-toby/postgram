import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Entity } from '../lib/types.ts';
import type { ApiClient } from '../lib/api.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';
import MarkdownEditor from './MarkdownEditor.tsx';

type Props = {
  entity: Entity;
  api: ApiClient;
  onUpdate: (entity: Entity) => void;
};

export default function EntityDetail({ entity, api, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entity.content ?? '');
  const [saving, setSaving] = useState(false);

  // Reset draft when navigating to a different entity
  useEffect(() => {
    setDraft(entity.content ?? '');
    setEditing(false);
  }, [entity.id]);
  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default']!;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await api.updateEntity(entity.id, { version: entity.version, content: draft });
      onUpdate(res.entity);
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: color + '22', color }}
        >
          {entity.type}
        </span>
        <span className="text-xs text-gray-500 font-mono">{entity.id.slice(0, 8)}</span>
        <div className="flex-1" />
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      <div className="text-xs text-gray-600 flex flex-col gap-0.5">
        <span>Created {new Date(entity.created_at).toLocaleDateString()}</span>
        <span>Updated {new Date(entity.updated_at).toLocaleDateString()}</span>
        {entity.enrichment_status && (
          <span className={entity.enrichment_status === 'failed' ? 'text-red-400' : ''}>
            Extraction: {entity.enrichment_status}
          </span>
        )}
      </div>

      {/* Tags */}
      {entity.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entity.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Content */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <MarkdownEditor value={draft} onChange={setDraft} disabled={saving} />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(entity.content ?? ''); }}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="prose prose-sm prose-invert max-w-none text-sm text-gray-300 break-words">
            {entity.content
              ? <ReactMarkdown>{entity.content}</ReactMarkdown>
              : <span className="text-gray-600 italic">No content</span>
            }
          </div>
        </div>
      )}
    </div>
  );
}
