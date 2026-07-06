import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';
import AdminAuth from './admin/AdminAuth.tsx';
import TopBar from './TopBar.tsx';

vi.mock('./GraphCanvas.tsx', () => ({
  default: () => <div data-testid="graph-canvas" />
}));

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
  mfaRequired: true
};

const pendingUser = {
  ...activeUser,
  status: 'pending_mfa'
};

const pendingSession = {
  id: 'admin-session-1',
  expiresAt: '2026-07-06T18:00:00.000Z',
  mfaVerified: false
};

const activeSession = {
  ...pendingSession,
  mfaVerified: true
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function mockFetch(routes: MockRoute[]) {
  const pending = [...routes];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = typeof input === 'string' ? input : input.toString();
    const method = init.method ?? 'GET';
    const index = pending.findIndex(
      (route) => route.path === path && (route.method ?? 'GET') === method
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

function expectNoAdminSecretInLocalStorage(
  storageWrites: StorageWriteSpy,
  ...values: string[]
) {
  const entries = Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index) ?? '';
    return [key, localStorage.getItem(key) ?? ''].join('=');
  });
  const serialized = entries.join('\n');
  const writes = storageWrites.mock.calls
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  for (const value of values) {
    expect(serialized).not.toContain(value);
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
    }
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  });
}

beforeEach(() => {
  installLocalStorage();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin auth navigation', () => {
  it('adds a restrained admin entry to the main navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <TopBar onLogout={vi.fn()} currentPage="search" onNavigate={onNavigate} />
    );

    await user.click(screen.getByRole('button', { name: 'Admin' }));
    expect(onNavigate).toHaveBeenCalledWith('admin');
  });

  it('opens admin auth without requiring a regular API key when the /admin path is loaded', async () => {
    window.history.pushState({}, '', '/admin');
    const fetchMock = mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      }
    ]);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/api key/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every(([path]) =>
        String(path).startsWith('/admin/api/')
      )
    ).toBe(true);
  });

  it('ignores stale admin page storage on the regular app route', () => {
    localStorage.setItem('pgm_current_page', 'admin');

    render(<App />);

    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Admin sign in' })
    ).not.toBeInTheDocument();
  });

  it('does not persist admin as the regular app page when opening it from navigation', async () => {
    const user = userEvent.setup();
    localStorage.setItem('pgm_api_key', 'regular-api-key');
    const fetchMock = mockFetch([
      {
        path: '/api/queue',
        body: {
          embedding: {
            pending: 0,
            completed: 0,
            failed: 0,
            retry_eligible: 0,
            oldest_pending_secs: null
          },
          extraction: null
        }
      },
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      }
    ]);

    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Admin' }));

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    expect(localStorage.getItem('pgm_current_page')).not.toBe('admin');
    expect(window.location.pathname).toBe('/admin');
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/queue')).toBe(
      true
    );
  });

  it('keeps regular tab navigation out of browser history', async () => {
    const user = userEvent.setup();
    localStorage.setItem('pgm_api_key', 'regular-api-key');
    const pushState = vi.spyOn(window.history, 'pushState');
    mockFetch([
      {
        path: '/api/queue',
        body: {
          embedding: {
            pending: 0,
            completed: 0,
            failed: 0,
            retry_eligible: 0,
            oldest_pending_secs: null
          },
          extraction: null
        }
      },
      {
        path: '/api/entities?limit=500&offset=0',
        body: { items: [], total: 0 }
      }
    ]);

    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Graph' }));

    expect(pushState).not.toHaveBeenCalled();
    expect(localStorage.getItem('pgm_current_page')).toBe('graph');
    expect(window.location.pathname).toBe('/');
  });

  it('can return from the admin route to the regular app login', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/admin');
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      }
    ]);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to app' }));

    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('syncs admin route state when browser history changes', async () => {
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      }
    ]);

    render(<App />);
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();

    act(() => {
      window.history.pushState({}, '', '/admin');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();

    act(() => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
  });
});

describe('AdminAuth', () => {
  it('keeps first-admin setup pending until MFA is enrolled and verified without storing secrets', async () => {
    const user = userEvent.setup();
    const storageWrites = vi.spyOn(localStorage, 'setItem');
    const fetchMock = mockFetch([
      {
        path: '/admin/api/bootstrap/status',
        body: { state: 'unbootstrapped' }
      },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      },
      {
        path: '/admin/api/bootstrap/setup',
        method: 'POST',
        status: 201,
        body: {
          state: 'mfa_required',
          user: pendingUser,
          session: pendingSession,
          csrfToken: 'csrf-after-bootstrap',
          bootstrapToken: 'bootstrap-token-plaintext',
          sessionToken: 'pgm-admin-session-secret',
          providerSecret: 'provider-secret',
          adminBearerCredential: 'Bearer admin-secret'
        },
        assert: (init) => {
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).not.toHaveProperty('Authorization');
        }
      },
      {
        path: '/admin/api/session/mfa/enroll',
        method: 'POST',
        status: 201,
        body: {
          factor: {
            id: 'factor-1',
            type: 'totp',
            status: 'pending',
            createdAt: '2026-07-06T16:00:00.000Z',
            verifiedAt: null
          },
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl:
            'otpauth://totp/Postgram:admin@example.com?secret=JBSWY3DPEHPK3PXP'
        },
        assert: (init) => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-after-bootstrap'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
        }
      },
      {
        path: '/admin/api/session/mfa/verify',
        method: 'POST',
        body: {
          user: activeUser,
          session: activeSession,
          factor: {
            id: 'factor-1',
            type: 'totp',
            status: 'verified',
            createdAt: '2026-07-06T16:00:00.000Z',
            verifiedAt: '2026-07-06T16:03:00.000Z'
          },
          stepUp: {
            fresh: true,
            expiresAt: '2026-07-06T16:13:00.000Z'
          }
        },
        assert: (init) => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-after-bootstrap'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
        }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'First admin setup' })
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Bootstrap token'),
      'bootstrap-token-plaintext'
    );
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Display name'), 'Ada Admin');
    await user.type(
      screen.getByLabelText('Password'),
      'Correct Horse Battery Staple 2026!'
    );
    await user.click(screen.getByRole('button', { name: 'Create admin' }));

    expect(
      await screen.findByRole('heading', { name: 'MFA enrollment' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operations dashboard' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Begin enrollment' }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify MFA' }));

    expect(
      await screen.findByRole('heading', { name: 'Operations dashboard' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Config' })).toBeInTheDocument();
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();
    expect(screen.queryByText(/otpauth:\/\//i)).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expectNoAdminSecretInLocalStorage(
      storageWrites,
      'bootstrap-token-plaintext',
      'pgm-admin-session',
      'JBSWY3DPEHPK3PXP',
      'otpauth://',
      'provider-secret',
      'Bearer'
    );
  });

  it('keeps MFA enrollment state when an authenticator code is invalid', async () => {
    const user = userEvent.setup();
    mockFetch([
      {
        path: '/admin/api/bootstrap/status',
        body: { state: 'unbootstrapped' }
      },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      },
      {
        path: '/admin/api/bootstrap/setup',
        method: 'POST',
        status: 201,
        body: {
          state: 'mfa_required',
          user: pendingUser,
          session: pendingSession,
          csrfToken: 'csrf-after-bootstrap'
        }
      },
      {
        path: '/admin/api/session/mfa/enroll',
        method: 'POST',
        status: 201,
        body: {
          factor: {
            id: 'factor-1',
            type: 'totp',
            status: 'pending',
            createdAt: '2026-07-06T16:00:00.000Z',
            verifiedAt: null
          },
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUrl:
            'otpauth://totp/Postgram:admin@example.com?secret=JBSWY3DPEHPK3PXP'
        }
      },
      {
        path: '/admin/api/session/mfa/verify',
        method: 'POST',
        status: 401,
        body: { error: { message: 'Unable to verify MFA challenge' } }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'First admin setup' })
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Bootstrap token'),
      'bootstrap-token-plaintext'
    );
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'Correct Horse Battery Staple 2026!'
    );
    await user.click(screen.getByRole('button', { name: 'Create admin' }));

    expect(
      await screen.findByRole('heading', { name: 'MFA enrollment' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Begin enrollment' }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify MFA' }));

    expect(
      await screen.findByText('Unable to verify MFA challenge')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'MFA enrollment' })
    ).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Admin sign in' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operations dashboard' })
    ).not.toBeInTheDocument();
  });

  it('requires MFA challenge before active admin navigation after login', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      },
      {
        path: '/admin/api/session/login',
        method: 'POST',
        body: {
          user: activeUser,
          session: pendingSession,
          csrfToken: 'csrf-after-login'
        }
      },
      {
        path: '/admin/api/session/mfa/challenge',
        method: 'POST',
        body: {
          user: activeUser,
          session: activeSession,
          stepUp: {
            fresh: true,
            expiresAt: '2026-07-06T16:13:00.000Z'
          }
        },
        assert: (init) => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-after-login'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
        }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'Correct Horse Battery Staple 2026!'
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'MFA challenge' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operations dashboard' })
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Authenticator code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(
      await screen.findByRole('heading', { name: 'Operations dashboard' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Config' })).toBeInTheDocument();
  });

  it('keeps MFA challenge state when an authenticator code is invalid', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      },
      {
        path: '/admin/api/session/login',
        method: 'POST',
        body: {
          user: activeUser,
          session: pendingSession,
          csrfToken: 'csrf-after-login'
        }
      },
      {
        path: '/admin/api/session/mfa/challenge',
        method: 'POST',
        status: 401,
        body: { error: { message: 'Unable to verify MFA challenge' } }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'Correct Horse Battery Staple 2026!'
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'MFA challenge' })
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(
      await screen.findByText('Unable to verify MFA challenge')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'MFA challenge' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Admin sign in' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operations dashboard' })
    ).not.toBeInTheDocument();
  });

  it('lets pending MFA sessions sign out before admin navigation is available', async () => {
    const user = userEvent.setup();
    const storageWrites = vi.spyOn(localStorage, 'setItem');
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      },
      {
        path: '/admin/api/session/login',
        method: 'POST',
        body: {
          user: activeUser,
          session: pendingSession,
          csrfToken: 'csrf-after-login'
        }
      },
      {
        path: '/admin/api/session/logout',
        method: 'POST',
        body: { ok: true },
        assert: (init) => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-after-login'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
        }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'Correct Horse Battery Staple 2026!'
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'MFA challenge' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operations dashboard' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    expectNoAdminSecretInLocalStorage(
      storageWrites,
      'csrf-after-login',
      'pgm-admin-session',
      'admin bearer',
      'Bearer'
    );
  });

  it('returns to login when a pending MFA challenge finds an expired admin session', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      },
      {
        path: '/admin/api/session/login',
        method: 'POST',
        body: {
          user: activeUser,
          session: pendingSession,
          csrfToken: 'csrf-after-login'
        }
      },
      {
        path: '/admin/api/session/mfa/challenge',
        method: 'POST',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'Correct Horse Battery Staple 2026!'
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'MFA challenge' })
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Authenticator code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Admin session expired. Sign in again.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'MFA challenge' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operations dashboard' })
    ).not.toBeInTheDocument();
  });

  it('hydrates the current active session and refreshes CSRF before logout', async () => {
    const user = userEvent.setup();
    const storageWrites = vi.spyOn(localStorage, 'setItem');
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        body: { user: activeUser, session: activeSession }
      },
      {
        path: '/admin/api/session/csrf',
        body: { csrfToken: 'csrf-from-refresh' }
      },
      {
        path: '/admin/api/session/logout',
        method: 'POST',
        body: { ok: true },
        assert: (init) => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-from-refresh'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
        }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'Operations dashboard' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    expectNoAdminSecretInLocalStorage(
      storageWrites,
      'csrf-from-refresh',
      'pgm-admin-session',
      'admin bearer',
      'Bearer'
    );
  });

  it('keeps the admin session visible when logout fails before the cookie is cleared', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        body: { user: activeUser, session: activeSession }
      },
      {
        path: '/admin/api/session/csrf',
        body: { csrfToken: 'csrf-from-refresh' }
      },
      {
        path: '/admin/api/session/logout',
        method: 'POST',
        status: 503,
        body: { error: { message: 'Logout service unavailable' } }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'Operations dashboard' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByText('Logout service unavailable')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Operations dashboard' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Admin sign in' })
    ).not.toBeInTheDocument();
  });

  it('clears the protected shell when CSRF refresh reports an expired session during logout', async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: '/admin/api/bootstrap/status', body: { state: 'configured' } },
      {
        path: '/admin/api/session/current',
        body: { user: activeUser, session: activeSession }
      },
      {
        path: '/admin/api/session/csrf',
        status: 401,
        body: { error: { message: 'Invalid admin session' } }
      }
    ]);

    render(<AdminAuth />);

    expect(
      await screen.findByRole('heading', { name: 'Operations dashboard' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Admin session expired. Sign in again.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operations dashboard' })
    ).not.toBeInTheDocument();
  });
});
