import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminConfig from './admin/AdminConfig.tsx';
import {
  AdminApiError,
  createAdminApiClient,
  type AdminApiClient,
  type AdminProviderConfiguration,
  type AdminProviderConfigurationResponse,
  type AdminRuntimeSecretMetadata,
  type AdminRuntimeSettingSnapshot
} from '../lib/adminApi.ts';

type MockRoute = {
  path: string;
  method?: string;
  body: unknown;
  assert?: (init: RequestInit) => void;
};

type StorageWriteSpy = {
  mock: {
    calls: Array<Parameters<Storage['setItem']>>;
  };
};

const activeUser = {
  id: 'admin-user-1',
  email: 'admin@example.com',
  displayName: 'Ada Admin',
  status: 'active' as const,
  mfaRequired: true
};

const activeSession = {
  id: 'admin-session-1',
  expiresAt: '2026-07-06T18:00:00.000Z',
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
    return jsonResponse(route.body);
  });

  vi.stubGlobal('fetch', fn);
  return fn;
}

function installTrackedStorage(name: 'localStorage' | 'sessionStorage') {
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

  Object.defineProperty(window, name, {
    configurable: true,
    value: storage
  });
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage
  });
}

function expectStorageNotToContain(
  storage: Storage,
  storageWrites: StorageWriteSpy,
  ...values: string[]
) {
  const entries = Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? '';
    return [key, storage.getItem(key) ?? ''].join('=');
  }).join('\n');
  const writes = storageWrites.mock.calls
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  for (const value of values) {
    expect(entries).not.toContain(value);
    expect(writes).not.toContain(value);
  }
}

const settingKeys = [
  'EXTRACTION_ENABLED',
  'EXTRACTION_PROVIDER',
  'EXTRACTION_MODEL',
  'EXTRACTION_BASE_URL',
  'OLLAMA_BASE_URL',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'EMBEDDING_BASE_URL'
] as const;

const secretNames = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OLLAMA_API_KEY',
  'EXTRACTION_API_KEY',
  'EMBEDDING_API_KEY'
] as const;

function setting(
  key: (typeof settingKeys)[number],
  value: AdminRuntimeSettingSnapshot['value'],
  overrides: Partial<AdminRuntimeSettingSnapshot> = {}
): AdminRuntimeSettingSnapshot {
  const dangerous =
    key.startsWith('EMBEDDING_') && key !== 'EMBEDDING_BASE_URL';
  return {
    key,
    value,
    source: value === undefined ? 'unset' : 'database',
    classification: dangerous ? 'dangerous_migration' : 'restart_required',
    state: 'applied',
    validation: {
      status: 'valid',
      message: null,
      metadata: {},
      validatedAt: '2026-07-06T16:00:00.000Z'
    },
    restartRequired: false,
    reembedRequired: false,
    appliedAt: '2026-07-06T15:00:00.000Z',
    updatedByAdminUserId: 'admin-user-1',
    updatedAt: '2026-07-06T16:00:00.000Z',
    ...overrides
  };
}

function secret(
  name: (typeof secretNames)[number],
  overrides: Partial<AdminRuntimeSecretMetadata> = {}
): AdminRuntimeSecretMetadata {
  return {
    name,
    configured: true,
    provider: name === 'ANTHROPIC_API_KEY' ? 'anthropic' : 'openai',
    purpose: name === 'EMBEDDING_API_KEY' ? 'embedding' : 'provider',
    algorithm: 'aes-256-gcm',
    keyVersion: 'v1',
    validation: {
      status: 'valid',
      message: null,
      metadata: {},
      validatedAt: '2026-07-06T16:00:00.000Z'
    },
    updatedByAdminUserId: 'admin-user-1',
    createdAt: '2026-07-06T15:00:00.000Z',
    updatedAt: '2026-07-06T16:00:00.000Z',
    ...overrides
  };
}

function providerConfig(
  overrides: Partial<AdminProviderConfiguration> = {}
): AdminProviderConfiguration {
  return {
    settings: {
      EXTRACTION_ENABLED: setting('EXTRACTION_ENABLED', true),
      EXTRACTION_PROVIDER: setting('EXTRACTION_PROVIDER', 'openai'),
      EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1-mini'),
      EXTRACTION_BASE_URL: setting(
        'EXTRACTION_BASE_URL',
        'https://api.openai.com/v1'
      ),
      OLLAMA_BASE_URL: setting('OLLAMA_BASE_URL', undefined),
      EMBEDDING_PROVIDER: setting('EMBEDDING_PROVIDER', 'openai'),
      EMBEDDING_MODEL: setting('EMBEDDING_MODEL', 'text-embedding-3-small'),
      EMBEDDING_DIMENSIONS: setting('EMBEDDING_DIMENSIONS', 1536),
      EMBEDDING_BASE_URL: setting('EMBEDDING_BASE_URL', undefined)
    },
    secrets: {
      OPENAI_API_KEY: secret('OPENAI_API_KEY'),
      ANTHROPIC_API_KEY: null,
      OLLAMA_API_KEY: null,
      EXTRACTION_API_KEY: null,
      EMBEDDING_API_KEY: null
    },
    restartRequired: false,
    reembedRequired: false,
    egressPolicy: {
      id: 'provider-base-url-v1',
      httpsRequiredForRemoteProviders: true,
      redirects: 'blocked',
      localProviderHttpHosts: ['host.docker.internal', 'localhost', 'ollama']
    },
    ...overrides
  };
}

function providerResponse(
  config: AdminProviderConfiguration = providerConfig()
): AdminProviderConfigurationResponse {
  return { config };
}

function adminApi(overrides: Partial<AdminApiClient> = {}): AdminApiClient {
  return {
    getBootstrapStatus: vi.fn(),
    setupBootstrap: vi.fn(),
    login: vi.fn(),
    current: vi.fn(),
    enrollMfa: vi.fn(),
    verifyMfa: vi.fn(),
    challengeMfa: vi.fn(),
    stepUp: vi.fn(async () => ({
      user: activeUser,
      session: activeSession,
      stepUp: {
        fresh: true,
        expiresAt: '2026-07-06T16:13:00.000Z'
      }
    })),
    logout: vi.fn(),
    getProviderConfig: vi.fn(async () => providerResponse()),
    saveProviderConfig: vi.fn(async () => providerResponse()),
    saveProviderSecret: vi.fn(async ({ name }) => ({
      secret: secret(name)
    })),
    validateProviderConfig: vi.fn(async () => ({
      validation: {
        status: 'valid',
        restartRequired: false,
        reembedRequired: false,
        connectionTests: {
          EXTRACTION_BASE_URL: {
            status: 'valid',
            message: 'Connection check passed',
            metadata: {}
          }
        },
        runtime: {
          constructible: true,
          errors: []
        },
        embedding: {
          current: null,
          target: null
        }
      }
    })),
    applyProviderConfig: vi.fn(async () => ({
      result: {
        applied: true,
        restartRequired: true,
        reembedRequired: false,
        reload: {
          extraction: 'restart_required',
          embedding: 'unchanged'
        },
        appliedSettings: ['EXTRACTION_MODEL']
      }
    })),
    ...overrides
  } as AdminApiClient;
}

beforeEach(() => {
  installTrackedStorage('localStorage');
  installTrackedStorage('sessionStorage');
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AdminConfig', () => {
  it('delegates expired admin sessions during config load to the parent shell', async () => {
    const expiredSession = new AdminApiError(401, 'Invalid admin session');
    const onSessionExpired = vi.fn(() => true);
    const api = adminApi({
      getProviderConfig: vi.fn(async () => {
        throw expiredSession;
      })
    });

    render(<AdminConfig api={api} onSessionExpired={onSessionExpired} />);

    await waitFor(() => {
      expect(onSessionExpired).toHaveBeenCalledWith(expiredSession);
    });
    expect(
      screen.queryByText('Unable to load provider configuration')
    ).not.toBeInTheDocument();
  });

  it('delegates expired admin sessions during provider actions to the parent shell', async () => {
    const user = userEvent.setup();
    const expiredSession = new AdminApiError(401, 'Invalid admin session');
    const freshStepUp = new Date(Date.now() + 60_000).toISOString();
    const onSessionExpired = vi.fn(() => true);
    const api = adminApi({
      validateProviderConfig: vi.fn(async () => {
        throw expiredSession;
      })
    });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: freshStepUp }}
        onSessionExpired={onSessionExpired}
      />
    );

    await screen.findByRole('heading', { name: 'Provider configuration' });
    await user.click(
      screen.getByRole('button', { name: 'Validate and test connections' })
    );

    await waitFor(() => {
      expect(onSessionExpired).toHaveBeenCalledWith(expiredSession);
    });
    expect(
      screen.queryByText('Unable to validate provider configuration')
    ).not.toBeInTheDocument();
  });

  it('keeps provider secret inputs write-only and renders only redacted secret metadata', async () => {
    const localWrites = vi.spyOn(localStorage, 'setItem');
    const sessionWrites = vi.spyOn(sessionStorage, 'setItem');
    const unsafeValue = 'sk-live-secret-that-must-not-render';
    const api = adminApi({
      getProviderConfig: vi.fn(async () =>
        providerResponse(
          providerConfig({
            secrets: {
              OPENAI_API_KEY: {
                ...secret('OPENAI_API_KEY'),
                plaintext: unsafeValue,
                ciphertext: 'ciphertext-must-not-render',
                tokenPrefix: 'sk-live-prefix',
                validation: {
                  status: 'valid',
                  message: null,
                  metadata: {
                    authorization: 'Bearer leaked-provider-token'
                  },
                  validatedAt: '2026-07-06T16:00:00.000Z'
                }
              } as AdminRuntimeSecretMetadata,
              ANTHROPIC_API_KEY: null,
              OLLAMA_API_KEY: null,
              EXTRACTION_API_KEY: null,
              EMBEDDING_API_KEY: null
            }
          })
        )
      )
    });

    render(<AdminConfig api={api} />);

    expect(
      await screen.findByRole('heading', { name: 'Provider configuration' })
    ).toBeInTheDocument();
    expect(screen.getByText('Pending provider settings')).toBeInTheDocument();
    expect(screen.getByText('Applied provider settings')).toBeInTheDocument();

    const secretInput = screen.getByLabelText(
      'OPENAI_API_KEY replacement'
    ) as HTMLInputElement;
    expect(secretInput).toHaveAttribute('type', 'password');
    expect(secretInput.value).toBe('');
    expect(screen.getByText('OPENAI_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('provider')).toBeInTheDocument();
    expect(screen.getByText('valid')).toBeInTheDocument();

    expect(screen.queryByText(unsafeValue)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/ciphertext-must-not-render/u)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-live-prefix/u)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Bearer leaked-provider-token/u)
    ).not.toBeInTheDocument();
    expectStorageNotToContain(
      localStorage,
      localWrites,
      unsafeValue,
      'ciphertext-must-not-render'
    );
    expectStorageNotToContain(
      sessionStorage,
      sessionWrites,
      unsafeValue,
      'ciphertext-must-not-render'
    );
  });

  it('updates a provider secret through step-up, then clears the write-only field without browser persistence', async () => {
    const user = userEvent.setup();
    const localWrites = vi.spyOn(localStorage, 'setItem');
    const sessionWrites = vi.spyOn(sessionStorage, 'setItem');
    const api = adminApi();
    const plaintext = 'sk-provider-secret-written-once';

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: false, expiresAt: null }}
      />
    );

    const stepUpInput = await screen.findByLabelText('Step-up code');
    await user.type(stepUpInput, '123456');
    await user.type(
      screen.getByLabelText('OPENAI_API_KEY replacement'),
      plaintext
    );
    await user.click(
      screen.getByRole('button', { name: 'Save OPENAI_API_KEY secret' })
    );

    await waitFor(() => {
      expect(api.stepUp).toHaveBeenCalledWith({ code: '123456' });
      expect(api.saveProviderSecret).toHaveBeenCalledWith({
        name: 'OPENAI_API_KEY',
        plaintext
      });
    });
    expect(
      (screen.getByLabelText('OPENAI_API_KEY replacement') as HTMLInputElement)
        .value
    ).toBe('');
    expectStorageNotToContain(localStorage, localWrites, plaintext);
    expectStorageNotToContain(sessionStorage, sessionWrites, plaintext);
  });

  it('surfaces validation feedback and restart or re-embedding impact before apply', async () => {
    const user = userEvent.setup();
    const config = providerConfig({
      restartRequired: true,
      reembedRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'claude-3-5-haiku', {
          state: 'pending',
          restartRequired: true,
          appliedAt: null
        }),
        EMBEDDING_DIMENSIONS: setting('EMBEDDING_DIMENSIONS', 3072, {
          state: 'pending',
          restartRequired: true,
          reembedRequired: true,
          appliedAt: null,
          validation: {
            status: 'unvalidated',
            message: 'Embedding dimensions changed',
            metadata: {},
            validatedAt: null
          }
        })
      }
    });
    const api = adminApi({
      getProviderConfig: vi.fn(async () => providerResponse(config)),
      validateProviderConfig: vi.fn(async () => ({
        validation: {
          status: 'requires_reembedding' as const,
          restartRequired: true,
          reembedRequired: true,
          connectionTests: {
            EMBEDDING_BASE_URL: {
              status: 'invalid' as const,
              message: 'Provider URL is blocked by egress policy',
              metadata: {
                authorization: 'Bearer must-not-render'
              }
            }
          },
          runtime: {
            constructible: false,
            errors: [
              {
                field: 'EMBEDDING_DIMENSIONS',
                message: 'Embedding dimensions require the migration flow'
              }
            ]
          },
          embedding: {
            current: {
              provider: 'openai',
              model: 'text-embedding-3-small',
              dimensions: 1536
            },
            target: {
              provider: 'openai',
              model: 'text-embedding-3-large',
              dimensions: 3072
            }
          }
        }
      }))
    });

    render(<AdminConfig api={api} />);

    expect(await screen.findByText('Restart required')).toBeInTheDocument();
    expect(screen.getByText('Re-embedding required')).toBeInTheDocument();
    expect(screen.getByText('EXTRACTION_MODEL')).toBeInTheDocument();
    expect(screen.getByText('EMBEDDING_DIMENSIONS')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Applied')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Step-up code'), '123456');
    await user.click(
      screen.getByRole('button', { name: 'Validate and test connections' })
    );

    expect(
      await screen.findByText('Provider URL is blocked by egress policy')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Embedding dimensions require the migration flow')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Bearer must-not-render/u)
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Apply provider configuration' })
    ).toBeDisabled();
  });

  it('saves only changed provider settings so unchanged embedding identity is not resubmitted', async () => {
    const user = userEvent.setup();
    const api = adminApi();

    render(<AdminConfig api={api} />);

    const modelInput = await screen.findByLabelText('Extraction model');
    await user.clear(modelInput);
    await user.type(modelInput, 'gpt-4.1');
    await user.click(
      screen.getByRole('button', { name: 'Save pending settings' })
    );

    await waitFor(() => {
      expect(api.saveProviderConfig).toHaveBeenCalledWith({
        settings: {
          EXTRACTION_MODEL: 'gpt-4.1'
        }
      });
    });
  });

  it('blocks apply while visible provider settings have unsaved draft edits', async () => {
    const user = userEvent.setup();
    const pendingConfig = providerConfig({
      restartRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1', {
          state: 'pending',
          restartRequired: true,
          appliedAt: null
        })
      }
    });
    const api = adminApi({
      getProviderConfig: vi.fn(async () => providerResponse(pendingConfig))
    });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    const modelInput = await screen.findByLabelText('Extraction model');
    await user.clear(modelInput);
    await user.type(modelInput, 'draft-only-model');

    expect(
      screen.getByText(
        'Save or discard draft changes before validating or applying.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Apply provider configuration' })
    ).toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: 'Discard draft changes' })
    );

    expect(
      (screen.getByLabelText('Extraction model') as HTMLInputElement).value
    ).toBe('gpt-4.1');
    expect(
      screen.queryByText(
        'Save or discard draft changes before validating or applying.'
      )
    ).not.toBeInTheDocument();
  });

  it('blocks apply until relevant provider URL connection validation passes', async () => {
    const user = userEvent.setup();
    let resolveValidatedConfig!: (
      value: AdminProviderConfigurationResponse
    ) => void;
    const pendingConfig = providerConfig({
      restartRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_PROVIDER: setting(
          'EXTRACTION_PROVIDER',
          'openai-compatible'
        ),
        EXTRACTION_BASE_URL: setting(
          'EXTRACTION_BASE_URL',
          'https://compatible.example.test/v1',
          {
            state: 'pending',
            appliedAt: null,
            validation: {
              status: 'unvalidated',
              message: 'Run connection validation before apply',
              metadata: {},
              validatedAt: null
            }
          }
        )
      }
    });
    const validatedConfig = providerConfig({
      restartRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_PROVIDER: setting(
          'EXTRACTION_PROVIDER',
          'openai-compatible'
        ),
        EXTRACTION_BASE_URL: setting(
          'EXTRACTION_BASE_URL',
          'https://compatible.example.test/v1',
          {
            state: 'pending',
            appliedAt: null,
            validation: {
              status: 'valid',
              message: 'Provider connection validated',
              metadata: {
                provider: 'openai-compatible',
                egressPolicy: 'provider-base-url-v1',
                connectionTest: true,
                connectionNormalizedUrl: 'https://compatible.example.test/v1',
                connectionSecretNames: ['EXTRACTION_API_KEY'],
                connectionSecretRevisions: {
                  EXTRACTION_API_KEY: null
                },
                connectionStatus: 200
              },
              validatedAt: '2026-07-06T16:45:00.000Z'
            }
          }
        )
      }
    });
    const appliedConfig = providerConfig({
      restartRequired: false,
      settings: {
        ...validatedConfig.settings,
        EXTRACTION_BASE_URL: setting(
          'EXTRACTION_BASE_URL',
          'https://compatible.example.test/v1',
          {
            state: 'applied',
            appliedAt: '2026-07-06T16:50:00.000Z',
            validation: validatedConfig.settings.EXTRACTION_BASE_URL.validation
          }
        )
      }
    });
    const getProviderConfig = vi
      .fn()
      .mockResolvedValueOnce(providerResponse(pendingConfig))
      .mockImplementationOnce(
        () =>
          new Promise<AdminProviderConfigurationResponse>((resolve) => {
            resolveValidatedConfig = resolve;
          })
      )
      .mockResolvedValueOnce(providerResponse(appliedConfig));
    const api = adminApi({
      getProviderConfig,
      validateProviderConfig: vi.fn(async () => ({
        validation: {
          status: 'valid' as const,
          restartRequired: true,
          reembedRequired: false,
          connectionTests: {
            EXTRACTION_BASE_URL: {
              status: 'valid' as const,
              message: 'Provider connection validated',
              metadata: {
                egressPolicy: 'provider-base-url-v1',
                status: 200
              }
            }
          },
          runtime: {
            constructible: true,
            errors: []
          },
          embedding: {
            current: null,
            target: null
          }
        }
      }))
    });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    const applyButton = await screen.findByRole('button', {
      name: 'Apply provider configuration'
    });
    expect(applyButton).toBeDisabled();
    expect(
      screen.getByText('Run connection validation before applying.')
    ).toBeInTheDocument();
    expect(screen.getAllByText('EXTRACTION_BASE_URL').length).toBeGreaterThan(
      0
    );

    await user.click(
      screen.getByRole('button', { name: 'Validate and test connections' })
    );

    await waitFor(() => {
      expect(api.validateProviderConfig).toHaveBeenCalledWith({
        testConnections: true
      });
      expect(getProviderConfig).toHaveBeenCalledTimes(2);
      expect(applyButton).toBeDisabled();
    });

    resolveValidatedConfig(providerResponse(validatedConfig));
    await waitFor(() => {
      expect(applyButton).toBeEnabled();
    });

    await user.click(applyButton);
    await waitFor(() => {
      expect(api.applyProviderConfig).toHaveBeenCalled();
    });
  });

  it('blocks apply after provider validation reports runtime errors', async () => {
    const user = userEvent.setup();
    const pendingConfig = providerConfig({
      restartRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'claude-3-5-haiku', {
          state: 'pending',
          restartRequired: true,
          appliedAt: null
        })
      }
    });
    const api = adminApi({
      getProviderConfig: vi.fn(async () => providerResponse(pendingConfig)),
      validateProviderConfig: vi.fn(async () => ({
        validation: {
          status: 'invalid' as const,
          restartRequired: true,
          reembedRequired: false,
          connectionTests: {},
          runtime: {
            constructible: false,
            errors: [
              {
                field: 'ANTHROPIC_API_KEY',
                message: 'ANTHROPIC_API_KEY is required'
              }
            ]
          },
          embedding: {
            current: null,
            target: null
          }
        }
      }))
    });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    const applyButton = await screen.findByRole('button', {
      name: 'Apply provider configuration'
    });
    expect(applyButton).toBeEnabled();

    await user.click(
      screen.getByRole('button', { name: 'Validate and test connections' })
    );

    expect(
      await screen.findByText('Resolve validation errors before applying.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('ANTHROPIC_API_KEY is required')
    ).toBeInTheDocument();
    expect(applyButton).toBeDisabled();

    await user.click(applyButton);
    expect(api.applyProviderConfig).not.toHaveBeenCalled();
  });

  it('blocks connection validation while visible provider settings have unsaved draft edits', async () => {
    const user = userEvent.setup();
    const api = adminApi();

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    const baseUrlInput = await screen.findByLabelText('Extraction base URL');
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, 'https://draft.example.test/v1');

    expect(
      screen.getByRole('button', { name: 'Validate and test connections' })
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Validate and test connections' })
    );
    expect(api.validateProviderConfig).not.toHaveBeenCalled();
  });

  it('requires explicit migration acknowledgement before saving embedding dimension edits', async () => {
    const user = userEvent.setup();
    const api = adminApi();

    render(<AdminConfig api={api} />);

    const dimensionsInput = await screen.findByLabelText(
      'Embedding dimensions'
    );
    await user.clear(dimensionsInput);
    await user.type(dimensionsInput, '3072');

    expect(screen.getAllByText('Migration-class setting')).toHaveLength(3);
    await user.click(
      screen.getByRole('button', { name: 'Save pending settings' })
    );

    expect(
      await screen.findByText(
        'Confirm embedding migration impact before saving migration-class settings.'
      )
    ).toBeInTheDocument();
    expect(api.saveProviderConfig).not.toHaveBeenCalled();

    await user.click(
      screen.getByLabelText(
        'I understand embedding changes require migration before apply'
      )
    );
    await user.click(
      screen.getByRole('button', { name: 'Save pending settings' })
    );

    await waitFor(() => {
      expect(api.saveProviderConfig).toHaveBeenCalledWith({
        settings: {
          EMBEDDING_DIMENSIONS: 3072
        }
      });
    });
  });

  it('uses step-up before connection tests when the current step-up is stale', async () => {
    const user = userEvent.setup();
    const api = adminApi();

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: false, expiresAt: null }}
      />
    );

    await user.type(await screen.findByLabelText('Step-up code'), '123456');
    await user.click(
      screen.getByRole('button', { name: 'Validate and test connections' })
    );

    await waitFor(() => {
      expect(api.stepUp).toHaveBeenCalledWith({ code: '123456' });
      expect(api.validateProviderConfig).toHaveBeenCalledWith({
        testConnections: true
      });
    });
  });

  it('treats expired step-up state as stale before a secret write', async () => {
    const user = userEvent.setup();
    const api = adminApi();

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2000-01-01T00:00:00.000Z' }}
      />
    );

    await user.type(await screen.findByLabelText('Step-up code'), '123456');
    await user.type(
      screen.getByLabelText('OPENAI_API_KEY replacement'),
      'sk-rotated-after-expiry'
    );
    await user.click(
      screen.getByRole('button', { name: 'Save OPENAI_API_KEY secret' })
    );

    await waitFor(() => {
      expect(api.stepUp).toHaveBeenCalledWith({ code: '123456' });
      expect(api.saveProviderSecret).toHaveBeenCalledWith({
        name: 'OPENAI_API_KEY',
        plaintext: 'sk-rotated-after-expiry'
      });
    });
  });

  it('updates the visible step-up status when the fresh marker expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T16:12:59.000Z'));
    const api = adminApi();

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2026-07-06T16:13:00.000Z' }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Step-up fresh')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Fresh step-up active')
    ).toBeInTheDocument();

    act(() => {
      vi.setSystemTime(new Date('2026-07-06T16:13:00.100Z'));
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByText('Step-up required')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Required before secret writes or apply')
    ).toBeInTheDocument();
  });

  it('refreshes provider state after apply succeeds', async () => {
    const user = userEvent.setup();
    const pendingConfig = providerConfig({
      restartRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1', {
          state: 'pending',
          restartRequired: true,
          appliedAt: null
        })
      }
    });
    const appliedConfig = providerConfig({
      restartRequired: false,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1', {
          state: 'applied',
          restartRequired: false,
          appliedAt: '2026-07-06T16:30:00.000Z'
        })
      }
    });
    const getProviderConfig = vi
      .fn()
      .mockResolvedValueOnce(providerResponse(pendingConfig))
      .mockResolvedValueOnce(providerResponse(appliedConfig));
    const api = adminApi({ getProviderConfig });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    expect(await screen.findByText('1 pending')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Apply provider configuration' })
    );

    await waitFor(() => {
      expect(api.applyProviderConfig).toHaveBeenCalled();
      expect(getProviderConfig).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('0 pending')).toBeInTheDocument();
  });

  it('reports successful apply separately when the follow-up provider refresh fails', async () => {
    const user = userEvent.setup();
    const pendingConfig = providerConfig({
      restartRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1', {
          state: 'pending',
          restartRequired: true,
          appliedAt: null
        })
      }
    });
    const getProviderConfig = vi
      .fn()
      .mockResolvedValueOnce(providerResponse(pendingConfig))
      .mockRejectedValueOnce(
        new Error('Provider refresh unavailable after apply')
      );
    const api = adminApi({ getProviderConfig });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    expect(await screen.findByText('1 pending')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Apply provider configuration' })
    );

    expect(
      await screen.findByText(
        /Provider configuration apply completed, but provider state could not be refreshed/u
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Provider refresh unavailable after apply/u)
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Unable to apply provider configuration')
    ).not.toBeInTheDocument();
    expect(screen.getByText('restart_required')).toBeInTheDocument();
  });

  it('disables secret saves while another sensitive provider action is running', async () => {
    const user = userEvent.setup();
    let resolveValidation!: (
      value: Awaited<ReturnType<AdminApiClient['validateProviderConfig']>>
    ) => void;
    const validateProviderConfig = vi.fn(
      () =>
        new Promise<
          Awaited<ReturnType<AdminApiClient['validateProviderConfig']>>
        >((resolve) => {
          resolveValidation = resolve;
        })
    );
    const api = adminApi({ validateProviderConfig });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    await user.type(
      await screen.findByLabelText('OPENAI_API_KEY replacement'),
      'sk-openai-pending'
    );
    await user.type(
      screen.getByLabelText('ANTHROPIC_API_KEY replacement'),
      'sk-anthropic-pending'
    );
    await user.click(
      screen.getByRole('button', { name: 'Validate and test connections' })
    );

    await waitFor(() => {
      expect(validateProviderConfig).toHaveBeenCalledWith({
        testConnections: true
      });
    });
    expect(
      screen.getByRole('button', { name: 'Save OPENAI_API_KEY secret' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Save ANTHROPIC_API_KEY secret' })
    ).toBeDisabled();

    resolveValidation({
      validation: {
        status: 'valid',
        restartRequired: false,
        reembedRequired: false,
        connectionTests: {},
        runtime: {
          constructible: true,
          errors: []
        },
        embedding: {
          current: null,
          target: null
        }
      }
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Save OPENAI_API_KEY secret' })
      ).toBeEnabled();
    });
  });

  it('locks provider setting drafts while a secret write refresh is in flight', async () => {
    const user = userEvent.setup();
    let resolveSecret!: (
      value: Awaited<ReturnType<AdminApiClient['saveProviderSecret']>>
    ) => void;
    let resolveRefresh!: (value: AdminProviderConfigurationResponse) => void;
    const getProviderConfig = vi
      .fn()
      .mockResolvedValueOnce(providerResponse())
      .mockImplementationOnce(
        () =>
          new Promise<AdminProviderConfigurationResponse>((resolve) => {
            resolveRefresh = resolve;
          })
      );
    const saveProviderSecret = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<AdminApiClient['saveProviderSecret']>>>(
          (resolve) => {
            resolveSecret = resolve;
          }
        )
    );
    const api = adminApi({ getProviderConfig, saveProviderSecret });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    await user.type(
      await screen.findByLabelText('OPENAI_API_KEY replacement'),
      'sk-openai-pending'
    );
    await user.click(
      screen.getByRole('button', { name: 'Save OPENAI_API_KEY secret' })
    );

    await waitFor(() => {
      expect(saveProviderSecret).toHaveBeenCalledWith({
        name: 'OPENAI_API_KEY',
        plaintext: 'sk-openai-pending'
      });
    });

    const extractionEnabled = screen.getByLabelText('Extraction enabled');
    const extractionModel = screen.getByLabelText('Extraction model');
    expect(extractionEnabled).toBeDisabled();
    expect(extractionModel).toBeDisabled();

    resolveSecret({ secret: secret('OPENAI_API_KEY') });
    await waitFor(() => {
      expect(getProviderConfig).toHaveBeenCalledTimes(2);
    });
    expect(extractionEnabled).toBeDisabled();
    expect(extractionModel).toBeDisabled();

    resolveRefresh(providerResponse());
    await waitFor(() => {
      expect(extractionEnabled).toBeEnabled();
      expect(extractionModel).toBeEnabled();
    });
  });

  it('refreshes provider state after secret writes instead of forcing restart warnings locally', async () => {
    const user = userEvent.setup();
    const getProviderConfig = vi.fn(async () =>
      providerResponse(providerConfig({ restartRequired: false }))
    );
    const api = adminApi({ getProviderConfig });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    await user.type(
      await screen.findByLabelText('ANTHROPIC_API_KEY replacement'),
      'sk-anthropic-unused'
    );
    await user.click(
      screen.getByRole('button', { name: 'Save ANTHROPIC_API_KEY secret' })
    );

    await waitFor(() => {
      expect(api.saveProviderSecret).toHaveBeenCalledWith({
        name: 'ANTHROPIC_API_KEY',
        plaintext: 'sk-anthropic-unused'
      });
      expect(getProviderConfig).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText('Restart required')).not.toBeInTheDocument();
  });

  it('clears stale apply results after a provider secret is rotated', async () => {
    const user = userEvent.setup();
    const pendingConfig = providerConfig({
      restartRequired: true,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1', {
          state: 'pending',
          restartRequired: true,
          appliedAt: null
        })
      }
    });
    const appliedConfig = providerConfig({
      restartRequired: false,
      settings: {
        ...providerConfig().settings,
        EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1', {
          state: 'applied',
          restartRequired: false,
          appliedAt: '2026-07-06T16:30:00.000Z'
        })
      }
    });
    const getProviderConfig = vi
      .fn()
      .mockResolvedValueOnce(providerResponse(pendingConfig))
      .mockResolvedValueOnce(providerResponse(appliedConfig))
      .mockResolvedValueOnce(providerResponse(appliedConfig));
    const api = adminApi({ getProviderConfig });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    expect(await screen.findByText('1 pending')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Apply provider configuration' })
    );

    expect(await screen.findByText('Extraction reload')).toBeInTheDocument();
    expect(screen.getByText('restart_required')).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('OPENAI_API_KEY replacement'),
      'sk-rotated-after-apply'
    );
    await user.click(
      screen.getByRole('button', { name: 'Save OPENAI_API_KEY secret' })
    );

    await waitFor(() => {
      expect(api.saveProviderSecret).toHaveBeenCalledWith({
        name: 'OPENAI_API_KEY',
        plaintext: 'sk-rotated-after-apply'
      });
      expect(getProviderConfig).toHaveBeenCalledTimes(3);
    });
    expect(screen.queryByText('Extraction reload')).not.toBeInTheDocument();
    expect(screen.queryByText('restart_required')).not.toBeInTheDocument();
  });

  it('clears a saved secret draft even when the follow-up provider refresh fails', async () => {
    const user = userEvent.setup();
    const getProviderConfig = vi
      .fn()
      .mockResolvedValueOnce(providerResponse())
      .mockRejectedValueOnce(new Error('Provider refresh unavailable'));
    const api = adminApi({ getProviderConfig });

    render(
      <AdminConfig
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    const secretInput = (await screen.findByLabelText(
      'OPENAI_API_KEY replacement'
    )) as HTMLInputElement;
    await user.type(secretInput, 'sk-saved-before-refresh-failure');
    await user.click(
      screen.getByRole('button', { name: 'Save OPENAI_API_KEY secret' })
    );

    await waitFor(() => {
      expect(api.saveProviderSecret).toHaveBeenCalledWith({
        name: 'OPENAI_API_KEY',
        plaintext: 'sk-saved-before-refresh-failure'
      });
      expect(getProviderConfig).toHaveBeenCalledTimes(2);
      expect(secretInput.value).toBe('');
    });
    expect(
      screen.getByText('Provider refresh unavailable')
    ).toBeInTheDocument();
  });
});

describe('createAdminApiClient provider configuration methods', () => {
  it('uses the existing cookie and CSRF admin client for step-up, secret writes, validation, and apply', async () => {
    const fetchMock = mockFetch([
      {
        path: '/admin/api/session/csrf',
        body: { csrfToken: 'csrf-before-step-up' }
      },
      {
        path: '/admin/api/session/step-up',
        method: 'POST',
        body: {
          user: activeUser,
          session: activeSession,
          csrfToken: 'csrf-after-step-up',
          stepUp: {
            fresh: true,
            expiresAt: '2026-07-06T16:13:00.000Z'
          }
        },
        assert: (init) => {
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-before-step-up'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
          expect(JSON.parse(String(init.body))).toEqual({ code: '123456' });
        }
      },
      {
        path: '/admin/api/provider-config/secrets',
        method: 'PUT',
        body: { secret: secret('OPENAI_API_KEY') },
        assert: (init) => {
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-after-step-up'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
          expect(JSON.parse(String(init.body))).toEqual({
            name: 'OPENAI_API_KEY',
            plaintext: 'sk-written-once'
          });
        }
      },
      {
        path: '/admin/api/provider-config/validate',
        method: 'POST',
        body: {
          validation: {
            status: 'valid',
            restartRequired: false,
            reembedRequired: false,
            connectionTests: {},
            runtime: { constructible: true, errors: [] },
            embedding: { current: null, target: null }
          }
        },
        assert: (init) => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-after-step-up'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
          expect(JSON.parse(String(init.body))).toEqual({
            testConnections: true
          });
        }
      },
      {
        path: '/admin/api/provider-config/apply',
        method: 'POST',
        body: {
          result: {
            applied: true,
            restartRequired: true,
            reembedRequired: false,
            reload: {
              extraction: 'restart_required',
              embedding: 'unchanged'
            },
            appliedSettings: ['EXTRACTION_MODEL']
          }
        },
        assert: (init) => {
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-after-step-up'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
          expect(JSON.parse(String(init.body))).toEqual({});
        }
      }
    ]);
    const api = createAdminApiClient();

    await api.stepUp({ code: '123456' });
    await api.saveProviderSecret({
      name: 'OPENAI_API_KEY',
      plaintext: 'sk-written-once'
    });
    await api.validateProviderConfig({ testConnections: true });
    await api.applyProviderConfig();

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
