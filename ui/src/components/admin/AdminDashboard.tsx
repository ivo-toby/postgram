import { useMemo, useState, type ReactNode } from 'react';
import {
  type AdminApiClient,
  type AdminAuthResponse,
  type AdminSession,
  type AdminStepUp,
  type AdminUser
} from '../../lib/adminApi.ts';
import AdminConfig from './AdminConfig.tsx';

type AdminDashboardProps = {
  api: AdminApiClient;
  user: AdminUser;
  session: AdminSession;
  stepUp?: AdminStepUp;
  onAuthUpdate: (response: AdminAuthResponse) => void;
  onSessionExpired: (error: unknown) => boolean;
};

type DashboardPanel = 'overview' | 'config';

function InlineMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2">
      <p className="text-[11px] uppercase text-gray-500">{label}</p>
      <div className="mt-1 truncate text-sm font-medium text-gray-100">
        {value}
      </div>
    </div>
  );
}

function DashboardNavButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:bg-gray-800/60 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminDashboard(props: AdminDashboardProps) {
  const { api, onAuthUpdate, onSessionExpired, session, stepUp, user } = props;
  const [activePanel, setActivePanel] = useState<DashboardPanel>('overview');

  const stepUpValue = useMemo(() => {
    if (stepUp?.fresh) {
      return stepUp.expiresAt
        ? `Fresh until ${new Date(stepUp.expiresAt).toLocaleTimeString()}`
        : 'Fresh';
    }
    return 'Required for sensitive actions';
  }, [stepUp]);

  return (
    <section className="flex w-full max-w-7xl flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Operations dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-400">{user.email}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InlineMetric
          label="Session"
          value={session.mfaVerified ? 'MFA verified' : 'MFA pending'}
        />
        <InlineMetric
          label="Expires"
          value={new Date(session.expiresAt).toLocaleString()}
        />
        <InlineMetric label="Step-up" value={stepUpValue} />
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
        <DashboardNavButton
          active={activePanel === 'overview'}
          onClick={() => setActivePanel('overview')}
        >
          Overview
        </DashboardNavButton>
        <DashboardNavButton
          active={activePanel === 'config'}
          onClick={() => setActivePanel('config')}
        >
          Config
        </DashboardNavButton>
      </nav>

      {activePanel === 'config' ? (
        <AdminConfig
          api={api}
          initialStepUp={stepUp}
          onAuthUpdate={onAuthUpdate}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Admin workspace">
            <p className="mt-2 text-sm text-gray-400">
              Provider configuration is available from the config panel.
            </p>
          </Panel>
          <Panel title="Security posture">
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <dt className="text-gray-500">Credential mode</dt>
              <dd className="text-gray-200">HttpOnly cookie</dd>
              <dt className="text-gray-500">CSRF</dt>
              <dd className="text-gray-200">Required on mutations</dd>
              <dt className="text-gray-500">Step-up</dt>
              <dd className="text-gray-200">Required for sensitive changes</dd>
            </dl>
          </Panel>
        </div>
      )}
    </section>
  );
}
