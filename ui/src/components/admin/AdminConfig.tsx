import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AdminApiError,
  createAdminApiClient,
  type AdminApiClient,
  type AdminAuthResponse,
  type AdminJsonValue,
  type AdminProviderApplyResponse,
  type AdminProviderConfigSettingKey,
  type AdminProviderConfiguration,
  type AdminProviderSecretName,
  type AdminProviderValidationResult,
  type AdminRuntimeSecretMetadata,
  type AdminRuntimeSettingSnapshot,
  type AdminStepUp
} from '../../lib/adminApi.ts';

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
] as const satisfies readonly AdminProviderConfigSettingKey[];

const secretNames = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OLLAMA_API_KEY',
  'EXTRACTION_API_KEY',
  'EMBEDDING_API_KEY'
] as const satisfies readonly AdminProviderSecretName[];

const migrationSettingKeys = [
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS'
] as const satisfies readonly AdminProviderConfigSettingKey[];

const providerUrlSettingKeys = [
  'EXTRACTION_BASE_URL',
  'OLLAMA_BASE_URL',
  'EMBEDDING_BASE_URL'
] as const satisfies readonly AdminProviderConfigSettingKey[];

const maxBrowserTimeoutMs = 2_147_483_647;

type ProviderUrlSettingKey = (typeof providerUrlSettingKeys)[number];

type ConnectionValidationCandidate = {
  status: AdminRuntimeSettingSnapshot['validation']['status'];
  metadata: Record<string, AdminJsonValue>;
};

type ProviderSettingsDraft = {
  EXTRACTION_ENABLED: boolean;
  EXTRACTION_PROVIDER: string;
  EXTRACTION_MODEL: string;
  EXTRACTION_BASE_URL: string;
  OLLAMA_BASE_URL: string;
  EMBEDDING_PROVIDER: string;
  EMBEDDING_MODEL: string;
  EMBEDDING_DIMENSIONS: string;
  EMBEDDING_BASE_URL: string;
};

type SecretDrafts = Record<AdminProviderSecretName, string>;

type AdminConfigProps = {
  api?: AdminApiClient;
  initialStepUp?: AdminStepUp;
  onAuthUpdate?: (response: AdminAuthResponse) => void;
  onSessionExpired?: (error: unknown) => boolean;
};

function emptySecretDrafts(): SecretDrafts {
  return {
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    OLLAMA_API_KEY: '',
    EXTRACTION_API_KEY: '',
    EMBEDDING_API_KEY: ''
  };
}

function emptySettingsDraft(): ProviderSettingsDraft {
  return {
    EXTRACTION_ENABLED: false,
    EXTRACTION_PROVIDER: '',
    EXTRACTION_MODEL: '',
    EXTRACTION_BASE_URL: '',
    OLLAMA_BASE_URL: '',
    EMBEDDING_PROVIDER: '',
    EMBEDDING_MODEL: '',
    EMBEDDING_DIMENSIONS: '',
    EMBEDDING_BASE_URL: ''
  };
}

function stringValue(value: AdminJsonValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function draftFromConfig(
  config: AdminProviderConfiguration
): ProviderSettingsDraft {
  return {
    EXTRACTION_ENABLED: config.settings.EXTRACTION_ENABLED.value === true,
    EXTRACTION_PROVIDER: stringValue(config.settings.EXTRACTION_PROVIDER.value),
    EXTRACTION_MODEL: stringValue(config.settings.EXTRACTION_MODEL.value),
    EXTRACTION_BASE_URL: stringValue(config.settings.EXTRACTION_BASE_URL.value),
    OLLAMA_BASE_URL: stringValue(config.settings.OLLAMA_BASE_URL.value),
    EMBEDDING_PROVIDER: stringValue(config.settings.EMBEDDING_PROVIDER.value),
    EMBEDDING_MODEL: stringValue(config.settings.EMBEDDING_MODEL.value),
    EMBEDDING_DIMENSIONS: stringValue(
      config.settings.EMBEDDING_DIMENSIONS.value
    ),
    EMBEDDING_BASE_URL: stringValue(config.settings.EMBEDDING_BASE_URL.value)
  };
}

function messageForError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError || error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function inputClassName(tone: 'default' | 'danger' = 'default') {
  const base =
    'w-full rounded-md border bg-gray-950 px-2.5 py-2 text-sm text-white placeholder-gray-600 outline-none focus:ring-1 disabled:cursor-not-allowed disabled:text-gray-500';
  if (tone === 'danger') {
    return `${base} border-red-500/60 focus:border-red-400 focus:ring-red-400`;
  }
  return `${base} border-gray-700 focus:border-blue-500 focus:ring-blue-500`;
}

function buttonClassName(
  variant: 'primary' | 'secondary' | 'danger' = 'secondary'
) {
  const base =
    'rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500';
  if (variant === 'primary') {
    return `${base} bg-blue-600 text-white hover:bg-blue-500`;
  }
  if (variant === 'danger') {
    return `${base} bg-red-600 text-white hover:bg-red-500`;
  }
  return `${base} bg-gray-800 text-gray-100 hover:bg-gray-700`;
}

function badgeClassName(
  tone: 'default' | 'good' | 'warn' | 'danger' = 'default'
) {
  const base =
    'inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium';
  if (tone === 'good') {
    return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`;
  }
  if (tone === 'warn') {
    return `${base} border-amber-500/30 bg-amber-500/10 text-amber-200`;
  }
  if (tone === 'danger') {
    return `${base} border-red-500/30 bg-red-500/10 text-red-200`;
  }
  return `${base} border-gray-700 bg-gray-800 text-gray-300`;
}

function formatValue(value: AdminJsonValue | undefined): string {
  if (value === undefined || value === null || value === '') {
    return 'unset';
  }
  if (typeof value === 'boolean') {
    return value ? 'enabled' : 'disabled';
  }
  return String(value);
}

function jsonValuesEqual(
  left: AdminJsonValue | undefined,
  right: AdminJsonValue | undefined
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function draftValueChanged(
  config: AdminProviderConfiguration,
  draft: ProviderSettingsDraft,
  key: AdminProviderConfigSettingKey
): boolean {
  if (key === 'EXTRACTION_ENABLED') {
    return (
      draft.EXTRACTION_ENABLED !==
      (config.settings.EXTRACTION_ENABLED.value === true)
    );
  }
  return (
    String(draft[key]).trim() !== stringValue(config.settings[key].value).trim()
  );
}

function isMigrationSettingKey(
  key: AdminProviderConfigSettingKey
): key is (typeof migrationSettingKeys)[number] {
  return (
    migrationSettingKeys as readonly AdminProviderConfigSettingKey[]
  ).includes(key);
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'not yet';
  }
  return new Date(value).toLocaleString();
}

function validationTone(
  status: string
): 'default' | 'good' | 'warn' | 'danger' {
  if (status === 'valid') {
    return 'good';
  }
  if (status === 'invalid' || status === 'error') {
    return 'danger';
  }
  return 'warn';
}

function configSettingString(
  config: AdminProviderConfiguration,
  key: AdminProviderConfigSettingKey
): string | undefined {
  const value = config.settings[key].value;
  return typeof value === 'string' ? value : undefined;
}

function configSettingBoolean(
  config: AdminProviderConfiguration,
  key: AdminProviderConfigSettingKey
): boolean | undefined {
  const value = config.settings[key].value;
  return typeof value === 'boolean' ? value : undefined;
}

function targetExtractionProvider(config: AdminProviderConfiguration): string {
  return configSettingString(config, 'EXTRACTION_PROVIDER') ?? 'openai';
}

function targetEmbeddingProvider(config: AdminProviderConfiguration): string {
  return configSettingString(config, 'EMBEDDING_PROVIDER') ?? 'openai';
}

function providerForUrlKey(
  config: AdminProviderConfiguration,
  key: ProviderUrlSettingKey
): string {
  return key === 'EXTRACTION_BASE_URL'
    ? targetExtractionProvider(config)
    : 'ollama';
}

function isProviderUrlRelevant(
  config: AdminProviderConfiguration,
  key: ProviderUrlSettingKey
): boolean {
  const extractionEnabled =
    configSettingBoolean(config, 'EXTRACTION_ENABLED') ?? false;
  const extractionProvider = targetExtractionProvider(config);
  const embeddingProvider = targetEmbeddingProvider(config);

  if (key === 'EXTRACTION_BASE_URL') {
    return extractionEnabled && extractionProvider === 'openai-compatible';
  }
  if (key === 'OLLAMA_BASE_URL') {
    return (
      (extractionEnabled && extractionProvider === 'ollama') ||
      (embeddingProvider === 'ollama' &&
        !configSettingString(config, 'EMBEDDING_BASE_URL'))
    );
  }
  return embeddingProvider === 'ollama';
}

function normalizeProviderUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString().replace(/\/+$/u, '');
  } catch {
    return null;
  }
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function metadataStringArray(
  value: AdminJsonValue | undefined
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const strings = value.filter(
    (item): item is string => typeof item === 'string'
  );
  return strings.length === value.length
    ? strings.sort((left, right) => left.localeCompare(right))
    : null;
}

function metadataStringNullRecord(
  value: AdminJsonValue | undefined
): Record<string, string | null> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const output: Record<string, string | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' && item !== null) {
      return null;
    }
    output[key] = item;
  }
  return output;
}

function stringNullRecordsEqual(
  left: Record<string, string | null>,
  right: Record<string, string | null>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    stringArraysEqual(leftKeys, rightKeys) &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function connectionSecretNames(
  config: AdminProviderConfiguration,
  key: ProviderUrlSettingKey,
  provider: string
): AdminProviderSecretName[] {
  if (key === 'EXTRACTION_BASE_URL') {
    return provider === 'openai-compatible' ? ['EXTRACTION_API_KEY'] : [];
  }
  if (key === 'EMBEDDING_BASE_URL') {
    return ['EMBEDDING_API_KEY'];
  }

  const names: AdminProviderSecretName[] = [];
  if (
    targetEmbeddingProvider(config) === 'ollama' &&
    !configSettingString(config, 'EMBEDDING_BASE_URL')
  ) {
    names.push('EMBEDDING_API_KEY');
  }
  if (
    (configSettingBoolean(config, 'EXTRACTION_ENABLED') ?? false) &&
    targetExtractionProvider(config) === 'ollama'
  ) {
    names.push('OLLAMA_API_KEY');
  }
  return names.sort((left, right) => left.localeCompare(right));
}

function connectionSecretRevisions(
  config: AdminProviderConfiguration,
  secretNames: readonly AdminProviderSecretName[]
): Record<string, string | null> {
  const revisions: Record<string, string | null> = {};
  for (const name of secretNames) {
    revisions[name] = config.secrets[name]?.updatedAt ?? null;
  }
  return revisions;
}

function connectionValidationIsCurrent(
  config: AdminProviderConfiguration,
  key: ProviderUrlSettingKey,
  candidate: ConnectionValidationCandidate | undefined
): boolean {
  if (!candidate || candidate.status !== 'valid') {
    return false;
  }

  const metadata = candidate.metadata;
  const provider = providerForUrlKey(config, key);
  const fromConnectionTest =
    metadata.connectionTest === true ||
    typeof metadata.connectionStatus === 'number';
  if (
    !fromConnectionTest ||
    metadata.provider !== provider ||
    metadata.egressPolicy !== config.egressPolicy.id
  ) {
    return false;
  }

  const currentNormalizedUrl = normalizeProviderUrl(
    configSettingString(config, key)
  );
  if (
    typeof metadata.connectionNormalizedUrl !== 'string' ||
    metadata.connectionNormalizedUrl !== currentNormalizedUrl
  ) {
    return false;
  }

  const expectedSecretNames = connectionSecretNames(config, key, provider);
  const storedSecretNames = metadataStringArray(metadata.connectionSecretNames);
  if (
    !storedSecretNames ||
    !stringArraysEqual(storedSecretNames, expectedSecretNames)
  ) {
    return false;
  }

  const storedSecretRevisions = metadataStringNullRecord(
    metadata.connectionSecretRevisions
  );
  return (
    storedSecretRevisions !== null &&
    stringNullRecordsEqual(
      storedSecretRevisions,
      connectionSecretRevisions(config, expectedSecretNames)
    )
  );
}

function missingConnectionValidationSettings(
  config: AdminProviderConfiguration,
  validation: AdminProviderValidationResult | null
): ProviderUrlSettingKey[] {
  return providerUrlSettingKeys.filter((key) => {
    const setting = config.settings[key];
    if (setting.source !== 'database' || !isProviderUrlRelevant(config, key)) {
      return false;
    }

    return !(
      connectionValidationIsCurrent(config, key, setting.validation) ||
      connectionValidationIsCurrent(
        config,
        key,
        validation?.connectionTests[key]
      )
    );
  });
}

function isStepUpFresh(
  stepUp: AdminStepUp | undefined,
  nowMs: number
): boolean {
  if (!stepUp?.fresh || !stepUp.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(stepUp.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export default function AdminConfig({
  api,
  initialStepUp,
  onAuthUpdate,
  onSessionExpired
}: AdminConfigProps) {
  const defaultApi = useMemo(() => createAdminApiClient(), []);
  const client = api ?? defaultApi;
  const [config, setConfig] = useState<AdminProviderConfiguration | null>(null);
  const [settingsDraft, setSettingsDraft] =
    useState<ProviderSettingsDraft>(emptySettingsDraft);
  const [secretDrafts, setSecretDrafts] =
    useState<SecretDrafts>(emptySecretDrafts);
  const [stepUp, setStepUp] = useState<AdminStepUp | undefined>(initialStepUp);
  const [stepUpClockMs, setStepUpClockMs] = useState(() => Date.now());
  const [stepUpCode, setStepUpCode] = useState('');
  const [migrationAcknowledged, setMigrationAcknowledged] = useState(false);
  const [validation, setValidation] =
    useState<AdminProviderValidationResult | null>(null);
  const [applyResult, setApplyResult] = useState<
    AdminProviderApplyResponse['result'] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function routeSessionExpiry(requestError: unknown): boolean {
    return onSessionExpired?.(requestError) ?? false;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setError(null);
      try {
        const response = await client.getProviderConfig();
        if (cancelled) {
          return;
        }
        setConfig(response.config);
        setSettingsDraft(draftFromConfig(response.config));
        setSecretDrafts(emptySecretDrafts());
        setMigrationAcknowledged(false);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (routeSessionExpiry(loadError)) {
          return;
        }
        setError(
          messageForError(loadError, 'Unable to load provider configuration')
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    setStepUpClockMs(Date.now());
    if (!stepUp?.fresh || !stepUp.expiresAt) {
      return;
    }

    const expiresAtMs = Date.parse(stepUp.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }

    const timeoutMs = Math.max(0, expiresAtMs - Date.now()) + 1;
    if (timeoutMs > maxBrowserTimeoutMs) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStepUpClockMs(Date.now());
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [stepUp?.expiresAt, stepUp?.fresh]);

  const pendingSettings = useMemo(() => {
    if (!config) {
      return [];
    }
    return settingKeys.filter(
      (key) => config.settings[key].state === 'pending'
    );
  }, [config]);

  const appliedSettings = useMemo(() => {
    if (!config) {
      return [];
    }
    return settingKeys.filter(
      (key) => config.settings[key].state === 'applied'
    );
  }, [config]);

  const changedDraftKeys = useMemo(() => {
    if (!config) {
      return [];
    }
    return settingKeys.filter((key) =>
      draftValueChanged(config, settingsDraft, key)
    );
  }, [config, settingsDraft]);

  const migrationDraftKeys = useMemo(
    () => changedDraftKeys.filter(isMigrationSettingKey),
    [changedDraftKeys]
  );
  const missingConnectionValidation = useMemo(() => {
    if (!config) {
      return [];
    }
    return missingConnectionValidationSettings(config, validation);
  }, [config, validation]);

  const hasUnsavedDraft = changedDraftKeys.length > 0;
  const hasMigrationClassDraft = migrationDraftKeys.length > 0;
  const hasMissingConnectionValidation = missingConnectionValidation.length > 0;
  const hasBlockingValidationFailure =
    validation?.status === 'invalid' || validation?.status === 'error';
  const restartRequired =
    config?.restartRequired ||
    validation?.restartRequired ||
    applyResult?.restartRequired;
  const reembedRequired =
    config?.reembedRequired || validation?.reembedRequired;
  const applyDisabled =
    Boolean(reembedRequired) ||
    hasBlockingValidationFailure ||
    hasMissingConnectionValidation ||
    hasUnsavedDraft ||
    busyAction !== null ||
    !config;
  const stepUpIsFresh = isStepUpFresh(stepUp, stepUpClockMs);
  const settingsInputsDisabled = busyAction !== null;

  function updateSetting(
    key: keyof ProviderSettingsDraft,
    value: string | boolean
  ) {
    setSettingsDraft((previous) => ({
      ...previous,
      [key]: value
    }));
    if (
      key === 'EMBEDDING_PROVIDER' ||
      key === 'EMBEDDING_MODEL' ||
      key === 'EMBEDDING_DIMENSIONS'
    ) {
      setMigrationAcknowledged(false);
    }
  }

  function updateSecretDraft(name: AdminProviderSecretName, value: string) {
    setSecretDrafts((previous) => ({
      ...previous,
      [name]: value
    }));
  }

  function buildSettingsPayload(): Partial<
    Record<AdminProviderConfigSettingKey, AdminJsonValue>
  > | null {
    if (!config) {
      return null;
    }

    const dimensions = settingsDraft.EMBEDDING_DIMENSIONS.trim();
    if (dimensions && !Number.isInteger(Number(dimensions))) {
      setError('Embedding dimensions must be a whole number.');
      return null;
    }
    if (
      !dimensions &&
      config.settings.EMBEDDING_DIMENSIONS.value !== undefined
    ) {
      setError(
        'Embedding dimensions cannot be cleared through this apply path.'
      );
      return null;
    }
    if (hasMigrationClassDraft && !migrationAcknowledged) {
      setError(
        'Confirm embedding migration impact before saving migration-class settings.'
      );
      return null;
    }

    const settings: Partial<
      Record<AdminProviderConfigSettingKey, AdminJsonValue>
    > = {};
    const extractionEnabledCurrent =
      config.settings.EXTRACTION_ENABLED.value === true;
    if (settingsDraft.EXTRACTION_ENABLED !== extractionEnabledCurrent) {
      settings.EXTRACTION_ENABLED = settingsDraft.EXTRACTION_ENABLED;
    }
    for (const key of settingKeys) {
      if (key === 'EXTRACTION_ENABLED' || key === 'EMBEDDING_DIMENSIONS') {
        continue;
      }
      const value = settingsDraft[key].trim();
      if (!value && config.settings[key].value !== undefined) {
        setError(`${key} cannot be cleared through this apply path.`);
        return null;
      }
      if (value && !jsonValuesEqual(value, config.settings[key].value)) {
        settings[key] = value;
      }
    }
    if (
      dimensions &&
      !jsonValuesEqual(
        Number(dimensions),
        config.settings.EMBEDDING_DIMENSIONS.value
      )
    ) {
      settings.EMBEDDING_DIMENSIONS = Number(dimensions);
    }
    if (Object.keys(settings).length === 0) {
      setError('Change at least one provider setting before saving.');
      return null;
    }
    return settings;
  }

  function hasFreshStepUp(): boolean {
    return isStepUpFresh(stepUp, Date.now());
  }

  async function ensureStepUp(): Promise<boolean> {
    if (hasFreshStepUp()) {
      return true;
    }
    if (!stepUpCode.trim()) {
      setError('Enter a step-up code before sensitive changes.');
      return false;
    }

    const response = await client.stepUp({ code: stepUpCode.trim() });
    setStepUp(response.stepUp);
    onAuthUpdate?.(response);
    setStepUpClockMs(Date.now());
    setStepUpCode('');
    return true;
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settings = buildSettingsPayload();
    if (!settings) {
      return;
    }

    setBusyAction('settings');
    setError(null);
    setNotice(null);
    try {
      const response = await client.saveProviderConfig({ settings });
      setConfig(response.config);
      setSettingsDraft(draftFromConfig(response.config));
      setMigrationAcknowledged(false);
      setValidation(null);
      setApplyResult(null);
      setNotice('Pending provider settings saved.');
    } catch (saveError) {
      if (routeSessionExpiry(saveError)) {
        return;
      }
      setError(messageForError(saveError, 'Unable to save provider settings'));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleValidate() {
    if (hasUnsavedDraft) {
      setError('Save or discard draft changes before validating.');
      return;
    }

    setBusyAction('validate');
    setError(null);
    setNotice(null);
    try {
      if (!(await ensureStepUp())) {
        return;
      }
      const response = await client.validateProviderConfig({
        testConnections: true
      });
      setValidation(response.validation);
      setApplyResult(null);
      try {
        const refreshed = await client.getProviderConfig();
        setConfig(refreshed.config);
        setSettingsDraft(draftFromConfig(refreshed.config));
        setMigrationAcknowledged(false);
        setNotice('Provider validation completed.');
      } catch (refreshError) {
        if (routeSessionExpiry(refreshError)) {
          return;
        }
        setNotice(
          `Provider validation completed, but provider state could not be refreshed: ${messageForError(refreshError, 'refresh unavailable')}`
        );
      }
    } catch (validateError) {
      if (routeSessionExpiry(validateError)) {
        return;
      }
      setError(
        messageForError(
          validateError,
          'Unable to validate provider configuration'
        )
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveSecret(name: AdminProviderSecretName) {
    const plaintext = secretDrafts[name].trim();
    if (!plaintext) {
      setError(`Enter a replacement value for ${name}.`);
      return;
    }

    setBusyAction(name);
    setError(null);
    setNotice(null);
    try {
      if (!(await ensureStepUp())) {
        return;
      }
      await client.saveProviderSecret({ name, plaintext });
      setSecretDrafts((previous) => ({
        ...previous,
        [name]: ''
      }));
      setValidation(null);
      setApplyResult(null);
      try {
        const refreshed = await client.getProviderConfig();
        setConfig(refreshed.config);
        if (!hasUnsavedDraft) {
          setSettingsDraft(draftFromConfig(refreshed.config));
          setMigrationAcknowledged(false);
        }
        setNotice(`${name} secret saved as write-only metadata.`);
      } catch (refreshError) {
        if (routeSessionExpiry(refreshError)) {
          return;
        }
        setError(
          messageForError(
            refreshError,
            `${name} secret saved, but provider state could not be refreshed`
          )
        );
      }
    } catch (secretError) {
      if (routeSessionExpiry(secretError)) {
        return;
      }
      setError(messageForError(secretError, `Unable to save ${name}`));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApply() {
    if (reembedRequired) {
      setError('Simple apply is blocked while re-embedding is required.');
      return;
    }
    if (hasUnsavedDraft) {
      setError('Save or discard draft changes before applying.');
      return;
    }
    if (hasBlockingValidationFailure) {
      setError('Resolve validation errors before applying.');
      return;
    }
    if (hasMissingConnectionValidation) {
      setError(
        `Run connection validation before applying: ${missingConnectionValidation.join(', ')}.`
      );
      return;
    }

    setBusyAction('apply');
    setError(null);
    setNotice(null);
    try {
      if (!(await ensureStepUp())) {
        return;
      }
      const response = await client.applyProviderConfig();
      setApplyResult(response.result);
      setValidation(null);
      try {
        const refreshed = await client.getProviderConfig();
        setConfig(refreshed.config);
        setSettingsDraft(draftFromConfig(refreshed.config));
        setMigrationAcknowledged(false);
        setNotice('Provider configuration apply completed.');
      } catch (refreshError) {
        if (routeSessionExpiry(refreshError)) {
          return;
        }
        setNotice(
          `Provider configuration apply completed, but provider state could not be refreshed: ${messageForError(refreshError, 'refresh unavailable')}`
        );
      }
    } catch (applyError) {
      if (routeSessionExpiry(applyError)) {
        return;
      }
      setError(
        messageForError(applyError, 'Unable to apply provider configuration')
      );
    } finally {
      setBusyAction(null);
    }
  }

  function handleDiscardDraftChanges() {
    if (!config) {
      return;
    }
    setSettingsDraft(draftFromConfig(config));
    setMigrationAcknowledged(false);
    setError(null);
    setNotice(null);
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-white">
          Loading provider configuration
        </h2>
        <p className="mt-2 text-sm text-gray-400">Loading provider settings</p>
      </section>
    );
  }

  if (!config) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-white">
          Provider configuration unavailable
        </h2>
        <ErrorBanner
          message={error ?? 'Provider configuration is unavailable'}
        />
      </section>
    );
  }

  return (
    <section className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Provider configuration
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Runtime provider settings are saved as pending changes until
            validation and apply succeed.
          </p>
        </div>
        <div className="flex-1" />
        <span
          className={badgeClassName(
            pendingSettings.length > 0 ? 'warn' : 'good'
          )}
        >
          Pending
        </span>
        <span className={badgeClassName('good')}>Applied</span>
      </div>

      <ErrorBanner message={error} />
      {notice ? (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-100">
          {notice}
        </div>
      ) : null}

      <ImpactWarnings
        restartRequired={Boolean(restartRequired)}
        reembedRequired={Boolean(reembedRequired)}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <form
            onSubmit={handleSaveSettings}
            className="rounded-lg border border-gray-800 bg-gray-900 p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-white">
                Pending provider settings
              </h3>
              <span
                className={badgeClassName(
                  pendingSettings.length > 0 ? 'warn' : 'default'
                )}
              >
                {pendingSettings.length} pending
              </span>
              {hasUnsavedDraft ? (
                <span className={badgeClassName('warn')}>Unsaved draft</span>
              ) : null}
            </div>
            {hasUnsavedDraft ? (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Save or discard draft changes before validating or applying.
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={settingsDraft.EXTRACTION_ENABLED}
                  disabled={settingsInputsDisabled}
                  onChange={(event) =>
                    updateSetting('EXTRACTION_ENABLED', event.target.checked)
                  }
                  className="accent-blue-500"
                />
                Extraction enabled
              </label>
              <SettingInput
                label="Extraction provider"
                value={settingsDraft.EXTRACTION_PROVIDER}
                disabled={settingsInputsDisabled}
                onChange={(value) =>
                  updateSetting('EXTRACTION_PROVIDER', value)
                }
              />
              <SettingInput
                label="Extraction model"
                value={settingsDraft.EXTRACTION_MODEL}
                disabled={settingsInputsDisabled}
                onChange={(value) => updateSetting('EXTRACTION_MODEL', value)}
              />
              <SettingInput
                label="Extraction base URL"
                value={settingsDraft.EXTRACTION_BASE_URL}
                disabled={settingsInputsDisabled}
                onChange={(value) =>
                  updateSetting('EXTRACTION_BASE_URL', value)
                }
              />
              <SettingInput
                label="Ollama base URL"
                value={settingsDraft.OLLAMA_BASE_URL}
                disabled={settingsInputsDisabled}
                onChange={(value) => updateSetting('OLLAMA_BASE_URL', value)}
              />
              <SettingInput
                label="Embedding provider"
                tone="danger"
                helpText="Migration-class setting"
                value={settingsDraft.EMBEDDING_PROVIDER}
                disabled={settingsInputsDisabled}
                onChange={(value) => updateSetting('EMBEDDING_PROVIDER', value)}
              />
              <SettingInput
                label="Embedding model"
                tone="danger"
                helpText="Migration-class setting"
                value={settingsDraft.EMBEDDING_MODEL}
                disabled={settingsInputsDisabled}
                onChange={(value) => updateSetting('EMBEDDING_MODEL', value)}
              />
              <SettingInput
                label="Embedding dimensions"
                inputMode="numeric"
                tone="danger"
                helpText="Migration-class setting"
                value={settingsDraft.EMBEDDING_DIMENSIONS}
                disabled={settingsInputsDisabled}
                onChange={(value) =>
                  updateSetting('EMBEDDING_DIMENSIONS', value)
                }
              />
              <SettingInput
                label="Embedding base URL"
                value={settingsDraft.EMBEDDING_BASE_URL}
                disabled={settingsInputsDisabled}
                onChange={(value) => updateSetting('EMBEDDING_BASE_URL', value)}
              />
            </div>
            {hasMigrationClassDraft ? (
              <label className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                <input
                  type="checkbox"
                  className="mt-1 accent-red-500"
                  checked={migrationAcknowledged}
                  disabled={settingsInputsDisabled}
                  onChange={(event) =>
                    setMigrationAcknowledged(event.target.checked)
                  }
                />
                I understand embedding changes require migration before apply
              </label>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="submit"
                className={buttonClassName('primary')}
                disabled={busyAction !== null}
              >
                Save pending settings
              </button>
              <button
                type="button"
                onClick={handleDiscardDraftChanges}
                className={buttonClassName()}
                disabled={busyAction !== null || !hasUnsavedDraft}
              >
                Discard draft changes
              </button>
              <button
                type="button"
                onClick={handleValidate}
                className={buttonClassName()}
                disabled={busyAction !== null || hasUnsavedDraft}
              >
                Validate and test connections
              </button>
            </div>
          </form>

          <SettingsStateTable
            title="Applied provider settings"
            settings={appliedSettings.map((key) => config.settings[key])}
          />
          <SettingsStateTable
            title="Pending provider settings detail"
            settings={pendingSettings.map((key) => config.settings[key])}
          />
          <ValidationPanel validation={validation} />
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h3 className="text-sm font-semibold text-white">
              Sensitive changes
            </h3>
            <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-300">
              Step-up code
              <input
                className={inputClassName()}
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value)}
                placeholder={
                  stepUpIsFresh
                    ? 'Fresh step-up active'
                    : 'Required before secret writes or apply'
                }
              />
            </label>
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <span className={badgeClassName(stepUpIsFresh ? 'good' : 'warn')}>
                {stepUpIsFresh ? 'Step-up fresh' : 'Step-up required'}
              </span>
              <span>
                {stepUp?.expiresAt
                  ? `Expires ${formatDate(stepUp.expiresAt)}`
                  : 'No fresh step-up'}
              </span>
            </div>
          </section>

          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h3 className="text-sm font-semibold text-white">
              Provider secrets
            </h3>
            <div className="mt-3 flex flex-col gap-3">
              {secretNames.map((name) => (
                <SecretEditor
                  key={name}
                  name={name}
                  metadata={config.secrets[name]}
                  value={secretDrafts[name]}
                  busy={busyAction !== null}
                  onChange={(value) => updateSecretDraft(name, value)}
                  onSave={() => void handleSaveSecret(name)}
                />
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h3 className="text-sm font-semibold text-white">Apply</h3>
            <p className="mt-2 text-sm text-gray-400">
              Apply only promotes validated pending values. Re-embedding changes
              require the migration path.
            </p>
            {hasBlockingValidationFailure ? (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                Resolve validation errors before applying.
              </div>
            ) : null}
            {hasMissingConnectionValidation ? (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <p>Run connection validation before applying.</p>
                <p className="mt-1 font-mono">
                  {missingConnectionValidation.join(', ')}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleApply}
              className={`mt-3 w-full ${buttonClassName(reembedRequired ? 'danger' : 'primary')}`}
              disabled={applyDisabled}
            >
              Apply provider configuration
            </button>
            {applyResult ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <dt className="text-gray-500">Extraction reload</dt>
                <dd className="text-gray-200">
                  {applyResult.reload.extraction}
                </dd>
                <dt className="text-gray-500">Embedding reload</dt>
                <dd className="text-gray-200">
                  {applyResult.reload.embedding}
                </dd>
              </dl>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}

function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) {
    return null;
  }

  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {message}
    </div>
  );
}

function ImpactWarnings({
  restartRequired,
  reembedRequired
}: {
  restartRequired: boolean;
  reembedRequired: boolean;
}) {
  if (!restartRequired && !reembedRequired) {
    return null;
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {restartRequired ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <h3 className="text-sm font-semibold text-amber-100">
            Restart required
          </h3>
          <p className="mt-1 text-xs text-amber-100/80">
            The API reports these changes need a controlled restart or provider
            reload before operators should treat them as active.
          </p>
        </div>
      ) : null}
      {reembedRequired ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <h3 className="text-sm font-semibold text-red-100">
            Re-embedding required
          </h3>
          <p className="mt-1 text-xs text-red-100/80">
            Embedding provider, model, or dimension changes are migration work
            and are blocked from simple apply.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SettingInput({
  label,
  value,
  inputMode,
  tone = 'default',
  helpText,
  disabled = false,
  onChange
}: {
  label: string;
  value: string;
  inputMode?: 'numeric';
  tone?: 'default' | 'danger';
  helpText?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label
      className={`flex flex-col gap-1 text-xs font-medium ${tone === 'danger' ? 'text-red-100' : 'text-gray-300'}`}
    >
      <span className="flex items-center gap-2">
        {label}
        {helpText ? (
          <span
            className={badgeClassName(tone === 'danger' ? 'danger' : 'default')}
          >
            {helpText}
          </span>
        ) : null}
      </span>
      <input
        className={inputClassName(tone)}
        aria-label={label}
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SettingsStateTable({
  title,
  settings
}: {
  title: string;
  settings: AdminRuntimeSettingSnapshot[];
}) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span
          className={badgeClassName(settings.length > 0 ? 'default' : 'warn')}
        >
          {settings.length}
        </span>
      </div>
      {settings.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No settings in this state.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="whitespace-nowrap py-2 pr-3 font-medium">Key</th>
                <th className="whitespace-nowrap py-2 pr-3 font-medium">
                  Value
                </th>
                <th className="whitespace-nowrap py-2 pr-3 font-medium">
                  Source
                </th>
                <th className="whitespace-nowrap py-2 pr-3 font-medium">
                  Validation
                </th>
                <th className="whitespace-nowrap py-2 pr-3 font-medium">
                  Applied at
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-200">
              {settings.map((setting) => (
                <tr key={`${title}-${setting.key}`}>
                  <td className="whitespace-nowrap py-2 pr-3 font-mono text-gray-100">
                    {setting.key}
                  </td>
                  <td className="max-w-[16rem] truncate py-2 pr-3">
                    {formatValue(setting.value)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {setting.source}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    <span
                      className={badgeClassName(
                        validationTone(setting.validation.status)
                      )}
                    >
                      Validation: {setting.validation.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {formatDate(setting.appliedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SecretEditor({
  name,
  metadata,
  value,
  busy,
  onChange,
  onSave
}: {
  name: AdminProviderSecretName;
  metadata: AdminRuntimeSecretMetadata | null;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-mono text-xs font-semibold text-gray-100">
          {name}
        </h4>
        <span className={badgeClassName(metadata ? 'good' : 'warn')}>
          {metadata ? 'Configured' : 'Not configured'}
        </span>
      </div>
      {metadata ? (
        <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
          <dt className="text-gray-500">Provider</dt>
          <dd className="truncate text-gray-200">
            {metadata.provider ?? 'unset'}
          </dd>
          <dt className="text-gray-500">Purpose</dt>
          <dd className="truncate text-gray-200">{metadata.purpose}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd className="truncate text-gray-200">
            {metadata.validation.status}
          </dd>
          <dt className="text-gray-500">Updated</dt>
          <dd className="truncate text-gray-200">
            {formatDate(metadata.updatedAt)}
          </dd>
        </dl>
      ) : null}
      <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-300">
        {name} replacement
        <input
          className={inputClassName()}
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={onSave}
        className={`mt-2 w-full ${buttonClassName()}`}
        disabled={busy || !value.trim()}
      >
        Save {name} secret
      </button>
    </div>
  );
}

function ValidationPanel({
  validation
}: {
  validation: AdminProviderValidationResult | null;
}) {
  if (!validation) {
    return null;
  }

  const connectionEntries = Object.entries(validation.connectionTests);

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Validation result</h3>
        <span
          className={badgeClassName(
            validation.status === 'valid'
              ? 'good'
              : validation.reembedRequired
                ? 'danger'
                : 'warn'
          )}
        >
          {validation.status}
        </span>
      </div>
      {validation.runtime.errors.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm text-red-100">
          {validation.runtime.errors.map((error) => (
            <li
              key={`${error.field}-${error.message}`}
              className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2"
            >
              <span className="font-mono text-xs text-red-200">
                {error.field}
              </span>
              <span className="ml-2">{error.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {connectionEntries.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {connectionEntries.map(([key, result]) =>
            result ? (
              <div
                key={key}
                className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-gray-300">{key}</span>
                  <span
                    className={badgeClassName(validationTone(result.status))}
                  >
                    {result.status}
                  </span>
                </div>
                <p className="mt-1 text-gray-300">{result.message}</p>
              </div>
            ) : null
          )}
        </div>
      ) : null}
      {validation.embedding.current || validation.embedding.target ? (
        <dl className="mt-3 grid gap-2 text-xs md:grid-cols-2">
          <IdentityBlock
            title="Current embedding"
            identity={validation.embedding.current}
          />
          <IdentityBlock
            title="Target embedding"
            identity={validation.embedding.target}
          />
        </dl>
      ) : null}
    </section>
  );
}

function IdentityBlock({
  title,
  identity
}: {
  title: string;
  identity: AdminProviderValidationResult['embedding']['current'];
}) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
      <dt className="text-gray-500">{title}</dt>
      <dd className="mt-1 text-gray-200">
        {identity
          ? `${identity.provider} / ${identity.model} / ${identity.dimensions}`
          : 'none'}
      </dd>
    </div>
  );
}
