import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Entity } from '../lib/types.ts';
import type { ApiClient } from '../lib/api.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';
import EntityEditor from './EntityEditor.tsx';

type Props = {
  entity: Entity;
  api: ApiClient;
  onUpdate: (entity: Entity) => void;
};

export default function EntityDetail({ entity, api, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [entity.id]);

  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default']!;
  const metadata = entity.metadata ?? {};
  const dueDate = typeof metadata.due_date === 'string' ? metadata.due_date : null;
  const scheduledFor = typeof metadata.scheduled_for === 'string' ? metadata.scheduled_for : null;
  const context = typeof metadata.context === 'string' ? metadata.context : null;
  const priority = metadata.priority;

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
        {entity.status && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">{entity.status}</span>
        )}
        <span className="text-xs text-gray-500 font-mono">{entity.id.slice(0, 8)}</span>
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

      {/* Task/project metadata badges */}
      {(entity.type === 'task' || entity.type === 'project') && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {dueDate && (
            <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
              Due {dueDate}
            </span>
          )}
          {scheduledFor && (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300">
              Scheduled {scheduledFor}
            </span>
          )}
          {context && (
            <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
              {context}
            </span>
          )}
          {priority !== undefined && priority !== '' && (
            <span className="px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300">
              Priority {String(priority)}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {!editing && entity.tags.length > 0 && (
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
        <EntityEditor
          entity={entity}
          api={api}
          onSaved={updated => { onUpdate(updated); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div>
          <div className="prose prose-sm prose-invert max-w-none text-sm text-gray-300 break-words">
            {entity.content
              ? <ReactMarkdown>{entity.content}</ReactMarkdown>
              : <span className="text-gray-600 italic">No content</span>
            }
          </div>
          <button
            onClick={() => setEditing(true)}
            className="mt-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
