import { useMemo, useState } from 'react';
import type {
  AdminApiClient,
  AdminOnboardingState,
  AdminOnboardingStep
} from '../../lib/adminApi.ts';

export type AdminOnboardingPanelTarget =
  | 'backup'
  | 'help'
  | 'maintenance'
  | 'provider-config';

type AdminOnboardingProps = {
  api: AdminApiClient;
  onboarding: AdminOnboardingState;
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

const steps = [
  {
    id: 'setup',
    title: 'Setup overview',
    doneLabel: 'setup overview',
    panel: 'help',
    panelLabel: 'Open Help',
    body:
      'Confirm the first admin and MFA setup are working before changing runtime behavior.',
    details: [
      'Admin sign-in is separate from API keys.',
      'MFA confirmation is needed again for sensitive changes.'
    ]
  },
  {
    id: 'provider_config',
    title: 'Provider configuration',
    doneLabel: 'provider configuration',
    panel: 'provider-config',
    panelLabel: 'Open Config',
    body:
      'Choose where embeddings and extraction run. Embeddings power meaning-based search; extraction asks an LLM to find people, projects, tasks, documents, and relationships.',
    details: [
      'Ollama keeps model calls local; OpenAI-compatible providers need network egress.',
      'Embedding provider, model, and dimensions must match vectors already stored in Postgres.'
    ]
  },
  {
    id: 'secrets',
    title: 'Provider secrets',
    doneLabel: 'provider secrets',
    panel: 'provider-config',
    panelLabel: 'Open Config',
    body:
      'Save provider API keys only in the write-only secret fields. Postgram stores encrypted metadata and never shows the plaintext secret again.',
    details: [
      'Use OPENAI_API_KEY for OpenAI, ANTHROPIC_API_KEY for Anthropic extraction, and custom extraction or embedding keys only for compatible endpoints.',
      'A saved secret can be replaced, but it cannot be read back from the UI.'
    ]
  },
  {
    id: 'validate_apply',
    title: 'Validate and apply',
    doneLabel: 'validation and apply',
    panel: 'provider-config',
    panelLabel: 'Open Config',
    body:
      'Validation checks saved settings before Postgram starts using them. Apply makes validated settings active and tells you whether a restart or re-embedding job is required.',
    details: [
      'Connection tests may require fresh MFA confirmation because they touch provider endpoints.',
      'Embedding identity changes are maintenance work, not a casual toggle.'
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
      'Re-extract reruns LLM graph extraction.',
      'Re-embed rebuilds vector chunks with the active embedding model.',
      'Prune edges removes low-confidence extracted relationships.'
    ]
  }
] as const satisfies readonly OnboardingStepDefinition[];

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

export default function AdminOnboarding({
  api,
  onboarding,
  onOpenPanel,
  onSessionExpired,
  onStateChange
}: AdminOnboardingProps) {
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [busyAction, setBusyAction] = useState<
    'complete' | 'skip' | 'update' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const activeIndex = stepIndex(onboarding.currentStep);
  const activeStep = steps[activeIndex] ?? steps[0];
  const isFinished = onboarding.status !== 'in_progress';

  const progressText = useMemo(
    () => `Step ${activeIndex + 1} of ${steps.length}`,
    [activeIndex]
  );

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
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to update onboarding'
        );
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

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-lg border border-blue-900/60 bg-blue-950/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-blue-200">{statusText(onboarding)}</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Admin onboarding</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-300">
              A Docker-first setup path for operators who know services and
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
                    <span className="mt-1 block text-xs text-green-300">Done</span>
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

          <p className="mt-4 text-sm leading-6 text-gray-300">{activeStep.body}</p>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-gray-300">
            {activeStep.details.map((detail) => (
              <li key={detail} className="rounded-md bg-gray-950 px-3 py-2">
                {detail}
              </li>
            ))}
          </ul>

          {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {nextStep(activeStep.id) ? (
              <button
                type="button"
                disabled={busyAction !== null || isFinished}
                onClick={handleAdvance}
                className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
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
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
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
