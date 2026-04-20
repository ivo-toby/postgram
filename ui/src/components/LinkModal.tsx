import { useState, useRef } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { SearchResult } from '../lib/types.ts';

type Props = {
  sourceEntityId: string;
  api: ApiClient;
  onLinked: () => void;
  onClose: () => void;
};

const RELATION_TYPES = ['related_to', 'involves', 'assigned_to', 'part_of', 'blocked_by', 'mentioned_in', 'depends_on'];

export default function LinkModal({ sourceEntityId, api, onLinked, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [relation, setRelation] = useState('related_to');
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(q: string) {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await api.searchEntities({ query: q, limit: 10 });
        setResults(res.results);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  async function handleLink() {
    if (!selected) return;
    setSaving(true);
    try {
      await api.createEdge({ source_id: sourceEntityId, target_id: selected, relation, confidence: 1 });
      onLinked();
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
        <h2 className="text-white font-semibold mb-4">Link to Entity</h2>
        <div className="flex flex-col gap-3">
          <input
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search for entity…"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          {results.length > 0 && (
            <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
              {results.map(r => (
                <button
                  key={r.entity.id}
                  onClick={() => setSelected(r.entity.id)}
                  className={`text-left px-3 py-2 rounded text-sm transition-colors ${
                    selected === r.entity.id ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  <span className="text-xs text-gray-500 mr-2">{r.entity.type}</span>
                  {(r.entity.content ?? r.entity.id).slice(0, 80)}
                </button>
              ))}
            </div>
          )}
          <select
            value={relation}
            onChange={e => setRelation(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
          >
            {RELATION_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
            <button
              onClick={handleLink}
              disabled={!selected || saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg disabled:opacity-50"
            >
              {saving ? 'Linking…' : 'Link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
