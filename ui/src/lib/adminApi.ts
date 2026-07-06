export type AdminBootstrapState =
  | 'configured'
  | 'locked'
  | 'misconfigured'
  | 'unbootstrapped';

export type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  status: 'pending_mfa' | 'active' | 'disabled';
  mfaRequired: boolean;
};

export type AdminSession = {
  id: string;
  expiresAt: string;
  mfaVerified: boolean;
};

export type AdminStepUp = {
  fresh: boolean;
  expiresAt: string | null;
};

export type AdminMfaFactor = {
  id: string;
  type: 'totp';
  status: 'pending' | 'verified' | 'disabled';
  createdAt: string;
  verifiedAt: string | null;
};

export type AdminBootstrapStatusResponse = {
  state: AdminBootstrapState;
};

export type AdminAuthResponse = {
  state?: 'mfa_required';
  user: AdminUser;
  session: AdminSession;
  csrfToken?: string;
  stepUp?: AdminStepUp;
};

export type AdminMfaEnrollmentResponse = {
  factor: AdminMfaFactor;
  secret: string;
  otpauthUrl: string;
};

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

type AdminRequestOptions = {
  method?: string;
  body?: unknown;
  csrf?: boolean;
};

type AdminApiClient = {
  getBootstrapStatus: () => Promise<AdminBootstrapStatusResponse>;
  setupBootstrap: (input: {
    bootstrapToken: string;
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<AdminAuthResponse>;
  login: (input: { email: string; password: string }) => Promise<AdminAuthResponse>;
  current: () => Promise<AdminAuthResponse>;
  enrollMfa: () => Promise<AdminMfaEnrollmentResponse>;
  verifyMfa: (input: { factorId: string; code: string }) => Promise<AdminAuthResponse>;
  challengeMfa: (input: { code: string }) => Promise<AdminAuthResponse>;
  stepUp: (input: { code: string }) => Promise<AdminAuthResponse>;
  logout: () => Promise<{ ok: true }>;
};

function isUnsafeMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function hasCsrfToken(value: unknown): value is { csrfToken: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'csrfToken' in value &&
    typeof (value as { csrfToken?: unknown }).csrfToken === 'string'
  );
}

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
  };
  return body.error?.message ?? `Admin request failed: ${response.status}`;
}

export function createAdminApiClient(): AdminApiClient {
  let csrfToken: string | null = null;

  async function request<T>(
    path: string,
    options: AdminRequestOptions = {}
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.csrf !== false && isUnsafeMethod(method)) {
      headers['X-CSRF-Token'] = csrfToken ?? await getCsrfToken();
    }

    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new AdminApiError(response.status, await parseError(response));
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new AdminApiError(response.status, `Unexpected content-type: ${contentType}`);
    }

    const body = await response.json() as T;
    if (hasCsrfToken(body)) {
      csrfToken = body.csrfToken;
    }

    return body;
  }

  async function getCsrfToken(): Promise<string> {
    const response = await request<{ csrfToken: string }>('/admin/api/session/csrf', {
      csrf: false,
    });
    csrfToken = response.csrfToken;
    return response.csrfToken;
  }

  return {
    getBootstrapStatus() {
      return request<AdminBootstrapStatusResponse>('/admin/api/bootstrap/status');
    },

    setupBootstrap(input) {
      const body = {
        bootstrapToken: input.bootstrapToken,
        email: input.email,
        password: input.password,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      };
      return request<AdminAuthResponse>('/admin/api/bootstrap/setup', {
        method: 'POST',
        body,
        csrf: false,
      });
    },

    login(input) {
      return request<AdminAuthResponse>('/admin/api/session/login', {
        method: 'POST',
        body: input,
        csrf: false,
      });
    },

    current() {
      return request<AdminAuthResponse>('/admin/api/session/current');
    },

    enrollMfa() {
      return request<AdminMfaEnrollmentResponse>('/admin/api/session/mfa/enroll', {
        method: 'POST',
        body: {},
      });
    },

    verifyMfa(input) {
      return request<AdminAuthResponse>('/admin/api/session/mfa/verify', {
        method: 'POST',
        body: input,
      });
    },

    challengeMfa(input) {
      return request<AdminAuthResponse>('/admin/api/session/mfa/challenge', {
        method: 'POST',
        body: input,
      });
    },

    stepUp(input) {
      return request<AdminAuthResponse>('/admin/api/session/step-up', {
        method: 'POST',
        body: input,
      });
    },

    async logout() {
      const response = await request<{ ok: true }>('/admin/api/session/logout', {
        method: 'POST',
        body: {},
      });
      csrfToken = null;
      return response;
    },
  };
}

export type { AdminApiClient };
