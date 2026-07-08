import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminMaintenance from './admin/AdminMaintenance.tsx';
import AdminDashboard from './admin/AdminDashboard.tsx';
import {
  createAdminApiClient,
  type AdminApiClient,
  type AdminJob
} from '../lib/adminApi.ts';

type MockRoute = {
  path: string;
  method?: string;
  body: unknown;
  status?: number;
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
    return jsonResponse(route.body, route.status);
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

function adminJob(overrides: Partial<AdminJob> = {}): AdminJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    operation: 'maintenance.reextract',
    mode: 'dry_run',
    status: 'queued',
    idempotencyKey: null,
    requestedScope: { operation: 'reextract', scope: { kind: 'type', type: 'memory' } },
    requestSummary: { dryRun: true, destructive: false, llmCost: true },
    resultSummary: {},
    progress: {
      current: 0,
      total: null,
      message: null
    },
    createdByAdminUserId: activeUser.id,
    updatedByAdminUserId: null,
    startedAt: null,
    cancelRequestedAt: null,
    finishedAt: null,
    createdAt: '2026-07-06T16:00:00.000Z',
    updatedAt: '2026-07-06T16:00:00.000Z',
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
    stepUp: vi.fn(async () => ({
      user: activeUser,
      session: activeSession,
      stepUp: {
        fresh: true,
        expiresAt: '2026-07-06T17:05:00.000Z'
      }
    })),
    logout: vi.fn(),
    getHealth: vi.fn(async () => ({
      health: {
        status: 'ok',
        postgres: 'connected',
        embeddingModel: 'text-embedding-3-small'
      }
    })),
    getQueueStatus: vi.fn(async () => ({
      queue: {
        embedding: {
          pending: 0,
          completed: 1,
          failed: 0,
          retry_eligible: 0,
          oldest_pending_secs: null
        },
        extraction: {
          pending: 0,
          completed: 1,
          failed: 0,
          skipped: 0
        }
      }
    })),
    listModels: vi.fn(async () => ({
      models: [
        {
          id: 'model-active',
          name: 'text-embedding-3-small',
          provider: 'openai',
          dimensions: 1536,
          chunkSize: 300,
          chunkOverlap: 100,
          isActive: true,
          createdAt: '2026-07-06T12:00:00.000Z'
        }
      ]
    })),
    getConfigStatus: vi.fn(async () => ({
      configStatus: {
        settings: {
          total: 1,
          byState: { applied: 1, pending: 0 },
          byClassification: { restart_required: 1 },
          byValidationStatus: { valid: 1 }
        },
        secrets: {
          totalConfigured: 0,
          byPurpose: {},
          byValidationStatus: {}
        }
      }
    })),
    getStats: vi.fn(async () => ({
      stats: {
        entityCounts: { memory: 1 },
        chunkCount: 1,
        keyCount: 0,
        databaseSizeBytes: 1024,
        uptimeSeconds: 60
      }
    })),
    listApiKeys: vi.fn(async () => ({
      keys: [],
      pagination: { limit: 50, offset: 0, nextOffset: null }
    })),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    getAudit: vi.fn(async () => ({
      audit: {
        entries: [],
        pagination: { limit: 50, offset: 0, nextOffset: null }
      }
    })),
    listJobs: vi.fn(async () => ({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0
    })),
    getProviderConfig: vi.fn(),
    saveProviderConfig: vi.fn(),
    saveProviderSecret: vi.fn(),
    validateProviderConfig: vi.fn(),
    applyProviderConfig: vi.fn(),
    getJob: vi.fn(async (jobId: string) => ({
      job: adminJob({ id: jobId })
    })),
    dryRunReextractMaintenance: vi.fn(async () => ({
      operation: 'reextract' as const,
      dryRun: true,
      job: adminJob(),
      metadata: { dryRun: true }
    })),
    applyReextractMaintenance: vi.fn(async () => ({
      operation: 'reextract' as const,
      dryRun: false,
      job: adminJob({
        id: '22222222-2222-4222-8222-222222222222',
        mode: 'apply',
        status: 'queued'
      }),
      metadata: { dryRun: false }
    })),
    dryRunReembedMaintenance: vi.fn(),
    applyReembedMaintenance: vi.fn(),
    dryRunPruneEdgesMaintenance: vi.fn(async () => ({
      operation: 'prune-edges' as const,
      dryRun: true,
      job: adminJob({
        id: '33333333-3333-4333-8333-333333333333',
        operation: 'maintenance.prune_edges',
        requestedScope: {
          operation: 'prune-edges',
          threshold: 0.3,
          source: 'llm-extraction',
          relation: null
        }
      }),
      metadata: { dryRun: true }
    })),
    applyPruneEdgesMaintenance: vi.fn(),
    downloadBackup: vi.fn(),
    ...overrides
  } as AdminApiClient;
}

beforeEach(() => {
  installTrackedStorage('localStorage');
  installTrackedStorage('sessionStorage');
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AdminMaintenance', () => {
  it('keeps apply confirmation disabled until a successful dry-run preview and constrains edge pruning to LLM extraction', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = adminApi({
      getJob: vi.fn(async (jobId: string) => ({
        job: adminJob({
          id: jobId,
          operation: 'maintenance.prune_edges',
          mode: 'dry_run',
          status: 'succeeded',
          requestedScope: {
            operation: 'prune-edges',
            threshold: 0.3,
            source: 'llm-extraction',
            relation: null
          },
          resultSummary: {
            dryRun: true,
            wouldDelete: 7,
            threshold: 0.3,
            source: 'llm-extraction',
            relation: null,
            implications: {
              destructive: true,
              permanentDelete: true,
              scopedToLlmExtraction: true
            }
          },
          progress: {
            current: 7,
            total: 7,
            message: 'Maintenance preview completed'
          },
          finishedAt: '2026-07-06T16:01:00.000Z'
        })
      }))
    });

    render(<AdminMaintenance api={api} />);

    await user.click(screen.getByRole('button', { name: 'Prune edges' }));
    expect(screen.queryByRole('option', { name: /any source/i })).not.toBeInTheDocument();
    expect(screen.getByText('Source: llm-extraction')).toBeInTheDocument();
    expect(screen.getByLabelText('I reviewed the dry-run preview')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply maintenance job' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Run dry-run preview' }));

    await waitFor(() => {
      expect(api.dryRunPruneEdgesMaintenance).toHaveBeenCalledWith({
        below: 0.3,
        source: 'llm-extraction'
      });
    });
    expect(await screen.findByText('wouldDelete')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByLabelText('I reviewed the dry-run preview')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Apply maintenance job' })).toBeDisabled();

    await user.click(screen.getByLabelText('I reviewed the dry-run preview'));
    expect(screen.getByRole('button', { name: 'Apply maintenance job' })).toBeEnabled();
  });

  it('disables extraction-only jobs when extraction is disabled', async () => {
    const api = adminApi();

    render(<AdminMaintenance api={api} extractionEnabled={false} />);

    expect(
      await screen.findByText(/Extraction is disabled/u)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-extract' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prune edges' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Re-embed' })).toBeEnabled();
    expect(
      screen.getByText(/Re-embed rebuilds vector chunks/u)
    ).toBeInTheDocument();
  });

  it('uses step-up before apply, sends preview and idempotency evidence, then polls to completion', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const previewJob = adminJob({
      id: '44444444-4444-4444-8444-444444444444',
      status: 'succeeded',
      resultSummary: {
        dryRun: true,
        wouldMark: 4,
        wouldDeleteEdges: 1,
        implications: {
          destructive: true,
          llmCost: true,
          clearsExtractionErrors: true,
          deletesLlmEdges: true
        }
      },
      progress: {
        current: 4,
        total: 4,
        message: 'Maintenance preview completed'
      },
      finishedAt: '2026-07-06T16:01:00.000Z'
    });
    const runningApply = adminJob({
      id: '55555555-5555-4555-8555-555555555555',
      operation: 'maintenance.reextract',
      mode: 'apply',
      status: 'running',
      progress: {
        current: 2,
        total: 4,
        message: 'Re-extracting selected records'
      }
    });
    const succeededApply = adminJob({
      ...runningApply,
      status: 'succeeded',
      resultSummary: {
        dryRun: false,
        markedCount: 4,
        deletedEdges: 1,
        implications: {
          destructive: true,
          llmCost: true,
          clearsExtractionErrors: true,
          deletesLlmEdges: true
        }
      },
      progress: {
        current: 4,
        total: 4,
        message: 'Maintenance mutation applied'
      },
      finishedAt: '2026-07-06T16:03:00.000Z'
    });
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ job: previewJob })
      .mockResolvedValueOnce({ job: succeededApply });
    const api = adminApi({
      getJob,
      applyReextractMaintenance: vi.fn(async () => ({
        operation: 'reextract' as const,
        dryRun: false,
        job: runningApply,
        metadata: { dryRun: false }
      }))
    });
    const onAuthUpdate = vi.fn();

    render(
      <AdminMaintenance
        api={api}
        initialStepUp={{ fresh: false, expiresAt: null }}
        onAuthUpdate={onAuthUpdate}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Run dry-run preview' }));
    expect(await screen.findByText('wouldMark')).toBeInTheDocument();
    await user.click(screen.getByLabelText('I reviewed the dry-run preview'));
    await user.type(screen.getByLabelText('MFA confirmation code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Apply maintenance job' }));

    await waitFor(() => {
      expect(api.stepUp).toHaveBeenCalledWith({ code: '123456' });
      expect(onAuthUpdate).toHaveBeenCalled();
      expect(api.applyReextractMaintenance).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { kind: 'type', type: 'memory' },
          cleanEdges: true,
          previewJobId: previewJob.id,
          idempotencyKey: expect.stringMatching(/^maintenance-reextract:/u)
        })
      );
    });

    expect(await screen.findByText('Re-extracting selected records')).toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(await screen.findByText('Maintenance mutation applied')).toBeInTheDocument();
    expect(screen.getByText('markedCount')).toBeInTheDocument();
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
  });

  it('locks request controls while a maintenance job is in flight so polling evidence is retained', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const runningPreview = adminJob({
      id: '10101010-1010-4010-8010-101010101010',
      status: 'running',
      progress: {
        current: 1,
        total: 8,
        message: 'Preview still scanning records'
      }
    });
    const succeededPreview = adminJob({
      ...runningPreview,
      status: 'succeeded',
      resultSummary: {
        dryRun: true,
        wouldMark: 8
      },
      progress: {
        current: 8,
        total: 8,
        message: 'Preview finished scanning records'
      },
      finishedAt: '2026-07-06T16:02:00.000Z'
    });
    const api = adminApi({
      dryRunReextractMaintenance: vi.fn(async () => ({
        operation: 'reextract' as const,
        dryRun: true,
        job: runningPreview,
        metadata: { dryRun: true }
      })),
      getJob: vi
        .fn()
        .mockResolvedValueOnce({ job: runningPreview })
        .mockResolvedValueOnce({ job: succeededPreview })
    });

    render(<AdminMaintenance api={api} />);

    await user.click(screen.getByRole('button', { name: 'Run dry-run preview' }));
    expect(await screen.findByText('Preview still scanning records')).toBeInTheDocument();
    expect(screen.getByText('1/8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-embed' })).toBeDisabled();
    expect(screen.getByLabelText('Scope')).toBeDisabled();
    expect(screen.getByLabelText('Clean LLM extraction edges')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run dry-run preview' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Re-embed' }));
    expect(screen.getByText('Preview still scanning records')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(await screen.findByText('Preview finished scanning records')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-embed' })).toBeEnabled();
    expect(screen.getByLabelText('Scope')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Run dry-run preview' })).toBeEnabled();
  });

  it('keeps polling a running preview after a transient job-status failure', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const runningPreview = adminJob({
      id: '12121212-1212-4212-8212-121212121212',
      status: 'running',
      progress: {
        current: 1,
        total: 3,
        message: 'Preview started'
      }
    });
    const succeededPreview = adminJob({
      ...runningPreview,
      status: 'succeeded',
      resultSummary: {
        dryRun: true,
        wouldMark: 3
      },
      progress: {
        current: 3,
        total: 3,
        message: 'Preview recovered and completed'
      },
      finishedAt: '2026-07-06T16:02:00.000Z'
    });
    const api = adminApi({
      dryRunReextractMaintenance: vi.fn(async () => ({
        operation: 'reextract' as const,
        dryRun: true,
        job: runningPreview,
        metadata: { dryRun: true }
      })),
      getJob: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary job status outage'))
        .mockResolvedValueOnce({ job: succeededPreview })
    });

    render(<AdminMaintenance api={api} />);

    await user.click(screen.getByRole('button', { name: 'Run dry-run preview' }));
    expect(await screen.findByText('Preview started')).toBeInTheDocument();
    expect(await screen.findByText('temporary job status outage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-embed' })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(await screen.findByText('Preview recovered and completed')).toBeInTheDocument();
    expect(screen.queryByText('temporary job status outage')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-embed' })).toBeEnabled();
  });

  it('keeps polling a running apply job after a transient job-status failure', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const previewJob = adminJob({
      id: '13131313-1313-4313-8313-131313131313',
      status: 'succeeded',
      resultSummary: {
        dryRun: true,
        wouldMark: 2
      },
      progress: {
        current: 2,
        total: 2,
        message: 'Preview completed'
      },
      finishedAt: '2026-07-06T16:01:00.000Z'
    });
    const runningApply = adminJob({
      id: '14141414-1414-4414-8414-141414141414',
      operation: 'maintenance.reextract',
      mode: 'apply',
      status: 'running',
      progress: {
        current: 1,
        total: 2,
        message: 'Apply started'
      }
    });
    const succeededApply = adminJob({
      ...runningApply,
      status: 'succeeded',
      resultSummary: {
        dryRun: false,
        markedCount: 2
      },
      progress: {
        current: 2,
        total: 2,
        message: 'Apply recovered and completed'
      },
      finishedAt: '2026-07-06T16:03:00.000Z'
    });
    const api = adminApi({
      getJob: vi
        .fn()
        .mockResolvedValueOnce({ job: previewJob })
        .mockRejectedValueOnce(new Error('temporary apply status outage'))
        .mockResolvedValueOnce({ job: succeededApply }),
      applyReextractMaintenance: vi.fn(async () => ({
        operation: 'reextract' as const,
        dryRun: false,
        job: runningApply,
        metadata: { dryRun: false }
      }))
    });

    render(
      <AdminMaintenance
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Run dry-run preview' }));
    await user.click(await screen.findByLabelText('I reviewed the dry-run preview'));
    await user.click(screen.getByRole('button', { name: 'Apply maintenance job' }));
    expect(await screen.findByText('Apply started')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(await screen.findByText('temporary apply status outage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply maintenance job' })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(await screen.findByText('Apply recovered and completed')).toBeInTheDocument();
    expect(screen.queryByText('temporary apply status outage')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply maintenance job' })).toBeEnabled();
  });

  it('retains failed job evidence while rendering only safe result summary fields', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const localWrites = vi.spyOn(localStorage, 'setItem');
    const previewJob = adminJob({
      id: '66666666-6666-4666-8666-666666666666',
      status: 'succeeded',
      resultSummary: {
        dryRun: true,
        wouldMark: 3
      },
      progress: {
        current: 3,
        total: 3,
        message: 'Maintenance preview completed'
      },
      finishedAt: '2026-07-06T16:01:00.000Z'
    });
    const failedApply = adminJob({
      id: '77777777-7777-4777-8777-777777777777',
      operation: 'maintenance.reextract',
      mode: 'apply',
      status: 'failed',
      resultSummary: {
        failed: true,
        errorCode: 'INTERNAL',
        markedCount: 2,
        failedCount: 1,
        providerResponseBody: 'secret provider body must not render',
        authorization: 'Bearer sk-live-secret',
        tokenPrefix: 'sk-live',
        ciphertext: 'ciphertext-value',
        validationMetadata: {
          apiKey: 'sk-live-secret'
        }
      },
      progress: {
        current: 2,
        total: 3,
        message: 'Partial progress before failure'
      },
      finishedAt: '2026-07-06T16:03:00.000Z'
    });
    const api = adminApi({
      getJob: vi
        .fn()
        .mockResolvedValueOnce({ job: previewJob })
        .mockResolvedValueOnce({ job: failedApply })
    });

    render(
      <AdminMaintenance
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Run dry-run preview' }));
    await user.click(await screen.findByLabelText('I reviewed the dry-run preview'));
    await user.click(screen.getByRole('button', { name: 'Apply maintenance job' }));
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    expect(await screen.findByText('Partial progress before failure')).toBeInTheDocument();
    expect(screen.getAllByText('failed').length).toBeGreaterThan(0);
    expect(screen.getByText('INTERNAL')).toBeInTheDocument();
    expect(screen.getByText('failedCount')).toBeInTheDocument();
    expect(screen.queryByText(/secret provider body/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bearer sk-live-secret/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokenPrefix/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/ciphertext-value/u)).not.toBeInTheDocument();
    expectStorageNotToContain(localStorage, localWrites, 'sk-live-secret', 'ciphertext-value');
  });

  it('fetches full job detail when an idempotent apply retry returns a terminal job reference', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const previewJob = adminJob({
      id: '88888888-8888-4888-8888-888888888888',
      status: 'succeeded',
      resultSummary: {
        dryRun: true,
        wouldMark: 2
      },
      progress: {
        current: 2,
        total: 2,
        message: 'Maintenance preview completed'
      },
      finishedAt: '2026-07-06T16:01:00.000Z'
    });
    const reusedJobId = '99999999-9999-4999-8999-999999999999';
    const reusedFailedJob = adminJob({
      id: reusedJobId,
      operation: 'maintenance.reextract',
      mode: 'apply',
      status: 'failed',
      resultSummary: {
        failed: true,
        errorCode: 'INTERNAL',
        markedCount: 1
      },
      progress: {
        current: 1,
        total: 2,
        message: 'Stored failure from idempotent retry'
      },
      finishedAt: '2026-07-06T16:05:00.000Z'
    });
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ job: previewJob })
      .mockResolvedValueOnce({ job: reusedFailedJob });
    const api = adminApi({
      getJob,
      applyReextractMaintenance: vi.fn(async () => ({
        operation: 'reextract' as const,
        dryRun: false,
        job: {
          id: reusedJobId,
          status: 'failed' as const
        },
        metadata: {},
        reused: true
      }))
    });

    render(
      <AdminMaintenance
        api={api}
        initialStepUp={{ fresh: true, expiresAt: '2999-01-01T00:00:00.000Z' }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Run dry-run preview' }));
    await user.click(await screen.findByLabelText('I reviewed the dry-run preview'));
    await user.click(screen.getByRole('button', { name: 'Apply maintenance job' }));

    await waitFor(() => {
      expect(getJob).toHaveBeenNthCalledWith(2, reusedJobId);
    });
    expect(await screen.findByText('Stored failure from idempotent retry')).toBeInTheDocument();
    expect(screen.getByText('INTERNAL')).toBeInTheDocument();
    expect(screen.queryByText('No result summary yet')).not.toBeInTheDocument();
  });

  it('uses only approved maintenance API routes through the same-origin CSRF client', async () => {
    mockFetch([
      { path: '/admin/api/session/csrf', body: { csrfToken: 'csrf-maintenance' } },
      {
        path: '/admin/api/maintenance/reembed/dry-run',
        method: 'POST',
        status: 202,
        body: {
          operation: 'reembed',
          dryRun: true,
          job: adminJob({
            operation: 'maintenance.reembed',
            requestedScope: {
              operation: 'reembed',
              scope: { kind: 'failed' },
              onlyFailed: true
            }
          }),
          metadata: { dryRun: true }
        },
        assert: (init) => {
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-maintenance'
          });
          expect(init.headers).not.toHaveProperty('Authorization');
          expect(JSON.parse(String(init.body))).toEqual({
            scope: { kind: 'failed' },
            onlyFailed: true
          });
        }
      },
      {
        path: '/admin/api/jobs/11111111-1111-4111-8111-111111111111',
        body: { job: adminJob() },
        assert: (init) => {
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).not.toHaveProperty('Authorization');
        }
      }
    ]);

    const client = createAdminApiClient();
    await client.dryRunReembedMaintenance({
      scope: { kind: 'failed' },
      onlyFailed: true
    });
    await client.getJob('11111111-1111-4111-8111-111111111111');
  });

  it('adds maintenance to the existing admin dashboard shell without replacing overview or config panels', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = adminApi();

    render(
      <AdminDashboard
        api={api}
        user={activeUser}
        session={activeSession}
        onAuthUpdate={vi.fn()}
        onSessionExpired={() => false}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Config' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maintenance' })).toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
    expect(screen.getByText('Audit log')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Maintenance' }));
    expect(await screen.findByRole('heading', { name: 'Maintenance jobs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run dry-run preview' })).toBeInTheDocument();
  });
});
