import { useState, useCallback, useEffect } from 'react';
import LoginScreen from './components/LoginScreen.tsx';
import MainLayout from './components/MainLayout.tsx';
import GraphCanvas from './components/GraphCanvas.tsx';
import SearchBox from './components/SearchBox.tsx';
import SearchResults from './components/SearchResults.tsx';
import FilterChips from './components/FilterChips.tsx';
import RelationChips from './components/RelationChips.tsx';
import DepthSlider from './components/DepthSlider.tsx';
import { useApi } from './hooks/useApi.ts';
import { useGraph } from './hooks/useGraph.ts';
import { useSearch } from './hooks/useSearch.ts';
import type { Entity } from './lib/types.ts';

const STORAGE_KEY = 'pgm_api_key';
const ALL_ENTITY_TYPES = ['document', 'memory', 'person', 'project', 'task', 'interaction'];

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [rightOpen, setRightOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(ALL_ENTITY_TYPES));
  const [visibleRelations, setVisibleRelations] = useState<Set<string>>(new Set<string>());
  const [loadedRelations, setLoadedRelations] = useState<Set<string>>(new Set<string>());

  const handleLogout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
  }, []);

  const handleLogin = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  const api = useApi({ apiKey: apiKey ?? '', onUnauthorized: handleLogout });
  const graphHook = useGraph();
  const searchHook = useSearch(api);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    async function load() {
      let offset = 0;
      const limit = 500;
      while (true) {
        const result = await api.listEntities({ limit, offset });
        if (cancelled) return;
        graphHook.addEntities(result.items as Entity[]);
        if (result.items.length < limit) break;
        offset += limit;
      }
      // Scan edges present after initial load for relation chips
      if (!cancelled) {
        setLoadedRelations(graphHook.getLoadedRelations());
      }
    }
    load().catch(console.error);
    return () => { cancelled = true; };
  }, [apiKey]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setRightOpen(true);
  }, []);

  const handleStageClick = useCallback(() => {
    setRightOpen(false);
    setSelectedNodeId(null);
  }, []);

  const handleTypeToggle = useCallback((type: string) => {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      const wasVisible = next.has(type);
      if (wasVisible) next.delete(type); else next.add(type);
      graphHook.setNodesHiddenByType(type, wasVisible);
      return next;
    });
  }, [graphHook]);

  const handleRelationToggle = useCallback((relation: string) => {
    setVisibleRelations(prev => {
      const next = new Set(prev);
      const wasVisible = next.has(relation);
      if (wasVisible) next.delete(relation); else next.add(relation);
      graphHook.setEdgesHiddenByRelation(relation, wasVisible);
      return next;
    });
  }, [graphHook]);

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const leftContent = (
    <div className="flex flex-col gap-4 p-3 h-full">
      <SearchBox value={searchHook.query} onChange={searchHook.search} />
      {searchHook.loading && <p className="text-xs text-gray-500 px-1">Searching…</p>}
      <SearchResults results={searchHook.results} onSelect={handleNodeClick} />

      <div className="border-t border-gray-800 pt-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 px-1">Entity types</p>
        <FilterChips types={ALL_ENTITY_TYPES} visible={visibleTypes} onToggle={handleTypeToggle} />
      </div>

      {loadedRelations.size > 0 && (
        <div className="border-t border-gray-800 pt-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 px-1">Relations</p>
          <RelationChips
            relations={[...loadedRelations]}
            visible={visibleRelations}
            onToggle={handleRelationToggle}
          />
        </div>
      )}

      <div className="border-t border-gray-800 pt-3">
        <DepthSlider value={depth} onChange={setDepth} />
      </div>
    </div>
  );

  return (
    <MainLayout
      onLogout={handleLogout}
      leftContent={leftContent}
      graphContent={
        <GraphCanvas
          graphHook={graphHook}
          api={api}
          depth={depth}
          onNodeClick={handleNodeClick}
          onStageClick={handleStageClick}
        />
      }
      rightOpen={rightOpen}
      onRightClose={() => setRightOpen(false)}
      rightContent={
        selectedNodeId
          ? <div className="text-gray-400 text-sm font-mono break-all">{selectedNodeId}</div>
          : null
      }
    />
  );
}
