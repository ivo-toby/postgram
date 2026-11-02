// Protected feature test for change 004-ui-where (spec 004 phase 5).
// It lives outside ui/src on purpose: ui/tsconfig.json only includes src, so
// this file is run by Vitest but never typechecked by a slice check.
// It asserts the UI contract of specs/004-workspace-session-tracking/contracts/ui.md
// end to end against a stubbed API client. Slices may not edit this file.
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

function actionsResponse(): Json {
  return {
    view: 'actions',
    generated_at: iso(0),
    dormant_after_days: 30,
    groups: [
      {
        key: 'review',
        label: 'Review',
        features: [
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
      },
      { key: 'test', label: 'Test', features: [] },
      {
        key: 'merge',
        label: 'Merge',
        features: [
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
      },
      { key: 'release', label: 'Release', features: [] },
      {
        key: 'in_progress',
        label: 'In progress',
        features: [
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
      },
      { key: 'unassigned', label: 'Unassigned', workspaces: [unassignedWorkspace] },
    ],
  };
}

function emptyResponse(view: string): Json {
  return {
    view,
    generated_at: iso(0),
    dormant_after_days: 30,
    groups: [
      { key: 'review', label: 'Review', features: [] },
      { key: 'unassigned', label: 'Unassigned', workspaces: [] },
    ],
  };
}

function apiWith(getWhere: ApiClient['getWhere']): ApiClient {
  return { getWhere } as unknown as ApiClient;
}

function stubApi(response: Json = actionsResponse()): ApiClient {
  return apiWith(vi.fn(async () => response) as unknown as ApiClient['getWhere']);
}

function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

function groupSection(label: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: new RegExp(`^${label} \\(`, 'u') });
  const section = heading.closest('section');
  if (section === null) throw new Error(`group ${label} is not inside a section`);
  return section;
}

describe('WherePage (feature)', () => {
  beforeEach(() => {
    clipboard(vi.fn(async () => undefined));
  });

  it('asks for the actions view without released or done work', async () => {
    const api = stubApi();
    render(<WherePage api={api} />);

    await screen.findByRole('heading', { level: 2, name: /^Review \(/u });
    expect(api.getWhere).toHaveBeenCalledWith({ view: 'actions' });
  });

  it('renders the groups in server order and skips the empty ones', async () => {
    render(<WherePage api={stubApi()} />);

    const headings = await waitFor(() => {
      const found = screen.getAllByRole('heading', { level: 2 });
      expect(found.length).toBeGreaterThan(0);
      return found;
    });

    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Review (1)',
      'Merge (1)',
      'In progress (1)',
      'Unassigned (1)',
    ]);
  });

  it('renders a feature with its short id, stage, age and pull request', async () => {
    render(<WherePage api={stubApi()} />);

    const review = groupSection('Review');
    expect(await within(review).findByText('1a2b3c4d')).toBeInTheDocument();
    expect(within(review).getByText('Keyword rank fusion')).toBeInTheDocument();
    expect(within(review).getByText('review')).toBeInTheDocument();
    expect(within(review).getAllByText('12m').length).toBeGreaterThan(0);

    const link = within(review).getByRole('link', { name: '#42 open' });
    expect(link).toHaveAttribute('href', 'https://github.com/ivo-toby/postgram/pull/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('marks a done feature without worktrees', async () => {
    render(<WherePage api={stubApi()} />);

    const merge = groupSection('Merge');
    expect(await within(merge).findByText('Docker env table')).toBeInTheDocument();
    expect(within(merge).getByText('done')).toBeInTheDocument();
    expect(within(merge).getByText('no worktrees')).toBeInTheDocument();
  });

  it('renders a workspace row with its risks, git age and sessions', async () => {
    render(<WherePage api={stubApi()} />);

    const review = groupSection('Review');
    await within(review).findByText('/w/a');
    expect(within(review).getByText('codebox')).toBeInTheDocument();
    expect(within(review).getByText('feat/kw')).toBeInTheDocument();
    expect(within(review).getByText('git 5h')).toBeInTheDocument();
    expect(within(review).getByText('dirty 2')).toBeInTheDocument();
    expect(within(review).getByText('unpushed 3')).toBeInTheDocument();
    expect(within(review).getByText('claude-code/running 12m')).toBeInTheDocument();
  });

  it('renders unknown git counts, a dormant session and a missing path', async () => {
    render(<WherePage api={stubApi()} />);

    const progress = groupSection('In progress');
    await within(progress).findByText('/home/ivo/wt/a b');
    expect(within(progress).getByText('no upstream')).toBeInTheDocument();
    expect(within(progress).getByText('git ?')).toBeInTheDocument();
    expect(within(progress).getAllByText('-').length).toBeGreaterThan(0);
    expect(within(progress).getByText('pi/idle 3d dormant')).toBeInTheDocument();

    const unassigned = groupSection('Unassigned');
    expect(within(unassigned).getByText('missing')).toBeInTheDocument();
    expect(within(unassigned).getByText('no sessions')).toBeInTheDocument();
  });

  it('renders every resume command as the ssh form', async () => {
    render(<WherePage api={stubApi()} />);

    expect(
      await screen.findByText(String.raw`ssh -t codebox 'cd '\''/w/a'\'' && claude --resume '\''8f3c'\'''`)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        String.raw`ssh -t nuc.lan 'cd '\''/home/ivo/wt/a b/cli'\'' && pi --session '\''x'\''\'\'''\''y'\'''`
      )
    ).toBeInTheDocument();
    expect(screen.getByText(String.raw`ssh -t jarvis 'cd '\''/w/d'\'''`)).toBeInTheDocument();
    expect(
      screen.getByText(String.raw`ssh -t codebox 'cd '\''/w/c'\'' && claude'`)
    ).toBeInTheDocument();
  });

  it('copies the resume command of a row', async () => {
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    const user = userEvent.setup();
    render(<WherePage api={stubApi()} />);

    const review = groupSection('Review');
    const button = await within(review).findByRole('button', { name: 'Copy resume command' });
    await user.click(button);

    expect(writeText).toHaveBeenCalledWith(
      String.raw`ssh -t codebox 'cd '\''/w/a'\'' && claude --resume '\''8f3c'\'''`
    );
    expect(await within(review).findByText('Copied')).toBeInTheDocument();
  });

  it('reports a failed copy and keeps the command readable', async () => {
    clipboard(vi.fn(async () => { throw new Error('denied'); }));
    const user = userEvent.setup();
    render(<WherePage api={stubApi()} />);

    const review = groupSection('Review');
    await user.click(await within(review).findByRole('button', { name: 'Copy resume command' }));

    expect(await within(review).findByText('Copy failed')).toBeInTheDocument();
    expect(
      screen.getByText(String.raw`ssh -t codebox 'cd '\''/w/a'\'' && claude --resume '\''8f3c'\'''`)
    ).toBeInTheDocument();
  });

  it('switches to the stage view and back', async () => {
    const getWhere = vi.fn(async ({ view }: { view: string }) =>
      view === 'stage' ? emptyResponse('stage') : actionsResponse()
    );
    const api = apiWith(getWhere as unknown as ApiClient['getWhere']);
    const user = userEvent.setup();
    render(<WherePage api={api} />);

    await screen.findByRole('heading', { level: 2, name: /^Review \(/u });
    await user.click(screen.getByRole('button', { name: 'Stage' }));

    await waitFor(() => {
      expect(getWhere).toHaveBeenCalledWith({ view: 'stage' });
    });
    expect(screen.getByRole('button', { name: 'Stage' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Nothing to do')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await waitFor(() => {
      expect(getWhere).toHaveBeenLastCalledWith({ view: 'actions' });
    });
  });

  it('adds released and done work to the query when the toggle is on', async () => {
    const api = stubApi();
    const user = userEvent.setup();
    render(<WherePage api={api} />);

    await screen.findByRole('heading', { level: 2, name: /^Review \(/u });
    await user.click(screen.getByRole('checkbox', { name: 'Show released and done' }));

    await waitFor(() => {
      expect(api.getWhere).toHaveBeenLastCalledWith({
        view: 'actions',
        include_released: true,
        include_done: true,
      });
    });
  });

  it('refetches on the refresh button', async () => {
    const api = stubApi();
    const user = userEvent.setup();
    render(<WherePage api={api} />);

    await screen.findByRole('heading', { level: 2, name: /^Review \(/u });
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
      return actionsResponse();
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

  it('shows nothing to do when every group is empty', async () => {
    render(<WherePage api={stubApi(emptyResponse('actions'))} />);

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
