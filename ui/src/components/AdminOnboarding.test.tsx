import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminOnboarding from './admin/AdminOnboarding.tsx';
import type {
  AdminApiClient,
  AdminOnboardingState,
  AdminProviderConfiguration,
  AdminRuntimeSecretMetadata,
  AdminRuntimeSettingSnapshot
} from '../lib/adminApi.ts';

const providerConfigState: AdminOnboardingState = {
  status: 'in_progress',
  currentStep: 'provider_config',
  completedSteps: ['setup'],
  skippedAt: null,
  completedAt: null,
  updatedByAdminUserId: 'admin-user-1',
  createdAt: '2026-07-08T08:00:00.000Z',
  updatedAt: '2026-07-08T08:10:00.000Z'
};

const secretNames = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OLLAMA_API_KEY',
  'EXTRACTION_API_KEY',
  'EMBEDDING_API_KEY'
] as const;

function setting(
  key: keyof AdminProviderConfiguration['settings'],
  value: AdminRuntimeSettingSnapshot['value']
): AdminRuntimeSettingSnapshot {
  return {
    key,
    value,
    source: value === undefined ? 'unset' : 'database',
    classification: key.startsWith('EMBEDDING_')
      ? 'dangerous_migration'
      : 'restart_required',
    state: 'applied',
    validation: {
      status: 'valid',
      message: null,
      metadata: {},
      validatedAt: '2026-07-08T08:00:00.000Z'
    },
    restartRequired: false,
    reembedRequired: false,
    appliedAt: '2026-07-08T08:00:00.000Z',
    updatedByAdminUserId: 'admin-user-1',
    updatedAt: '2026-07-08T08:00:00.000Z'
  };
}

function providerConfig(
  overrides: Partial<AdminProviderConfiguration> = {}
): AdminProviderConfiguration {
  return {
    settings: {
      EXTRACTION_ENABLED: setting('EXTRACTION_ENABLED', false),
      EXTRACTION_PROVIDER: setting('EXTRACTION_PROVIDER', 'openai'),
      EXTRACTION_MODEL: setting('EXTRACTION_MODEL', 'gpt-4.1-mini'),
      EXTRACTION_BASE_URL: setting('EXTRACTION_BASE_URL', undefined),
      OLLAMA_BASE_URL: setting('OLLAMA_BASE_URL', 'http://localhost:11434'),
      EMBEDDING_PROVIDER: setting('EMBEDDING_PROVIDER', 'openai'),
      EMBEDDING_MODEL: setting('EMBEDDING_MODEL', 'text-embedding-3-small'),
      EMBEDDING_DIMENSIONS: setting('EMBEDDING_DIMENSIONS', 1536),
      EMBEDDING_BASE_URL: setting('EMBEDDING_BASE_URL', undefined)
    },
    secrets: Object.fromEntries(secretNames.map((name) => [name, null])) as Record<
      (typeof secretNames)[number],
      AdminRuntimeSecretMetadata | null
    >,
    envSecrets: Object.fromEntries(
      secretNames.map((name) => [name, false])
    ) as Record<(typeof secretNames)[number], boolean>,
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

function adminApi(overrides: Partial<AdminApiClient> = {}): AdminApiClient {
  return {
    getBootstrapStatus: vi.fn(),
    setupBootstrap: vi.fn(),
    login: vi.fn(),
    current: vi.fn(),
    enrollMfa: vi.fn(),
    verifyMfa: vi.fn(),
    challengeMfa: vi.fn(),
    stepUp: vi.fn(),
    logout: vi.fn(),
    getOnboarding: vi.fn(async () => ({ onboarding: providerConfigState })),
    updateOnboarding: vi.fn(async (input) => ({
      onboarding: {
        ...providerConfigState,
        currentStep: input.currentStep ?? providerConfigState.currentStep,
        completedSteps:
          input.completedSteps ?? providerConfigState.completedSteps
      }
    })),
    skipOnboarding: vi.fn(async () => ({
      onboarding: {
        ...providerConfigState,
        status: 'skipped',
        skippedAt: '2026-07-08T08:20:00.000Z'
      }
    })),
    completeOnboarding: vi.fn(async () => ({
      onboarding: {
        ...providerConfigState,
        status: 'completed',
        currentStep: 'maintenance',
        completedSteps: [
          'setup',
          'provider_config',
          'secrets',
          'validate_apply',
          'backup_restore',
          'maintenance'
        ],
        completedAt: '2026-07-08T08:30:00.000Z'
      }
    })),
    getHealth: vi.fn(),
    getQueueStatus: vi.fn(),
    listModels: vi.fn(),
    getConfigStatus: vi.fn(),
    getStats: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    getAudit: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    dryRunReextractMaintenance: vi.fn(),
    applyReextractMaintenance: vi.fn(),
    dryRunReembedMaintenance: vi.fn(),
    applyReembedMaintenance: vi.fn(),
    dryRunPruneEdgesMaintenance: vi.fn(),
    applyPruneEdgesMaintenance: vi.fn(),
    getProviderConfig: vi.fn(async () => ({ config: providerConfig() })),
    saveProviderConfig: vi.fn(),
    saveProviderSecret: vi.fn(),
    validateProviderConfig: vi.fn(),
    applyProviderConfig: vi.fn(),
    downloadBackup: vi.fn(),
    validateBackupRestore: vi.fn(),
    stageBackupRestore: vi.fn(),
    ...overrides
  } as AdminApiClient;
}

describe('AdminOnboarding', () => {
  it('resumes the persisted step and opens the related dashboard panel', async () => {
    const user = userEvent.setup();
    const api = adminApi();
    const onStateChange = vi.fn();
    const onOpenPanel = vi.fn();

    render(
      <AdminOnboarding
        api={api}
        onboarding={providerConfigState}
        onOpenPanel={onOpenPanel}
        onSessionExpired={() => false}
        onStateChange={onStateChange}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Admin onboarding' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Step 2 of 6').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider settings').length).toBeGreaterThan(0);
    expect(await screen.findByText('Embedding settings')).toBeInTheDocument();
    expect(screen.getByText(/Set embeddings first/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open full Config' }));
    expect(onOpenPanel).toHaveBeenCalledWith('provider-config');

    await user.click(
      screen.getByRole('button', {
        name: 'Save provider settings and continue'
      })
    );

    expect(api.updateOnboarding).toHaveBeenCalledWith({
      currentStep: 'secrets',
      completedSteps: ['setup', 'provider_config']
    });
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        currentStep: 'secrets',
        completedSteps: ['setup', 'provider_config']
      })
    );
  });

  it('saves real embedding and extraction settings from the wizard', async () => {
    const user = userEvent.setup();
    const api = adminApi({
      getProviderConfig: vi.fn(async () => ({ config: providerConfig() })),
      saveProviderConfig: vi.fn(async () => ({ config: providerConfig() }))
    });
    const onStateChange = vi.fn();

    render(
      <AdminOnboarding
        api={api}
        onboarding={providerConfigState}
        onOpenPanel={vi.fn()}
        onSessionExpired={() => false}
        onStateChange={onStateChange}
      />
    );

    expect(await screen.findByText('Embedding settings')).toBeInTheDocument();
    expect(screen.getByText('Extraction settings')).toBeInTheDocument();
    expect(
      screen.getByText(/http:\/\/host\.docker\.internal:11434/i)
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Embedding provider'), 'ollama');
    await user.clear(screen.getByLabelText('Embedding model'));
    await user.type(screen.getByLabelText('Embedding model'), 'bge-m3');
    await user.clear(screen.getByLabelText('Embedding dimensions'));
    await user.type(screen.getByLabelText('Embedding dimensions'), '1024');
    await user.click(screen.getByLabelText('Extraction enabled'));
    await user.selectOptions(screen.getByLabelText('Extraction provider'), 'ollama');
    await user.clear(screen.getByLabelText('Extraction model'));
    await user.type(screen.getByLabelText('Extraction model'), 'llama3.1');
    await user.click(
      screen.getByRole('button', {
        name: 'Save provider settings and continue'
      })
    );

    await waitFor(() => {
      expect(api.saveProviderConfig).toHaveBeenCalledWith({
        settings: {
          EMBEDDING_PROVIDER: 'ollama',
          EMBEDDING_MODEL: 'bge-m3',
          EMBEDDING_DIMENSIONS: 1024,
          EXTRACTION_ENABLED: true,
          EXTRACTION_PROVIDER: 'ollama',
          EXTRACTION_MODEL: 'llama3.1'
        }
      });
      expect(api.updateOnboarding).toHaveBeenCalledWith({
        currentStep: 'secrets',
        completedSteps: ['setup', 'provider_config']
      });
    });
  });

  it('shows env-backed secret notices during onboarding secrets', async () => {
    const api = adminApi({
      getProviderConfig: vi.fn(async () => ({
        config: providerConfig({
          envSecrets: {
            OPENAI_API_KEY: true,
            ANTHROPIC_API_KEY: false,
            OLLAMA_API_KEY: false,
            EXTRACTION_API_KEY: false,
            EMBEDDING_API_KEY: false
          }
        })
      }))
    });

    render(
      <AdminOnboarding
        api={api}
        onboarding={{
          ...providerConfigState,
          currentStep: 'secrets',
          completedSteps: ['setup', 'provider_config']
        }}
        onOpenPanel={vi.fn()}
        onSessionExpired={() => false}
        onStateChange={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/OPENAI_API_KEY is already available from environment/i)
    ).toBeInTheDocument();
  });

  it('renders provider secrets when env secret availability is absent', async () => {
    const { envSecrets: _envSecrets, ...configWithoutEnvSecrets } =
      providerConfig();
    const api = adminApi({
      getProviderConfig: vi.fn(async () => ({
        config: configWithoutEnvSecrets
      }))
    });

    render(
      <AdminOnboarding
        api={api}
        onboarding={{
          ...providerConfigState,
          currentStep: 'secrets',
          completedSteps: ['setup', 'provider_config']
        }}
        onOpenPanel={vi.fn()}
        onSessionExpired={() => false}
        onStateChange={vi.fn()}
      />
    );

    expect(
      await screen.findByRole('heading', { name: 'Provider secrets' })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('OPENAI_API_KEY replacement')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/already available from environment/i)
    ).not.toBeInTheDocument();
  });

  it('runs backend validation before advancing past validation', async () => {
    const user = userEvent.setup();
    const api = adminApi({
      getProviderConfig: vi.fn(async () => ({ config: providerConfig() })),
      validateProviderConfig: vi.fn(async () => ({
        validation: {
          status: 'valid' as const,
          restartRequired: false,
          reembedRequired: false,
          connectionTests: {},
          runtime: {
            constructible: true,
            errors: []
          },
          embedding: {
            current: null,
            target: {
              provider: 'openai',
              model: 'text-embedding-3-small',
              dimensions: 1536
            }
          }
        }
      }))
    });

    render(
      <AdminOnboarding
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
        onboarding={{
          ...providerConfigState,
          currentStep: 'validate_apply',
          completedSteps: ['setup', 'provider_config', 'secrets']
        }}
        onOpenPanel={vi.fn()}
        onSessionExpired={() => false}
        onStateChange={vi.fn()}
      />
    );

    await user.click(
      await screen.findByRole('button', { name: 'Validate configuration' })
    );

    await waitFor(() => {
      expect(api.validateProviderConfig).toHaveBeenCalledWith({
        testConnections: true
      });
    });
    expect(
      screen.getByText(/Provider configuration validated by the backend/i)
    ).toBeInTheDocument();
  });

  it('makes skipping deliberate and completing explicit', async () => {
    const user = userEvent.setup();
    const api = adminApi();
    const onStateChange = vi.fn();
    const maintenanceState: AdminOnboardingState = {
      ...providerConfigState,
      currentStep: 'maintenance',
      completedSteps: [
        'setup',
        'provider_config',
        'secrets',
        'validate_apply',
        'backup_restore'
      ]
    };
    const { rerender } = render(
      <AdminOnboarding
        api={api}
        onboarding={providerConfigState}
        onOpenPanel={vi.fn()}
        onSessionExpired={() => false}
        onStateChange={onStateChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Skip onboarding' }));
    expect(
      screen.getByText(/you can reopen onboarding from the dashboard/i)
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Skip onboarding anyway' })
    );

    expect(api.skipOnboarding).toHaveBeenCalledWith();
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped' })
    );

    rerender(
      <AdminOnboarding
        api={api}
        onboarding={maintenanceState}
        onOpenPanel={vi.fn()}
        onSessionExpired={() => false}
        onStateChange={onStateChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Finish onboarding' }));
    expect(api.completeOnboarding).toHaveBeenCalledWith();
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });
});
