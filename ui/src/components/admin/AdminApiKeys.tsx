import { useEffect, useState, type FormEvent } from 'react';
import {
  AdminApiError,
  type AdminApiClient,
  type AdminApiKeyMetadata,
  type AdminAuthResponse,
  type AdminEntityType,
  type AdminScope,
  type AdminVisibility,
} from '../../lib/adminApi.ts';
import { HelpLabel } from './AdminHelp.tsx';

const KEY_PAGE_SIZE = 50;
const DEFAULT_SCOPES: AdminScope[] = ['read'];
const SCOPE_OPTIONS: AdminScope[] = ['read', 'write', 'delete', 'sync'];
const ENTITY_TYPE_OPTIONS: AdminEntityType[] = [
  'document',
  'interaction',
  'memory',
  'person',
  'project',
  'task',
];
const DEFAULT_ENTITY_TYPES: AdminEntityType[] = [...ENTITY_TYPE_OPTIONS];
const VISIBILITY_OPTIONS: AdminVisibility[] = ['shared', 'work', 'personal'];
const DEFAULT_VISIBILITY: AdminVisibility[] = ['shared'];

type AdminApiKeysProps = {
  api: AdminApiClient;
  onAuthUpdate: (response: AdminAuthResponse) => void;
  onSessionExpired: (error: unknown) => boolean;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function isStepUpError(error: unknown): boolean {
  return (
    error instanceof AdminApiError &&
    error.status === 403 &&
    /step-up/i.test(error.message)
  );
}

function checkboxClassName() {
  return 'h-4 w-4 rounded border-gray-700 bg-gray-950 text-blue-600 focus:ring-blue-500';
}

function inputClassName() {
  return 'rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
}

function primaryButtonClassName() {
  return 'rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400';
}

function secondaryButtonClassName() {
  return 'rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-500';
}

export default function AdminApiKeys({
  api,
  onAuthUpdate,
  onSessionExpired,
}: AdminApiKeysProps) {
  const [keys, setKeys] = useState<AdminApiKeyMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<AdminScope>>(
    () => new Set(DEFAULT_SCOPES)
  );
  const [selectedTypes, setSelectedTypes] = useState<Set<AdminEntityType>>(
    () => new Set(DEFAULT_ENTITY_TYPES)
  );
  const [selectedVisibility, setSelectedVisibility] = useState<Set<AdminVisibility>>(
    () => new Set(DEFAULT_VISIBILITY)
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [stepUpSuccess, setStepUpSuccess] = useState<string | null>(null);
  const [submittingStepUp, setSubmittingStepUp] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadKeys() {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await api.listApiKeys({ limit: KEY_PAGE_SIZE, offset: 0 });
        if (!cancelled) {
          setKeys(response.keys);
          setNextOffset(response.pagination.nextOffset);
        }
      } catch (error) {
        if (!cancelled) {
          if (onSessionExpired(error)) {
            return;
          }
          setLoadError(errorMessage(error, 'Unable to load API keys'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadKeys();
    return () => {
      cancelled = true;
    };
  }, [api, onSessionExpired]);

  async function loadMoreKeys() {
    if (nextOffset === null) {
      return;
    }

    setLoadingMore(true);
    setLoadError(null);
    try {
      const response = await api.listApiKeys({
        limit: KEY_PAGE_SIZE,
        offset: nextOffset,
      });
      setKeys(previous => {
        const seen = new Set(previous.map(key => key.id));
        return [
          ...previous,
          ...response.keys.filter(key => !seen.has(key.id)),
        ];
      });
      setNextOffset(response.pagination.nextOffset);
    } catch (error) {
      if (!onSessionExpired(error)) {
        setLoadError(errorMessage(error, 'Unable to load API keys'));
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function handleSensitiveError(error: unknown, fallback: string) {
    if (onSessionExpired(error)) {
      return;
    }

    if (isStepUpError(error)) {
      setStepUpRequired(true);
      setStepUpSuccess(null);
      setCreateError(null);
      setRevokeError(null);
      return;
    }

    const message = errorMessage(error, fallback);
    setCreateError(message);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    setPlaintextKey(null);
    try {
      const response = await api.createApiKey({
        name: name.trim(),
        ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
        scopes: Array.from(selectedScopes),
        allowedTypes: Array.from(selectedTypes),
        allowedVisibility: Array.from(selectedVisibility),
      });
      setKeys(previous => [
        response.key,
        ...previous.filter(key => key.id !== response.key.id),
      ]);
      setPlaintextKey(response.plaintextKey);
      setName('');
      setClientId('');
      setSelectedScopes(new Set(DEFAULT_SCOPES));
      setSelectedTypes(new Set(DEFAULT_ENTITY_TYPES));
      setSelectedVisibility(new Set(DEFAULT_VISIBILITY));
    } catch (error) {
      handleSensitiveError(error, 'Unable to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function handleStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingStepUp(true);
    setStepUpError(null);
    setStepUpSuccess(null);
    try {
      const response = await api.stepUp({ code: stepUpCode });
      onAuthUpdate(response);
      setStepUpCode('');
      setStepUpRequired(false);
      setStepUpSuccess('MFA confirmation refreshed');
    } catch (error) {
      if (!onSessionExpired(error)) {
        setStepUpError(errorMessage(error, 'Unable to verify MFA confirmation'));
      }
    } finally {
      setSubmittingStepUp(false);
    }
  }

  async function handleRevoke(key: AdminApiKeyMetadata) {
    setRevokingId(key.id);
    setRevokeError(null);
    try {
      await api.revokeApiKey(key.id);
      setKeys(previous =>
        previous.map(current =>
          current.id === key.id ? { ...current, isActive: false } : current
        )
      );
    } catch (error) {
      if (onSessionExpired(error)) {
        return;
      }

      if (isStepUpError(error)) {
        setStepUpRequired(true);
        setStepUpSuccess(null);
      } else {
        setRevokeError(errorMessage(error, 'Unable to revoke API key'));
      }
    } finally {
      setRevokingId(null);
    }
  }

  function toggleScope(scope: AdminScope) {
    setSelectedScopes(previous => {
      const next = new Set(previous);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }

  function toggleType(type: AdminEntityType) {
    setSelectedTypes(previous => {
      const next = new Set(previous);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  function toggleVisibility(visibility: AdminVisibility) {
    setSelectedVisibility(previous => {
      const next = new Set(previous);
      if (next.has(visibility)) {
        next.delete(visibility);
      } else {
        next.add(visibility);
      }
      return next;
    });
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-white">API keys</h2>
        <span className="text-xs text-gray-500">{keys.length} listed</span>
      </div>

      {plaintextKey ? (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
          <p className="text-xs font-semibold uppercase text-emerald-200">One-time API key</p>
          <p className="mt-2 break-all font-mono text-sm text-emerald-50">{plaintextKey}</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-emerald-400/40 px-3 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20"
            onClick={() => setPlaintextKey(null)}
          >
            I have copied it
          </button>
        </div>
      ) : null}

      {stepUpRequired || stepUpSuccess ? (
        <form
          onSubmit={handleStepUp}
          className="mt-3 grid gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 sm:grid-cols-[1fr_auto]"
        >
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase text-amber-200">
              {stepUpRequired ? 'Recent MFA confirmation required' : stepUpSuccess}
            </p>
            {stepUpError ? (
              <p className="mt-1 text-xs text-red-200">{stepUpError}</p>
            ) : null}
          </div>
          {stepUpRequired ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
                <HelpLabel help="Use the current six-digit code from your authenticator app to confirm API-key creation or revocation.">
                  MFA confirmation code
                </HelpLabel>
                <input
                  className={inputClassName()}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  value={stepUpCode}
                  onChange={event => setStepUpCode(event.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                className={`${primaryButtonClassName()} self-end`}
                disabled={submittingStepUp}
              >
                Verify MFA
              </button>
            </>
          ) : null}
        </form>
      ) : null}

      <form onSubmit={handleCreate} className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
          <HelpLabel help="Human-readable name used in admin lists and audit rows.">
            API key name
          </HelpLabel>
          <input
            className={inputClassName()}
            value={name}
            onChange={event => setName(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-300">
          <HelpLabel help="Optional stable client identity for key rotation. Leave blank unless multiple keys should share one client identity.">
            Client ID
          </HelpLabel>
          <input
            className={inputClassName()}
            value={clientId}
            onChange={event => setClientId(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className={`${primaryButtonClassName()} self-end`}
          disabled={
            creating ||
            name.trim().length === 0 ||
            selectedScopes.size === 0 ||
            selectedTypes.size === 0 ||
            selectedVisibility.size === 0
          }
        >
          Create key
        </button>
        <fieldset className="flex flex-wrap gap-3 lg:col-span-3">
          <legend className="basis-full text-xs font-medium text-gray-500">
            <HelpLabel help="Scopes decide which API operations the key can perform. Start with read unless a client needs writes or deletes.">
              Scopes
            </HelpLabel>
          </legend>
          {SCOPE_OPTIONS.map(scope => (
            <label key={scope} className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                className={checkboxClassName()}
                checked={selectedScopes.has(scope)}
                onChange={() => toggleScope(scope)}
              />
              {scope}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-3 lg:col-span-3">
          <legend className="basis-full text-xs font-medium text-gray-500">
            <HelpLabel help="Restrict which entity types this key can access.">
              Allowed entity types
            </HelpLabel>
          </legend>
          {ENTITY_TYPE_OPTIONS.map(type => (
            <label key={type} className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                className={checkboxClassName()}
                checked={selectedTypes.has(type)}
                onChange={() => toggleType(type)}
              />
              {type}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-3 lg:col-span-3">
          <legend className="basis-full text-xs font-medium text-gray-500">
            <HelpLabel help="Restrict which visibility buckets this key can access.">
              Allowed visibility
            </HelpLabel>
          </legend>
          {VISIBILITY_OPTIONS.map(visibility => (
            <label key={visibility} className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                className={checkboxClassName()}
                checked={selectedVisibility.has(visibility)}
                onChange={() => toggleVisibility(visibility)}
              />
              {visibility}
            </label>
          ))}
        </fieldset>
      </form>

      {createError ? (
        <p className="mt-2 text-sm text-red-200">{createError}</p>
      ) : null}
      {revokeError ? (
        <p className="mt-2 text-sm text-red-200">{revokeError}</p>
      ) : null}
      {loadError ? (
        <p className="mt-3 text-sm text-red-200">{loadError}</p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-gray-800 text-gray-500">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">Name</th>
              <th scope="col" className="px-2 py-2 font-medium">Client</th>
              <th scope="col" className="px-2 py-2 font-medium">Scopes</th>
              <th scope="col" className="px-2 py-2 font-medium">Visibility</th>
              <th scope="col" className="px-2 py-2 font-medium">Status</th>
              <th scope="col" className="px-2 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr>
                <td className="px-2 py-3 text-gray-500" colSpan={6}>Loading keys</td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-gray-500" colSpan={6}>No API keys</td>
              </tr>
            ) : keys.map(key => (
              <tr key={key.id} className="text-gray-300">
                <td className="px-2 py-2 font-medium text-gray-100">{key.name}</td>
                <td className="px-2 py-2">{key.clientId}</td>
                <td className="px-2 py-2">{key.scopes.join(', ')}</td>
                <td className="px-2 py-2">{key.allowedVisibility.join(', ')}</td>
                <td className="px-2 py-2">
                  {key.isActive ? (
                    <span className="text-emerald-300">Active</span>
                  ) : (
                    <span className="text-gray-500">Revoked</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-label={`Revoke ${key.name}`}
                    className={secondaryButtonClassName()}
                    disabled={!key.isActive || revokingId === key.id}
                    onClick={() => {
                      void handleRevoke(key);
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextOffset !== null ? (
        <button
          type="button"
          className={`${secondaryButtonClassName()} mt-3`}
          disabled={loadingMore}
          onClick={() => {
            void loadMoreKeys();
          }}
        >
          Load more keys
        </button>
      ) : null}
    </section>
  );
}
