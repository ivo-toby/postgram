// Feature test for the Where page (spec 004 phase 5).
// It lives outside ui/src, so ui/tsconfig.json (include: src) does not typecheck it.
// It asserts the UI contract of specs/004-workspace-session-tracking/contracts/ui.md
// end to end against a stubbed API client: swimlanes per project, with the
// worktree details in a dialog per feature.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient } from '../src/lib/api.ts';
import WherePage from '../src/components/WherePage.tsx';
import TopBar from '../src/components/TopBar.tsx';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const base = Date.now();
const iso = (msAgo: number) => new Date(base - msAgo).toISOString();

const twelveMinutesAgo = iso(12 * MINUTE);
const fiveHoursAgo = iso(5 * HOUR);
const threeDaysAgo = iso(3 * DAY);

type Json = Record<string, unknown>;

function session(overrides: Json = {}): Json {
  return {
    id: 'session-1',
    agent_kind: 'claude-code',
    agent_session_id: '8f3c',
    status: 'running',
    dormant: false,
    cwd: null,
    transcript_path: null,
    started_at: twelveMinutesAgo,
    last_activity_at: twelveMinutesAgo,
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

function workspace(overrides: Json = {}): Json {
  return {
    id: 'ws-1',
    machine: 'codebox',
    connect_target: 'codebox',
    path: '/w/a',
    repo_remote: 'github.com/ivo-toby/postgram',
    branch: 'feat/kw',
    feature_id: 'feature-1',
    last_activity_at: twelveMinutesAgo,
    git: { dirty_count: 2, unpushed_count: 3, has_upstream: true },
    git_state_at: fiveHoursAgo,
    missing_since: null,
    risks: ['dirty', 'unpushed'],
    resume_session: {
      id: 'session-1',
      agent_kind: 'claude-code',
      agent_session_id: '8f3c',
      status: 'running',
      cwd: '/w/a',
      transcript_path: '/home/ivo/.claude/projects/x/8f3c.jsonl',
      last_activity_at: twelveMinutesAgo,
    },
    sessions: [session()],
    ...overrides,
  };
}

// A pi session on another machine, whose cwd lies under the workspace path and
// whose session id contains a single quote.
const piWorkspace = workspace({
  id: 'ws-2',
  machine: 'nuc',
  connect_target: 'nuc.lan',
  path: '/home/ivo/wt/a b',
  branch: null,
  feature_id: 'feature-3',
  git: { dirty_count: null, unpushed_count: null, has_upstream: false },
  git_state_at: null,
  risks: ['no_upstream'],
  resume_session: {
    id: 'session-2',
    agent_kind: 'pi',
    agent_session_id: "x'y",
    status: 'idle',
    cwd: '/home/ivo/wt/a b/cli',
    transcript_path: null,
    last_activity_at: threeDaysAgo,
  },
  sessions: [
    session({
      id: 'session-2',
      agent_kind: 'pi',
      agent_session_id: "x'y",
      status: 'idle',
      dormant: true,
      last_activity_at: threeDaysAgo,
    }),
  ],
});

// A talon session: neither template exists, so only the cd is rendered.
const talonWorkspace = workspace({
  id: 'ws-3',
  machine: 'jarvis',
  connect_target: 'jarvis',
  path: '/w/d',
  branch: 'feat/talon',
  feature_id: 'feature-3',
  git: null,
  git_state_at: null,
  risks: [],
  resume_session: {
    id: 'session-3',
    agent_kind: 'talon',
    agent_session_id: 'tl-1',
    status: 'ended',
    cwd: null,
    transcript_path: null,
    last_activity_at: threeDaysAgo,
  },
  sessions: [session({ id: 'session-3', agent_kind: 'talon', status: 'ended', agent_session_id: 'tl-1' })],
});

// An unlinked workspace without any session, whose path is gone.
const unassignedWorkspace = workspace({
  id: 'ws-4',
  path: '/w/c',
  branch: null,
  feature_id: null,
  git: null,
  git_state_at: null,
  missing_since: twelveMinutesAgo,
  risks: ['missing'],
  resume_session: null,
  sessions: [],
});

function features(): Record<string, Json[]> {
  return {
    building: [
      {
        id: '3c4d5e6f-3333-4333-8333-333333333333',
        title: 'Where page',
        stage: 'building',
        stage_source: 'manual',
        stage_set_at: threeDaysAgo,
        task_status: 'active',
        pull_requests: [],
        workspaces: [piWorkspace, talonWorkspace],
      },
    ],
    review: [
      {
        id: '1a2b3c4d-1111-4111-8111-111111111111',
        title: 'Keyword rank fusion',
        stage: 'review',
        stage_source: 'derived',
        stage_set_at: twelveMinutesAgo,
        task_status: 'active',
        pull_requests: [
          {
            url: 'https://github.com/ivo-toby/postgram/pull/42',
            state: 'open',
            updated_at: twelveMinutesAgo,
          },
        ],
        workspaces: [workspace()],
      },
    ],
    functional_test: [],
    ready_to_merge: [
      {
        id: '2b3c4d5e-2222-4222-8222-222222222222',
        title: 'Docker env table',
        stage: 'ready_to_merge',
        stage_source: 'manual',
        stage_set_at: null,
        task_status: 'done',
        pull_requests: [],
        workspaces: [],
      },
    ],
    awaiting_release: [],
  };
}

function stageResponse(): Json {
  const byStage = features();
  return {
    view: 'stage',
    generated_at: iso(0),
    dormant_after_days: 30,
    groups: [
      { key: 'building', label: 'Building', features: byStage.building },
      { key: 'review', label: 'Review', features: byStage.review },
      { key: 'functional_test', label: 'Functional test', features: byStage.functional_test },
      { key: 'ready_to_merge', label: 'Ready to merge', features: byStage.ready_to_merge },
      { key: 'awaiting_release', label: 'Awaiting release', features: byStage.awaiting_release },
      { key: 'unassigned', label: 'Unassigned', workspaces: [unassignedWorkspace] },
    ],
  };
}

function emptyResponse(): Json {
  return {
    view: 'stage',
    generated_at: iso(0),
    dormant_after_days: 30,
    groups: [
      { key: 'building', label: 'Building', features: [] },
      { key: 'review', label: 'Review', features: [] },
      { key: 'unassigned', label: 'Unassigned', workspaces: [] },
    ],
  };
}

function apiWith(getWhere: ApiClient['getWhere']): ApiClient {
  return { getWhere } as unknown as ApiClient;
}

function stubApi(response: Json = stageResponse()): ApiClient {
  return apiWith(vi.fn(async () => response) as unknown as ApiClient['getWhere']);
}

function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

async function projectSection(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name });
  const section = heading.closest('section');
  if (section === null) throw new Error(`project ${name} is not inside a section`);
  return section;
}

async function openFeature(title: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: new RegExp(title, 'u') }));
  return screen.getByRole('dialog', { name: title });
}

describe('WherePage (feature)', () => {
  beforeEach(() => {
    clipboard(vi.fn(async () => undefined));
  });

  it('asks for the stage view without released or done work', async () => {
    const api = stubApi();
    render(<WherePage api={api} />);

    await projectSection('postgram');
    expect(api.getWhere).toHaveBeenCalledWith({ view: 'stage' });
  });

  it('renders one section per project, Other last, then the unassigned worktrees', async () => {
    render(<WherePage api={stubApi()} />);

    await projectSection('postgram');
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'postgram',
      'Other',
      'Unassigned worktrees (1)',
    ]);
    expect(screen.getByText('3 features in 2 projects · 2 need you')).toBeInTheDocument();
  });

  it('gives each project the five stage columns and marks the ones that need you', async () => {
    render(<WherePage api={stubApi()} />);

    const postgram = await projectSection('postgram');
    expect(within(postgram).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Building',
      'Review',
      'Test',
      'Merge',
      'Release',
    ]);
    expect(within(postgram).getByText('github.com/ivo-toby/postgram')).toBeInTheDocument();
    expect(within(postgram).getByText('2 features')).toBeInTheDocument();
    expect(within(postgram).getByText('1 needs you')).toBeInTheDocument();
    expect(within(postgram).getAllByText('needs you')).toHaveLength(1);
  });

  it('keeps a card to its title, PR number, age and worst risk', async () => {
    render(<WherePage api={stubApi()} />);

    const postgram = await projectSection('postgram');
    const card = within(postgram).getByRole('button', { name: /Keyword rank fusion/u });
    expect(within(card).getByText('#42')).toBeInTheDocument();
    expect(within(card).getByText('12m')).toBeInTheDocument();
    expect(within(card).getByText('uncommitted +1')).toBeInTheDocument();
    expect(within(postgram).queryByText('/w/a')).not.toBeInTheDocument();

    const other = await projectSection('Other');
    const done = within(other).getByRole('button', { name: /Docker env table/u });
    expect(within(done).getByText('done')).toBeInTheDocument();
  });

  it('opens the details of a feature with its stage, pull request and worktree', async () => {
    render(<WherePage api={stubApi()} />);

    const dialog = await openFeature('Keyword rank fusion');
    expect(within(dialog).getByText('1a2b3c4d · postgram')).toBeInTheDocument();
    expect(within(dialog).getByText('Review')).toBeInTheDocument();
    expect(within(dialog).getByText('12m')).toBeInTheDocument();

    const link = within(dialog).getByRole('link', { name: '#42 open' });
    expect(link).toHaveAttribute('href', 'https://github.com/ivo-toby/postgram/pull/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));

    expect(within(dialog).getByText('/w/a')).toBeInTheDocument();
    expect(within(dialog).getByText('codebox')).toBeInTheDocument();
    expect(within(dialog).getByText('feat/kw')).toBeInTheDocument();
    expect(within(dialog).getByText('git 5h')).toBeInTheDocument();
    expect(within(dialog).getByText('dirty 2')).toBeInTheDocument();
    expect(within(dialog).getByText('unpushed 3')).toBeInTheDocument();
    expect(within(dialog).getByText('claude-code/running 12m')).toBeInTheDocument();
  });

  it('shows unknown git counts and a dormant session in the details', async () => {
    render(<WherePage api={stubApi()} />);

    const dialog = await openFeature('Where page');
    expect(within(dialog).getByText('/home/ivo/wt/a b')).toBeInTheDocument();
    expect(within(dialog).getByText('no upstream')).toBeInTheDocument();
    expect(within(dialog).getByText('git ?')).toBeInTheDocument();
    expect(within(dialog).getAllByText('-').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('pi/idle 3d dormant')).toBeInTheDocument();
  });

  it('marks a done feature without worktrees in the details', async () => {
    render(<WherePage api={stubApi()} />);

    const dialog = await openFeature('Docker env table');
    expect(within(dialog).getByText('Ready to merge')).toBeInTheDocument();
    expect(within(dialog).getByText('done')).toBeInTheDocument();
    expect(within(dialog).getByText('no worktrees')).toBeInTheDocument();
  });

  it('closes the details with the Close button and with Escape', async () => {
    const user = userEvent.setup();
    render(<WherePage api={stubApi()} />);

    let dialog = await openFeature('Keyword rank fusion');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    dialog = await openFeature('Keyword rank fusion');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders every resume command as the ssh form', async () => {
    render(<WherePage api={stubApi()} />);

    const where = await openFeature('Where page');
    expect(
      within(where).getByText(
        String.raw`ssh -t nuc.lan 'cd '\''/home/ivo/wt/a b/cli'\'' && pi --session '\''x'\''\'\'''\''y'\'''`
      )
    ).toBeInTheDocument();
    expect(within(where).getByText(String.raw`ssh -t jarvis 'cd /w/d'`)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(where).getByRole('button', { name: 'Close' }));
    const keyword = await openFeature('Keyword rank fusion');
    expect(
      within(keyword).getByText(String.raw`ssh -t codebox 'cd /w/a && claude --resume 8f3c'`)
    ).toBeInTheDocument();

    // The unassigned worktree keeps its row, missing path and resume command.
    const unassigned = (await screen.findByRole('heading', { level: 2, name: 'Unassigned worktrees (1)' })).closest(
      'section'
    ) as HTMLElement;
    expect(within(unassigned).getByText('missing')).toBeInTheDocument();
    expect(within(unassigned).getByText('no sessions')).toBeInTheDocument();
    expect(within(unassigned).getByText(String.raw`ssh -t codebox 'cd /w/c && claude'`)).toBeInTheDocument();
  });

  it('copies the resume command of a row', async () => {
    render(<WherePage api={stubApi()} />);
    const dialog = await openFeature('Keyword rank fusion');

    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    await user.click(within(dialog).getByRole('button', { name: 'Copy resume command' }));

    expect(writeText).toHaveBeenCalledWith(
      String.raw`ssh -t codebox 'cd /w/a && claude --resume 8f3c'`
    );
    expect(await within(dialog).findByText('Copied')).toBeInTheDocument();
  });

  it('reports a failed copy and keeps the command readable', async () => {
    render(<WherePage api={stubApi()} />);
    const dialog = await openFeature('Keyword rank fusion');

    const user = userEvent.setup();
    clipboard(vi.fn(async () => { throw new Error('denied'); }));
    await user.click(within(dialog).getByRole('button', { name: 'Copy resume command' }));

    expect(await within(dialog).findByText('Copy failed')).toBeInTheDocument();
    expect(
      within(dialog).getByText(String.raw`ssh -t codebox 'cd /w/a && claude --resume 8f3c'`)
    ).toBeInTheDocument();
  });

  it('adds released and done work to the query when the toggle is on', async () => {
    const api = stubApi();
    const user = userEvent.setup();
    render(<WherePage api={api} />);

    await projectSection('postgram');
    await user.click(screen.getByRole('checkbox', { name: 'Show released and done' }));

    await waitFor(() => {
      expect(api.getWhere).toHaveBeenLastCalledWith({
        view: 'stage',
        include_released: true,
        include_done: true,
      });
    });
  });

  it('refetches on the refresh button', async () => {
    const api = stubApi();
    const user = userEvent.setup();
    render(<WherePage api={api} />);

    await projectSection('postgram');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(api.getWhere).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the last good data when a refetch fails, and retries', async () => {
    let calls = 0;
    const getWhere = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error('where is down');
      return stageResponse();
    });
    const api = apiWith(getWhere as unknown as ApiClient['getWhere']);
    const user = userEvent.setup();
    render(<WherePage api={api} />);

    await screen.findByText('Keyword rank fusion');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(/where is down/u)).toBeInTheDocument();
    expect(screen.getByText('Keyword rank fusion')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByText(/where is down/u)).not.toBeInTheDocument();
    });
  });

  it('shows nothing to do when there are no features and no worktrees', async () => {
    render(<WherePage api={stubApi(emptyResponse())} />);

    expect(await screen.findByText('Nothing to do')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });
});

describe('TopBar (feature)', () => {
  it('offers the Where tab and navigates to it', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<TopBar currentPage="search" onNavigate={onNavigate} onLogout={vi.fn()} />);

    const tab = screen.getByRole('button', { name: 'Where' });
    await user.click(tab);

    expect(onNavigate).toHaveBeenCalledWith('where');
  });
});
