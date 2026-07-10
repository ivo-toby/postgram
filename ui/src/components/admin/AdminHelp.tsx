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
          A practical operator guide for Postgram administration. It assumes
          comfort with services and credentials, but not with vector databases
          or graph maintenance.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HelpSection title="Bootstrap and sign in">
          <p>
            The bootstrap token is a one-time setup token printed by the API
            container when the first admin is needed. It proves the person
            creating the first admin can read the trusted local operator
            channel.
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
            MFA confirmation is the plain-English name for the previous
            "step-up code": re-enter your current six-digit authenticator code
            before sensitive actions such as secret writes, API-key creation,
            provider apply, backup download, or maintenance apply. It expires
            quickly by design.
          </p>
        </HelpSection>

        <HelpSection title="Onboarding resume">
          <p>
            After an active MFA login, Postgram opens onboarding until it is
            completed or deliberately skipped. The current step is saved in
            Postgres, so refresh, logout/login, browser close, and ordinary
            container restart resume from the server-side progress.
          </p>
          <p>
            Keep the Docker pgdata volume when testing resume behavior. Use
            docker compose restart or docker compose up -d --build. Do not use
            docker compose down -v unless you intentionally want to delete the
            Postgres volume and reset the install.
          </p>
        </HelpSection>

        <HelpSection title="Embeddings and extraction">
          <p>
            Embeddings turn text into numeric vectors so Postgram can find
            related content by meaning, not just exact words. The embedding
            provider, model, and dimensions must stay consistent with the
            vectors already stored in the database.
          </p>
          <p>
            Extraction is separate. It uses an LLM to identify people, projects,
            tasks, documents, and relationships, then stores those relationships
            as graph edges. If extraction is off, graph extraction jobs are not
            active.
          </p>
        </HelpSection>

        <HelpSection title="Pending, active, and validation">
          <p>
            Editing Config creates saved changes waiting to apply. They are in
            the database, but Postgram does not use them until validation and
            apply succeed.
          </p>
          <p>
            Active provider settings are what runtime behavior is currently
            using. "Not tested yet" means Postgram has not validated the saved
            value against runtime construction or provider connectivity since it
            was saved.
          </p>
        </HelpSection>

        <HelpSection title="Provider secrets">
          <p>
            Secret fields are write-only. After saving, the UI shows metadata
            such as provider, purpose, validation status, and update time, but
            never shows the plaintext secret again.
          </p>
          <p>
            Use OPENAI_API_KEY for OpenAI embeddings or extraction,
            ANTHROPIC_API_KEY for Anthropic extraction, OLLAMA_API_KEY for a
            protected Ollama endpoint, EXTRACTION_API_KEY for a custom
            extraction endpoint, and EMBEDDING_API_KEY for a custom embedding
            endpoint.
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
            Re-extract reruns LLM extraction. Re-embed rebuilds vector chunks.
            Prune edges removes low-confidence edges created by LLM extraction.
            Apply jobs use idempotency so retries can reuse the same job rather
            than accidentally starting duplicate destructive work.
          </p>
        </HelpSection>

        <HelpSection title="Backups and restore">
          <p>
            Backup download produces a gzipped v2 archive with a data-only
            PostgreSQL custom dump, a manifest, and redacted runtime
            configuration. Store it like sensitive data because it contains the
            database contents. Legacy v1 and full-schema archives are rejected.
          </p>
          <p>
            Restore is intentionally staged: require exactly the approved
            Postgram table-data entries, create the trusted schema from bundled
            migrations, import the data into a new database name, run health
            checks, and only then switch over after operator approval. Active or
            unknown PostgreSQL objects never reach restore.
          </p>
          <p>
            If the restored database has problems after switch-over, roll back
            by restoring the previous POSTGRES_DB or DATABASE_URL setting and
            restarting the API/UI services. The original database is left
            untouched so this rollback does not need another restore.
          </p>
        </HelpSection>
      </div>
    </section>
  );
}
