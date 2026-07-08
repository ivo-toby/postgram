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

export type AdminRuntimeValidationStatus =
  | 'unvalidated'
  | 'valid'
  | 'invalid'
  | 'error';

export type AdminRuntimeSettingClassification =
  | 'bootstrap_only'
  | 'runtime_editable'
  | 'restart_required'
  | 'dangerous_migration';

export type AdminJsonValue =
  | string
  | number
  | boolean
  | null
  | AdminJsonValue[]
  | { [key: string]: AdminJsonValue };

export type AdminRuntimeValidationRecord = {
  status: AdminRuntimeValidationStatus;
  message: string | null;
  metadata: { [key: string]: AdminJsonValue };
  validatedAt: string | null;
};

export type AdminProviderConfigSettingKey =
  | 'EXTRACTION_ENABLED'
  | 'EXTRACTION_PROVIDER'
  | 'EXTRACTION_MODEL'
  | 'EXTRACTION_BASE_URL'
  | 'OLLAMA_BASE_URL'
  | 'EMBEDDING_PROVIDER'
  | 'EMBEDDING_MODEL'
  | 'EMBEDDING_DIMENSIONS'
  | 'EMBEDDING_BASE_URL';

export type AdminProviderSecretName =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'OLLAMA_API_KEY'
  | 'EXTRACTION_API_KEY'
  | 'EMBEDDING_API_KEY';

export type AdminRuntimeSettingSnapshot = {
  key: AdminProviderConfigSettingKey;
  value: AdminJsonValue | undefined;
  source: 'database' | 'env' | 'unset';
  classification: AdminRuntimeSettingClassification;
  state: 'pending' | 'applied';
  validation: AdminRuntimeValidationRecord;
  restartRequired: boolean;
  reembedRequired: boolean;
  appliedAt: string | null;
  updatedByAdminUserId: string | null;
  updatedAt: string | null;
};

export type AdminRuntimeSecretMetadata = {
  name: AdminProviderSecretName;
  configured: true;
  provider: string | null;
  purpose: 'embedding' | 'extraction' | 'provider' | 'other';
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  validation: AdminRuntimeValidationRecord;
  updatedByAdminUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminProviderConfiguration = {
  settings: Record<AdminProviderConfigSettingKey, AdminRuntimeSettingSnapshot>;
  secrets: Record<AdminProviderSecretName, AdminRuntimeSecretMetadata | null>;
  restartRequired: boolean;
  reembedRequired: boolean;
  egressPolicy: {
    id: 'provider-base-url-v1';
    httpsRequiredForRemoteProviders: true;
    redirects: 'blocked';
    localProviderHttpHosts: string[];
  };
};

export type AdminProviderConfigurationResponse = {
  config: AdminProviderConfiguration;
};

export type AdminProviderSecretResponse = {
  secret: AdminRuntimeSecretMetadata;
};

export type AdminProviderValidationResult = {
  status: 'valid' | 'invalid' | 'error' | 'requires_reembedding';
  restartRequired: boolean;
  reembedRequired: boolean;
  connectionTests: Partial<
    Record<
      AdminProviderConfigSettingKey,
      {
        status: AdminRuntimeValidationStatus;
        message: string;
        metadata: Record<string, AdminJsonValue>;
      }
    >
  >;
  runtime: {
    constructible: boolean;
    errors: Array<{
      field: string;
      message: string;
    }>;
  };
  embedding: {
    current: {
      provider: string;
      model: string;
      dimensions: number;
    } | null;
    target: {
      provider: string;
      model: string;
      dimensions: number;
    } | null;
  };
};

export type AdminProviderValidationResponse = {
  validation: AdminProviderValidationResult;
};

export type AdminProviderApplyResponse = {
  result: {
    applied: true;
    restartRequired: boolean;
    reembedRequired: false;
    reload: {
      extraction: 'restart_required' | 'unchanged';
      embedding: 'restart_required' | 'unchanged';
    };
    appliedSettings: AdminProviderConfigSettingKey[];
  };
};

export type AdminScope = 'read' | 'write' | 'delete' | 'sync';
export type AdminEntityType =
  | 'document'
  | 'interaction'
  | 'memory'
  | 'person'
  | 'project'
  | 'task';
export type AdminVisibility = 'personal' | 'work' | 'shared';

export type AdminPagination = {
  limit: number;
  offset: number;
  nextOffset: number | null;
};

export type AdminApiKeyMetadata = {
  id: string;
  name: string;
  clientId: string;
  scopes: AdminScope[];
  allowedTypes: AdminEntityType[] | null;
  allowedVisibility: AdminVisibility[];
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type AdminApiKeyListResponse = {
  keys: AdminApiKeyMetadata[];
  pagination: AdminPagination;
};

export type AdminCreateApiKeyInput = {
  name: string;
  clientId?: string;
  scopes?: AdminScope[];
  allowedTypes?: AdminEntityType[] | null;
  allowedVisibility?: AdminVisibility[];
};

export type AdminCreateApiKeyResponse = {
  plaintextKey: string;
  key: AdminApiKeyMetadata;
};

export type AdminRevokeApiKeyResponse = {
  revoked: true;
  id: string;
};

export type AdminAuditEntry = {
  id: string;
  timestamp: string;
  operation: string;
  entityId: string | null;
  apiKeyId: string | null;
  keyName: string | null;
  adminUserId: string | null;
  adminEmail: string | null;
  details: unknown;
};

export type AdminAuditResponse = {
  audit: {
    entries: AdminAuditEntry[];
    pagination: AdminPagination;
  };
};

export type AdminAuditQuery = {
  operation?: string;
  apiKeyId?: string;
  keyName?: string;
  adminUserId?: string;
  entityId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

export type AdminStats = {
  entityCounts: Record<string, number>;
  chunkCount: number;
  keyCount: number;
  databaseSizeBytes: number;
  uptimeSeconds: number;
};

export type AdminStatsResponse = {
  stats: AdminStats;
};

export type AdminHealth = {
  status: string;
  postgres: string;
  embeddingModel: string | null;
};

export type AdminHealthResponse = {
  health: AdminHealth;
};

export type AdminQueueStatus = {
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
    skipped: number;
  } | null;
};

export type AdminQueueResponse = {
  queue: AdminQueueStatus;
};

export type AdminEmbeddingModel = {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
  chunkSize: number;
  chunkOverlap: number;
  isActive: boolean;
  createdAt: string;
};

export type AdminModelsResponse = {
  models: AdminEmbeddingModel[];
};

export type AdminConfigStatus = {
  settings: {
    total: number;
    byState: Record<string, number>;
    byClassification: Record<string, number>;
    byValidationStatus: Record<string, number>;
  };
  secrets: {
    totalConfigured: number;
    byPurpose: Record<string, number>;
    byValidationStatus: Record<string, number>;
  };
};

export type AdminConfigStatusResponse = {
  configStatus: AdminConfigStatus;
};

export type AdminJobStatus =
  | 'cancel_requested'
  | 'cancelled'
  | 'failed'
  | 'queued'
  | 'running'
  | 'succeeded';

export type AdminJob = {
  id: string;
  operation: string;
  mode: 'dry_run' | 'apply';
  status: AdminJobStatus;
  idempotencyKey: string | null;
  requestedScope: Record<string, unknown>;
  requestSummary: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  progress: {
    current: number;
    total: number | null;
    message: string | null;
  };
  createdByAdminUserId: string | null;
  updatedByAdminUserId: string | null;
  startedAt: string | null;
  cancelRequestedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminJobListResponse = {
  jobs: AdminJob[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminJobResponse = {
  job: AdminJob;
};

export type AdminMaintenanceEntityScope =
  | { kind: 'all' }
  | { kind: 'type'; type: AdminEntityType }
  | { kind: 'id'; id: string }
  | { kind: 'failed' };

export type AdminMaintenanceReextractInput = {
  scope: AdminMaintenanceEntityScope;
  onlyFailed?: boolean;
  limit?: number;
  cleanEdges?: boolean;
  includeAutoCreated?: boolean;
  noEdgesOnly?: boolean;
  showSkipped?: boolean;
};

export type AdminMaintenanceReembedInput = {
  scope: AdminMaintenanceEntityScope;
  onlyFailed?: boolean;
};

export type AdminMaintenancePruneEdgesInput = {
  below: number;
  source?: 'llm-extraction';
  relation?: string;
};

export type AdminMaintenanceApplyEvidence = {
  previewJobId: string;
  idempotencyKey: string;
};

export type AdminMaintenanceRunResponse = {
  operation: 'reextract' | 'reembed' | 'prune-edges';
  dryRun: boolean;
  job: AdminJob | Pick<AdminJob, 'id' | 'status'>;
  metadata: Record<string, unknown>;
  reused?: boolean;
};

export type AdminBackupDownload = {
  blob: Blob;
  filename: string;
};

export type AdminBackupSwitchOverInstructions = {
  dockerCompose: string[];
  emergencyRollback: string[];
};

export type AdminBackupRestoreValidationResponse = {
  restore: {
    token: string;
    expiresAt: string;
    manifest: {
      id: string | null;
      generatedAt: string | null;
      formatVersion: number;
    };
    sourceDatabase: {
      name: string;
      redactedUrl: string;
    };
    stagingDatabaseName: string;
    validation: {
      archive: 'passed';
      pgRestoreList: 'passed';
      entries: number;
    };
    switchOver: AdminBackupSwitchOverInstructions;
  };
};

export type AdminBackupRestoreStageResponse = {
  restore: {
    status: 'staged';
    stagingDatabaseName: string;
    sourceDatabase: {
      name: string;
      redactedUrl: string;
    };
    verification: {
      migrations: 'passed';
      health: 'connected';
    };
    switchOver: AdminBackupSwitchOverInstructions;
  };
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
  getHealth: () => Promise<AdminHealthResponse>;
  getQueueStatus: () => Promise<AdminQueueResponse>;
  listModels: () => Promise<AdminModelsResponse>;
  getConfigStatus: () => Promise<AdminConfigStatusResponse>;
  getStats: () => Promise<AdminStatsResponse>;
  listApiKeys: (input?: { limit?: number; offset?: number }) => Promise<AdminApiKeyListResponse>;
  createApiKey: (input: AdminCreateApiKeyInput) => Promise<AdminCreateApiKeyResponse>;
  revokeApiKey: (id: string) => Promise<AdminRevokeApiKeyResponse>;
  getAudit: (input?: AdminAuditQuery) => Promise<AdminAuditResponse>;
  listJobs: (input?: {
    limit?: number;
    offset?: number;
    status?: AdminJobStatus[];
  }) => Promise<AdminJobListResponse>;
  getJob: (jobId: string) => Promise<AdminJobResponse>;
  dryRunReextractMaintenance: (
    input: AdminMaintenanceReextractInput
  ) => Promise<AdminMaintenanceRunResponse>;
  applyReextractMaintenance: (
    input: AdminMaintenanceReextractInput & AdminMaintenanceApplyEvidence
  ) => Promise<AdminMaintenanceRunResponse>;
  dryRunReembedMaintenance: (
    input: AdminMaintenanceReembedInput
  ) => Promise<AdminMaintenanceRunResponse>;
  applyReembedMaintenance: (
    input: AdminMaintenanceReembedInput & AdminMaintenanceApplyEvidence
  ) => Promise<AdminMaintenanceRunResponse>;
  dryRunPruneEdgesMaintenance: (
    input: AdminMaintenancePruneEdgesInput
  ) => Promise<AdminMaintenanceRunResponse>;
  applyPruneEdgesMaintenance: (
    input: AdminMaintenancePruneEdgesInput & AdminMaintenanceApplyEvidence
  ) => Promise<AdminMaintenanceRunResponse>;
  getProviderConfig: () => Promise<AdminProviderConfigurationResponse>;
  saveProviderConfig: (input: {
    settings: Partial<
      Record<AdminProviderConfigSettingKey, AdminJsonValue | undefined>
    >;
  }) => Promise<AdminProviderConfigurationResponse>;
  saveProviderSecret: (input: {
    name: AdminProviderSecretName;
    plaintext: string;
  }) => Promise<AdminProviderSecretResponse>;
  validateProviderConfig: (input?: {
    testConnections?: boolean;
  }) => Promise<AdminProviderValidationResponse>;
  applyProviderConfig: () => Promise<AdminProviderApplyResponse>;
  downloadBackup: () => Promise<AdminBackupDownload>;
  validateBackupRestore: (
    file: File
  ) => Promise<AdminBackupRestoreValidationResponse>;
  stageBackupRestore: (input: {
    restoreToken: string;
    confirmation: 'RESTORE TO STAGING';
  }) => Promise<AdminBackupRestoreStageResponse>;
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

function appendPagination(
  params: URLSearchParams,
  input: { limit?: number; offset?: number } | undefined,
  defaults: { limit: number; offset: number }
) {
  params.set('limit', String(input?.limit ?? defaults.limit));
  params.set('offset', String(input?.offset ?? defaults.offset));
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

  async function download<T extends AdminBackupDownload>(
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

    const disposition = response.headers.get('content-disposition') ?? '';
    const filenameMatch = /filename="([^"]+)"/u.exec(disposition);
    const blob = await response.blob();
    return {
      blob,
      filename: filenameMatch?.[1] ?? 'postgram-backup.tar.gz',
    } as T;
  }

  async function upload<T>(
    path: string,
    formData: FormData,
    options: AdminRequestOptions = {}
  ): Promise<T> {
    const method = options.method ?? 'POST';
    const headers: Record<string, string> = {};

    if (options.csrf !== false && isUnsafeMethod(method)) {
      headers['X-CSRF-Token'] = csrfToken ?? await getCsrfToken();
    }

    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new AdminApiError(response.status, await parseError(response));
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new AdminApiError(response.status, `Unexpected content-type: ${contentType}`);
    }

    return await response.json() as T;
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

    getHealth() {
      return request<AdminHealthResponse>('/admin/api/diagnostics/health');
    },

    getQueueStatus() {
      return request<AdminQueueResponse>('/admin/api/diagnostics/queue');
    },

    listModels() {
      return request<AdminModelsResponse>('/admin/api/diagnostics/models');
    },

    getConfigStatus() {
      return request<AdminConfigStatusResponse>('/admin/api/diagnostics/config-status');
    },

    getStats() {
      return request<AdminStatsResponse>('/admin/api/stats');
    },

    listApiKeys(input = {}) {
      const params = new URLSearchParams();
      appendPagination(params, input, { limit: 50, offset: 0 });
      return request<AdminApiKeyListResponse>(`/admin/api/keys?${params}`);
    },

    createApiKey(input) {
      return request<AdminCreateApiKeyResponse>('/admin/api/keys', {
        method: 'POST',
        body: input,
      });
    },

    revokeApiKey(id) {
      return request<AdminRevokeApiKeyResponse>(`/admin/api/keys/${id}/revoke`, {
        method: 'POST',
        body: {},
      });
    },

    getAudit(input = {}) {
      const params = new URLSearchParams();
      if (input.operation) params.set('operation', input.operation);
      if (input.apiKeyId) params.set('apiKeyId', input.apiKeyId);
      if (input.keyName) params.set('keyName', input.keyName);
      if (input.adminUserId) params.set('adminUserId', input.adminUserId);
      if (input.entityId) params.set('entityId', input.entityId);
      if (input.since) params.set('since', input.since);
      if (input.until) params.set('until', input.until);
      appendPagination(params, input, { limit: 50, offset: 0 });
      return request<AdminAuditResponse>(`/admin/api/audit?${params}`);
    },

    listJobs(input = {}) {
      const params = new URLSearchParams();
      if (input.status?.length) params.set('status', input.status.join(','));
      appendPagination(params, input, { limit: 20, offset: 0 });
      return request<AdminJobListResponse>(`/admin/api/jobs?${params}`);
    },

    getJob(jobId) {
      return request<AdminJobResponse>(`/admin/api/jobs/${jobId}`);
    },

    dryRunReextractMaintenance(input) {
      return request<AdminMaintenanceRunResponse>(
        '/admin/api/maintenance/reextract/dry-run',
        {
          method: 'POST',
          body: input,
        }
      );
    },

    applyReextractMaintenance(input) {
      return request<AdminMaintenanceRunResponse>(
        '/admin/api/maintenance/reextract/apply',
        {
          method: 'POST',
          body: input,
        }
      );
    },

    dryRunReembedMaintenance(input) {
      return request<AdminMaintenanceRunResponse>(
        '/admin/api/maintenance/reembed/dry-run',
        {
          method: 'POST',
          body: input,
        }
      );
    },

    applyReembedMaintenance(input) {
      return request<AdminMaintenanceRunResponse>(
        '/admin/api/maintenance/reembed/apply',
        {
          method: 'POST',
          body: input,
        }
      );
    },

    dryRunPruneEdgesMaintenance(input) {
      return request<AdminMaintenanceRunResponse>(
        '/admin/api/maintenance/prune-edges/dry-run',
        {
          method: 'POST',
          body: input,
        }
      );
    },

    applyPruneEdgesMaintenance(input) {
      return request<AdminMaintenanceRunResponse>(
        '/admin/api/maintenance/prune-edges/apply',
        {
          method: 'POST',
          body: input,
        }
      );
    },

    getProviderConfig() {
      return request<AdminProviderConfigurationResponse>(
        '/admin/api/provider-config'
      );
    },

    saveProviderConfig(input) {
      return request<AdminProviderConfigurationResponse>(
        '/admin/api/provider-config',
        {
          method: 'PUT',
          body: input,
        }
      );
    },

    saveProviderSecret(input) {
      return request<AdminProviderSecretResponse>(
        '/admin/api/provider-config/secrets',
        {
          method: 'PUT',
          body: input,
        }
      );
    },

    validateProviderConfig(input = {}) {
      return request<AdminProviderValidationResponse>(
        '/admin/api/provider-config/validate',
        {
          method: 'POST',
          body: {
            testConnections: input.testConnections ?? false,
          },
        }
      );
    },

    applyProviderConfig() {
      return request<AdminProviderApplyResponse>(
        '/admin/api/provider-config/apply',
        {
          method: 'POST',
          body: {},
        }
      );
    },

    downloadBackup() {
      return download<AdminBackupDownload>('/admin/api/backups/download', {
        method: 'POST',
        body: {},
      });
    },

    validateBackupRestore(file) {
      const formData = new FormData();
      formData.set('backup', file);
      return upload<AdminBackupRestoreValidationResponse>(
        '/admin/api/backups/restore/validate',
        formData,
        {
          method: 'POST',
        }
      );
    },

    stageBackupRestore(input) {
      return request<AdminBackupRestoreStageResponse>(
        '/admin/api/backups/restore/stage',
        {
          method: 'POST',
          body: input,
        }
      );
    },
  };
}

export type { AdminApiClient };
