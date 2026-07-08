import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminAuth from './admin/AdminAuth.tsx';

type MockRoute = {
  path: string;
  method?: string;
  status?: number;
  body: unknown;
  assert?: (init: RequestInit) => void;
};

const activeUser = {
  id: 'admin-user-1',
  email: 'admin@example.com',
  displayName: 'Ada Admin',
  status: 'active',
  mfaRequired: true,
};

const activeSession = {
  id: 'admin-session-1',
  expiresAt: '2026-07-06T18:00:00.000Z',
  mfaVerified: true,
};

const keyAlpha = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'admin-alpha',
  clientId: 'codex-desktop',
  scopes: ['read', 'write'],
  allowedTypes: ['memory', 'task'],
  allowedVisibility: ['shared', 'work'],
  isActive: true,
  createdAt: '2026-07-06T16:30:00.000Z',
  lastUsedAt: null,
};

const keyOld = {
  ...keyAlpha,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'admin-old',
  clientId: 'legacy-agent',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(routes: MockRoute[]) {
  const pending = [...routes];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = typeof input === 'string' ? input : input.toString();
    const method = init.method ?? 'GET';
    const index = pending.findIndex(route =>
      route.path === path && (route.method ?? 'GET') === method
    );
    if (index === -1) {
      throw new Error(`Unexpected ${method} ${path}`);
    }
    const [route] = pending.splice(index, 1);
    route.assert?.(init);
    return jsonResponse(route.body, route.status);
  });

  vi.stubGlobal('fetch', fn);
  return fn;
}

type StorageWriteSpy = {
  mock: {
    calls: Array<Parameters<Storage['setItem']>>;
  };
};

function expectNoBrowserStorageLeak(storageWrites: StorageWriteSpy, ...values: string[]) {
  const entries = Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index) ?? '';
    return [key, localStorage.getItem(key) ?? ''].join('=');
  }).join('\n');
  const writes = storageWrites.mock.calls
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  for (const value of values) {
    expect(entries).not.toContain(value);
    expect(writes).not.toContain(value);
  }
}

function installLocalStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

function activeSessionRoutes(): MockRoute[] {
  return [
    { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
    { path: '/admin/api/session/current', body: { user: activeUser, session: activeSession } },
  ];
}

function adminOpsRoutes(input: {
  keys?: unknown[];
  keysNextOffset?: number | null;
  auditEntries?: unknown[];
  auditNextOffset?: number | null;
  extractionFailed?: number;
  jobs?: unknown[];
  healthStatus?: number;
  healthErrorMessage?: string;
  statsStatus?: number;
} = {}): MockRoute[] {
  return [
    {
      path: '/admin/api/onboarding',
      body: {
        onboarding: {
          status: 'completed',
          currentStep: 'maintenance',
          completedSteps: [
            'setup',
            'provider_config',
            'secrets',
            'validate_apply',
            'backup_restore',
            'maintenance',
          ],
          skippedAt: null,
          completedAt: '2026-07-06T16:20:00.000Z',
          updatedByAdminUserId: activeUser.id,
          createdAt: '2026-07-06T16:00:00.000Z',
          updatedAt: '2026-07-06T16:20:00.000Z',
        },
      },
    },
    {
      path: '/admin/api/diagnostics/health',
      status: input.healthStatus,
      body: input.healthStatus
        ? { error: { message: input.healthErrorMessage ?? 'Health check unavailable' } }
        : {
            health: {
              status: 'ok',
              postgres: 'connected',
              embeddingModel: 'text-embedding-3-small',
            },
          },
    },
    {
      path: '/admin/api/diagnostics/queue',
      body: {
        queue: {
          embedding: {
            pending: 2,
            completed: 5,
            failed: 1,
            retry_eligible: 1,
            oldest_pending_secs: 45,
          },
          extraction: {
            pending: 1,
            completed: 4,
            failed: input.extractionFailed ?? 0,
            skipped: 0,
          },
        },
      },
    },
    {
      path: '/admin/api/diagnostics/models',
      body: {
        models: [
          {
            id: 'model-active',
            name: 'text-embedding-3-small',
            provider: 'openai',
            dimensions: 1536,
            chunkSize: 300,
            chunkOverlap: 100,
            isActive: true,
            createdAt: '2026-07-06T12:00:00.000Z',
          },
        ],
      },
    },
    {
      path: '/admin/api/diagnostics/config-status',
      body: {
        configStatus: {
          settings: {
            total: 2,
            byState: { applied: 1, pending: 1 },
            byClassification: { restart_required: 1, dynamic: 1 },
            byValidationStatus: { valid: 2 },
          },
          secrets: {
            totalConfigured: 1,
            byPurpose: { extraction: 1 },
            byValidationStatus: { valid: 1 },
          },
        },
      },
    },
    {
      path: '/admin/api/stats',
      status: input.statsStatus,
      body: input.statsStatus
        ? { error: { message: 'Stats unavailable' } }
        : {
            stats: {
              entityCounts: { memory: 2, task: 1 },
              chunkCount: 4,
              keyCount: 1,
              databaseSizeBytes: 1048576,
              uptimeSeconds: 3661,
            },
          },
    },
    {
      path: '/admin/api/keys?limit=50&offset=0',
      body: {
        keys: input.keys ?? [],
        pagination: { limit: 50, offset: 0, nextOffset: input.keysNextOffset ?? null },
      },
    },
    {
      path: '/admin/api/audit?limit=50&offset=0',
      body: {
        audit: {
          entries: input.auditEntries ?? [],
          pagination: { limit: 50, offset: 0, nextOffset: input.auditNextOffset ?? null },
        },
      },
    },
    {
      path: '/admin/api/jobs?limit=20&offset=0',
      body: {
        jobs: input.jobs ?? [],
        total: input.jobs?.length ?? 0,
        limit: 20,
        offset: 0,
      },
    },
  ];
}

beforeEach(() => {
  installLocalStorage();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Admin operations dashboard', () => {
  it('loads API keys, audit, stats, health, queue, jobs, models, and config status for an active admin session', async () => {
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({
        keys: [keyAlpha],
        auditEntries: [
          {
            id: 'audit-1',
            timestamp: '2026-07-06T16:34:00.000Z',
            operation: 'key.create',
            entityId: keyAlpha.id,
            apiKeyId: null,
            keyName: null,
            adminUserId: activeUser.id,
            adminEmail: activeUser.email,
            details: {
              name: 'admin-alpha',
              plaintextKey: '[redacted]',
              nested: { authorization: '[redacted]' },
            },
          },
        ],
        jobs: [
          {
            id: 'job-1',
            operation: 'maintenance.reextract',
            mode: 'dry_run',
            status: 'queued',
            idempotencyKey: null,
            requestedScope: { type: 'memory' },
            requestSummary: { dryRun: true },
            resultSummary: {},
            progress: { current: 0, total: null, message: null },
            createdByAdminUserId: activeUser.id,
            updatedByAdminUserId: null,
            startedAt: null,
            cancelRequestedAt: null,
            finishedAt: null,
            createdAt: '2026-07-06T16:35:00.000Z',
            updatedAt: '2026-07-06T16:35:00.000Z',
          },
        ],
      }),
    ]);

    render(<AdminAuth />);

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    expect((await screen.findAllByText('admin-alpha')).length).toBeGreaterThan(0);
    expect(screen.getByText('codex-desktop')).toBeInTheDocument();
    expect(screen.getByText('key.create')).toBeInTheDocument();
    expect(screen.getByText('maintenance.reextract')).toBeInTheDocument();
    expect(screen.getAllByText('text-embedding-3-small').length).toBeGreaterThan(0);
    expect(screen.getByText('Postgres connected')).toBeInTheDocument();
    expect(screen.getByText('Queue pending')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Config pending')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/pgm-/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/authorization.+Bearer/i)).not.toBeInTheDocument();
  });

  it('surfaces extraction failures in the queue panel', async () => {
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({ extractionFailed: 3 }),
    ]);

    render(<AdminAuth />);

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Extraction failed')).toBeInTheDocument();
    expect(await screen.findByText('3 failed')).toBeInTheDocument();
  });

  it('creates an API key with CSRF and shows plaintext only until the operator dismisses it', async () => {
    const user = userEvent.setup();
    const storageWrites = vi.spyOn(localStorage, 'setItem');
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes(),
      { path: '/admin/api/session/csrf', body: { csrfToken: 'csrf-for-key-create' } },
      {
        path: '/admin/api/keys',
        method: 'POST',
        status: 201,
        body: {
          plaintextKey: 'pgm-admin-alpha-one-time-secret',
          key: keyAlpha,
        },
        assert: init => {
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-for-key-create',
          });
          expect(init.headers).not.toHaveProperty('Authorization');
          expect(JSON.parse(String(init.body))).toMatchObject({
            name: 'admin-alpha',
            clientId: 'codex-desktop',
            scopes: ['read'],
            allowedTypes: ['interaction', 'memory', 'person', 'project', 'task'],
            allowedVisibility: ['shared', 'work'],
          });
        },
      },
    ]);

    render(<AdminAuth />);

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('API key name'), 'admin-alpha');
    await user.type(screen.getByLabelText('Client ID'), 'codex-desktop');
    await user.click(screen.getByLabelText('document'));
    await user.click(screen.getByLabelText('work'));
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByText('One-time API key')).toBeInTheDocument();
    expect(screen.getByText('pgm-admin-alpha-one-time-secret')).toBeInTheDocument();
    expect(screen.getByText('admin-alpha')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I have copied it' }));
    expect(screen.queryByText('pgm-admin-alpha-one-time-secret')).not.toBeInTheDocument();
    expectNoBrowserStorageLeak(
      storageWrites,
      'pgm-admin-alpha-one-time-secret',
      'csrf-for-key-create'
    );
  });

  it('uses the existing step-up flow when key creation requires recent admin step-up', async () => {
    const user = userEvent.setup();
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes(),
      { path: '/admin/api/session/csrf', body: { csrfToken: 'csrf-before-step-up' } },
      {
        path: '/admin/api/keys',
        method: 'POST',
        status: 403,
        body: { error: { message: 'Recent admin step-up is required' } },
      },
      {
        path: '/admin/api/session/step-up',
        method: 'POST',
        body: {
          user: activeUser,
          session: activeSession,
          stepUp: {
            fresh: true,
            expiresAt: '2026-07-06T17:10:00.000Z',
          },
        },
        assert: init => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-before-step-up',
          });
          expect(JSON.parse(String(init.body))).toEqual({ code: '123456' });
        },
      },
      {
        path: '/admin/api/keys',
        method: 'POST',
        status: 201,
        body: {
          plaintextKey: 'pgm-admin-beta-one-time-secret',
          key: { ...keyAlpha, id: '22222222-2222-4222-8222-222222222222', name: 'admin-beta' },
        },
      },
    ]);

    render(<AdminAuth />);

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('API key name'), 'admin-beta');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByText('Recent MFA confirmation required')).toBeInTheDocument();
    await user.type(screen.getByLabelText('MFA confirmation code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify MFA' }));
    expect(await screen.findByText('MFA confirmation refreshed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('pgm-admin-beta-one-time-secret')).toBeInTheDocument();
  });

  it('revokes API keys through the CSRF-protected admin client without displaying key hashes', async () => {
    const user = userEvent.setup();
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({ keys: [keyAlpha] }),
      { path: '/admin/api/session/csrf', body: { csrfToken: 'csrf-for-revoke' } },
      {
        path: `/admin/api/keys/${keyAlpha.id}/revoke`,
        method: 'POST',
        body: { revoked: true, id: keyAlpha.id },
        assert: init => {
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-for-revoke',
          });
          expect(init.headers).not.toHaveProperty('Authorization');
          expect(JSON.parse(String(init.body))).toEqual({});
        },
      },
    ]);

    render(<AdminAuth />);

    expect(await screen.findByText('admin-alpha')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke admin-alpha' }));

    const keyRow = await screen.findByRole('row', { name: /admin-alpha/i });
    expect(within(keyRow).getByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByText(/hash/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prefix/i)).not.toBeInTheDocument();
  });

  it('loads another API-key page before revoking keys outside the first page', async () => {
    const user = userEvent.setup();
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({ keys: [keyAlpha], keysNextOffset: 50 }),
      {
        path: '/admin/api/keys?limit=50&offset=50',
        body: {
          keys: [keyOld],
          pagination: { limit: 50, offset: 50, nextOffset: null },
        },
      },
      { path: '/admin/api/session/csrf', body: { csrfToken: 'csrf-for-old-revoke' } },
      {
        path: `/admin/api/keys/${keyOld.id}/revoke`,
        method: 'POST',
        body: { revoked: true, id: keyOld.id },
      },
    ]);

    render(<AdminAuth />);

    expect(await screen.findByText('admin-alpha')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more keys' }));
    expect(await screen.findByText('admin-old')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke admin-old' }));

    const keyRow = await screen.findByRole('row', { name: /admin-old/i });
    expect(within(keyRow).getByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more keys' })).not.toBeInTheDocument();
  });

  it('filters audit entries and preserves server-side redaction in details', async () => {
    const user = userEvent.setup();
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({
        auditEntries: [
          {
            id: 'audit-1',
            timestamp: '2026-07-06T16:34:00.000Z',
            operation: 'key.create',
            entityId: keyAlpha.id,
            apiKeyId: null,
            keyName: null,
            adminUserId: activeUser.id,
            adminEmail: activeUser.email,
            details: { plaintextKey: '[redacted]', safe: 'visible' },
          },
        ],
      }),
      {
        path: '/admin/api/audit?operation=key.revoke&limit=50&offset=0',
        body: {
          audit: {
            entries: [
              {
                id: 'audit-2',
                timestamp: '2026-07-06T16:36:00.000Z',
                operation: 'key.revoke',
                entityId: keyAlpha.id,
                apiKeyId: null,
                keyName: 'admin-alpha',
                adminUserId: activeUser.id,
                adminEmail: activeUser.email,
                details: {
                  providerSecret: '[redacted]',
                  nested: { token: '[redacted]' },
                  safe: 'visible',
                },
              },
            ],
            pagination: { limit: 50, offset: 0, nextOffset: null },
          },
        },
      },
    ]);

    render(<AdminAuth />);

    expect(await screen.findByText('key.create')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Audit operation'), 'key.revoke');
    await user.click(screen.getByRole('button', { name: 'Apply audit filters' }));

    expect(await screen.findByText('key.revoke')).toBeInTheDocument();
    expect(screen.getAllByText('[redacted]').length).toBeGreaterThan(0);
    expect(screen.getByText('visible')).toBeInTheDocument();
    expect(screen.queryByText(/sk-/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pgm-admin/i)).not.toBeInTheDocument();
  });

  it('loads additional audit pages when the server returns a next offset', async () => {
    const user = userEvent.setup();
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({
        auditEntries: [
          {
            id: 'audit-1',
            timestamp: '2026-07-06T16:34:00.000Z',
            operation: 'key.create',
            entityId: keyAlpha.id,
            apiKeyId: null,
            keyName: null,
            adminUserId: activeUser.id,
            adminEmail: activeUser.email,
            details: { plaintextKey: '[redacted]' },
          },
        ],
        auditNextOffset: 50,
      }),
      {
        path: '/admin/api/audit?limit=50&offset=50',
        body: {
          audit: {
            entries: [
              {
                id: 'audit-2',
                timestamp: '2026-07-06T16:36:00.000Z',
                operation: 'key.revoke',
                entityId: keyAlpha.id,
                apiKeyId: null,
                keyName: 'admin-alpha',
                adminUserId: activeUser.id,
                adminEmail: activeUser.email,
                details: { providerSecret: '[redacted]' },
              },
            ],
            pagination: { limit: 50, offset: 50, nextOffset: null },
          },
        },
      },
    ]);

    render(<AdminAuth />);

    expect(await screen.findByText('key.create')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more audit rows' }));

    expect(await screen.findByText('key.revoke')).toBeInTheDocument();
    expect(screen.getByText('2 rows')).toBeInTheDocument();
    expect(screen.getAllByText('[redacted]').length).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: 'Load more audit rows' })).not.toBeInTheDocument();
  });

  it('shows focused dashboard errors without collapsing the protected admin shell', async () => {
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({
        healthStatus: 503,
        statsStatus: 503,
      }),
    ]);

    render(<AdminAuth />);

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Health check unavailable')).toBeInTheDocument();
    expect(await screen.findByText('Stats unavailable')).toBeInTheDocument();
    expect(screen.getByText('API keys')).toBeInTheDocument();
    expect(screen.getByText('Audit log')).toBeInTheDocument();
  });

  it('returns to sign in when a dashboard read reports an expired admin session', async () => {
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes({
        healthStatus: 401,
        healthErrorMessage: 'Invalid admin session',
      }),
    ]);

    render(<AdminAuth />);

    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.getByText('Admin session expired. Sign in again.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Operations dashboard' })).not.toBeInTheDocument();
  });

  it('returns to sign in when key creation detects an expired admin session', async () => {
    const user = userEvent.setup();
    mockFetch([
      ...activeSessionRoutes(),
      ...adminOpsRoutes(),
      {
        path: '/admin/api/session/csrf',
        status: 401,
        body: { error: { message: 'Invalid admin session' } },
      },
    ]);

    render(<AdminAuth />);

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('API key name'), 'expired-create');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.getByText('Admin session expired. Sign in again.')).toBeInTheDocument();
  });
});
