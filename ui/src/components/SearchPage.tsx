import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ApiClient } from '../lib/api.ts';
import type { Edge, Entity, SearchResult } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';
import EntityEditor from './EntityEditor.tsx';
import LinkModal from './LinkModal.tsx';
import CreateEntityModal from './CreateEntityModal.tsx';
import { useResizable } from '../hooks/useResizable.ts';
import CopyUuid from './CopyUuid.tsx';

const ALL_ENTITY_TYPES = ['document', 'memory', 'person', 'project', 'task', 'interaction'];
const ALL_STATUSES = ['active', 'done', 'inbox', 'next', 'waiting', 'scheduled', 'someday'];
const ALL_VISIBILITIES = ['personal', 'work', 'shared'];
const PAGE_SIZE = 20;
const SEMANTIC_MAX = 50;

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
  showArchived: boolean;
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
  showArchived: false,
};

type ResultItem = {
  entity: Entity;
  chunk?: string;
  score?: number;
  similarity?: number;
  related?: SearchResult['related'];
};

export default function SearchPage({ api, onOpenInGraph }: Props) {
  const sidebar = useResizable({
    initial: 480,
    min: 320,
    max: 900,
    storageKey: 'pgm_search_sidebar_width',
    direction: 'left',
  });
  const isDesktop = useIsDesktop();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetchedItem, setFetchedItem] = useState<ResultItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<() => void>(() => {});

  const update = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const fetchPage = useCallback(async (f: Filters, offset: number): Promise<{ items: ResultItem[]; total: number | null; hasMore: boolean }> => {
    if (f.mode === 'semantic' && f.query.trim()) {
      if (offset > 0) return { items: [], total: null, hasMore: false };
      const primaryType = f.types.size === 1 ? [...f.types][0] : undefined;
      const res = await api.searchEntities({
        query: f.query,
        ...(primaryType ? { type: primaryType } : {}),
        ...(f.tags.length ? { tags: f.tags } : {}),
        ...(f.visibility ? { visibility: f.visibility } : {}),
        ...(f.owner.trim() ? { owner: f.owner.trim() } : {}),
        limit: SEMANTIC_MAX,
        ...(f.threshold > 0 ? { threshold: f.threshold } : {}),
        ...(f.recencyWeight > 0 ? { recency_weight: f.recencyWeight } : {}),
        expand_graph: f.expandGraph,
        ...(f.showArchived ? { include_archived: true } : {}),
      });
      let items: ResultItem[] = res.results.map(r => ({
        entity: r.entity,
        chunk: r.chunk_content,
        score: r.score,
        similarity: r.similarity,
        related: r.related,
      }));
      if (f.types.size > 1) items = items.filter(i => f.types.has(i.entity.type));
      if (f.statuses.size > 0) items = items.filter(i => i.entity.status && f.statuses.has(i.entity.status));
      return { items, total: items.length, hasMore: false };
    }

    const primaryType = f.types.size === 1 ? [...f.types][0] : undefined;
    const primaryStatus = f.statuses.size === 1 ? [...f.statuses][0] : undefined;
    const res = await api.listEntities({
      ...(primaryType ? { type: primaryType } : {}),
      ...(primaryStatus ? { status: primaryStatus } : {}),
      ...(f.visibility ? { visibility: f.visibility } : {}),
      ...(f.owner.trim() ? { owner: f.owner.trim() } : {}),
      ...(f.tags.length ? { tags: f.tags } : {}),
      limit: PAGE_SIZE,
      offset,
      ...(f.showArchived ? { include_archived: true } : {}),
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
    const pageHasMore = offset + res.items.length < res.total;
    return {
      items: items.map(e => ({ entity: e })),
      total: res.total,
      hasMore: pageHasMore,
    };
  }, [api]);

  const loadInitial = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(f, 0);
      setResults(page.items);
      setTotalCount(page.total);
      setNextOffset(PAGE_SIZE);
      setHasMore(page.hasMore);
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
      setTotalCount(null);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(filters, nextOffset);
      setResults(prev => {
        const seen = new Set(prev.map(r => r.entity.id));
        const merged = [...prev];
        for (const item of page.items) {
          if (!seen.has(item.entity.id)) merged.push(item);
        }
        return merged;
      });
      setNextOffset(n => n + PAGE_SIZE);
      setHasMore(page.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more');
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, nextOffset, hasMore, loading, loadingMore, fetchPage]);

  loadMoreRef.current = loadMore;

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { loadInitial(filters); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [filters, loadInitial, refreshKey]);

  const replaceEntity = useCallback((entity: Entity) => {
    setResults(prev => prev.map(r => (r.entity.id === entity.id ? { ...r, entity } : r)));
    setFetchedItem(prev => (prev && prev.entity.id === entity.id ? { ...prev, entity } : prev));
  }, []);

  const removeEntity = useCallback((id: string) => {
    setResults(prev => prev.filter(r => r.entity.id !== id));
    setFetchedItem(prev => (prev && prev.entity.id === id ? null : prev));
    setSelectedId(prev => (prev === id ? null : prev));
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    const root = scrollContainerRef.current;
    if (!node || !root) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMoreRef.current();
    }, { root, rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore]);

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
    (filters.recencyWeight > 0 ? 1 : 0) +
    (filters.showArchived ? 1 : 0);

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
            <button
              onClick={() => setCreateOpen(true)}
              className="shrink-0 px-3 py-3 rounded-lg border border-emerald-600 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20 text-sm"
              title="Create new entity"
            >
              + New
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
                <label className="flex items-center gap-2 text-xs text-gray-400 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.showArchived}
                    onChange={e => update('showArchived', e.target.checked)}
                    className="accent-blue-500"
                  />
                  Show archived
                </label>
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
        <div
          ref={scrollContainerRef}
          className={`flex-1 overflow-y-auto ${selectedId ? 'hidden md:block' : ''}`}
        >
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
            {hasMore && (
              <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-500">
                {loadingMore ? 'Loading more…' : '·'}
              </div>
            )}
            {!hasMore && !loading && results.length > 0 && (
              <div className="py-4 text-center text-[11px] text-gray-600">End of results</div>
            )}
          </div>
        </div>

        {createOpen && (
          <CreateEntityModal
            api={api}
            onCreated={entity => {
              setRefreshKey(k => k + 1);
              setSelectedId(entity.id);
            }}
            onClose={() => setCreateOpen(false)}
          />
        )}

        {selectedId && (
          <aside
            className="md:border-l md:border-gray-800 bg-gray-900 flex-1 md:flex-initial overflow-y-auto relative"
            style={isDesktop ? { width: sidebar.width } : undefined}
          >
            <div
              onMouseDown={sidebar.onMouseDown}
              className={`hidden md:block absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-col-resize group z-10 ${
                sidebar.dragging ? 'bg-blue-500/40' : 'hover:bg-blue-500/30'
              }`}
              title="Drag to resize"
              aria-label="Resize sidebar"
            >
              <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gray-700 group-hover:bg-blue-500" />
            </div>
            {selected ? (
              <DetailPanel
                api={api}
                entity={selected.entity}
                related={selected.related}
                onClose={() => setSelectedId(null)}
                onNavigate={id => setSelectedId(id)}
                onOpenInGraph={() => onOpenInGraph(selected.entity.id)}
                onEntityUpdated={replaceEntity}
                onEntityDeleted={removeEntity}
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
        <CopyUuid id={entity.id} className="text-gray-600" />
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
  onEntityUpdated: (entity: Entity) => void;
  onEntityDeleted: (id: string) => void;
};

function DetailPanel({ api, entity, related, onClose, onNavigate, onOpenInGraph, onEntityUpdated, onEntityDeleted }: DetailPanelProps) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [labels, setLabels] = useState<Record<string, { type: string; label: string }>>({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [edgesReloadKey, setEdgesReloadKey] = useState(0);

  useEffect(() => {
    setEditing(false);
    setLinkOpen(false);
    setConfirmDelete(false);
  }, [entity.id]);

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
  }, [api, entity.id, edgesReloadKey]);

  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS['default']!;
  const grouped = useMemo(() => {
    return edges.reduce<Record<string, Edge[]>>((acc, edge) => {
      (acc[edge.relation] ??= []).push(edge);
      return acc;
    }, {});
  }, [edges]);

  const metadata = entity.metadata ?? {};
  const dueDate = typeof metadata.due_date === 'string' ? metadata.due_date : null;
  const scheduledFor = typeof metadata.scheduled_for === 'string' ? metadata.scheduled_for : null;
  const contextStr = typeof metadata.context === 'string' ? metadata.context : null;
  const priority = metadata.priority;

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteEntity(entity.id);
      onEntityDeleted(entity.id);
    } catch (e) {
      console.error(e);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleDeleteEdge(edgeId: string) {
    try {
      await api.deleteEdge(edgeId);
      setEdgesReloadKey(k => k + 1);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0 gap-2">
        <button
          onClick={onClose}
          className="md:hidden text-sm text-gray-400 hover:text-white flex items-center gap-1"
        >
          ‹ Back
        </button>
        <span className="hidden md:inline text-xs text-gray-500 uppercase tracking-wide">Detail</span>
        <div className="flex items-center gap-1 ml-auto">
          {!editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-2 py-1 text-xs rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200"
              >
                Edit
              </button>
              <button
                onClick={() => setLinkOpen(true)}
                className="px-2 py-1 text-xs rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200"
              >
                Link
              </button>
            </>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none hidden md:block ml-1">×</button>
        </div>
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
          <CopyUuid id={entity.id} className="ml-auto" />
        </div>

        {(entity.type === 'task' || entity.type === 'project') && (dueDate || scheduledFor || contextStr || priority !== undefined) && (
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
            {contextStr && (
              <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
                {contextStr}
              </span>
            )}
            {priority !== undefined && priority !== '' && (
              <span className="px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300">
                Priority {String(priority)}
              </span>
            )}
          </div>
        )}

        <div className="text-xs text-gray-500 flex flex-col gap-0.5">
          <span>Created {new Date(entity.created_at).toLocaleString()}</span>
          <span>Updated {new Date(entity.updated_at).toLocaleString()}</span>
          {entity.owner && <span>Owner: {entity.owner}</span>}
          {entity.source && <span>Source: {entity.source}</span>}
        </div>

        {!editing && entity.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entity.tags.map(t => (
              <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">{t}</span>
            ))}
          </div>
        )}

        {editing ? (
          <EntityEditor
            entity={entity}
            api={api}
            onSaved={updated => { onEntityUpdated(updated); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="prose prose-sm prose-invert max-w-none text-sm text-gray-200 break-words">
            {entity.content
              ? <ReactMarkdown>{entity.content}</ReactMarkdown>
              : <span className="text-gray-600 italic">No content</span>}
          </div>
        )}

        {!editing && Object.keys(metadata).length > 0 && (
          <details className="bg-gray-950 border border-gray-800 rounded-lg">
            <summary className="cursor-pointer px-3 py-2 text-xs text-gray-400 hover:text-white">
              Metadata
            </summary>
            <pre className="px-3 pb-3 text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </details>
        )}

        {!editing && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={onOpenInGraph}
              className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm"
            >
              Open in graph
            </button>
            <button
              onClick={() => setLinkOpen(true)}
              className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm"
            >
              Link to…
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 text-sm ml-auto"
              >
                Delete
              </button>
            ) : (
              <div className="flex gap-1 ml-auto">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

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
                      <div
                        key={edge.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800 transition-colors group"
                      >
                        <button
                          onClick={() => onNavigate(otherId)}
                          className="flex items-center gap-2 flex-1 text-left min-w-0"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c }} />
                          <span className="text-gray-500 text-xs shrink-0">
                            {edge.source_id === entity.id ? '→' : '←'}
                          </span>
                          <span className="text-sm text-gray-300 truncate">
                            {info?.label ?? otherId.slice(0, 8)}
                          </span>
                          <span className="text-xs text-gray-600 ml-auto shrink-0">{Math.round(edge.confidence * 100)}%</span>
                        </button>
                        <button
                          onClick={() => handleDeleteEdge(edge.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-1"
                          title="Remove link"
                          aria-label="Remove link"
                        >
                          ×
                        </button>
                      </div>
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

      {linkOpen && (
        <LinkModal
          sourceEntityId={entity.id}
          api={api}
          onLinked={() => setEdgesReloadKey(k => k + 1)}
          onClose={() => setLinkOpen(false)}
        />
      )}
    </div>
  );
}

function truncateLabel(content: string | null | undefined, id: string): string {
  const text = (content ?? '').trim();
  if (!text) return id.slice(0, 8);
  const firstLine = text.split('\n')[0]!.trim();
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}
