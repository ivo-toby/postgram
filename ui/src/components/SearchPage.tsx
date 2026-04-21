import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ApiClient } from '../lib/api.ts';
import type { Edge, Entity, SearchResult } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

const ALL_ENTITY_TYPES = ['document', 'memory', 'person', 'project', 'task', 'interaction'];
const ALL_STATUSES = ['active', 'done', 'archived', 'inbox', 'next', 'waiting', 'scheduled', 'someday'];
const ALL_VISIBILITIES = ['personal', 'work', 'shared'];

type Props = {
  api: ApiClient;
  onOpenInGraph: (entityId: string) => void;
};

type SearchMode = 'semantic' | 'list';

type Filters = {
  query: string;
  mode: SearchMode;
  types: Set<string>;
  statuses: Set<string>;
  visibility: string;
  owner: string;
  tags: string[];
  tagInput: string;
  threshold: number;
  recencyWeight: number;
  expandGraph: boolean;
  limit: number;
};

const initialFilters: Filters = {
  query: '',
  mode: 'semantic',
  types: new Set(),
  statuses: new Set(),
  visibility: '',
  owner: '',
  tags: [],
  tagInput: '',
  threshold: 0,
  recencyWeight: 0,
  expandGraph: true,
  limit: 20,
};

type ResultItem = {
  entity: Entity;
  chunk?: string;
  score?: number;
  similarity?: number;
  related?: SearchResult['related'];
};

export default function SearchPage({ api, onOpenInGraph }: Props) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetchedItem, setFetchedItem] = useState<ResultItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
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
          limit: f.limit,
          ...(f.threshold > 0 ? { threshold: f.threshold } : {}),
          ...(f.recencyWeight > 0 ? { recency_weight: f.recencyWeight } : {}),
          expand_graph: f.expandGraph,
        });
        let items: ResultItem[] = res.results.map(r => ({
          entity: r.entity,
          chunk: r.chunk_content,
          score: r.score,
          similarity: r.similarity,
          related: r.related,
        }));
        if (f.types.size > 1) {
          items = items.filter(i => f.types.has(i.entity.type));
        }
        if (f.statuses.size > 0) {
          items = items.filter(i => i.entity.status && f.statuses.has(i.entity.status));
        }
        setResults(items);
        setTotalCount(items.length);
      } else {
        const primaryType = f.types.size === 1 ? [...f.types][0] : undefined;
        const primaryStatus = f.statuses.size === 1 ? [...f.statuses][0] : undefined;
        const res = await api.listEntities({
          ...(primaryType ? { type: primaryType } : {}),
          ...(primaryStatus ? { status: primaryStatus } : {}),
          ...(f.visibility ? { visibility: f.visibility } : {}),
          ...(f.owner.trim() ? { owner: f.owner.trim() } : {}),
          ...(f.tags.length ? { tags: f.tags } : {}),
          limit: f.limit,
          offset: 0,
        });
        let items: Entity[] = res.items as Entity[];
        if (f.types.size > 1) items = items.filter(e => f.types.has(e.type));
        if (f.statuses.size > 1) items = items.filter(e => e.status && f.statuses.has(e.status));
        if (f.query.trim()) {
          const q = f.query.toLowerCase();
          items = items.filter(e =>
            (e.content ?? '').toLowerCase().includes(q) ||
            e.tags.some(t => t.toLowerCase().includes(q))
          );
        }
        setResults(items.map(e => ({ entity: e })));
        setTotalCount(res.total);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { runSearch(filters); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [filters, runSearch]);

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

  const reset = useCallback(() => { setFilters(initialFilters); }, []);

  useEffect(() => {
    if (!selectedId) { setFetchedItem(null); setDetailLoading(false); return; }
    if (results.find(r => r.entity.id === selectedId)) {
      setFetchedItem(null);
      setDetailLoading(false);
      return;
    }
    if (fetchedItem && fetchedItem.entity.id === selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    api.getEntity(selectedId)
      .then(res => { if (!cancelled) setFetchedItem({ entity: res.entity }); })
      .catch(err => { if (!cancelled) console.error(err); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, results, api, fetchedItem]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const fromResults = results.find(r => r.entity.id === selectedId);
    if (fromResults) return fromResults;
    if (fetchedItem && fetchedItem.entity.id === selectedId) return fetchedItem;
    return null;
  }, [results, selectedId, fetchedItem]);

  const activeFilterCount =
    filters.types.size +
    filters.statuses.size +
    filters.tags.length +
    (filters.visibility ? 1 : 0) +
    (filters.owner.trim() ? 1 : 0) +
    (filters.threshold > 0 ? 1 : 0) +
    (filters.recencyWeight > 0 ? 1 : 0);

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Search header */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-900">
        <div className="max-w-5xl mx-auto w-full px-3 sm:px-6 py-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="search"
                value={filters.query}
                onChange={e => update('query', e.target.value)}
                placeholder="Search everything — semantic, metadata, tags…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-10 py-3 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">⌕</span>
              {filters.query && (
                <button
                  onClick={() => update('query', '')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  aria-label="Clear query"
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={() => setFiltersOpen(v => !v)}
              className={`shrink-0 px-3 py-3 rounded-lg border text-sm transition-colors ${
                filtersOpen || activeFilterCount > 0
                  ? 'border-blue-500 text-blue-300 bg-blue-500/10'
                  : 'border-gray-700 text-gray-300 hover:bg-gray-800'
              }`}
              aria-expanded={filtersOpen}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
            <div className="flex rounded-md border border-gray-700 overflow-hidden">
              <button
                onClick={() => update('mode', 'semantic')}
                className={`px-3 py-1.5 ${filters.mode === 'semantic' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Semantic
              </button>
              <button
                onClick={() => update('mode', 'list')}
                className={`px-3 py-1.5 ${filters.mode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Browse
              </button>
            </div>
            {loading && <span>Searching…</span>}
            {!loading && totalCount !== null && (
              <span>{totalCount} {filters.mode === 'semantic' ? 'matches' : 'entities'}</span>
            )}
            {activeFilterCount > 0 && (
              <button onClick={reset} className="ml-auto text-gray-500 hover:text-white">
                Clear filters
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 bg-gray-950/50 border border-gray-800 rounded-lg p-3">
              <Section title="Entity types">
                <div className="flex flex-wrap gap-1.5">
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
              </Section>

              <Section title="Status">
                <div className="flex flex-wrap gap-1.5">
                  {ALL_STATUSES.map(s => {
                    const active = filters.statuses.has(s);
                    return (
                      <button
                        key={s}
                        onClick={() => toggleInSet('statuses', s)}
                        className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                          active ? 'bg-blue-500/20 border-blue-500 text-blue-300' : 'border-gray-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section title="Visibility">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => update('visibility', '')}
                    className={`px-2 py-0.5 rounded-full text-xs border ${!filters.visibility ? 'border-blue-500 text-blue-300' : 'border-gray-700 text-gray-400'}`}
                  >
                    any
                  </button>
                  {ALL_VISIBILITIES.map(v => (
                    <button
                      key={v}
                      onClick={() => update('visibility', v)}
                      className={`px-2 py-0.5 rounded-full text-xs border ${filters.visibility === v ? 'border-blue-500 text-blue-300' : 'border-gray-700 text-gray-400 hover:text-white'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </Section>

              <Section title="Owner">
                <input
                  type="text"
                  value={filters.owner}
                  onChange={e => update('owner', e.target.value)}
                  placeholder="owner id"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </Section>

              <Section title="Tags">
                <div className="flex flex-wrap gap-1 mb-1">
                  {filters.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-200 flex items-center gap-1">
                      {t}
                      <button onClick={() => removeTag(t)} className="text-gray-500 hover:text-white">×</button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
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
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </Section>

              <Section title="Result limit">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={5}
                    value={filters.limit}
                    onChange={e => update('limit', Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm text-gray-300 tabular-nums w-8 text-right">{filters.limit}</span>
                </div>
              </Section>

              {filters.mode === 'semantic' && (
                <>
                  <Section title={`Similarity threshold (${filters.threshold.toFixed(2)})`}>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.05}
                      value={filters.threshold}
                      onChange={e => update('threshold', Number(e.target.value))}
                      className="w-full"
                    />
                  </Section>
                  <Section title={`Recency boost (${filters.recencyWeight.toFixed(2)})`}>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={filters.recencyWeight}
                      onChange={e => update('recencyWeight', Number(e.target.value))}
                      className="w-full"
                    />
                  </Section>
                  <Section title="Graph expansion">
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.expandGraph}
                        onChange={e => update('expandGraph', e.target.checked)}
                        className="accent-blue-500"
                      />
                      Include 1-hop neighbours
                    </label>
                  </Section>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results + detail */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        <div className={`flex-1 overflow-y-auto ${selectedId ? 'hidden md:block' : ''}`}>
          <div className="max-w-5xl mx-auto w-full px-3 sm:px-6 py-4">
            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                {error}
              </div>
            )}
            {!loading && results.length === 0 && !error && (
              <div className="text-center text-gray-500 py-16 text-sm">
                {filters.query || activeFilterCount > 0
                  ? 'No results. Try different keywords or loosen filters.'
                  : 'Start typing to search your graph, or open filters to browse.'}
              </div>
            )}
            <ul className="flex flex-col gap-2">
              {results.map(item => (
                <ResultCard
                  key={item.entity.id}
                  item={item}
                  active={item.entity.id === selectedId}
                  onSelect={() => setSelectedId(item.entity.id)}
                  onOpenInGraph={() => onOpenInGraph(item.entity.id)}
                  onSelectRelated={id => setSelectedId(id)}
                />
              ))}
            </ul>
          </div>
        </div>

        {selectedId && (
          <aside className="md:w-[420px] md:border-l md:border-gray-800 bg-gray-900 flex-1 md:flex-initial overflow-y-auto">
            {selected ? (
              <DetailPanel
                api={api}
                entity={selected.entity}
                related={selected.related}
                onClose={() => setSelectedId(null)}
                onNavigate={id => setSelectedId(id)}
                onOpenInGraph={() => onOpenInGraph(selected.entity.id)}
              />
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="text-sm text-gray-400 hover:text-white flex items-center gap-1"
                  >
                    ‹ Back
                  </button>
                </div>
                <div className="p-4 text-sm text-gray-500">
                  {detailLoading ? 'Loading…' : 'Entity not found'}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">{title}</p>
      {children}
    </div>
  );
}

type ResultCardProps = {
  item: ResultItem;
  active: boolean;
  onSelect: () => void;
  onOpenInGraph: () => void;
  onSelectRelated: (id: string) => void;
};

function ResultCard({ item, active, onSelect, onOpenInGraph, onSelectRelated }: ResultCardProps) {
  const { entity, chunk, score, related } = item;
  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default']!;
  const preview = chunk ?? entity.content ?? '';

  return (
    <li
      className={`rounded-lg border transition-colors ${
        active ? 'border-blue-500 bg-blue-500/5' : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
    >
      <button onClick={onSelect} className="w-full text-left p-3 sm:p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span
            className="px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: color + '22', color }}
          >
            {entity.type}
          </span>
          {entity.status && (
            <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">{entity.status}</span>
          )}
          <span className="text-gray-500">{new Date(entity.updated_at).toLocaleDateString()}</span>
          {typeof score === 'number' && (
            <span className="ml-auto text-gray-400 tabular-nums">{Math.round(score * 100)}%</span>
          )}
        </div>

        {preview && (
          <div className="prose prose-sm prose-invert max-w-none text-sm text-gray-200 line-clamp-3 break-words">
            <ReactMarkdown>{preview}</ReactMarkdown>
          </div>
        )}

        {entity.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entity.tags.slice(0, 8).map(t => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">
                {t}
              </span>
            ))}
          </div>
        )}
      </button>

      {(related && related.length > 0) && (
        <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Connected</span>
          {related.slice(0, 8).map((r, i) => {
            const c = ENTITY_COLORS[r.entity.type] ?? ENTITY_COLORS['default']!;
            return (
              <button
                key={`${r.entity.id}-${i}`}
                onClick={e => { e.stopPropagation(); onSelectRelated(r.entity.id); }}
                className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-300 hover:bg-gray-800 flex items-center gap-1"
                title={`${r.direction} · ${r.relation}`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                <span className="truncate max-w-[140px]">{truncateLabel(r.entity.content, r.entity.id)}</span>
                <span className="text-gray-500">· {r.relation}</span>
              </button>
            );
          })}
          {related.length > 8 && (
            <span className="text-[11px] text-gray-500">+{related.length - 8} more</span>
          )}
        </div>
      )}

      <div className="px-3 sm:px-4 pb-3 flex items-center gap-3 text-[11px]">
        <button
          onClick={onOpenInGraph}
          className="text-blue-400 hover:text-blue-300"
        >
          Open in graph →
        </button>
        <span className="text-gray-600 font-mono">{entity.id.slice(0, 8)}</span>
      </div>
    </li>
  );
}

type DetailPanelProps = {
  api: ApiClient;
  entity: Entity;
  related?: SearchResult['related'];
  onClose: () => void;
  onNavigate: (id: string) => void;
  onOpenInGraph: () => void;
};

function DetailPanel({ api, entity, related, onClose, onNavigate, onOpenInGraph }: DetailPanelProps) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [labels, setLabels] = useState<Record<string, { type: string; label: string }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEdges([]);
    setLabels({});
    api.listEdges(entity.id).then(async res => {
      if (cancelled) return;
      setEdges(res.edges);
      const ids = new Set<string>();
      for (const e of res.edges) {
        ids.add(e.source_id === entity.id ? e.target_id : e.source_id);
      }
      const entries = await Promise.all([...ids].map(async id => {
        try {
          const { entity: n } = await api.getEntity(id);
          return [id, { type: n.type, label: truncateLabel(n.content, n.id) }] as const;
        } catch {
          return [id, { type: 'default', label: id.slice(0, 8) }] as const;
        }
      }));
      if (!cancelled) setLabels(Object.fromEntries(entries));
    }).catch(console.error).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [api, entity.id]);

  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default']!;
  const grouped = useMemo(() => {
    return edges.reduce<Record<string, Edge[]>>((acc, edge) => {
      (acc[edge.relation] ??= []).push(edge);
      return acc;
    }, {});
  }, [edges]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={onClose}
          className="md:hidden text-sm text-gray-400 hover:text-white flex items-center gap-1"
        >
          ‹ Back
        </button>
        <span className="hidden md:inline text-xs text-gray-500 uppercase tracking-wide">Detail</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none hidden md:block">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
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
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{entity.visibility}</span>
          <span className="text-xs text-gray-500 font-mono ml-auto">{entity.id.slice(0, 8)}</span>
        </div>

        <div className="text-xs text-gray-500 flex flex-col gap-0.5">
          <span>Created {new Date(entity.created_at).toLocaleString()}</span>
          <span>Updated {new Date(entity.updated_at).toLocaleString()}</span>
          {entity.owner && <span>Owner: {entity.owner}</span>}
          {entity.source && <span>Source: {entity.source}</span>}
        </div>

        {entity.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entity.tags.map(t => (
              <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">{t}</span>
            ))}
          </div>
        )}

        <div className="prose prose-sm prose-invert max-w-none text-sm text-gray-200 break-words">
          {entity.content
            ? <ReactMarkdown>{entity.content}</ReactMarkdown>
            : <span className="text-gray-600 italic">No content</span>}
        </div>

        {Object.keys(entity.metadata ?? {}).length > 0 && (
          <details className="bg-gray-950 border border-gray-800 rounded-lg">
            <summary className="cursor-pointer px-3 py-2 text-xs text-gray-400 hover:text-white">
              Metadata
            </summary>
            <pre className="px-3 pb-3 text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(entity.metadata, null, 2)}
            </pre>
          </details>
        )}

        <button
          onClick={onOpenInGraph}
          className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm"
        >
          Open in graph
        </button>

        <div className="border-t border-gray-800 pt-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Connections</p>
          {loading && <p className="text-xs text-gray-500">Loading…</p>}
          {!loading && edges.length === 0 && (
            <p className="text-xs text-gray-600 italic">No connections yet</p>
          )}
          <div className="flex flex-col gap-3">
            {Object.entries(grouped).map(([relation, relEdges]) => (
              <div key={relation}>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{relation}</p>
                <div className="flex flex-col gap-0.5">
                  {relEdges.map(edge => {
                    const otherId = edge.source_id === entity.id ? edge.target_id : edge.source_id;
                    const info = labels[otherId];
                    const c = ENTITY_COLORS[info?.type ?? 'default'] ?? ENTITY_COLORS['default']!;
                    return (
                      <button
                        key={edge.id}
                        onClick={() => onNavigate(otherId)}
                        className="flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-gray-800 transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />
                        <span className="text-gray-500 text-xs shrink-0">
                          {edge.source_id === entity.id ? '→' : '←'}
                        </span>
                        <span className="text-sm text-gray-300 truncate">
                          {info?.label ?? otherId.slice(0, 8)}
                        </span>
                        <span className="text-xs text-gray-600 ml-auto">{Math.round(edge.confidence * 100)}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {related && related.length > 0 && (
          <div className="border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">From search context</p>
            <div className="flex flex-wrap gap-1.5">
              {related.map((r, i) => {
                const c = ENTITY_COLORS[r.entity.type] ?? ENTITY_COLORS['default']!;
                return (
                  <button
                    key={`${r.entity.id}-${i}`}
                    onClick={() => onNavigate(r.entity.id)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-300 hover:bg-gray-800 flex items-center gap-1"
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                    <span className="truncate max-w-[180px]">{truncateLabel(r.entity.content, r.entity.id)}</span>
                    <span className="text-gray-500">· {r.relation}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function truncateLabel(content: string | null | undefined, id: string): string {
  const text = (content ?? '').trim();
  if (!text) return id.slice(0, 8);
  const firstLine = text.split('\n')[0]!.trim();
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
}
