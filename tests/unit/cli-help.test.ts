import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const TSX_BIN = path.resolve('node_modules/.bin/tsx');
const PGM_ENTRYPOINT = path.resolve('cli/src/pgm.ts');
const PGM_ADMIN_ENTRYPOINT = path.resolve('src/cli/admin/pgm-admin.ts');

async function helpFor(entrypoint: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(TSX_BIN, [entrypoint, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PGM_API_URL: '',
      PGM_API_KEY: ''
    },
    timeout: 10_000
  });

  expect(stderr).toBe('');
  return stdout;
}

function normalizeHelp(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('CLI help text', () => {
  it('presents pgm as an agent-friendly CLI with compact structured output', async () => {
    const help = await helpFor(PGM_ENTRYPOINT, ['--help']);
    const normalized = normalizeHelp(help);

    expect(help).toContain('Postgram CLI for humans and agents');
    expect(help).toContain('--json');
    expect(help).toContain('compact JSON for agents');
    expect(normalized).toContain(
      'Store durable memory/entity; use memory session-context for resumability'
    );
    expect(normalized).toContain(
      'Hybrid vector + keyword search over stored entity chunks.'
    );
    expect(help).toContain('Memory commands for agent session context');
  });

  it('guides agents toward the right memory role and visibility choices', async () => {
    const storeHelp = await helpFor(PGM_ENTRYPOINT, ['store', '--help']);
    const normalizedStoreHelp = normalizeHelp(storeHelp);
    expect(normalizedStoreHelp).toContain(
      'Store durable memory/entity; use memory session-context for resumability'
    );
    expect(normalizedStoreHelp).toContain('prefer personal for agent memory');

    const sessionHelp = await helpFor(PGM_ENTRYPOINT, [
      'memory',
      'session-context',
      '--help'
    ]);
    const normalizedSessionHelp = normalizeHelp(sessionHelp);
    expect(normalizedSessionHelp).toContain(
      'Store client-scoped session context for agent resumability'
    );
    expect(normalizedSessionHelp).toContain(
      'prefer personal for agent session context'
    );
    expect(normalizedSessionHelp).toContain('metadata only; not an auth boundary');

    const searchHelp = await helpFor(PGM_ENTRYPOINT, ['search', '--help']);
    const normalizedSearchHelp = normalizeHelp(searchHelp);
    expect(normalizedSearchHelp).toContain(
      'session_context for continuity; durable_memory for stable facts'
    );
    expect(normalizedSearchHelp).toContain(
      'emit compact TOON output for lower agent token use'
    );
    expect(normalizedSearchHelp).toContain(
      'RRF scores use 1/(60+vector_rank) + 1/(60+keyword_rank)'
    );
    expect(normalizedSearchHelp).toContain(
      'cosine similarity floor; below-floor keyword chunks need at least half the keyword terms'
    );
    expect(normalizedSearchHelp).toContain(
      'Keyword parsing retains the first 24 distinct non-empty terms after multi-term English stopword filtering'
    );
  }, 20_000);

  it('keeps admin help concise and emphasizes per-client agent keys', async () => {
    const adminHelp = await helpFor(PGM_ADMIN_ENTRYPOINT, ['--help']);
    const normalizedAdminHelp = normalizeHelp(adminHelp);

    expect(adminHelp).toContain('Postgram admin CLI for operators and agents');
    expect(normalizedAdminHelp).toContain(
      'Queue entities for graph re-extraction with optional model/provider override'
    );
    expect(normalizedAdminHelp).toContain(
      'Create semantic neighbor edges without calling the extraction LLM'
    );
    expect(adminHelp).not.toContain('extraction_model_override');
    expect(adminHelp).not.toContain(
      'EXTRACTION_SEMANTIC_NEIGHBORS_ENABLED was set'
    );

    const keyHelp = await helpFor(PGM_ADMIN_ENTRYPOINT, [
      'key',
      'create',
      '--help'
    ]);
    expect(normalizeHelp(keyHelp)).toContain(
      'one stable client identity per agent/client for session-context scope'
    );

    const memoryHelp = await helpFor(PGM_ADMIN_ENTRYPOINT, [
      'memory',
      '--help'
    ]);
    expect(normalizeHelp(memoryHelp)).toContain('groom-durable');
    expect(normalizeHelp(memoryHelp)).toContain('apply-durable-grooming');
  }, 20_000);
});
