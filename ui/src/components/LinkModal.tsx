import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, SearchResult } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

type Props = {
  sourceEntityId: string;
  api: ApiClient;
  onLinked: () => void;
  onClose: () => void;
};

const RELATION_TYPES = [
  'related_to',
  'involves',
  'assigned_to',
  'part_of',
  'blocked_by',
  'depends_on',
  'mentioned_in',
  'references',
  'produced_by',
  'about',
];

const ALL_ENTITY_TYPES = ['document', 'memory', 'person', 'project', 'task', 'interaction'];
const ALL_STATUSES = ['active', 'done', 'archived', 'inbox', 'next', 'waiting', 'scheduled', 'someday'];
const ALL_VISIBILITIES = ['personal', 'work', 'shared'];

type SearchMode = 'semantic' | 'list';
type Direction = 'outgoing' | 'incoming';

type Filters = {
  query: string;
  mode: SearchMode;
  types: Set<string>;
  statuses: Set<string>;
  visibility: string;
  owner: string;
  tags: string[];
  tagInput: string;
};

const initialFilters: Filters = {
  query: '',
  mode: 'list',
  types: new Set(),
  statuses: new Set(),
  visibility: '',
  owner: '',
  tags: [],
  tagInput: '',
};

export default function LinkModal({ sourceEntityId, api, onLinked, onClose }: Props) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [results, setResults] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [relation, setRelation] = useState('related_to');
  const [customRelation, setCustomRelation] = useState('');
  const [direction, setDirection] = useState<Direction>('outgoing');
  const [confidence, setConfidence] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleInSet = useCallback(<K extends 'types' | 'statuses'>(key: K, value: string) => {
    setFilters(prev => {
      const next = new Set(prev[key]);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...prev, [key]: next };
    });
  }, []);

  const addTag = useCallback((raw: string) => {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (!tag) return;
    setFilters(prev =>
      prev.tags.includes(tag) ? { ...prev, tagInput: '' } : { ...prev, tags: [...prev.tags, tag], tagInput: '' }
    );
  }, []);

  const removeTag = useCallback((tag: string) => {
    setFilters(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  }, []);

  const runSearch = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    try {
      if (f.mode === 'semantic' && f.query.trim()) {
        const primaryType = f.types.size === 1 ? [...f.types][0] : undefined;
        const res = await api.searchEntities({
          query: f.query,
          ...(primaryType ? { type: primaryType } : {}),
          ...(f.tags.length ? { tags: f.tags } : {}),
          ...(f.visibility ? { visibility: f.visibility } : {}),
          ...(f.owner.trim() ? { owner: f.owner.trim() } : {}),
          limit: 25,
        });
        let items: Entity[] = res.results.map((r: SearchResult) => r.entity);
        if (f.types.size > 1) items = items.filter(e => f.types.has(e.type));
        if (f.statuses.size > 0) items = items.filter(e => e.status && f.statuses.has(e.status));
        items = items.filter(e => e.id !== sourceEntityId);
        setResults(items);
      } else {
        const primaryType = f.types.size === 1 ? [...f.types][0] : undefined;
        const primaryStatus = f.statuses.size === 1 ? [...f.statuses][0] : undefined;
        const res = await api.listEntities({
          ...(primaryType ? { type: primaryType } : {}),
          ...(primaryStatus ? { status: primaryStatus } : {}),
          ...(f.visibility ? { visibility: f.visibility } : {}),
          ...(f.owner.trim() ? { owner: f.owner.trim() } : {}),
          ...(f.tags.length ? { tags: f.tags } : {}),
          limit: 50,
        });
        let items = res.items as Entity[];
        if (f.types.size > 1) items = items.filter(e => f.types.has(e.type));
        if (f.statuses.size > 1) items = items.filter(e => e.status && f.statuses.has(e.status));
        if (f.query.trim()) {
          const q = f.query.toLowerCase();
          items = items.filter(e =>
            (e.content ?? '').toLowerCase().includes(q) ||
            e.tags.some(t => t.toLowerCase().includes(q))
          );
        }
        items = items.filter(e => e.id !== sourceEntityId);
        setResults(items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [api, sourceEntityId]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { runSearch(filters); }, 250);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [filters, runSearch]);

  const effectiveRelation = useMemo(() => {
    if (relation === '__custom') return customRelation.trim();
    return relation;
  }, [relation, customRelation]);

  async function handleLink() {
    if (!selected) return;
    if (!effectiveRelation) {
      setError('Relation is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [source, target] =
        direction === 'outgoing' ? [sourceEntityId, selected.id] : [selected.id, sourceEntityId];
      await api.createEdge({
        source_id: source,
        target_id: target,
        relation: effectiveRelation,
        confidence,
      });
      onLinked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link');
    } finally {
      setSaving(false);
    }
  }

  const activeFilterCount =
    filters.types.size +
    filters.statuses.size +
    filters.tags.length +
    (filters.visibility ? 1 : 0) +
    (filters.owner.trim() ? 1 : 0);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <h2 className="text-white font-semibold">Link to entity</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Search + filters */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-800 flex flex-col gap-3 shrink-0">
          <div className="flex gap-2">
            <input
              value={filters.query}
              onChange={e => update('query', e.target.value)}
              placeholder="Search entities…"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex rounded-md border border-gray-700 overflow-hidden shrink-0">
              <button
                onClick={() => update('mode', 'list')}
                className={`px-3 py-2 text-xs ${filters.mode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Browse
              </button>
              <button
                onClick={() => update('mode', 'semantic')}
                className={`px-3 py-2 text-xs ${filters.mode === 'semantic' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Semantic
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FilterSection title="Types">
              <div className="flex flex-wrap gap-1">
                {ALL_ENTITY_TYPES.map(t => {
                  const color = ENTITY_COLORS[t] ?? ENTITY_COLORS['default']!;
                  const active = filters.types.has(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleInSet('types', t)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-opacity ${active ? 'opacity-100' : 'opacity-40'}`}
                      style={{ borderColor: color, color: active ? color : '#6B7280' }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </FilterSection>

            <FilterSection title="Status">
              <div className="flex flex-wrap gap-1">
                {ALL_STATUSES.map(s => {
                  const active = filters.statuses.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleInSet('statuses', s)}
                      className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                        active ? 'bg-blue-500/20 border-blue-500 text-blue-300' : 'border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </FilterSection>

            <FilterSection title="Visibility">
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => update('visibility', '')}
                  className={`px-2 py-0.5 rounded-full text-[11px] border ${!filters.visibility ? 'border-blue-500 text-blue-300' : 'border-gray-700 text-gray-400'}`}
                >
                  any
                </button>
                {ALL_VISIBILITIES.map(v => (
                  <button
                    key={v}
                    onClick={() => update('visibility', v)}
                    className={`px-2 py-0.5 rounded-full text-[11px] border ${filters.visibility === v ? 'border-blue-500 text-blue-300' : 'border-gray-700 text-gray-400 hover:text-white'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection title="Owner">
              <input
                value={filters.owner}
                onChange={e => update('owner', e.target.value)}
                placeholder="owner id"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FilterSection>

            <FilterSection title="Tags" wide>
              <div className="flex flex-wrap gap-1 mb-1">
                {filters.tags.map(t => (
                  <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-200 flex items-center gap-1">
                    {t}
                    <button onClick={() => removeTag(t)} className="text-gray-500 hover:text-white">×</button>
                  </span>
                ))}
              </div>
              <input
                value={filters.tagInput}
                onChange={e => {
                  const v = e.target.value;
                  if (v.includes(',')) addTag(v); else update('tagInput', v);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); addTag(filters.tagInput); }
                  if (e.key === 'Backspace' && !filters.tagInput && filters.tags.length > 0) {
                    removeTag(filters.tags[filters.tags.length - 1]!);
                  }
                }}
                placeholder="add tag, press Enter"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FilterSection>
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <span>{loading ? 'Searching…' : `${results.length} candidates`}</span>
            {activeFilterCount > 0 && (
              <button onClick={() => setFilters(initialFilters)} className="text-gray-400 hover:text-white">
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Candidates list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {results.length === 0 && !loading && (
            <div className="text-center text-gray-500 py-6 text-sm">
              No matching entities. Try loosening filters.
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {results.map(e => {
              const color = ENTITY_COLORS[e.type] ?? ENTITY_COLORS['default']!;
              const active = selected?.id === e.id;
              return (
                <li key={e.id}>
                  <button
                    onClick={() => setSelected(e)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-gray-800 hover:border-gray-700 bg-gray-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap text-[11px] mb-0.5">
                      <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: color + '22', color }}>{e.type}</span>
                      {e.status && <span className="text-gray-400">{e.status}</span>}
                      <span className="text-gray-600 font-mono">{e.id.slice(0, 8)}</span>
                    </div>
                    <div className="text-sm text-gray-200 truncate">
                      {truncate(e.content) || <span className="text-gray-600 italic">No content</span>}
                    </div>
                    {e.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {e.tags.slice(0, 6).map(t => (
                          <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">{t}</span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Relation + actions */}
        <div className="px-5 py-3 border-t border-gray-800 flex flex-col gap-3 shrink-0">
          {selected && (
            <div className="text-xs text-gray-400">
              Linking to <span className="text-gray-200 font-medium">{truncate(selected.content, 60) || selected.id.slice(0, 8)}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Direction</label>
              <div className="flex rounded-md border border-gray-700 overflow-hidden">
                <button
                  onClick={() => setDirection('outgoing')}
                  className={`flex-1 px-2 py-1.5 text-xs ${direction === 'outgoing' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
                >
                  source → target
                </button>
                <button
                  onClick={() => setDirection('incoming')}
                  className={`flex-1 px-2 py-1.5 text-xs ${direction === 'incoming' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
                >
                  target → source
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Relation</label>
              <select
                value={relation}
                onChange={e => setRelation(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {RELATION_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                <option value="__custom">custom…</option>
              </select>
              {relation === '__custom' && (
                <input
                  type="text"
                  value={customRelation}
                  onChange={e => setCustomRelation(e.target.value)}
                  placeholder="relation name"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Confidence {confidence.toFixed(2)}</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={confidence}
                onChange={e => setConfidence(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
            <button
              onClick={handleLink}
              disabled={!selected || saving || !effectiveRelation}
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

function FilterSection({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{title}</p>
      {children}
    </div>
  );
}

function truncate(text: string | null | undefined, max = 80): string {
  const s = (text ?? '').trim();
  if (!s) return '';
  const first = s.split('\n')[0]!.trim();
  return first.length > max ? first.slice(0, max) + '…' : first;
}
