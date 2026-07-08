import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminOnboarding from './admin/AdminOnboarding.tsx';
import type {
  AdminApiClient,
  AdminOnboardingState
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
    getProviderConfig: vi.fn(),
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
    expect(screen.getAllByText('Provider configuration').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/choose where embeddings and extraction run/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Config' }));
    expect(onOpenPanel).toHaveBeenCalledWith('provider-config');

    await user.click(
      screen.getByRole('button', {
        name: 'Mark provider configuration done'
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
