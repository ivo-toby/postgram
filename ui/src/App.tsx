import { useState, useCallback } from 'react';
import LoginScreen from './components/LoginScreen.tsx';

const STORAGE_KEY = 'pgm_api_key';

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  const handleLogin = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
  }, []);

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <span>Graph loading…</span>
        <button onClick={handleLogout} className="ml-4 text-xs text-gray-600 hover:text-gray-400">
          Logout
        </button>
      </div>
    </div>
  );
}
