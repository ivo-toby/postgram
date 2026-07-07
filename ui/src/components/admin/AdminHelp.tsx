import type { ReactNode } from 'react';

type HelpIconProps = {
  label: string;
  className?: string;
};

export function HelpIcon({ label, className = '' }: HelpIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-700 bg-gray-950 text-[11px] font-semibold text-gray-300 outline-none transition-colors after:content-[attr(data-help-icon)] hover:border-blue-400 hover:text-blue-200 focus:border-blue-400 focus:text-blue-200 ${className}`}
      data-help-icon="?"
      title={label}
    />
  );
}

export function HelpLabel({
  children,
  help
}: {
  children: ReactNode;
  help: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{children}</span>
      <HelpIcon label={help} />
    </span>
  );
}

function HelpSection({
  children,
  title
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-6 text-gray-300">{children}</div>
    </section>
  );
}

export default function AdminHelpPage() {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Admin help</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-400">
          A short operator guide for the browser admin plane, bootstrap, MFA,
          provider settings, API keys, and maintenance jobs.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HelpSection title="Bootstrap and sign in">
          <p>
            The bootstrap token is a one-time local setup token from the server
            logs. It proves the person creating the first admin can read the
            trusted local operator channel.
          </p>
          <p>
            Admin sign-in is separate from Postgram API keys. API keys can call
            the user API; they do not grant browser admin access.
          </p>
        </HelpSection>

        <HelpSection title="MFA and MFA confirmation">
          <p>
            MFA uses the six-digit code from your authenticator app. During
            setup, scan the QR code or enter the setup code manually.
          </p>
          <p>
            MFA confirmation means re-entering your current six-digit MFA code
            before sensitive actions such as secret writes, API-key creation,
            provider apply, or maintenance apply. It expires quickly by design.
          </p>
        </HelpSection>

        <HelpSection title="Provider configuration">
          <p>
            Provider settings are saved as pending values first. Validate and
            test connections before applying them to runtime behavior.
          </p>
          <p>
            Embedding provider, model, and dimensions are migration-class
            settings. Changing them can require a planned re-embedding path
            before apply is safe.
          </p>
        </HelpSection>

        <HelpSection title="Provider secrets">
          <p>
            Secret fields are write-only. After saving, the UI shows metadata
            such as provider, purpose, validation status, and update time, but
            never shows the plaintext secret again.
          </p>
        </HelpSection>

        <HelpSection title="API keys">
          <p>
            API keys are for the regular Postgram API and MCP clients. The
            plaintext key is shown once when created, then only redacted
            metadata remains.
          </p>
        </HelpSection>

        <HelpSection title="Maintenance">
          <p>
            Maintenance jobs start with dry-run previews. Apply stays disabled
            until the preview succeeds and you explicitly confirm review.
          </p>
          <p>
            Apply jobs use idempotency so retries can reuse the same job rather
            than accidentally starting duplicate destructive work.
          </p>
        </HelpSection>
      </div>
    </section>
  );
}
