import { useEffect, useMemo, useState } from 'react';
import type {
  AdminApiClient,
  AdminAuthResponse,
  AdminJsonValue,
  AdminOnboardingState,
  AdminOnboardingStep,
  AdminProviderConfigSettingKey,
  AdminProviderConfiguration,
  AdminProviderSecretName,
  AdminProviderValidationResult,
  AdminRuntimeSecretMetadata,
  AdminStepUp
} from '../../lib/adminApi.ts';

export type AdminOnboardingPanelTarget =
  | 'backup'
  | 'help'
  | 'maintenance'
  | 'provider-config';

type AdminOnboardingProps = {
  api: AdminApiClient;
  initialStepUp?: AdminStepUp;
  onboarding: AdminOnboardingState;
  onAuthUpdate?: (response: AdminAuthResponse) => void;
  onOpenPanel: (panel: AdminOnboardingPanelTarget) => void;
  onSessionExpired: (error: unknown) => boolean;
  onStateChange: (state: AdminOnboardingState) => void;
};

type OnboardingStepDefinition = {
  id: AdminOnboardingStep;
  title: string;
  doneLabel: string;
  panel: AdminOnboardingPanelTarget;
  panelLabel: string;
  body: string;
  details: string[];
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

const steps = [
  {
    id: 'setup',
    title: 'Security setup',
    doneLabel: 'security setup',
    panel: 'help',
    panelLabel: 'Open Help',
    body:
      'The first admin account is active and MFA is verified. Onboarding starts after that security baseline is in place.',
    details: [
      'Admin sign-in is separate from API keys.',
      'Sensitive actions can ask for a fresh MFA confirmation code.'
    ]
  },
  {
    id: 'provider_config',
    title: 'Provider settings',
    doneLabel: 'provider settings',
    panel: 'provider-config',
    panelLabel: 'Open full Config',
    body:
      'Set embeddings first, then extraction. Embeddings power semantic search; extraction asks an LLM to find entities and graph relationships.',
    details: [
      'Embeddings are required for Postgram search and memory matching.',
      'Extraction is optional and can stay off until provider credentials are ready.'
    ]
  },
  {
    id: 'secrets',
    title: 'Provider secrets',
    doneLabel: 'provider secrets',
    panel: 'provider-config',
    panelLabel: 'Open full Config',
    body:
      'Provider secrets are write-only. If a secret is already set through Docker environment variables, you can leave the database override empty.',
    details: [
      'OPENAI_API_KEY covers OpenAI embeddings and OpenAI extraction.',
      'ANTHROPIC_API_KEY covers Anthropic extraction.',
      'EXTRACTION_API_KEY and EMBEDDING_API_KEY cover custom or protected compatible endpoints.'
    ]
  },
  {
    id: 'validate_apply',
    title: 'Validate configuration',
    doneLabel: 'validation',
    panel: 'provider-config',
    panelLabel: 'Open full Config',
    body:
      'Run backend validation before using the configuration. Validation checks runtime construction and provider connections.',
    details: [
      'Connection tests can require fresh MFA confirmation because they touch provider endpoints.',
      'Validation does not expose provider secret values.'
    ]
  },
  {
    id: 'backup_restore',
    title: 'Backup and restore safety',
    doneLabel: 'backup and restore safety',
    panel: 'backup',
    panelLabel: 'Open Backup',
    body:
      'Create backups before risky configuration or maintenance work. Restore is staged into a separate database first so the current Postgres volume stays intact.',
    details: [
      'The Docker path preserves pgdata; do not use docker compose down -v when testing onboarding.',
      'Switch over only after validation and health checks pass.'
    ]
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    doneLabel: 'maintenance concepts',
    panel: 'maintenance',
    panelLabel: 'Open Maintenance',
    body:
      'Maintenance jobs repair or rebuild derived data. Start with a dry-run preview, inspect the scope, then apply only when the result matches what you intend.',
    details: [
      'Re-extract reruns LLM entity and relationship extraction for selected records.',
      'Re-embed rebuilds vector chunks with the active embedding model.',
      'Prune edges removes low-confidence LLM-created graph relationships.'
    ]
  }
] as const satisfies readonly OnboardingStepDefinition[];

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

const embeddingProviderOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'ollama', label: 'Ollama' }
];

const extractionProviderOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' }
];

const secretPurpose: Record<AdminProviderSecretName, string> = {
  OPENAI_API_KEY: 'OpenAI embeddings and OpenAI extraction.',
  ANTHROPIC_API_KEY: 'Anthropic extraction.',
  OLLAMA_API_KEY: 'Protected Ollama endpoints, if your Ollama server requires a bearer token.',
  EXTRACTION_API_KEY: 'Custom OpenAI-compatible extraction endpoints.',
  EMBEDDING_API_KEY: 'Custom or protected embedding endpoints.'
};

const maintenanceConcepts = [
  {
    title: 'Re-extract',
    body:
      'Queues selected records for LLM extraction again. Use it when extraction was disabled, failed, or used the wrong model or prompt.'
  },
  {
    title: 'Re-embed',
    body:
      'Deletes and rebuilds vector chunks with the active embedding model. Use it after embedding provider/model repair or a planned embedding migration.'
  },
  {
    title: 'Prune edges',
    body:
      'Deletes low-confidence graph edges created by LLM extraction. It is for cleaning noisy inferred relationships, not manually curated data.'
  },
  {
    title: 'Dry-run preview',
    body:
      'Shows the scope and implications before apply. Review it first because apply can spend provider quota or change database rows.'
  }
];

function stepIndex(step: AdminOnboardingStep): number {
  const index = steps.findIndex((candidate) => candidate.id === step);
  return index === -1 ? 0 : index;
}

function nextStep(step: AdminOnboardingStep): AdminOnboardingStep | null {
  const next = steps[stepIndex(step) + 1];
  return next?.id ?? null;
}

function completedWith(
  completedSteps: readonly AdminOnboardingStep[],
  step: AdminOnboardingStep
): AdminOnboardingStep[] {
  return completedSteps.includes(step)
    ? [...completedSteps]
    : [...completedSteps, step];
}

function statusText(onboarding: AdminOnboardingState): string {
  if (onboarding.status === 'completed') {
    return 'Completed';
  }
  if (onboarding.status === 'skipped') {
    return 'Skipped';
  }
  return 'In progress';
}

function stringValue(value: AdminJsonValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function settingValue(
  config: AdminProviderConfiguration,
  key: AdminProviderConfigSettingKey
): AdminJsonValue | undefined {
  return config.settings[key].value;
}

function draftFromConfig(
  config: AdminProviderConfiguration
): ProviderSettingsDraft {
  return {
    EXTRACTION_ENABLED: config.settings.EXTRACTION_ENABLED.value === true,
    EXTRACTION_PROVIDER:
      stringValue(config.settings.EXTRACTION_PROVIDER.value) || 'openai',
    EXTRACTION_MODEL: stringValue(config.settings.EXTRACTION_MODEL.value),
    EXTRACTION_BASE_URL: stringValue(config.settings.EXTRACTION_BASE_URL.value),
    OLLAMA_BASE_URL: stringValue(config.settings.OLLAMA_BASE_URL.value),
    EMBEDDING_PROVIDER:
      stringValue(config.settings.EMBEDDING_PROVIDER.value) || 'openai',
    EMBEDDING_MODEL: stringValue(config.settings.EMBEDDING_MODEL.value),
    EMBEDDING_DIMENSIONS: stringValue(
      config.settings.EMBEDDING_DIMENSIONS.value
    ),
    EMBEDDING_BASE_URL: stringValue(config.settings.EMBEDDING_BASE_URL.value)
  };
}

function emptySecretDrafts(): SecretDrafts {
  return {
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    OLLAMA_API_KEY: '',
    EXTRACTION_API_KEY: '',
    EMBEDDING_API_KEY: ''
  };
}

function envSecretConfigured(
  config: AdminProviderConfiguration,
  name: AdminProviderSecretName
): boolean {
  return config.envSecrets?.[name] ?? false;
}

function draftValueChanged(
  config: AdminProviderConfiguration,
  draft: ProviderSettingsDraft,
  key: AdminProviderConfigSettingKey
): boolean {
  if (key === 'EXTRACTION_ENABLED') {
    return draft.EXTRACTION_ENABLED !== (settingValue(config, key) === true);
  }
  return stringValue(settingValue(config, key)).trim() !== draft[key].trim();
}

function buildSettingsPayload(
  config: AdminProviderConfiguration,
  draft: ProviderSettingsDraft
):
  | { settings: Partial<Record<AdminProviderConfigSettingKey, AdminJsonValue>> }
  | { error: string } {
  const dimensions = draft.EMBEDDING_DIMENSIONS.trim();
  if (dimensions && !Number.isInteger(Number(dimensions))) {
    return { error: 'Embedding dimensions must be a whole number.' };
  }
  if (!dimensions && settingValue(config, 'EMBEDDING_DIMENSIONS') !== undefined) {
    return {
      error: 'Embedding dimensions cannot be cleared through onboarding.'
    };
  }

  const settings: Partial<Record<AdminProviderConfigSettingKey, AdminJsonValue>> =
    {};
  if (draft.EXTRACTION_ENABLED !== (settingValue(config, 'EXTRACTION_ENABLED') === true)) {
    settings.EXTRACTION_ENABLED = draft.EXTRACTION_ENABLED;
  }

  for (const key of settingKeys) {
    if (key === 'EXTRACTION_ENABLED' || key === 'EMBEDDING_DIMENSIONS') {
      continue;
    }
    const value = draft[key].trim();
    if (!value && settingValue(config, key) !== undefined) {
      return { error: `${key} cannot be cleared through onboarding.` };
    }
    if (value && draftValueChanged(config, draft, key)) {
      settings[key] = value;
    }
  }

  if (
    dimensions &&
    Number(dimensions) !== settingValue(config, 'EMBEDDING_DIMENSIONS')
  ) {
    settings.EMBEDDING_DIMENSIONS = Number(dimensions);
  }

  return { settings };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function inputClassName() {
  return 'w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:text-gray-500';
}

function buttonClassName(
  variant: 'primary' | 'secondary' | 'good' = 'secondary'
) {
  const base =
    'rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500';
  if (variant === 'primary') {
    return `${base} bg-blue-600 text-white hover:bg-blue-500`;
  }
  if (variant === 'good') {
    return `${base} bg-green-600 text-white hover:bg-green-500`;
  }
  return `${base} bg-gray-800 text-gray-100 hover:bg-gray-700`;
}

function badgeClassName(tone: 'default' | 'good' | 'warn' = 'default') {
  const base =
    'inline-flex min-h-6 items-center rounded-md border px-2 py-0.5 text-xs font-medium';
  if (tone === 'good') {
    return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`;
  }
  if (tone === 'warn') {
    return `${base} border-amber-500/30 bg-amber-500/10 text-amber-200`;
  }
  return `${base} border-gray-700 bg-gray-800 text-gray-300`;
}

function isStepUpFresh(stepUp: AdminStepUp | undefined): boolean {
  if (!stepUp?.fresh || !stepUp.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(stepUp.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

function validationLabel(validation: AdminProviderValidationResult): string {
  if (validation.status === 'valid') {
    return 'Valid';
  }
  if (validation.status === 'requires_reembedding') {
    return 'Valid, re-embedding required';
  }
  if (validation.status === 'invalid') {
    return 'Invalid';
  }
  return 'Validation error';
}

export default function AdminOnboarding({
  api,
  initialStepUp,
  onboarding,
  onAuthUpdate,
  onOpenPanel,
  onSessionExpired,
  onStateChange
}: AdminOnboardingProps) {
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [busyAction, setBusyAction] = useState<
    | 'complete'
    | 'secret'
    | 'settings'
    | 'skip'
    | 'update'
    | 'validate'
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providerConfig, setProviderConfig] =
    useState<AdminProviderConfiguration | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);
  const [settingsDraft, setSettingsDraft] =
    useState<ProviderSettingsDraft | null>(null);
  const [secretDrafts, setSecretDrafts] =
    useState<SecretDrafts>(emptySecretDrafts);
  const [stepUp, setStepUp] = useState<AdminStepUp | undefined>(initialStepUp);
  const [stepUpCode, setStepUpCode] = useState('');
  const [validation, setValidation] =
    useState<AdminProviderValidationResult | null>(null);
  const activeIndex = stepIndex(onboarding.currentStep);
  const activeStep = steps[activeIndex] ?? steps[0];
  const isFinished = onboarding.status !== 'in_progress';
  const needsProviderConfig =
    activeStep.id === 'provider_config' ||
    activeStep.id === 'secrets' ||
    activeStep.id === 'validate_apply';
  const progressText = useMemo(
    () => `Step ${activeIndex + 1} of ${steps.length}`,
    [activeIndex]
  );

  useEffect(() => {
    setStepUp(initialStepUp);
  }, [initialStepUp]);

  useEffect(() => {
    if (!needsProviderConfig || providerConfig) {
      return;
    }

    let cancelled = false;
    async function loadProviderConfig() {
      setProviderLoading(true);
      setError(null);
      try {
        const response = await api.getProviderConfig();
        if (cancelled) {
          return;
        }
        setProviderConfig(response.config);
        setSettingsDraft(draftFromConfig(response.config));
      } catch (loadError) {
        if (!cancelled && !onSessionExpired(loadError)) {
          setError(
            errorMessage(loadError, 'Unable to load provider configuration')
          );
        }
      } finally {
        if (!cancelled) {
          setProviderLoading(false);
        }
      }
    }

    void loadProviderConfig();
    return () => {
      cancelled = true;
    };
  }, [api, needsProviderConfig, onSessionExpired, providerConfig]);

  function updateSetting(
    key: keyof ProviderSettingsDraft,
    value: string | boolean
  ) {
    setSettingsDraft((previous) =>
      previous
        ? {
            ...previous,
            [key]: value
          }
        : previous
    );
  }

  function updateSecretDraft(name: AdminProviderSecretName, value: string) {
    setSecretDrafts((previous) => ({
      ...previous,
      [name]: value
    }));
  }

  async function refreshProviderConfig() {
    const refreshed = await api.getProviderConfig();
    setProviderConfig(refreshed.config);
    setSettingsDraft(draftFromConfig(refreshed.config));
    return refreshed.config;
  }

  async function handleStateRequest(
    action: 'complete' | 'skip' | 'update',
    request: () => Promise<{ onboarding: AdminOnboardingState }>
  ) {
    setBusyAction(action);
    setError(null);
    try {
      const response = await request();
      setConfirmSkip(false);
      onStateChange(response.onboarding);
    } catch (requestError) {
      if (!onSessionExpired(requestError)) {
        setError(errorMessage(requestError, 'Unable to update onboarding'));
      }
    } finally {
      setBusyAction(null);
    }
  }

  function handleAdvance() {
    const followingStep = nextStep(activeStep.id);
    if (!followingStep) {
      void handleStateRequest('complete', () => api.completeOnboarding());
      return;
    }

    void handleStateRequest('update', () =>
      api.updateOnboarding({
        currentStep: followingStep,
        completedSteps: completedWith(onboarding.completedSteps, activeStep.id)
      })
    );
  }

  async function ensureStepUp(): Promise<boolean> {
    if (isStepUpFresh(stepUp)) {
      return true;
    }
    if (!stepUpCode.trim()) {
      setError('Enter an MFA confirmation code before this sensitive action.');
      return false;
    }

    const response = await api.stepUp({ code: stepUpCode.trim() });
    setStepUp(response.stepUp);
    setStepUpCode('');
    onAuthUpdate?.(response);
    return true;
  }

  async function handleSaveSettingsAndAdvance() {
    if (!providerConfig || !settingsDraft) {
      setError('Provider configuration is still loading.');
      return;
    }

    const payload = buildSettingsPayload(providerConfig, settingsDraft);
    if ('error' in payload) {
      setError(payload.error);
      return;
    }

    setBusyAction('settings');
    setError(null);
    setNotice(null);
    try {
      if (Object.keys(payload.settings).length > 0) {
        const response = await api.saveProviderConfig({
          settings: payload.settings
        });
        setProviderConfig(response.config);
        setSettingsDraft(draftFromConfig(response.config));
        setValidation(null);
      }
      const followingStep = nextStep(activeStep.id);
      if (followingStep) {
        const response = await api.updateOnboarding({
          currentStep: followingStep,
          completedSteps: completedWith(
            onboarding.completedSteps,
            activeStep.id
          )
        });
        onStateChange(response.onboarding);
      }
    } catch (saveError) {
      if (!onSessionExpired(saveError)) {
        setError(errorMessage(saveError, 'Unable to save provider settings'));
      }
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

    setBusyAction('secret');
    setError(null);
    setNotice(null);
    try {
      if (!(await ensureStepUp())) {
        return;
      }
      await api.saveProviderSecret({ name, plaintext });
      setSecretDrafts((previous) => ({
        ...previous,
        [name]: ''
      }));
      await refreshProviderConfig();
      setValidation(null);
      setNotice(`${name} saved as write-only metadata.`);
    } catch (secretError) {
      if (!onSessionExpired(secretError)) {
        setError(errorMessage(secretError, `Unable to save ${name}`));
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleValidate() {
    setBusyAction('validate');
    setError(null);
    setNotice(null);
    try {
      if (!(await ensureStepUp())) {
        return;
      }
      const response = await api.validateProviderConfig({
        testConnections: true
      });
      setValidation(response.validation);
      await refreshProviderConfig();
      setNotice('Provider configuration validated by the backend.');
    } catch (validateError) {
      if (!onSessionExpired(validateError)) {
        setError(
          errorMessage(validateError, 'Unable to validate provider configuration')
        );
      }
    } finally {
      setBusyAction(null);
    }
  }

  function providerContent() {
    if (!needsProviderConfig) {
      return null;
    }
    if (providerLoading || !providerConfig || !settingsDraft) {
      return (
        <p className="mt-4 text-sm text-gray-400">
          Loading provider configuration
        </p>
      );
    }

    if (activeStep.id === 'provider_config') {
      return (
        <div className="mt-5 grid gap-4">
          <section className="rounded-md border border-gray-800 bg-gray-950 p-4">
            <h4 className="text-sm font-semibold text-white">
              Embedding settings
            </h4>
            <p className="mt-2 text-sm leading-6 text-gray-300">
              Embeddings are always part of Postgram storage and search. Choose
              where vectors are generated before enabling heavier graph
              extraction work.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <SettingSelect
                label="Embedding provider"
                value={settingsDraft.EMBEDDING_PROVIDER}
                options={embeddingProviderOptions}
                disabled={busyAction !== null}
                onChange={(value) => updateSetting('EMBEDDING_PROVIDER', value)}
              />
              <SettingInput
                label="Ollama base URL"
                helpText="Use http://host.docker.internal:11434 if Ollama runs on your Docker host."
                value={settingsDraft.OLLAMA_BASE_URL}
                disabled={busyAction !== null}
                onChange={(value) => updateSetting('OLLAMA_BASE_URL', value)}
              />
              <SettingInput
                label="Embedding model"
                value={settingsDraft.EMBEDDING_MODEL}
                disabled={busyAction !== null}
                onChange={(value) => updateSetting('EMBEDDING_MODEL', value)}
              />
              <SettingInput
                label="Embedding dimensions"
                inputMode="numeric"
                value={settingsDraft.EMBEDDING_DIMENSIONS}
                disabled={busyAction !== null}
                onChange={(value) =>
                  updateSetting('EMBEDDING_DIMENSIONS', value)
                }
              />
              <SettingInput
                label="Embedding base URL"
                helpText="Optional dedicated embedding endpoint. Leave empty to use the shared Ollama base URL when the provider is Ollama."
                value={settingsDraft.EMBEDDING_BASE_URL}
                disabled={busyAction !== null}
                onChange={(value) => updateSetting('EMBEDDING_BASE_URL', value)}
              />
            </div>
          </section>

          <section className="rounded-md border border-gray-800 bg-gray-950 p-4">
            <h4 className="text-sm font-semibold text-white">
              Extraction settings
            </h4>
            <p className="mt-2 text-sm leading-6 text-gray-300">
              Extraction uses a chat model to derive entities and relationships
              from stored content. Keep it disabled if you only want storage and
              semantic search for now.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={settingsDraft.EXTRACTION_ENABLED}
                  disabled={busyAction !== null}
                  onChange={(event) =>
                    updateSetting('EXTRACTION_ENABLED', event.target.checked)
                  }
                  className="accent-blue-500"
                />
                Extraction enabled
              </label>
              <SettingSelect
                label="Extraction provider"
                value={settingsDraft.EXTRACTION_PROVIDER}
                options={extractionProviderOptions}
                disabled={busyAction !== null}
                onChange={(value) =>
                  updateSetting('EXTRACTION_PROVIDER', value)
                }
              />
              <SettingInput
                label="Extraction model"
                value={settingsDraft.EXTRACTION_MODEL}
                disabled={busyAction !== null}
                onChange={(value) => updateSetting('EXTRACTION_MODEL', value)}
              />
              <SettingInput
                label="Extraction base URL"
                helpText="Required for OpenAI-compatible extraction endpoints. For local Ollama, use the shared Ollama base URL above."
                value={settingsDraft.EXTRACTION_BASE_URL}
                disabled={busyAction !== null}
                onChange={(value) =>
                  updateSetting('EXTRACTION_BASE_URL', value)
                }
              />
            </div>
          </section>
        </div>
      );
    }

    if (activeStep.id === 'secrets') {
      return (
        <div className="mt-5 grid gap-4">
          <StepUpInput
            stepUp={stepUp}
            stepUpCode={stepUpCode}
            disabled={busyAction !== null}
            onChange={setStepUpCode}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {secretNames.map((name) => (
              <SecretCard
                key={name}
                name={name}
                metadata={providerConfig.secrets[name]}
                envConfigured={envSecretConfigured(providerConfig, name)}
                value={secretDrafts[name]}
                busy={busyAction !== null}
                onChange={(value) => updateSecretDraft(name, value)}
                onSave={() => void handleSaveSecret(name)}
              />
            ))}
          </div>
        </div>
      );
    }

    if (activeStep.id === 'validate_apply') {
      return (
        <div className="mt-5 grid gap-4">
          <StepUpInput
            stepUp={stepUp}
            stepUpCode={stepUpCode}
            disabled={busyAction !== null}
            onChange={setStepUpCode}
          />
          <section className="rounded-md border border-gray-800 bg-gray-950 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-white">
                Backend validation
              </h4>
              {validation ? (
                <span
                  className={badgeClassName(
                    validation.status === 'valid' ||
                      validation.status === 'requires_reembedding'
                      ? 'good'
                      : 'warn'
                  )}
                >
                  {validationLabel(validation)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-300">
              This calls the admin provider validation endpoint with connection
              tests enabled. It checks whether the saved pending configuration
              can be constructed by the backend.
            </p>
            <button
              type="button"
              className={`mt-3 ${buttonClassName('primary')}`}
              disabled={busyAction !== null}
              onClick={() => void handleValidate()}
            >
              {busyAction === 'validate'
                ? 'Validating...'
                : 'Validate configuration'}
            </button>
            {validation?.runtime.errors.length ? (
              <ul className="mt-3 grid gap-2 text-sm text-amber-100">
                {validation.runtime.errors.map((item) => (
                  <li
                    key={`${item.field}-${item.message}`}
                    className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2"
                  >
                    <span className="font-mono">{item.field}</span>: {item.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      );
    }

    return null;
  }

  const validationReady =
    activeStep.id !== 'validate_apply' ||
    validation?.status === 'valid' ||
    validation?.status === 'requires_reembedding';

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-lg border border-blue-900/60 bg-blue-950/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-blue-200">
              {statusText(onboarding)}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Admin onboarding
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-300">
              A Docker-first setup wizard for operators who know services and
              credentials, but do not want to become vector database experts
              before Postgram is usable.
            </p>
          </div>
          <div className="rounded-md border border-blue-800 bg-blue-950 px-3 py-2 text-sm text-blue-100">
            {progressText}
          </div>
        </div>

        {isFinished ? (
          <p className="mt-4 text-sm text-gray-300">
            Onboarding is {onboarding.status}. It stays here for reference and
            can be reopened from the dashboard at any time.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <ol className="space-y-2">
          {steps.map((step, index) => {
            const complete = onboarding.completedSteps.includes(step.id);
            const current = step.id === activeStep.id;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() =>
                    onStateChange({
                      ...onboarding,
                      currentStep: step.id
                    })
                  }
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    current
                      ? 'border-blue-500 bg-blue-950/70 text-white'
                      : 'border-gray-800 bg-gray-950 text-gray-400 hover:border-gray-700 hover:text-gray-100'
                  }`}
                >
                  <span className="block text-[11px] uppercase text-gray-500">
                    Step {index + 1}
                  </span>
                  <span>{step.title}</span>
                  {complete ? (
                    <span className="mt-1 block text-xs text-green-300">
                      Done
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>

        <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase text-gray-500">{progressText}</p>
              <h3 className="mt-1 text-lg font-semibold text-white">
                {activeStep.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onOpenPanel(activeStep.panel)}
              className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-100 transition-colors hover:border-blue-500 hover:text-blue-100"
            >
              {activeStep.panelLabel}
            </button>
          </div>

          <p className="mt-4 text-sm leading-6 text-gray-300">
            {activeStep.body}
          </p>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-gray-300">
            {activeStep.details.map((detail) => (
              <li key={detail} className="rounded-md bg-gray-950 px-3 py-2">
                {detail}
              </li>
            ))}
          </ul>

          {activeStep.id === 'maintenance' ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {maintenanceConcepts.map((concept) => (
                <div
                  key={concept.title}
                  className="rounded-md border border-gray-800 bg-gray-950 p-3"
                >
                  <h4 className="text-sm font-semibold text-white">
                    {concept.title}
                  </h4>
                  <p className="mt-1 text-sm leading-6 text-gray-300">
                    {concept.body}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {providerContent()}

          {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
          {notice ? (
            <p className="mt-4 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-100">
              {notice}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {activeStep.id === 'provider_config' ? (
              <button
                type="button"
                disabled={busyAction !== null || isFinished || providerLoading}
                onClick={() => void handleSaveSettingsAndAdvance()}
                className={buttonClassName('primary')}
              >
                {busyAction === 'settings'
                  ? 'Saving...'
                  : 'Save provider settings and continue'}
              </button>
            ) : nextStep(activeStep.id) ? (
              <button
                type="button"
                disabled={busyAction !== null || isFinished || !validationReady}
                onClick={handleAdvance}
                className={buttonClassName('primary')}
              >
                {busyAction === 'update'
                  ? 'Saving...'
                  : `Mark ${activeStep.doneLabel} done`}
              </button>
            ) : (
              <button
                type="button"
                disabled={busyAction !== null || isFinished}
                onClick={handleAdvance}
                className={buttonClassName('good')}
              >
                {busyAction === 'complete' ? 'Finishing...' : 'Finish onboarding'}
              </button>
            )}

            <button
              type="button"
              disabled={busyAction !== null || isFinished}
              onClick={() => setConfirmSkip(true)}
              className="rounded-md px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:text-gray-600"
            >
              Skip onboarding
            </button>
          </div>

          {confirmSkip ? (
            <div className="mt-4 rounded-md border border-amber-700 bg-amber-950/40 p-3">
              <p className="text-sm leading-6 text-amber-100">
                Skipping hides the automatic guide, but you can reopen
                onboarding from the dashboard whenever you want to review these
                steps.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    void handleStateRequest('skip', () => api.skipOnboarding())
                  }
                  className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
                >
                  {busyAction === 'skip'
                    ? 'Skipping...'
                    : 'Skip onboarding anyway'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmSkip(false)}
                  className="rounded-md px-3 py-2 text-sm text-amber-100 transition-colors hover:bg-amber-900/60"
                >
                  Keep onboarding
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function SettingInput({
  label,
  value,
  inputMode,
  helpText,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  inputMode?: 'numeric';
  helpText?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
      <span>{label}</span>
      {helpText ? (
        <span className="text-xs font-normal leading-5 text-gray-500">
          {helpText}
        </span>
      ) : null}
      <input
        className={inputClassName()}
        aria-label={label}
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SettingSelect({
  label,
  value,
  disabled,
  options,
  onChange
}: {
  label: string;
  value: string;
  disabled: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
      <span>{label}</span>
      <select
        className={inputClassName()}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StepUpInput({
  stepUp,
  stepUpCode,
  disabled,
  onChange
}: {
  stepUp: AdminStepUp | undefined;
  stepUpCode: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-md border border-gray-800 bg-gray-950 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-white">
          Sensitive action confirmation
        </h4>
        <span className={badgeClassName(isStepUpFresh(stepUp) ? 'good' : 'warn')}>
          {isStepUpFresh(stepUp) ? 'MFA confirmed' : 'MFA code required'}
        </span>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-300">
        MFA confirmation code
        <input
          className={inputClassName()}
          aria-label="MFA confirmation code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          autoComplete="one-time-code"
          disabled={disabled || isStepUpFresh(stepUp)}
          value={stepUpCode}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            isStepUpFresh(stepUp)
              ? 'MFA confirmation active'
              : 'Six-digit authenticator code'
          }
        />
      </label>
    </section>
  );
}

function SecretCard({
  name,
  metadata,
  envConfigured,
  value,
  busy,
  onChange,
  onSave
}: {
  name: AdminProviderSecretName;
  metadata: AdminRuntimeSecretMetadata | null;
  envConfigured: boolean;
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
          {metadata ? 'Database secret saved' : 'No database secret'}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-gray-400">
        {secretPurpose[name]}
      </p>
      {envConfigured ? (
        <p className="mt-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1.5 text-xs leading-5 text-blue-100">
          {name} is already available from environment. You do not need to save
          it again unless you want a database override.
        </p>
      ) : null}
      <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-300">
        {name} replacement
        <input
          className={inputClassName()}
          aria-label={`${name} replacement`}
          type="password"
          autoComplete="new-password"
          value={value}
          disabled={busy}
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
