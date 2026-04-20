import { useState } from 'react';

type Props = {
  onLogin: (apiKey: string) => void;
};

export default function LoginScreen({ onLogin }: Props) {
  const [key, setKey] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (trimmed) {
      onLogin(trimmed);
    }
  }

  return (
    <div className="flex items-center justify-center h-full bg-gray-950">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-sm shadow-2xl">
        <h1 className="text-white text-2xl font-semibold mb-1">Postgram</h1>
        <p className="text-gray-400 text-sm mb-6">Enter your API key to continue</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="API key"
            className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
          >
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}
