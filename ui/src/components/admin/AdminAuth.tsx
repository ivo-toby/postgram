import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createAdminApiClient,
  AdminApiError,
  type AdminApiClient,
  type AdminAuthResponse,
  type AdminBootstrapState,
  type AdminMfaEnrollmentResponse,
  type AdminSession,
  type AdminStepUp,
  type AdminUser
} from '../../lib/adminApi.ts';
import AdminDashboard from './AdminDashboard.tsx';

type AuthMode =
  | 'loading'
  | 'login'
  | 'bootstrap'
  | 'locked'
  | 'misconfigured'
  | 'mfa_enroll'
  | 'mfa_challenge'
  | 'active';

type AuthState = {
  mode: AuthMode;
  bootstrapState?: AdminBootstrapState;
  user?: AdminUser;
  session?: AdminSession;
  stepUp?: AdminStepUp;
  error?: string;
};

type AdminAuthProps = {
  onBack?: () => void;
};

function isActiveMfaSession(response: AdminAuthResponse): boolean {
  return response.user.status === 'active' && response.session.mfaVerified;
}

function modeForPendingMfa(response: AdminAuthResponse): AuthMode {
  return response.user.status === 'pending_mfa' ||
    response.state === 'mfa_required'
    ? 'mfa_enroll'
    : 'mfa_challenge';
}

function stateFromAuth(response: AdminAuthResponse): AuthState {
  return {
    mode: isActiveMfaSession(response) ? 'active' : modeForPendingMfa(response),
    user: response.user,
    session: response.session,
    ...(response.stepUp ? { stepUp: response.stepUp } : {})
  };
}

function messageForError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function isInvalidAdminSession(error: AdminApiError): boolean {
  return error.status === 401 && /admin session/i.test(error.message);
}

export default function AdminAuth({ onBack }: AdminAuthProps) {
  const api = useMemo(() => createAdminApiClient(), []);
  const [state, setState] = useState<AuthState>({ mode: 'loading' });
  const [enrollment, setEnrollment] =
    useState<AdminMfaEnrollmentResponse | null>(null);
  const [logoutError, setLogoutError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [bootstrap, current] = await Promise.allSettled([
        api.getBootstrapStatus(),
        api.current()
      ]);

      if (cancelled) {
        return;
      }

      if (current.status === 'fulfilled') {
        setState(stateFromAuth(current.value));
        return;
      }

      if (bootstrap.status === 'rejected') {
        setState({
          mode: 'misconfigured',
          error: 'Admin bootstrap status is unavailable'
        });
        return;
      }

      const bootstrapState = bootstrap.value.state;
      if (bootstrapState === 'unbootstrapped') {
        setState({ mode: 'bootstrap', bootstrapState });
      } else if (bootstrapState === 'configured') {
        setState({ mode: 'login', bootstrapState });
      } else if (bootstrapState === 'locked') {
        setState({ mode: 'locked', bootstrapState });
      } else {
        setState({ mode: 'misconfigured', bootstrapState });
      }
    }

    load().catch((error) => {
      if (!cancelled) {
        setState({
          mode: 'misconfigured',
          error: messageForError(error, 'Admin auth is unavailable')
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  function handleUnauthorizedSession(error: unknown): boolean {
    if (!(error instanceof AdminApiError) || !isInvalidAdminSession(error)) {
      return false;
    }

    setEnrollment(null);
    setLogoutError(undefined);
    setState({
      mode: 'login',
      bootstrapState: 'configured',
      error: 'Admin session expired. Sign in again.'
    });
    return true;
  }

  async function handleLogout() {
    setLogoutError(undefined);
    try {
      await api.logout();
      setEnrollment(null);
      setState({ mode: 'login', bootstrapState: 'configured' });
    } catch (logoutFailure) {
      if (handleUnauthorizedSession(logoutFailure)) {
        return;
      }
      setLogoutError(messageForError(logoutFailure, 'Unable to sign out'));
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-gray-950 text-gray-100">
      <AdminHeader
        mode={state.mode}
        user={state.user}
        onBack={onBack}
        onLogout={state.user ? handleLogout : undefined}
      />
      <main className="flex flex-1 min-h-0 items-start justify-center px-4 py-8">
        <div className="flex w-full flex-col items-center gap-3">
          {logoutError ? (
            <div className="w-full max-w-xl">
              <ErrorBanner message={logoutError} />
            </div>
          ) : null}
          {state.mode === 'loading' ? (
            <StatusPanel
              title="Admin session"
              message="Checking admin session"
            />
          ) : state.mode === 'bootstrap' ? (
            <BootstrapPanel
              api={api}
              error={state.error}
              onComplete={(response) => {
                setEnrollment(null);
                setLogoutError(undefined);
                setState(stateFromAuth(response));
              }}
            />
          ) : state.mode === 'login' ? (
            <LoginPanel
              api={api}
              error={state.error}
              onComplete={(response) => {
                setEnrollment(null);
                setLogoutError(undefined);
                setState(stateFromAuth(response));
              }}
            />
          ) : state.mode === 'mfa_enroll' && state.user ? (
            <MfaEnrollmentPanel
              api={api}
              user={state.user}
              enrollment={enrollment}
              onEnrollment={setEnrollment}
              onSessionExpired={handleUnauthorizedSession}
              onComplete={(response) => {
                setEnrollment(null);
                setLogoutError(undefined);
                setState(stateFromAuth(response));
              }}
            />
          ) : state.mode === 'mfa_challenge' && state.user ? (
            <MfaChallengePanel
              api={api}
              user={state.user}
              onSessionExpired={handleUnauthorizedSession}
              onComplete={(response) => {
                setEnrollment(null);
                setLogoutError(undefined);
                setState(stateFromAuth(response));
              }}
            />
          ) : state.mode === 'active' && state.user && state.session ? (
            <AdminDashboard
              api={api}
              user={state.user}
              session={state.session}
              stepUp={state.stepUp}
              onAuthUpdate={(response) => {
                setEnrollment(null);
                setLogoutError(undefined);
                setState(stateFromAuth(response));
              }}
              onSessionExpired={handleUnauthorizedSession}
            />
          ) : state.mode === 'locked' ? (
            <StatusPanel
              title="Admin setup locked"
              message="No active bootstrap token is available. Use the local operator channel to generate one before setup."
            />
          ) : (
            <StatusPanel
              title="Admin setup unavailable"
              message={
                state.error ?? 'Admin bootstrap status is misconfigured.'
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}

function AdminHeader({
  mode,
  user,
  onBack,
  onLogout
}: {
  mode: AuthMode;
  user?: AdminUser;
  onBack?: () => void;
  onLogout?: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-800 bg-gray-900 px-4">
      <img src="/logo-mark.png" alt="" className="h-7 w-7" />
      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-wide text-white">
          Postgram Admin
        </p>
        <p className="text-[11px] uppercase text-gray-500">
          {mode.replace('_', ' ')}
        </p>
      </div>
      <div className="flex-1" />
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-400 transition-colors hover:text-white"
        >
          Back to app
        </button>
      ) : null}
      {user ? (
        <span className="hidden truncate text-xs text-gray-400 sm:block">
          {user.email}
        </span>
      ) : null}
      {onLogout ? (
        <button
          type="button"
          onClick={onLogout}
          className="text-xs text-gray-400 transition-colors hover:text-white"
        >
          Sign out
        </button>
      ) : null}
    </header>
  );
}

function panelClassName() {
  return 'w-full max-w-xl rounded-lg border border-gray-800 bg-gray-900 p-5 shadow-2xl';
}

function labelClassName() {
  return 'flex flex-col gap-1 text-xs font-medium text-gray-300';
}

function inputClassName() {
  return 'rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
}

function primaryButtonClassName() {
  return 'rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400';
}

function ErrorBanner({ message }: { message: string | undefined }) {
  if (!message) {
    return null;
  }

  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      {message}
    </div>
  );
}

function StatusPanel({ title, message }: { title: string; message: string }) {
  return (
    <section className={panelClassName()}>
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <p className="mt-2 text-sm text-gray-400">{message}</p>
    </section>
  );
}

function BootstrapPanel({
  api,
  error,
  onComplete
}: {
  api: AdminApiClient;
  error?: string;
  onComplete: (response: AdminAuthResponse) => void;
}) {
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(error);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      onComplete(
        await api.setupBootstrap({
          bootstrapToken,
          email,
          password,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {})
        })
      );
    } catch (submitFailure) {
      setSubmitError(messageForError(submitFailure, 'Unable to create admin'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={panelClassName()}>
      <h1 className="text-lg font-semibold text-white">First admin setup</h1>
      <p className="mt-1 text-sm text-gray-400">
        Create the first admin after obtaining the bootstrap token from the
        local operator channel.
      </p>
      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
        <ErrorBanner message={submitError} />
        <label className={labelClassName()}>
          Bootstrap token
          <input
            className={inputClassName()}
            type="password"
            value={bootstrapToken}
            onChange={(event) => setBootstrapToken(event.target.value)}
            autoComplete="one-time-code"
            required
          />
        </label>
        <label className={labelClassName()}>
          Email
          <input
            className={inputClassName()}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className={labelClassName()}>
          Display name
          <input
            className={inputClassName()}
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
          />
        </label>
        <label className={labelClassName()}>
          Password
          <input
            className={inputClassName()}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <button
          type="submit"
          className={primaryButtonClassName()}
          disabled={submitting}
        >
          Create admin
        </button>
      </form>
    </section>
  );
}

function LoginPanel({
  api,
  error,
  onComplete
}: {
  api: AdminApiClient;
  error?: string;
  onComplete: (response: AdminAuthResponse) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(error);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      onComplete(await api.login({ email, password }));
    } catch (submitFailure) {
      setSubmitError(messageForError(submitFailure, 'Unable to sign in'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={panelClassName()}>
      <h1 className="text-lg font-semibold text-white">Admin sign in</h1>
      <p className="mt-1 text-sm text-gray-400">
        Use the admin account. Postgram API keys are not admin credentials.
      </p>
      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
        <ErrorBanner message={submitError} />
        <label className={labelClassName()}>
          Email
          <input
            className={inputClassName()}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className={labelClassName()}>
          Password
          <input
            className={inputClassName()}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button
          type="submit"
          className={primaryButtonClassName()}
          disabled={submitting}
        >
          Sign in
        </button>
      </form>
    </section>
  );
}

function MfaEnrollmentPanel({
  api,
  user,
  enrollment,
  onEnrollment,
  onSessionExpired,
  onComplete
}: {
  api: AdminApiClient;
  user: AdminUser;
  enrollment: AdminMfaEnrollmentResponse | null;
  onEnrollment: (enrollment: AdminMfaEnrollmentResponse | null) => void;
  onSessionExpired: (error: unknown) => boolean;
  onComplete: (response: AdminAuthResponse) => void;
}) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function beginEnrollment() {
    setLoading(true);
    setError(undefined);
    try {
      onEnrollment(await api.enrollMfa());
    } catch (enrollFailure) {
      if (onSessionExpired(enrollFailure)) {
        return;
      }
      setError(
        messageForError(enrollFailure, 'Unable to begin MFA enrollment')
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) {
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      onComplete(await api.verifyMfa({ factorId: enrollment.factor.id, code }));
    } catch (verifyFailure) {
      if (onSessionExpired(verifyFailure)) {
        return;
      }
      setError(messageForError(verifyFailure, 'Unable to verify MFA'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={panelClassName()}>
      <h1 className="text-lg font-semibold text-white">MFA enrollment</h1>
      <p className="mt-1 text-sm text-gray-400">
        {user.email} needs verified MFA before admin navigation is enabled.
      </p>
      <div className="mt-5 flex flex-col gap-3">
        <ErrorBanner message={error} />
        {!enrollment ? (
          <button
            type="button"
            onClick={beginEnrollment}
            className={primaryButtonClassName()}
            disabled={loading}
          >
            Begin enrollment
          </button>
        ) : (
          <form onSubmit={verifyEnrollment} className="flex flex-col gap-3">
            <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <p className="text-xs uppercase text-gray-500">TOTP seed</p>
              <p className="mt-1 break-all font-mono text-sm text-gray-100">
                {enrollment.secret}
              </p>
              <a
                className="mt-2 block break-all text-xs text-blue-300 hover:text-blue-200"
                href={enrollment.otpauthUrl}
              >
                Open authenticator setup URI
              </a>
            </div>
            <label className={labelClassName()}>
              Authenticator code
              <input
                className={inputClassName()}
                inputMode="numeric"
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className={primaryButtonClassName()}
              disabled={loading}
            >
              Verify MFA
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function MfaChallengePanel({
  api,
  user,
  onSessionExpired,
  onComplete
}: {
  api: AdminApiClient;
  user: AdminUser;
  onSessionExpired: (error: unknown) => boolean;
  onComplete: (response: AdminAuthResponse) => void;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      onComplete(await api.challengeMfa({ code }));
    } catch (challengeFailure) {
      if (onSessionExpired(challengeFailure)) {
        return;
      }
      setError(
        messageForError(challengeFailure, 'Unable to verify MFA challenge')
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={panelClassName()}>
      <h1 className="text-lg font-semibold text-white">MFA challenge</h1>
      <p className="mt-1 text-sm text-gray-400">
        {user.email} must complete MFA before admin navigation is available.
      </p>
      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
        <ErrorBanner message={error} />
        <label className={labelClassName()}>
          Authenticator code
          <input
            className={inputClassName()}
            inputMode="numeric"
            pattern="[0-9]{6}"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          className={primaryButtonClassName()}
          disabled={submitting}
        >
          Verify code
        </button>
      </form>
    </section>
  );
}
