import { useState, useCallback } from 'react';
import LoginScreen from './components/LoginScreen.tsx';
import MainLayout from './components/MainLayout.tsx';
import { useApi } from './hooks/useApi.ts';

const STORAGE_KEY = 'pgm_api_key';

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [rightOpen, setRightOpen] = useState(false);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
  }, []);

  const handleLogin = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  useApi({ apiKey: apiKey ?? '', onUnauthorized: handleLogout });

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <MainLayout
      onLogout={handleLogout}
      leftContent={<div className="p-4 text-gray-500 text-sm">Filters loading…</div>}
      graphContent={<div className="flex items-center justify-center h-full text-gray-600 text-sm">Graph canvas coming soon</div>}
      rightOpen={rightOpen}
      onRightClose={() => setRightOpen(false)}
      rightContent={<div className="text-gray-500 text-sm">Entity details</div>}
    />
  );
}
