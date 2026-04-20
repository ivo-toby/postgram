# Postgram Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a graph-centric web UI for Postgram served as a separate Docker container, with Obsidian-style knowledge graph navigation, semantic search, entity management, and server status monitoring.

**Architecture:** React 19 + Vite SPA in a separate `ui/` directory, served via nginx container on port 3000. All `/api/*` requests proxied to the postgram server over Docker internal network. API key stored in localStorage, injected as Bearer token on every request.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v3, Sigma.js (WebGL graph), graphology (graph model), graphology-layout-forceatlas2 (WebWorker), graphology-layout (circular/radial), graphology-layout-dagre (hierarchy), react-markdown, vitest + @testing-library/react

---

## File Structure

```
ui/
  Dockerfile
  nginx.conf
  vite.config.ts
  tsconfig.json
  package.json
  src/
    main.tsx                      # React root mount
    App.tsx                       # Auth gate: LoginScreen vs MainLayout
    lib/
      api.ts                      # Typed fetch wrapper, injects Bearer token, 401 → logout
      types.ts                    # Shared TypeScript types mirroring server wire shapes
    hooks/
      useApi.ts                   # Returns api client bound to stored key; handles logout
      useGraph.ts                 # Graphology instance management, node/edge add/remove
      useSigma.ts                 # Sigma lifecycle, camera, event forwarding
      useLayout.ts                # Layout switching: ForceAtlas2 worker + circular + dagre
      useSearch.ts                # Debounced search, result state, graph highlight sync
      useQueue.ts                 # Polls /api/queue every 30s
      useEntityDetail.ts          # Loads full entity + edges for right panel
    components/
      LoginScreen.tsx             # API key input, stores to localStorage
      MainLayout.tsx              # Three-column layout shell
      TopBar.tsx                  # Logo, global search, health dot, logout
      LeftPanel.tsx               # Collapsible left panel container
      SearchBox.tsx               # Debounced search input (used in both left panel and top bar)
      SearchResults.tsx           # Search result list items
      FilterChips.tsx             # Entity type toggle chips
      RelationChips.tsx           # Relation type toggle chips
      DepthSlider.tsx             # 1–3 hop depth slider
      StatusWidget.tsx            # Queue health dots with expanded view
      GraphCanvas.tsx             # Sigma container + layout controls
      GraphControls.tsx           # Layout switcher (FA2/radial/hierarchy) + zoom
      NodeContextMenu.tsx         # Right-click context menu
      RightPanel.tsx              # Sliding detail panel container
      EntityDetail.tsx            # Entity header, content (markdown), tags
      EdgeList.tsx                # Edges grouped by relation type
      EntityActions.tsx           # Add note, link, edit metadata, delete
      AddNoteModal.tsx            # Create memory entity modal
      LinkModal.tsx               # Search-to-link modal
    styles/
      index.css                   # Tailwind base/components/utilities
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `ui/package.json`
- Create: `ui/tsconfig.json`
- Create: `ui/vite.config.ts`
- Create: `ui/src/main.tsx`
- Create: `ui/src/App.tsx`
- Create: `ui/src/styles/index.css`

- [ ] **Step 1: Create `ui/` directory and `package.json`**

```bash
mkdir -p ui/src/lib ui/src/hooks ui/src/components ui/src/styles
```

Create `ui/package.json`:

```json
{
  "name": "postgram-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "graphology": "^0.25.4",
    "graphology-layout": "^0.6.1",
    "graphology-layout-dagre": "^0.2.2",
    "graphology-layout-forceatlas2": "^0.10.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.1",
    "sigma": "^3.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.6.3",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `ui/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3100',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Create `ui/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 5: Create `ui/src/styles/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
```

- [ ] **Step 6: Create `ui/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 7: Create `ui/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 8: Create `ui/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Postgram</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Create `ui/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 10: Create a placeholder `ui/src/App.tsx`**

```tsx
export default function App() {
  return <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>;
}
```

- [ ] **Step 11: Install dependencies**

```bash
cd ui && npm install
```

Expected: Dependencies installed with no errors.

- [ ] **Step 12: Run typecheck**

```bash
cd ui && npm run typecheck
```

Expected: No errors.

- [ ] **Step 13: Commit**

```bash
git add ui/
git commit -m "feat(web-ui): scaffold Vite + React 19 + Tailwind project"
```

---

## Task 2: API Client + Types

**Files:**
- Create: `ui/src/lib/types.ts`
- Create: `ui/src/lib/api.ts`
- Test: `ui/src/lib/api.test.ts`

- [ ] **Step 1: Write failing test**

Create `ui/src/lib/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient } from './api.ts';

describe('createApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('injects Authorization header', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'test-key', onUnauthorized: vi.fn() });
    await client.listEntities({});

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/entities?limit=100&offset=0',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
  });

  it('calls onUnauthorized on 401', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const onUnauthorized = vi.fn();
    const client = createApiClient({ apiKey: 'bad-key', onUnauthorized });
    await expect(client.listEntities({})).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ui && npm test
```

Expected: FAIL — `createApiClient` not defined.

- [ ] **Step 3: Create `ui/src/lib/types.ts`**

```ts
export type EntityType = 'document' | 'memory' | 'person' | 'project' | 'task' | 'interaction';

export type Entity = {
  id: string;
  type: string;
  content: string | null;
  visibility: string;
  owner: string | null;
  status: string | null;
  enrichment_status: string | null;
  version: number;
  tags: string[];
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Edge = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence: number;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type GraphNeighbour = {
  id: string;
  type: string;
  content: string | null;
  metadata: Record<string, unknown>;
};

export type SearchResult = {
  entity: Entity;
  chunk_content: string;
  similarity: number;
  score: number;
  related?: Array<{
    entity: GraphNeighbour;
    relation: string;
    direction: 'incoming' | 'outgoing';
  }>;
};

export type QueueStatus = {
  embedding: {
    pending: number;
    completed: number;
    failed: number;
    retry_eligible: number;
    oldest_pending_secs: number | null;
  };
  extraction: {
    pending: number;
    completed: number;
    failed: number;
  } | null;
};

export type GraphData = {
  entities: GraphNeighbour[];
  edges: Edge[];
};

export type ListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
```

- [ ] **Step 4: Create `ui/src/lib/api.ts`**

```ts
import type { Entity, Edge, SearchResult, QueueStatus, GraphData, ListResponse } from './types.ts';

type ApiClientOptions = {
  apiKey: string;
  onUnauthorized: () => void;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
};

async function request<T>(
  apiKey: string,
  onUnauthorized: () => void,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401) {
    onUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return response.text() as unknown as T;
}

export function createApiClient(options: ApiClientOptions) {
  const r = <T>(path: string, req?: RequestOptions) =>
    request<T>(options.apiKey, options.onUnauthorized, path, req);

  return {
    listEntities(params: {
      type?: string;
      status?: string;
      visibility?: string;
      owner?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
    }) {
      const qs = new URLSearchParams();
      if (params.type) qs.set('type', params.type);
      if (params.status) qs.set('status', params.status);
      if (params.visibility) qs.set('visibility', params.visibility);
      if (params.owner) qs.set('owner', params.owner);
      if (params.tags?.length) qs.set('tags', params.tags.join(','));
      qs.set('limit', String(params.limit ?? 100));
      qs.set('offset', String(params.offset ?? 0));
      return r<ListResponse<Entity>>(`/api/entities?${qs}`);
    },

    getEntity(id: string) {
      return r<{ entity: Entity }>(`/api/entities/${id}`);
    },

    createEntity(input: {
      type: string;
      content?: string;
      visibility?: string;
      owner?: string;
      status?: string;
      tags?: string[];
      source?: string;
      metadata?: Record<string, unknown>;
    }) {
      return r<{ entity: Entity }>('/api/entities', { method: 'POST', body: input });
    },

    updateEntity(id: string, input: {
      version: number;
      content?: string | null;
      visibility?: string;
      status?: string | null;
      tags?: string[];
      source?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      return r<{ entity: Entity }>(`/api/entities/${id}`, { method: 'PATCH', body: input });
    },

    deleteEntity(id: string) {
      return r<{ id: string; deleted: true }>(`/api/entities/${id}`, { method: 'DELETE' });
    },

    searchEntities(input: {
      query: string;
      type?: string;
      tags?: string[];
      visibility?: string;
      owner?: string;
      limit?: number;
      threshold?: number;
      recency_weight?: number;
      expand_graph?: boolean;
    }) {
      return r<{ results: SearchResult[] }>('/api/search', { method: 'POST', body: input });
    },

    expandGraph(entityId: string, params: { depth?: number; relation_types?: string[]; owner?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.depth !== undefined) qs.set('depth', String(params.depth));
      if (params.relation_types?.length) qs.set('relation_types', params.relation_types.join(','));
      if (params.owner) qs.set('owner', params.owner);
      const query = qs.toString();
      return r<GraphData>(`/api/entities/${entityId}/graph${query ? `?${query}` : ''}`);
    },

    listEdges(entityId: string, params: { relation?: string; direction?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.relation) qs.set('relation', params.relation);
      if (params.direction) qs.set('direction', params.direction);
      const query = qs.toString();
      return r<{ edges: Edge[] }>(`/api/entities/${entityId}/edges${query ? `?${query}` : ''}`);
    },

    createEdge(input: {
      source_id: string;
      target_id: string;
      relation: string;
      confidence?: number;
      metadata?: Record<string, unknown>;
    }) {
      return r<{ edge: Edge }>('/api/edges', { method: 'POST', body: input });
    },

    deleteEdge(id: string) {
      return r<{ id: string; deleted: true }>(`/api/edges/${id}`, { method: 'DELETE' });
    },

    getQueueStatus() {
      return r<QueueStatus>('/api/queue');
    },

    getHealth() {
      return r<{ status: string }>('/health');
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd ui && npm test
```

Expected: PASS — 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/
git commit -m "feat(web-ui): add typed API client and shared types"
```

---

## Task 3: Auth + LoginScreen

**Files:**
- Create: `ui/src/components/LoginScreen.tsx`
- Modify: `ui/src/App.tsx`
- Test: `ui/src/components/LoginScreen.test.tsx`

- [ ] **Step 1: Write failing test**

Create `ui/src/components/LoginScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LoginScreen from './LoginScreen.tsx';

describe('LoginScreen', () => {
  it('renders API key input and submit button', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('calls onLogin with entered key', () => {
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByPlaceholderText(/api key/i), {
      target: { value: 'pgm_testkey123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(onLogin).toHaveBeenCalledWith('pgm_testkey123');
  });

  it('does not call onLogin with empty key', () => {
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(onLogin).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ui && npm test -- LoginScreen
```

Expected: FAIL — `LoginScreen` not found.

- [ ] **Step 3: Create `ui/src/components/LoginScreen.tsx`**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ui && npm test -- LoginScreen
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Update `ui/src/App.tsx` with auth gate**

```tsx
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
        <span>Loading graph…</span>
        <button onClick={handleLogout} className="ml-4 text-xs text-gray-600 hover:text-gray-400">
          Logout
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run all tests**

```bash
cd ui && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add auth gate with LoginScreen and localStorage key storage"
```

---

## Task 4: Layout Shell + Hooks Scaffold

**Files:**
- Create: `ui/src/hooks/useApi.ts`
- Create: `ui/src/components/MainLayout.tsx`
- Create: `ui/src/components/TopBar.tsx`
- Create: `ui/src/components/LeftPanel.tsx`
- Create: `ui/src/components/RightPanel.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Create `ui/src/hooks/useApi.ts`**

```ts
import { useMemo } from 'react';
import { createApiClient, type ApiClient } from '../lib/api.ts';

type UseApiOptions = {
  apiKey: string;
  onUnauthorized: () => void;
};

export function useApi({ apiKey, onUnauthorized }: UseApiOptions): ApiClient {
  return useMemo(
    () => createApiClient({ apiKey, onUnauthorized }),
    [apiKey, onUnauthorized]
  );
}
```

- [ ] **Step 2: Create `ui/src/components/TopBar.tsx`**

```tsx
type Props = {
  onLogout: () => void;
};

export default function TopBar({ onLogout }: Props) {
  return (
    <header className="flex items-center gap-4 px-4 h-12 bg-gray-900 border-b border-gray-800 shrink-0">
      <span className="text-white font-semibold text-sm tracking-wide">Postgram</span>
      <div className="flex-1" />
      <button
        onClick={onLogout}
        className="text-xs text-gray-400 hover:text-white transition-colors"
      >
        Logout
      </button>
    </header>
  );
}
```

- [ ] **Step 3: Create `ui/src/components/LeftPanel.tsx`**

```tsx
import { useState } from 'react';

type Props = {
  children: React.ReactNode;
};

export default function LeftPanel({ children }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-200 shrink-0 ${
        collapsed ? 'w-10' : 'w-72'
      }`}
    >
      <div className="flex items-center justify-end px-2 py-2 border-b border-gray-800">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="text-gray-500 hover:text-white transition-colors p-1 rounded"
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      {!collapsed && <div className="flex-1 overflow-y-auto">{children}</div>}
    </aside>
  );
}
```

- [ ] **Step 4: Create `ui/src/components/RightPanel.tsx`**

```tsx
type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export default function RightPanel({ open, onClose, children }: Props) {
  return (
    <aside
      className={`flex flex-col bg-gray-900 border-l border-gray-800 shrink-0 transition-all duration-200 overflow-hidden ${
        open ? 'w-96' : 'w-0'
      }`}
    >
      {open && (
        <>
          <div className="flex items-center justify-end px-4 py-2 border-b border-gray-800">
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
              title="Close"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </>
      )}
    </aside>
  );
}
```

- [ ] **Step 5: Create `ui/src/components/MainLayout.tsx`**

```tsx
import TopBar from './TopBar.tsx';
import LeftPanel from './LeftPanel.tsx';
import RightPanel from './RightPanel.tsx';

type Props = {
  onLogout: () => void;
  leftContent: React.ReactNode;
  graphContent: React.ReactNode;
  rightOpen: boolean;
  onRightClose: () => void;
  rightContent: React.ReactNode;
};

export default function MainLayout({
  onLogout,
  leftContent,
  graphContent,
  rightOpen,
  onRightClose,
  rightContent,
}: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-950">
      <TopBar onLogout={onLogout} />
      <div className="flex flex-1 min-h-0">
        <LeftPanel>{leftContent}</LeftPanel>
        <main className="flex-1 relative min-w-0">{graphContent}</main>
        <RightPanel open={rightOpen} onClose={onRightClose}>
          {rightContent}
        </RightPanel>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update `ui/src/App.tsx` to use MainLayout**

```tsx
import { useState, useCallback } from 'react';
import LoginScreen from './components/LoginScreen.tsx';
import MainLayout from './components/MainLayout.tsx';

const STORAGE_KEY = 'pgm_api_key';

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [rightOpen, setRightOpen] = useState(false);

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
    <MainLayout
      onLogout={handleLogout}
      leftContent={<div className="p-4 text-gray-500 text-sm">Filters loading…</div>}
      graphContent={<div className="flex items-center justify-center h-full text-gray-600">Graph canvas coming soon</div>}
      rightOpen={rightOpen}
      onRightClose={() => setRightOpen(false)}
      rightContent={<div className="text-gray-500 text-sm">Entity details</div>}
    />
  );
}
```

- [ ] **Step 7: Run typecheck and tests**

```bash
cd ui && npm run typecheck && npm test
```

Expected: No type errors. All tests pass.

- [ ] **Step 8: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add layout shell with TopBar, LeftPanel, RightPanel"
```

---

## Task 5: Graphology Setup + Node Styles

**Files:**
- Create: `ui/src/hooks/useGraph.ts`
- Create: `ui/src/lib/nodeStyles.ts`
- Test: `ui/src/lib/nodeStyles.test.ts`

- [ ] **Step 1: Write failing test**

Create `ui/src/lib/nodeStyles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getNodeColor, getNodeSize, ENTITY_COLORS } from './nodeStyles.ts';

describe('getNodeColor', () => {
  it('returns type-specific color for known types', () => {
    expect(getNodeColor('document')).toBe(ENTITY_COLORS.document);
    expect(getNodeColor('memory')).toBe(ENTITY_COLORS.memory);
    expect(getNodeColor('person')).toBe(ENTITY_COLORS.person);
  });

  it('returns fallback color for unknown type', () => {
    expect(getNodeColor('unknown_type')).toBe(ENTITY_COLORS.default);
  });
});

describe('getNodeSize', () => {
  it('returns larger size for nodes with more edges', () => {
    expect(getNodeSize('document', 20)).toBeGreaterThan(getNodeSize('document', 2));
  });

  it('returns fixed size for memory regardless of edge count', () => {
    expect(getNodeSize('memory', 0)).toBe(getNodeSize('memory', 100));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ui && npm test -- nodeStyles
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `ui/src/lib/nodeStyles.ts`**

```ts
export const ENTITY_COLORS: Record<string, string> = {
  document: '#3B82F6',
  memory: '#8B5CF6',
  person: '#F97316',
  project: '#22C55E',
  task: '#EAB308',
  interaction: '#14B8A6',
  default: '#6B7280',
};

const FIXED_SIZE_TYPES = new Set(['memory', 'task', 'interaction']);
const FIXED_SIZES: Record<string, number> = {
  memory: 8,
  task: 6,
  interaction: 6,
  project: 12,
};

export function getNodeColor(type: string): string {
  return ENTITY_COLORS[type] ?? ENTITY_COLORS.default;
}

export function getNodeSize(type: string, edgeCount: number): number {
  if (FIXED_SIZE_TYPES.has(type)) return FIXED_SIZES[type] ?? 6;
  if (type === 'project') return FIXED_SIZES.project;
  return Math.min(6 + Math.sqrt(edgeCount) * 2, 20);
}

export function getNodeOpacity(enrichmentStatus: string | null): number {
  return enrichmentStatus === 'pending' ? 0.6 : 1.0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ui && npm test -- nodeStyles
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Create `ui/src/hooks/useGraph.ts`**

```ts
import { useMemo, useRef } from 'react';
import Graph from 'graphology';
import type { Entity, Edge, GraphNeighbour } from '../lib/types.ts';
import { getNodeColor, getNodeSize, getNodeOpacity } from '../lib/nodeStyles.ts';

export type GraphNode = {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  type: string;
  enrichment_status: string | null;
  hidden: boolean;
};

export type GraphEdge = {
  label: string;
  color: string;
  size: number;
  type: 'line' | 'dashed';
};

export function useGraph() {
  const graphRef = useRef(new Graph({ multi: false, type: 'directed' }));
  const graph = graphRef.current;

  function addEntities(entities: Entity[]) {
    for (const entity of entities) {
      if (!graph.hasNode(entity.id)) {
        const edgeCount = 0;
        graph.addNode(entity.id, {
          x: (Math.random() - 0.5) * 100,
          y: (Math.random() - 0.5) * 100,
          size: getNodeSize(entity.type, edgeCount),
          color: getNodeColor(entity.type),
          label: (entity.content ?? entity.id).slice(0, 60),
          type: entity.type,
          enrichment_status: entity.enrichment_status,
          hidden: false,
          opacity: getNodeOpacity(entity.enrichment_status),
        } satisfies GraphNode & { opacity: number });
      }
    }
  }

  function addNeighbours(neighbours: GraphNeighbour[]) {
    for (const n of neighbours) {
      if (!graph.hasNode(n.id)) {
        graph.addNode(n.id, {
          x: (Math.random() - 0.5) * 100,
          y: (Math.random() - 0.5) * 100,
          size: getNodeSize(n.type, 0),
          color: getNodeColor(n.type),
          label: (n.content ?? n.id).slice(0, 60),
          type: n.type,
          enrichment_status: null,
          hidden: false,
          opacity: 1,
        });
      }
    }
  }

  function addEdges(edges: Edge[]) {
    for (const edge of edges) {
      if (!graph.hasEdge(edge.id)) {
        if (graph.hasNode(edge.source_id) && graph.hasNode(edge.target_id)) {
          graph.addEdgeWithKey(edge.id, edge.source_id, edge.target_id, {
            label: edge.relation,
            color: '#4B5563',
            size: edge.confidence === 1 && edge.source === null ? 2 : 1,
            type: edge.confidence < 0.5 ? 'dashed' : 'line',
          } satisfies GraphEdge);
        }
      }
    }
  }

  function setNodeHidden(id: string, hidden: boolean) {
    if (graph.hasNode(id)) {
      graph.setNodeAttribute(id, 'hidden', hidden);
    }
  }

  function setNodesHiddenByType(type: string, hidden: boolean) {
    graph.forEachNode((id, attrs) => {
      if (attrs.type === type) {
        graph.setNodeAttribute(id, 'hidden', hidden);
      }
    });
  }

  function setEdgesHiddenByRelation(relation: string, hidden: boolean) {
    graph.forEachEdge((id, attrs) => {
      if (attrs.label === relation) {
        graph.setEdgeAttribute(id, 'hidden', hidden);
      }
    });
  }

  return useMemo(
    () => ({ graph, addEntities, addNeighbours, addEdges, setNodeHidden, setNodesHiddenByType, setEdgesHiddenByRelation }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}
```

- [ ] **Step 6: Run all tests**

```bash
cd ui && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add graphology graph model, node styles and colors"
```

---

## Task 6: Graph Canvas (Sigma + Entity Loading)

**Files:**
- Create: `ui/src/components/GraphCanvas.tsx`
- Create: `ui/src/hooks/useSigma.ts`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Create `ui/src/hooks/useSigma.ts`**

```ts
import { useEffect, useRef, useCallback } from 'react';
import Sigma from 'sigma';
import type Graph from 'graphology';

type SigmaEvents = {
  onClickNode?: (nodeId: string) => void;
  onRightClickNode?: (nodeId: string, x: number, y: number) => void;
  onClickStage?: () => void;
};

export function useSigma(containerRef: React.RefObject<HTMLDivElement | null>, graph: Graph, events: SigmaEvents = {}) {
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: '#374151',
      defaultNodeColor: '#3B82F6',
      labelFont: 'Inter, sans-serif',
      labelSize: 11,
      labelColor: { color: '#9CA3AF' },
    });

    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [containerRef, graph]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    const handleClickNode = ({ node }: { node: string }) => {
      events.onClickNode?.(node);
    };
    const handleRightClickNode = ({ node, event }: { node: string; event: { x: number; y: number } }) => {
      events.onRightClickNode?.(node, event.x, event.y);
    };
    const handleClickStage = () => {
      events.onClickStage?.();
    };

    sigma.on('clickNode', handleClickNode);
    sigma.on('rightClickNode', handleRightClickNode);
    sigma.on('clickStage', handleClickStage);

    return () => {
      sigma.off('clickNode', handleClickNode);
      sigma.off('rightClickNode', handleRightClickNode);
      sigma.off('clickStage', handleClickStage);
    };
  }, [events]);

  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300 });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 });
  }, []);

  const focusNode = useCallback((nodeId: string, graph: Graph) => {
    const sigma = sigmaRef.current;
    if (!sigma || !graph.hasNode(nodeId)) return;
    const nodePosition = sigma.getNodeDisplayData(nodeId);
    if (nodePosition) {
      sigma.getCamera().animate(
        { x: nodePosition.x, y: nodePosition.y, ratio: 0.5 },
        { duration: 500 }
      );
    }
  }, []);

  const refresh = useCallback(() => {
    sigmaRef.current?.refresh();
  }, []);

  return { sigmaRef, zoomIn, zoomOut, focusNode, refresh };
}
```

- [ ] **Step 2: Create `ui/src/components/GraphCanvas.tsx`**

```tsx
import { useRef, useEffect, useCallback, useState } from 'react';
import { useSigma } from '../hooks/useSigma.ts';
import type { useGraph } from '../hooks/useGraph.ts';
import type { ApiClient } from '../lib/api.ts';

type Props = {
  graphHook: ReturnType<typeof useGraph>;
  api: ApiClient;
  depth: number;
  onNodeClick: (nodeId: string) => void;
  onStageClick: () => void;
};

type ContextMenu = { nodeId: string; x: number; y: number } | null;

export default function GraphCanvas({ graphHook, api, depth, onNodeClick, onStageClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const loadingRef = useRef(new Set<string>());

  const handleClickNode = useCallback((nodeId: string) => {
    onNodeClick(nodeId);
    if (!loadingRef.current.has(nodeId)) {
      loadingRef.current.add(nodeId);
      api.expandGraph(nodeId, { depth }).then(data => {
        graphHook.addNeighbours(data.entities);
        graphHook.addEdges(data.edges);
        sigmaControls.refresh();
      }).catch(console.error);
    }
  }, [api, depth, graphHook, onNodeClick]);

  const handleRightClickNode = useCallback((nodeId: string, x: number, y: number) => {
    setContextMenu({ nodeId, x, y });
  }, []);

  const handleClickStage = useCallback(() => {
    setContextMenu(null);
    onStageClick();
  }, [onStageClick]);

  const sigmaControls = useSigma(containerRef, graphHook.graph, {
    onClickNode: handleClickNode,
    onRightClickNode: handleRightClickNode,
    onClickStage: handleClickStage,
  });

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button
          onClick={sigmaControls.zoomIn}
          className="w-8 h-8 bg-gray-800 border border-gray-700 rounded text-white text-lg hover:bg-gray-700 flex items-center justify-center"
        >
          +
        </button>
        <button
          onClick={sigmaControls.zoomOut}
          className="w-8 h-8 bg-gray-800 border border-gray-700 rounded text-white text-lg hover:bg-gray-700 flex items-center justify-center"
        >
          −
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-10 min-w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            { label: 'Expand neighbours', action: () => handleClickNode(contextMenu.nodeId) },
            { label: 'Copy ID', action: () => { navigator.clipboard.writeText(contextMenu.nodeId); setContextMenu(null); } },
          ].map(item => (
            <button
              key={item.label}
              onClick={item.action}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `ui/src/App.tsx` to load entities and render canvas**

```tsx
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

  const api = useApi({ apiKey: apiKey ?? '', onUnauthorized: handleLogout });
  const graphHook = useGraph();

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    async function loadEntities() {
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
    loadEntities().catch(console.error);
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

  const handleLogin = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <MainLayout
      onLogout={handleLogout}
      leftContent={<div className="p-4 text-gray-500 text-sm">Filters coming soon…</div>}
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
        selectedNodeId ? (
          <div className="text-gray-400 text-sm font-mono break-all">{selectedNodeId}</div>
        ) : null
      }
    />
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd ui && npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Start dev server and verify graph loads**

```bash
cd ui && npm run dev
```

Open browser at `http://localhost:5173`. Log in with your API key. After login you should see the dark layout shell with "Filters coming soon…" on the left and a WebGL canvas on the right. Nodes should appear as blue dots. Clicking a node should show the node ID in the right panel.

- [ ] **Step 6: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add Sigma.js graph canvas with entity loading and node click"
```

---

## Task 7: ForceAtlas2 Layout + Layout Switcher

**Files:**
- Create: `ui/src/hooks/useLayout.ts`
- Create: `ui/src/components/GraphControls.tsx`
- Modify: `ui/src/components/GraphCanvas.tsx`

- [ ] **Step 1: Create `ui/src/hooks/useLayout.ts`**

```ts
import { useRef, useCallback, useState } from 'react';
import type Graph from 'graphology';
import circular from 'graphology-layout/circular';
import dagre from 'graphology-layout-dagre';

export type LayoutType = 'force' | 'radial' | 'hierarchy';

export function useLayout(graph: Graph) {
  const [layout, setLayout] = useState<LayoutType>('force');
  const workerRef = useRef<Worker | null>(null);

  const startForce = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    import('graphology-layout-forceatlas2/worker').then(({ default: FA2Worker }) => {
      const worker = new FA2Worker(graph, {
        settings: {
          gravity: 1,
          scalingRatio: 2,
          slowDown: 10,
          barnesHutOptimize: true,
        },
      });
      worker.start();
      workerRef.current = worker;

      setTimeout(() => {
        worker.stop();
      }, 2000);
    });
  }, [graph]);

  const applyRadial = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    circular.assign(graph);
  }, [graph]);

  const applyHierarchy = useCallback((focusNodeId?: string) => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    try {
      dagre.assign(graph, { settings: { rankdir: 'TB', rankSep: 50, nodeSep: 30 } });
    } catch {
      // dagre can fail on disconnected graphs — fall back to circular
      circular.assign(graph);
    }
  }, [graph]);

  const switchLayout = useCallback((next: LayoutType, focusNodeId?: string) => {
    setLayout(next);
    if (next === 'force') startForce();
    else if (next === 'radial') applyRadial();
    else applyHierarchy(focusNodeId);
  }, [startForce, applyRadial, applyHierarchy]);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  return { layout, switchLayout, startForce, stopWorker };
}
```

- [ ] **Step 2: Create `ui/src/components/GraphControls.tsx`**

```tsx
import type { LayoutType } from '../hooks/useLayout.ts';

type Props = {
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

const LAYOUTS: { id: LayoutType; label: string; title: string }[] = [
  { id: 'force', label: '⬡', title: 'Force-directed' },
  { id: 'radial', label: '◎', title: 'Radial' },
  { id: 'hierarchy', label: '⊤', title: 'Hierarchy' },
];

export default function GraphControls({ layout, onLayoutChange, onZoomIn, onZoomOut }: Props) {
  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-2">
      <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        {LAYOUTS.map(l => (
          <button
            key={l.id}
            onClick={() => onLayoutChange(l.id)}
            title={l.title}
            className={`w-9 h-9 text-sm flex items-center justify-center transition-colors ${
              layout === l.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <button onClick={onZoomIn} className="w-9 h-9 text-lg text-gray-400 hover:bg-gray-700 hover:text-white flex items-center justify-center">+</button>
        <button onClick={onZoomOut} className="w-9 h-9 text-lg text-gray-400 hover:bg-gray-700 hover:text-white flex items-center justify-center">−</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `ui/src/components/GraphCanvas.tsx` to use layout + controls**

Replace the zoom buttons block and add `layoutHook` prop:

```tsx
import { useRef, useEffect, useCallback, useState } from 'react';
import { useSigma } from '../hooks/useSigma.ts';
import { useLayout, type LayoutType } from '../hooks/useLayout.ts';
import GraphControls from './GraphControls.tsx';
import type { useGraph } from '../hooks/useGraph.ts';
import type { ApiClient } from '../lib/api.ts';

type Props = {
  graphHook: ReturnType<typeof useGraph>;
  api: ApiClient;
  depth: number;
  onNodeClick: (nodeId: string) => void;
  onStageClick: () => void;
};

type ContextMenu = { nodeId: string; x: number; y: number } | null;

export default function GraphCanvas({ graphHook, api, depth, onNodeClick, onStageClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const loadingRef = useRef(new Set<string>());
  const layoutHook = useLayout(graphHook.graph);

  const handleClickNode = useCallback((nodeId: string) => {
    onNodeClick(nodeId);
    if (!loadingRef.current.has(nodeId)) {
      loadingRef.current.add(nodeId);
      api.expandGraph(nodeId, { depth }).then(data => {
        graphHook.addNeighbours(data.entities);
        graphHook.addEdges(data.edges);
        sigmaControls.refresh();
      }).catch(console.error);
    }
  }, [api, depth, graphHook, onNodeClick]);

  const handleRightClickNode = useCallback((nodeId: string, x: number, y: number) => {
    setContextMenu({ nodeId, x, y });
  }, []);

  const handleClickStage = useCallback(() => {
    setContextMenu(null);
    onStageClick();
  }, [onStageClick]);

  const sigmaControls = useSigma(containerRef, graphHook.graph, {
    onClickNode: handleClickNode,
    onRightClickNode: handleRightClickNode,
    onClickStage: handleClickStage,
  });

  useEffect(() => {
    if (graphHook.graph.order > 0) {
      layoutHook.startForce();
    }
  }, [graphHook.graph.order]);

  useEffect(() => {
    return () => layoutHook.stopWorker();
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  const handleLayoutChange = useCallback((next: LayoutType) => {
    layoutHook.switchLayout(next);
    sigmaControls.refresh();
  }, [layoutHook, sigmaControls]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      <GraphControls
        layout={layoutHook.layout}
        onLayoutChange={handleLayoutChange}
        onZoomIn={sigmaControls.zoomIn}
        onZoomOut={sigmaControls.zoomOut}
      />

      {contextMenu && (
        <div
          className="absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-10 min-w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            { label: 'Expand neighbours', action: () => { handleClickNode(contextMenu.nodeId); setContextMenu(null); } },
            { label: 'Copy ID', action: () => { navigator.clipboard.writeText(contextMenu.nodeId); setContextMenu(null); } },
          ].map(item => (
            <button
              key={item.label}
              onClick={item.action}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd ui && npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Start dev server and verify layouts work**

```bash
cd ui && npm run dev
```

After logging in, nodes should spread out via ForceAtlas2. Click the ◎ button to switch to radial — nodes should arrange in a circle. Click ⊤ for hierarchy. Click ⬡ to return to force-directed.

- [ ] **Step 6: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add ForceAtlas2 layout worker and layout switcher controls"
```

---

## Task 8: Left Panel — Search, Filters, Depth

**Files:**
- Create: `ui/src/hooks/useSearch.ts`
- Create: `ui/src/components/SearchBox.tsx`
- Create: `ui/src/components/SearchResults.tsx`
- Create: `ui/src/components/FilterChips.tsx`
- Create: `ui/src/components/RelationChips.tsx`
- Create: `ui/src/components/DepthSlider.tsx`
- Modify: `ui/src/App.tsx`
- Test: `ui/src/components/FilterChips.test.tsx`

- [ ] **Step 1: Write failing test for FilterChips**

Create `ui/src/components/FilterChips.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChips from './FilterChips.tsx';

describe('FilterChips', () => {
  const types = ['document', 'memory', 'person'];

  it('renders a chip per type', () => {
    render(<FilterChips types={types} visible={new Set(types)} onToggle={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('calls onToggle with type when clicked', () => {
    const onToggle = vi.fn();
    render(<FilterChips types={types} visible={new Set(types)} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('document'));
    expect(onToggle).toHaveBeenCalledWith('document');
  });

  it('shows inactive state for hidden types', () => {
    const { container } = render(
      <FilterChips types={types} visible={new Set(['memory'])} onToggle={vi.fn()} />
    );
    const buttons = container.querySelectorAll('button');
    // document button should have opacity or different styling when not in visible set
    expect(buttons[0]).toHaveClass('opacity-40');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ui && npm test -- FilterChips
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `ui/src/components/FilterChips.tsx`**

```tsx
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

type Props = {
  types: string[];
  visible: Set<string>;
  onToggle: (type: string) => void;
};

export default function FilterChips({ types, visible, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map(type => {
        const color = ENTITY_COLORS[type] ?? ENTITY_COLORS.default;
        const isVisible = visible.has(type);
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-opacity ${
              isVisible ? 'opacity-100' : 'opacity-40'
            }`}
            style={{ borderColor: color, color: isVisible ? color : '#6B7280' }}
          >
            {type}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run FilterChips test to verify it passes**

```bash
cd ui && npm test -- FilterChips
```

Expected: PASS.

- [ ] **Step 5: Create `ui/src/hooks/useSearch.ts`**

```ts
import { useState, useCallback, useRef } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { SearchResult } from '../lib/types.ts';

export function useSearch(api: ApiClient) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchEntities({ query: q, limit: 20 });
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [api]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
  }, []);

  return { query, results, loading, search, clear };
}
```

- [ ] **Step 6: Create `ui/src/components/SearchBox.tsx`**

```tsx
type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export default function SearchBox({ value, onChange, placeholder = 'Search…' }: Props) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-xs"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create `ui/src/components/SearchResults.tsx`**

```tsx
import type { SearchResult } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

type Props = {
  results: SearchResult[];
  onSelect: (entityId: string) => void;
};

export default function SearchResults({ results, onSelect }: Props) {
  if (results.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {results.map(r => {
        const color = ENTITY_COLORS[r.entity.type] ?? ENTITY_COLORS.default;
        return (
          <button
            key={r.entity.id}
            onClick={() => onSelect(r.entity.id)}
            className="text-left px-2 py-2 rounded hover:bg-gray-800 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-400 uppercase tracking-wide">{r.entity.type}</span>
              <span className="text-xs text-gray-600 ml-auto">{Math.round(r.score * 100)}%</span>
            </div>
            <p className="text-sm text-gray-200 line-clamp-2">{r.chunk_content}</p>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 8: Create `ui/src/components/RelationChips.tsx`**

```tsx
type Props = {
  relations: string[];
  visible: Set<string>;
  onToggle: (relation: string) => void;
};

export default function RelationChips({ relations, visible, onToggle }: Props) {
  if (relations.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {relations.map(rel => (
        <button
          key={rel}
          onClick={() => onToggle(rel)}
          className={`px-2 py-0.5 rounded-full text-xs border border-gray-600 transition-opacity ${
            visible.has(rel) ? 'text-gray-300 opacity-100' : 'text-gray-500 opacity-40'
          }`}
        >
          {rel}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Create `ui/src/components/DepthSlider.tsx`**

```tsx
type Props = {
  value: number;
  onChange: (v: number) => void;
};

export default function DepthSlider({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-16 shrink-0">Depth: {value}</span>
      <input
        type="range"
        min={1}
        max={3}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-500"
      />
    </div>
  );
}
```

- [ ] **Step 10: Update `ui/src/App.tsx` with full left panel**

```tsx
import { useState, useCallback, useEffect, useMemo } from 'react';
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
  const [visibleRelations, setVisibleRelations] = useState<Set<string>>(new Set());
  const [loadedRelations, setLoadedRelations] = useState<Set<string>>(new Set());

  const handleLogout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
  }, []);

  const api = useApi({ apiKey: apiKey ?? '', onUnauthorized: handleLogout });
  const graphHook = useGraph();
  const searchHook = useSearch(api);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    async function loadEntities() {
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
    loadEntities().catch(console.error);
    return () => { cancelled = true; };
  }, [apiKey]);

  const handleTypeToggle = useCallback((type: string) => {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    graphHook.setNodesHiddenByType(type, visibleTypes.has(type));
  }, [graphHook, visibleTypes]);

  const handleRelationToggle = useCallback((relation: string) => {
    setVisibleRelations(prev => {
      const next = new Set(prev);
      if (next.has(relation)) next.delete(relation);
      else next.add(relation);
      return next;
    });
    graphHook.setEdgesHiddenByRelation(relation, visibleRelations.has(relation));
  }, [graphHook, visibleRelations]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setRightOpen(true);
  }, []);

  const handleStageClick = useCallback(() => {
    setRightOpen(false);
    setSelectedNodeId(null);
  }, []);

  const handleLogin = useCallback((key: string) => {
    localStorage.setItem(STORAGE_KEY, key);
    setApiKey(key);
  }, []);

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const leftContent = (
    <div className="flex flex-col gap-4 p-3">
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
        selectedNodeId ? (
          <div className="text-gray-400 text-sm font-mono break-all">{selectedNodeId}</div>
        ) : null
      }
    />
  );
}
```

- [ ] **Step 11: Run typecheck and tests**

```bash
cd ui && npm run typecheck && npm test
```

Expected: No errors. All tests pass.

- [ ] **Step 12: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add search, entity type filters, relation chips, depth slider"
```

---

## Task 9: Status Widget + useQueue

**Files:**
- Create: `ui/src/hooks/useQueue.ts`
- Create: `ui/src/components/StatusWidget.tsx`
- Modify: `ui/src/App.tsx` (add StatusWidget to left panel)
- Test: `ui/src/hooks/useQueue.test.ts`

- [ ] **Step 1: Write failing test**

Create `ui/src/hooks/useQueue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useQueue } from './useQueue.ts';
import type { ApiClient } from '../lib/api.ts';

describe('useQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches queue status on mount', async () => {
    const mockApi = {
      getQueueStatus: vi.fn().mockResolvedValue({
        embedding: { pending: 0, completed: 100, failed: 0, retry_eligible: 0, oldest_pending_secs: null },
        extraction: { pending: 0, completed: 50, failed: 0 },
      }),
    } as unknown as ApiClient;

    const { result } = renderHook(() => useQueue(mockApi));

    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(mockApi.getQueueStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status?.embedding.completed).toBe(100);
  });

  it('polls every 30 seconds', async () => {
    const mockApi = {
      getQueueStatus: vi.fn().mockResolvedValue({
        embedding: { pending: 0, completed: 100, failed: 0, retry_eligible: 0, oldest_pending_secs: null },
        extraction: null,
      }),
    } as unknown as ApiClient;

    renderHook(() => useQueue(mockApi));
    await waitFor(() => expect(mockApi.getQueueStatus).toHaveBeenCalledTimes(1));

    vi.advanceTimersByTime(30000);
    await waitFor(() => expect(mockApi.getQueueStatus).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ui && npm test -- useQueue
```

Expected: FAIL.

- [ ] **Step 3: Create `ui/src/hooks/useQueue.ts`**

```ts
import { useState, useEffect } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { QueueStatus } from '../lib/types.ts';

export function useQueue(api: ApiClient) {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const s = await api.getQueueStatus();
        if (!cancelled) setStatus(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      }
    }

    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [api]);

  return { status, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ui && npm test -- useQueue
```

Expected: PASS.

- [ ] **Step 5: Create `ui/src/components/StatusWidget.tsx`**

```tsx
import { useState } from 'react';
import type { QueueStatus } from '../lib/types.ts';

type Props = {
  status: QueueStatus | null;
};

function dot(color: string) {
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

export default function StatusWidget({ status }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!status) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500">Checking status…</div>
    );
  }

  const embFailed = status.embedding.failed > 0;
  const extFailed = status.extraction && status.extraction.failed > 0;
  const embPending = status.embedding.pending > 0;
  const extPending = status.extraction && status.extraction.pending > 0;

  const dotColor = embFailed || extFailed
    ? 'bg-red-500'
    : embPending || extPending
    ? 'bg-yellow-400'
    : 'bg-green-500';

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors"
      >
        {dot(dotColor)}
        <span>Queue status</span>
        <span className="ml-auto">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 text-xs text-gray-400 flex flex-col gap-1">
          <div className="font-medium text-gray-300 mb-1">Embedding</div>
          <div className="grid grid-cols-2 gap-x-4">
            <span>Pending</span><span className={embPending ? 'text-yellow-400' : 'text-gray-500'}>{status.embedding.pending}</span>
            <span>Completed</span><span className="text-gray-500">{status.embedding.completed}</span>
            <span>Failed</span><span className={embFailed ? 'text-red-400' : 'text-gray-500'}>{status.embedding.failed}</span>
          </div>
          {status.embedding.oldest_pending_secs != null && (
            <div className="text-orange-400 mt-1">Oldest pending: {Math.round(status.embedding.oldest_pending_secs)}s</div>
          )}
          {status.extraction && (
            <>
              <div className="font-medium text-gray-300 mt-2 mb-1">Extraction</div>
              <div className="grid grid-cols-2 gap-x-4">
                <span>Pending</span><span className={extPending ? 'text-yellow-400' : 'text-gray-500'}>{status.extraction.pending}</span>
                <span>Completed</span><span className="text-gray-500">{status.extraction.completed}</span>
                <span>Failed</span><span className={extFailed ? 'text-red-400' : 'text-gray-500'}>{status.extraction.failed}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Update `ui/src/App.tsx` to add StatusWidget to left panel**

Add import and usage. In the `leftContent` JSX, append StatusWidget at the bottom:

Import at top of App.tsx:
```tsx
import StatusWidget from './components/StatusWidget.tsx';
import { useQueue } from './hooks/useQueue.ts';
```

Add inside the component (after `const searchHook = useSearch(api);`):
```tsx
const queueHook = useQueue(api);
```

At the bottom of `leftContent`, inside the outer `<div className="flex flex-col gap-4 p-3">`, add:
```tsx
      <div className="mt-auto -mx-3 -mb-4">
        <StatusWidget status={queueHook.status} />
      </div>
```

Make the outer leftContent div use `min-h-0 flex-1 overflow-y-auto`:
```tsx
  const leftContent = (
    <div className="flex flex-col gap-4 p-3 h-full">
```

- [ ] **Step 7: Run typecheck and all tests**

```bash
cd ui && npm run typecheck && npm test
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add queue status polling and StatusWidget"
```

---

## Task 10: Right Panel — Entity Detail

**Files:**
- Create: `ui/src/hooks/useEntityDetail.ts`
- Create: `ui/src/components/EntityDetail.tsx`
- Create: `ui/src/components/EdgeList.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Create `ui/src/hooks/useEntityDetail.ts`**

```ts
import { useState, useEffect } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity, Edge } from '../lib/types.ts';

export function useEntityDetail(api: ApiClient, entityId: string | null) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityId) {
      setEntity(null);
      setEdges([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      api.getEntity(entityId),
      api.listEdges(entityId),
    ]).then(([entityRes, edgesRes]) => {
      if (cancelled) return;
      setEntity(entityRes.entity);
      setEdges(edgesRes.edges);
    }).catch(console.error).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [api, entityId]);

  return { entity, edges, loading };
}
```

- [ ] **Step 2: Create `ui/src/components/EntityDetail.tsx`**

```tsx
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Entity } from '../lib/types.ts';
import type { ApiClient } from '../lib/api.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

type Props = {
  entity: Entity;
  api: ApiClient;
  onUpdate: (entity: Entity) => void;
};

export default function EntityDetail({ entity, api, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entity.content ?? '');
  const [saving, setSaving] = useState(false);
  const color = ENTITY_COLORS[entity.type] ?? ENTITY_COLORS.default;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await api.updateEntity(entity.id, { version: entity.version, content: draft });
      onUpdate(res.entity);
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: color + '22', color }}
        >
          {entity.type}
        </span>
        <span className="text-xs text-gray-500 font-mono truncate">{entity.id.slice(0, 8)}</span>
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

      {/* Tags */}
      {entity.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entity.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-300">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Content */}
      <div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none h-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setDraft(entity.content ?? ''); }}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="group relative">
            <div className="prose prose-sm prose-invert max-w-none text-sm text-gray-300">
              {entity.content ? (
                <ReactMarkdown>{entity.content}</ReactMarkdown>
              ) : (
                <span className="text-gray-600 italic">No content</span>
              )}
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
    </div>
  );
}
```

- [ ] **Step 3: Create `ui/src/components/EdgeList.tsx`**

```tsx
import type { Edge } from '../lib/types.ts';
import { ENTITY_COLORS } from '../lib/nodeStyles.ts';

type Props = {
  edges: Edge[];
  onNavigate: (entityId: string) => void;
};

function groupByRelation(edges: Edge[]): Record<string, Edge[]> {
  return edges.reduce<Record<string, Edge[]>>((acc, edge) => {
    (acc[edge.relation] ??= []).push(edge);
    return acc;
  }, {});
}

export default function EdgeList({ edges, onNavigate }: Props) {
  if (edges.length === 0) {
    return <p className="text-xs text-gray-600 italic">No connections loaded yet</p>;
  }

  const grouped = groupByRelation(edges);

  return (
    <div className="flex flex-col gap-3">
      {Object.entries(grouped).map(([relation, relEdges]) => (
        <div key={relation}>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{relation}</p>
          <div className="flex flex-col gap-0.5">
            {relEdges.map(edge => {
              const targetId = edge.target_id;
              return (
                <button
                  key={edge.id}
                  onClick={() => onNavigate(targetId)}
                  className="flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-gray-800 transition-colors"
                >
                  <span className="text-gray-600 text-xs">→</span>
                  <span className="text-sm text-gray-300 font-mono truncate">{targetId.slice(0, 8)}</span>
                  <span className="text-xs text-gray-600 ml-auto">{Math.round(edge.confidence * 100)}%</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Update `ui/src/App.tsx` right panel content**

Add imports:
```tsx
import EntityDetail from './components/EntityDetail.tsx';
import EdgeList from './components/EdgeList.tsx';
import { useEntityDetail } from './hooks/useEntityDetail.ts';
```

Add after existing hooks:
```tsx
const detailHook = useEntityDetail(api, selectedNodeId);
```

Replace the rightContent in MainLayout:
```tsx
      rightContent={
        detailHook.loading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : detailHook.entity ? (
          <div className="flex flex-col gap-6">
            <EntityDetail
              entity={detailHook.entity}
              api={api}
              onUpdate={updated => { /* local state update if needed */ void updated; }}
            />
            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Connections</p>
              <EdgeList
                edges={detailHook.edges}
                onNavigate={handleNodeClick}
              />
            </div>
          </div>
        ) : null
      }
```

- [ ] **Step 5: Run typecheck and tests**

```bash
cd ui && npm run typecheck && npm test
```

Expected: All pass.

- [ ] **Step 6: Start dev server and verify entity detail loads**

```bash
cd ui && npm run dev
```

Click a node → right panel should slide in showing entity type badge, timestamps, content rendered as markdown, and edge list grouped by relation type. Click an edge neighbour to navigate.

- [ ] **Step 7: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add entity detail panel with markdown content, inline edit, and edge list"
```

---

## Task 11: Entity Actions (Add Note, Link, Delete)

**Files:**
- Create: `ui/src/components/EntityActions.tsx`
- Create: `ui/src/components/AddNoteModal.tsx`
- Create: `ui/src/components/LinkModal.tsx`
- Modify: `ui/src/App.tsx` (pass actions into right panel)

- [ ] **Step 1: Create `ui/src/components/AddNoteModal.tsx`**

```tsx
import { useState } from 'react';
import type { ApiClient } from '../lib/api.ts';
import type { Entity } from '../lib/types.ts';

type Props = {
  sourceEntityId: string;
  api: ApiClient;
  onCreated: (entity: Entity) => void;
  onClose: () => void;
};

const ENTITY_TYPES = ['memory', 'interaction', 'project', 'person', 'task'];
const VISIBILITIES = ['personal', 'work', 'shared'];

export default function AddNoteModal({ sourceEntityId, api, onCreated, onClose }: Props) {
  const [content, setContent] = useState('');
  const [type, setType] = useState('memory');
  const [visibility, setVisibility] = useState('personal');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      const res = await api.createEntity({
        type,
        content,
        visibility,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      });
      await api.createEdge({
        source_id: res.entity.id,
        target_id: sourceEntityId,
        relation: 'related_to',
        confidence: 1,
      });
      onCreated(res.entity);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-4">Add Note</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Note content…"
            className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none h-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <div className="flex gap-3">
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
            >
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
            >
              {VISIBILITIES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !content.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `ui/src/components/LinkModal.tsx`**

```tsx
import { useState } from 'react';
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

  async function handleSearch(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const res = await api.searchEntities({ query: q, limit: 10 });
    setResults(res.results);
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
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-4">Link to Entity</h2>
        <div className="flex flex-col gap-3">
          <input
            value={query}
            onChange={e => handleSearch(e.target.value)}
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
```

- [ ] **Step 3: Create `ui/src/components/EntityActions.tsx`**

```tsx
import { useState } from 'react';
import type { Entity } from '../lib/types.ts';
import type { ApiClient } from '../lib/api.ts';
import AddNoteModal from './AddNoteModal.tsx';
import LinkModal from './LinkModal.tsx';

type Props = {
  entity: Entity;
  api: ApiClient;
  onDelete: () => void;
  onNoteCreated: (entity: Entity) => void;
  onLinked: () => void;
};

type Modal = 'note' | 'link' | null;

export default function EntityActions({ entity, api, onDelete, onNoteCreated, onLinked }: Props) {
  const [modal, setModal] = useState<Modal>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    await api.deleteEntity(entity.id);
    onDelete();
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setModal('note')}
          className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          + Add note
        </button>
        <button
          onClick={() => setModal('link')}
          className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          Link to entity
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full text-left px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-red-900 text-gray-500 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-red-700 hover:bg-red-600 text-white"
            >
              Confirm delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {modal === 'note' && (
        <AddNoteModal
          sourceEntityId={entity.id}
          api={api}
          onCreated={onNoteCreated}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'link' && (
        <LinkModal
          sourceEntityId={entity.id}
          api={api}
          onLinked={onLinked}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Update `ui/src/App.tsx` rightContent to include EntityActions**

Add imports:
```tsx
import EntityActions from './components/EntityActions.tsx';
```

Update rightContent:
```tsx
      rightContent={
        detailHook.loading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : detailHook.entity ? (
          <div className="flex flex-col gap-6">
            <EntityDetail
              entity={detailHook.entity}
              api={api}
              onUpdate={updated => { void updated; }}
            />
            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Connections</p>
              <EdgeList edges={detailHook.edges} onNavigate={handleNodeClick} />
            </div>
            <div className="border-t border-gray-800 pt-4">
              <EntityActions
                entity={detailHook.entity}
                api={api}
                onDelete={() => { setRightOpen(false); setSelectedNodeId(null); }}
                onNoteCreated={entity => { graphHook.addEntities([entity]); }}
                onLinked={() => { /* edges will reload on next expand */ }}
              />
            </div>
          </div>
        ) : null
      }
```

- [ ] **Step 5: Run typecheck and tests**

```bash
cd ui && npm run typecheck && npm test
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add ui/src/
git commit -m "feat(web-ui): add entity actions: add note modal, link modal, delete confirmation"
```

---

## Task 12: Docker Packaging

**Files:**
- Create: `ui/Dockerfile`
- Create: `ui/nginx.conf`
- Modify: `docker-compose.yml` (at repo root)

- [ ] **Step 1: Create `ui/Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
```

- [ ] **Step 2: Create `ui/nginx.conf`**

```nginx
server {
  listen 3000;

  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://postgram:3100/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /health {
    proxy_pass http://postgram:3100/health;
    proxy_set_header Host $host;
  }
}
```

- [ ] **Step 3: Read `docker-compose.yml` at repo root**

```bash
cat /home/ivo/workspace/postgram/docker-compose.yml
```

- [ ] **Step 4: Add postgram-ui service to `docker-compose.yml`**

Add to the `services:` section:

```yaml
  postgram-ui:
    build: ./ui
    ports:
      - "3000:3000"
    depends_on:
      - postgram
    networks:
      - default
    restart: unless-stopped
```

- [ ] **Step 5: Build Docker image to verify it compiles**

```bash
cd /home/ivo/workspace/postgram && docker build -t postgram-ui-test ./ui
```

Expected: Build succeeds, `COPY --from=builder /app/dist` step succeeds.

- [ ] **Step 6: Run typecheck and all tests one final time**

```bash
cd ui && npm run typecheck && npm test
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add ui/Dockerfile ui/nginx.conf
git add docker-compose.yml
git commit -m "feat(web-ui): add Docker + nginx packaging, add postgram-ui service to compose"
```

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| Separate Docker container, nginx, port 3000 | Task 12 |
| `/api/*` proxied to postgram:3100 | Task 12 |
| React 19 + Vite + TypeScript + Tailwind | Task 1 |
| graphology + Sigma.js + ForceAtlas2 + dagre + circular | Tasks 5–7 |
| API key in localStorage, Bearer token, 401→logout | Tasks 2–3 |
| 4-zone layout: top bar, left panel, canvas, right panel | Task 4 |
| Left panel collapsible | Task 4 |
| Right panel slides in on node click | Task 4 |
| Load all entities on login (node cloud) | Task 6 |
| Lazy edge loading on node click (expandGraph) | Task 6 |
| Node colour by type | Task 5 |
| Node opacity for enrichment_status:pending | Task 5 |
| Edge dashed for confidence<0.5 | Task 5 |
| ForceAtlas2 WebWorker, 2s freeze | Task 7 |
| Radial + hierarchy layout | Task 7 |
| Layout switcher button group | Task 7 |
| Click node → right panel + 1-hop edges | Tasks 6, 10 |
| Right-click context menu (expand, copy ID) | Task 6 |
| Search with 300ms debounce | Task 8 |
| Entity type filter chips | Task 8 |
| Relation type chips | Task 8 |
| Depth slider 1-3 | Task 8 |
| Status widget polls /api/queue every 30s | Task 9 |
| Green/yellow/red dot logic | Task 9 |
| Right panel: entity content as markdown | Task 10 |
| Inline edit (PATCH /api/entities/:id) | Task 10 |
| Edges grouped by relation type | Task 10 |
| Add note modal (POST /api/entities + POST /api/edges) | Task 11 |
| Link modal (search → pick relation → POST /api/edges) | Task 11 |
| Delete with confirmation (DELETE /api/entities/:id) | Task 11 |
