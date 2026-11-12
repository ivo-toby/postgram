import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import {
  advertisedVocabulary,
  connectInMemoryMcpClient
} from '../helpers/mcp-in-memory.js';

const SKILL_DIR = path.join(process.cwd(), 'skill/postgram');

async function read(relative: string): Promise<string> {
  return readFile(path.join(SKILL_DIR, relative), 'utf8');
}

function frontmatterValue(skill: string, key: string): string {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
  const raw =
    new RegExp(`^${key}:\\s+(.*)$`, 'm').exec(frontmatter)?.[1] ?? '';
  return raw.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
}

describe('postgram skill', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ client, close } = await connectInMemoryMcpClient());
  });

  afterAll(async () => {
    await close();
  });

  it('describes itself as usable over MCP and the CLI', async () => {
    const description = frontmatterValue(await read('SKILL.md'), 'description');

    expect(description).toMatch(/MCP/);
    expect(description).toMatch(/`pgm`/);
    // Skills with a longer description are rejected by Agent Skills loaders.
    expect(description.length).toBeLessThanOrEqual(1024);
    // The skill must not claim the CLI as a precondition.
    expect(description).not.toMatch(/Assumes `pgm` is on PATH/);
  });

  it('does not require the CLI before an agent may use MCP tools', async () => {
    const skill = await read('SKILL.md');

    expect(skill).toMatch(/^## Pick your transport$/m);
    expect(skill).not.toMatch(/pgm not on PATH/);
    expect(skill).toContain('(references/mcp.md)');
    expect(skill).toContain('(references/cli.md)');
  });

  it('links only to files that ship with the skill', async () => {
    const files = [
      'SKILL.md',
      ...(await readdir(path.join(SKILL_DIR, 'references'))).map((name) =>
        path.join('references', name)
      )
    ];

    for (const file of files) {
      const links = [...(await read(file)).matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)]
        .map((match) => match[1] ?? '')
        .filter((target) => !/^[a-z]+:/i.test(target));

      for (const target of links) {
        const resolved = path.join(SKILL_DIR, path.dirname(file), target);
        await expect(access(resolved), `${file} -> ${target}`).resolves.toBe(
          undefined
        );
      }
    }
  });

  it('keeps the MCP references in step with the tools the server registers', async () => {
    const { toolNames } = await advertisedVocabulary(client);
    const reference = [
      await read('references/mcp.md'),
      await read('references/workspace.md')
    ].join('\n');
    const called = new Set(
      [...reference.matchAll(/^([a-z_]+) \{/gm)].map((match) => match[1] ?? '')
    );

    // Every call shown in the references is a real tool.
    expect(called.size).toBeGreaterThan(0);
    expect([...called].filter((name) => !toolNames.has(name))).toEqual([]);
    // Every tool the server registers is shown as a call or named in prose.
    expect(
      [...toolNames].filter(
        (name) => !called.has(name) && !reference.includes(`\`${name}\``)
      )
    ).toEqual([]);
  });

  it('keeps the CLI preflight in the CLI reference', async () => {
    expect(await read('references/cli.md')).toMatch(/pgm not on PATH/);
  });
});
