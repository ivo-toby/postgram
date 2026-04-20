import { useState, useCallback, useEffect } from 'react';
import LoginScreen from './components/LoginScreen.tsx';
import MainLayout from './components/MainLayout.tsx';
import GraphCanvas from './components/GraphCanvas.tsx';
import { useApi } from './hooks/useApi.ts';
import { useGraph } from './hooks/useGraph.ts';
import type { Entity } from './lib/types.ts';

const STORAGE_KEY = 'pgm_api_key';

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [rightOpen, setRightOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [depth] = useState(1);

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

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <MainLayout
      onLogout={handleLogout}
      leftContent={<div className="p-4 text-gray-500 text-sm">Filters loading…</div>}
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
