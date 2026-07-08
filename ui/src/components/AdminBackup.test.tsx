import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminBackup from './admin/AdminBackup.tsx';
import {
  createAdminApiClient,
  type AdminApiClient,
  type AdminBackupRestoreStageResponse,
  type AdminBackupRestoreValidationResponse
} from '../lib/adminApi.ts';

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
    downloadBackup: vi.fn(async () => ({
      blob: new Blob(['backup-archive']),
      filename: 'postgram-backup-test.tar.gz'
    })),
    validateBackupRestore: vi.fn(async () => ({
      restore: {
        token: 'restore-token-1',
        expiresAt: '2026-07-06T18:05:00.000Z',
        manifest: {
          id: 'backup-id-1',
          generatedAt: '2026-07-06T16:00:00.000Z',
          formatVersion: 1
        },
        sourceDatabase: {
          name: 'postgram',
          redactedUrl: 'postgresql://postgram:***@postgres:5432/postgram'
        },
        stagingDatabaseName: 'postgram_restore_20260706_160000_abcd1234',
        validation: {
          archive: 'passed' as const,
          pgRestoreList: 'passed' as const,
          entries: 1
        },
        switchOver: {
          dockerCompose: [
            'POSTGRES_DB=postgram_restore_20260706_160000_abcd1234 docker compose up -d mcp-server postgram-ui'
          ],
          emergencyRollback: [
            'To roll back, restore the previous POSTGRES_DB=postgram setting and restart mcp-server/postgram-ui.'
          ]
        }
      }
    })),
    stageBackupRestore: vi.fn(async () => ({
      restore: {
        status: 'staged' as const,
        stagingDatabaseName: 'postgram_restore_20260706_160000_abcd1234',
        sourceDatabase: {
          name: 'postgram',
          redactedUrl: 'postgresql://postgram:***@postgres:5432/postgram'
        },
        verification: {
          migrations: 'passed' as const,
          health: 'connected' as const
        },
        switchOver: {
          dockerCompose: [
            'POSTGRES_DB=postgram_restore_20260706_160000_abcd1234 docker compose up -d mcp-server postgram-ui'
          ],
          emergencyRollback: [
            'To roll back, restore the previous POSTGRES_DB=postgram setting and restart mcp-server/postgram-ui.'
          ]
        }
      }
    })),
    ...overrides
  } as AdminApiClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AdminBackup', () => {
  it('requires MFA confirmation before downloading a backup archive', async () => {
    const user = userEvent.setup();
    const backupDownload = deferred<{
      blob: Blob;
      filename: string;
    }>();
    const api = adminApi({
      downloadBackup: vi.fn(() => backupDownload.promise)
    });
    const createObjectUrl = vi.fn(() => 'blob:postgram-backup');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    render(
      <AdminBackup
        api={api}
        initialStepUp={{ fresh: false, expiresAt: null }}
      />
    );

    await user.type(
      screen.getByLabelText('Backup MFA confirmation code'),
      '123456'
    );
    await user.click(screen.getByRole('button', { name: 'Download backup' }));

    expect(
      await screen.findByText('Preparing backup archive...')
    ).toBeInTheDocument();
    backupDownload.resolve({
      blob: new Blob(['backup-archive']),
      filename: 'postgram-backup-test.tar.gz'
    });

    await waitFor(() => {
      expect(api.stepUp).toHaveBeenCalledWith({ code: '123456' });
      expect(api.downloadBackup).toHaveBeenCalled();
    });
    expect(createObjectUrl).toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:postgram-backup');
    expect(
      await screen.findByText(
        'Backup download started: postgram-backup-test.tar.gz'
      )
    ).toBeInTheDocument();
  });

  it('puts restore in a full-width section with restore-local MFA, waiting states, and rollback instructions', async () => {
    const user = userEvent.setup();
    const validateRestore = deferred<
      AdminBackupRestoreValidationResponse
    >();
    const stageRestore = deferred<AdminBackupRestoreStageResponse>();
    const api = adminApi({
      validateBackupRestore: vi.fn(() => validateRestore.promise),
      stageBackupRestore: vi.fn(() => stageRestore.promise)
    });

    render(<AdminBackup api={api} />);

    const backupSection = screen.getByRole('region', {
      name: 'Download backup'
    });
    const restoreSection = screen.getByRole('region', {
      name: 'Restore backup'
    });
    expect(
      backupSection.compareDocumentPosition(restoreSection) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByTestId('backup-layout')).toHaveClass('space-y-4');
    expect(screen.getByLabelText('Backup MFA confirmation code')).toBeInTheDocument();
    expect(screen.queryByLabelText('MFA confirmation code')).not.toBeInTheDocument();

    await user.upload(
      within(restoreSection).getByLabelText('Backup archive'),
      new File(['backup'], 'postgram-backup.tar.gz', {
        type: 'application/gzip'
      })
    );
    await user.click(
      within(restoreSection).getByRole('button', { name: 'Validate backup' })
    );

    expect(
      await screen.findByText('Validating backup archive...')
    ).toBeInTheDocument();
    validateRestore.resolve({
      restore: {
        token: 'restore-token-1',
        expiresAt: '2026-07-06T18:05:00.000Z',
        manifest: {
          id: 'backup-id-1',
          generatedAt: '2026-07-06T16:00:00.000Z',
          formatVersion: 1
        },
        sourceDatabase: {
          name: 'postgram',
          redactedUrl: 'postgresql://postgram:***@postgres:5432/postgram'
        },
        stagingDatabaseName: 'postgram_restore_20260706_160000_abcd1234',
        validation: {
          archive: 'passed',
          pgRestoreList: 'passed',
          entries: 1
        },
        switchOver: {
          dockerCompose: [
            'POSTGRES_DB=postgram_restore_20260706_160000_abcd1234 docker compose up -d mcp-server postgram-ui'
          ],
          emergencyRollback: [
            'To roll back, restore the previous POSTGRES_DB=postgram setting and restart mcp-server/postgram-ui.'
          ]
        }
      }
    });

    await waitFor(() => {
      expect(api.validateBackupRestore).toHaveBeenCalled();
    });
    expect(
      await screen.findByText('Backup validation passed')
    ).toBeInTheDocument();
    expect(
      screen.getByText('postgram_restore_20260706_160000_abcd1234')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/restore the previous POSTGRES_DB=postgram/u)
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Restore MFA confirmation code'),
      '654321'
    );
    await user.click(
      screen.getByRole('button', { name: 'Restore to staging database' })
    );

    expect(
      await screen.findByText('Restoring backup into staging database...')
    ).toBeInTheDocument();
    stageRestore.resolve({
      restore: {
        status: 'staged',
        stagingDatabaseName: 'postgram_restore_20260706_160000_abcd1234',
        sourceDatabase: {
          name: 'postgram',
          redactedUrl: 'postgresql://postgram:***@postgres:5432/postgram'
        },
        verification: {
          migrations: 'passed',
          health: 'connected'
        },
        switchOver: {
          dockerCompose: [
            'POSTGRES_DB=postgram_restore_20260706_160000_abcd1234 docker compose up -d mcp-server postgram-ui'
          ],
          emergencyRollback: [
            'To roll back, restore the previous POSTGRES_DB=postgram setting and restart mcp-server/postgram-ui.'
          ]
        }
      }
    });

    await waitFor(() => {
      expect(api.stepUp).toHaveBeenCalledWith({ code: '654321' });
      expect(api.stageBackupRestore).toHaveBeenCalledWith({
        restoreToken: 'restore-token-1',
        confirmation: 'RESTORE TO STAGING'
      });
    });
    expect(await screen.findByText('Restore staged')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Staging database was created, migrations were applied, and the health check passed.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/POSTGRES_DB=postgram_restore_20260706_160000_abcd1234/u)
    ).toBeInTheDocument();
  });
});

describe('createAdminApiClient backup methods', () => {
  it('downloads backup archives with the existing same-origin CSRF client', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = typeof input === 'string' ? input : input.toString();
        if (path === '/admin/api/session/csrf') {
          return new Response(JSON.stringify({ csrfToken: 'csrf-backup' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        expect(path).toBe('/admin/api/backups/download');
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('same-origin');
        expect(init.headers).toMatchObject({
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-backup'
        });
        expect(JSON.parse(String(init.body))).toEqual({});
        return new Response('backup-archive', {
          headers: {
            'Content-Disposition':
              'attachment; filename="postgram-backup-test.tar.gz"',
            'Content-Type': 'application/gzip'
          }
        });
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const backup = await createAdminApiClient().downloadBackup();

    expect(backup.filename).toBe('postgram-backup-test.tar.gz');
    expect(backup.blob).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uploads backup archives for validation and stages restore with CSRF protection', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = typeof input === 'string' ? input : input.toString();
        if (path === '/admin/api/session/csrf') {
          return new Response(JSON.stringify({ csrfToken: 'csrf-restore' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (path === '/admin/api/backups/restore/validate') {
          expect(init.method).toBe('POST');
          expect(init.credentials).toBe('same-origin');
          expect(init.headers).toMatchObject({
            'X-CSRF-Token': 'csrf-restore'
          });
          expect(init.headers).not.toHaveProperty('Content-Type');
          expect(init.body).toBeInstanceOf(FormData);
          return new Response(
            JSON.stringify({
              restore: {
                token: 'restore-token-1',
                expiresAt: '2026-07-06T18:05:00.000Z',
                manifest: {
                  id: 'backup-id-1',
                  generatedAt: '2026-07-06T16:00:00.000Z',
                  formatVersion: 1
                },
                sourceDatabase: {
                  name: 'postgram',
                  redactedUrl:
                    'postgresql://postgram:***@postgres:5432/postgram'
                },
                stagingDatabaseName:
                  'postgram_restore_20260706_160000_abcd1234',
                validation: {
                  archive: 'passed',
                  pgRestoreList: 'passed',
                  entries: 1
                },
                switchOver: {
                  dockerCompose: ['switch'],
                  emergencyRollback: ['rollback']
                }
              }
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }

        expect(path).toBe('/admin/api/backups/restore/stage');
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('same-origin');
        expect(init.headers).toMatchObject({
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-restore'
        });
        expect(JSON.parse(String(init.body))).toEqual({
          restoreToken: 'restore-token-1',
          confirmation: 'RESTORE TO STAGING'
        });
        return new Response(
          JSON.stringify({
            restore: {
              status: 'staged',
              stagingDatabaseName: 'postgram_restore_20260706_160000_abcd1234',
              sourceDatabase: {
                name: 'postgram',
                redactedUrl: 'postgresql://postgram:***@postgres:5432/postgram'
              },
              verification: {
                migrations: 'passed',
                health: 'connected'
              },
              switchOver: {
                dockerCompose: ['switch'],
                emergencyRollback: ['rollback']
              }
            }
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createAdminApiClient();
    const validation = await client.validateBackupRestore(
      new File(['backup'], 'postgram-backup.tar.gz')
    );
    const staged = await client.stageBackupRestore({
      restoreToken: validation.restore.token,
      confirmation: 'RESTORE TO STAGING'
    });

    expect(validation.restore.validation.archive).toBe('passed');
    expect(staged.restore.status).toBe('staged');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
