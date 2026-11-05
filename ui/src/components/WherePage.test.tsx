import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiClient } from '../lib/api.ts';
import type { WhereResponse, WorkspaceView } from '../lib/where.ts';
import WherePage from './WherePage.tsx';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function workspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'ws-1',
    machine: 'codebox',
    connect_target: 'codebox',
    path: '/w/a',
    repo_remote: null,
    branch: 'feat/kw',
    feature_id: 'feature-1',
    last_activity_at: iso(12 * MINUTE),
    git: { dirty_count: 2, unpushed_count: 3, has_upstream: true },
    git_state_at: iso(5 * HOUR),
    missing_since: null,
    risks: ['dirty', 'unpushed'],
    resume_session: {
      id: 'session-1',
      agent_kind: 'claude-code',
      agent_session_id: '8f3c',
      status: 'running',
      cwd: '/w/a',
      transcript_path: null,
      last_activity_at: iso(12 * MINUTE),
    },
    sessions: [
      {
        id: 'session-1',
        agent_kind: 'claude-code',
        agent_session_id: '8f3c',
        status: 'running',
        dormant: false,
        cwd: null,
        transcript_path: null,
        started_at: iso(12 * MINUTE),
        last_activity_at: iso(12 * MINUTE),
        ended_at: null,
        end_reason: null,
      },
    ],
    ...overrides,
  };
}

type FeatureOverrides = Partial<WhereResponse['groups'][number]['features'] extends (infer F)[] | undefined ? F : never>;

function feature(overrides: FeatureOverrides = {}) {
  return {
    id: '1a2b3c4d-1111-4111-8111-111111111111',
    title: 'Keyword rank fusion',
    stage: 'review' as const,
    stage_source: 'derived' as const,
    stage_set_at: iso(12 * MINUTE),
    task_status: 'active',
    pull_requests: [{ url: 'https://github.com/ivo-toby/postgram/pull/42', state: 'open' as const, updated_at: iso(HOUR) }],
    workspaces: [workspace()],
    ...overrides,
  };
}

function stageResponse(
  features: ReturnType<typeof feature>[],
  unassigned: WorkspaceView[] = []
): WhereResponse {
  const keys = ['building', 'review', 'functional_test', 'ready_to_merge', 'awaiting_release'] as const;
  return {
    view: 'stage',
    generated_at: iso(0),
    dormant_after_days: 30,
    groups: [
      ...keys.map((key) => ({ key, label: key, features: features.filter((f) => f.stage === key) })),
      { key: 'unassigned', label: 'Unassigned', workspaces: unassigned },
    ],
  };
}

function oneFeatureResponse(workspaces: WorkspaceView[] = [workspace()]): WhereResponse {
  return stageResponse([feature({ workspaces })]);
}

const EMPTY_RESPONSE: WhereResponse = stageResponse([]);

const RESUME = String.raw`ssh -t codebox 'cd /w/a && claude --resume 8f3c'`;

function apiReturning(response: WhereResponse | (() => Promise<WhereResponse>)) {
  const getWhere = typeof response === 'function'
    ? vi.fn(response)
    : vi.fn(async () => response);
  return { getWhere, api: { getWhere } as unknown as ApiClient };
}

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}

async function openFeature(title = 'Keyword rank fusion'): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(title, 'u') }));
  return screen.getByRole('dialog', { name: title });
}

describe('WherePage', () => {
  beforeEach(() => {
    setClipboard({ writeText: vi.fn(async () => undefined) });
  });

  afterEach(() => {
    vi.useRealTimers();
    setClipboard(undefined);
  });

  describe('lanes', () => {
    it('shows Nothing to do and no project when there is nothing', async () => {
      const { api } = apiReturning(EMPTY_RESPONSE);
      render(<WherePage api={api} />);

      expect(await screen.findByText('Nothing to do')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    });

    it('puts features in a section per project with the same five columns', async () => {
      const talon = feature({
        id: '2b3c4d5e-2222-4222-8222-222222222222',
        title: 'Memory sync',
        stage: 'functional_test',
        workspaces: [],
        pull_requests: [{ url: 'https://github.com/ivo-toby/talon/pull/3', state: 'open', updated_at: iso(HOUR) }],
      });
      const { api } = apiReturning(stageResponse([feature({ workspaces: [workspace({ repo_remote: 'github.com/ivo-toby/postgram' })] }), talon]));
      render(<WherePage api={api} />);

      const postgram = (await screen.findByRole('heading', { level: 2, name: 'postgram' })).closest('section') as HTMLElement;
      expect(within(postgram).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
        'Building',
        'Review',
        'Test',
        'Merge',
        'Release',
      ]);
      expect(within(postgram).getByRole('button', { name: /Keyword rank fusion/u })).toBeInTheDocument();
      expect(within(postgram).getByText('1 needs you')).toBeInTheDocument();

      const talonSection = screen.getByRole('heading', { level: 2, name: 'talon' }).closest('section') as HTMLElement;
      expect(within(talonSection).getByRole('button', { name: /Memory sync/u })).toBeInTheDocument();
      expect(screen.getByText('2 features in 2 projects · 2 need you')).toBeInTheDocument();
    });

    it('shows the PR number, age and worst risk on a card, and no worktree details', async () => {
      const risky = workspace({ risks: ['unpushed', 'interrupted'] });
      const { api } = apiReturning(oneFeatureResponse([risky]));
      render(<WherePage api={api} />);

      const card = await screen.findByRole('button', { name: /Keyword rank fusion/u });
      expect(within(card).getByText('#42')).toBeInTheDocument();
      expect(within(card).getByText('12m')).toBeInTheDocument();
      expect(within(card).getByText('interrupted +1')).toBeInTheDocument();
      expect(screen.queryByText('/w/a')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copy resume command' })).not.toBeInTheDocument();
    });

    it('lists unassigned worktrees under a collapsed heading', async () => {
      const { api } = apiReturning(stageResponse([], [workspace({ id: 'ws-loose', feature_id: null, path: '/w/loose' })]));
      render(<WherePage api={api} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Unassigned worktrees (1)' })).toBeInTheDocument();
      expect(screen.queryByText('Nothing to do')).not.toBeInTheDocument();
    });
  });

  describe('details', () => {
    it('opens a dialog with the stage, PR and worktrees, and closes it', async () => {
      const { api } = apiReturning(oneFeatureResponse());
      render(<WherePage api={api} />);

      const dialog = await openFeature();
      expect(within(dialog).getByText('Review')).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: '#42 open' })).toHaveAttribute(
        'href',
        'https://github.com/ivo-toby/postgram/pull/42'
      );
      expect(within(dialog).getByText('/w/a')).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on Escape', async () => {
      const { api } = apiReturning(oneFeatureResponse());
      render(<WherePage api={api} />);

      await openFeature();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows no worktrees for a feature without workspaces', async () => {
      const { api } = apiReturning(oneFeatureResponse([]));
      render(<WherePage api={api} />);

      const dialog = await openFeature();
      expect(within(dialog).getByText('no worktrees')).toBeInTheDocument();
    });
  });

  describe('workspace row', () => {
    it('renders risk counts, unknown git and the dash branch as single texts', async () => {
      const risky = workspace({
        id: 'ws-2',
        branch: null,
        git: { dirty_count: null, unpushed_count: 4, has_upstream: false },
        git_state_at: null,
        risks: ['dirty', 'unpushed', 'no_upstream', 'interrupted', 'missing'],
        sessions: [],
      });
      const { api } = apiReturning(oneFeatureResponse([risky]));
      render(<WherePage api={api} />);
      await openFeature();

      expect(screen.getByText('dirty')).toBeInTheDocument();
      expect(screen.getByText('unpushed 4')).toBeInTheDocument();
      expect(screen.getByText('no upstream')).toBeInTheDocument();
      expect(screen.getByText('interrupted')).toBeInTheDocument();
      expect(screen.getByText('missing')).toBeInTheDocument();
      expect(screen.getByText('git ?')).toBeInTheDocument();
      expect(screen.getByText('-')).toBeInTheDocument();
      expect(screen.getByText('no sessions')).toBeInTheDocument();
    });

    it('omits the git age when the git snapshot is null', async () => {
      const bare = workspace({ git: null, git_state_at: null, risks: [] });
      const { api } = apiReturning(oneFeatureResponse([bare]));
      render(<WherePage api={api} />);
      await openFeature();

      expect(screen.getByText('/w/a')).toBeInTheDocument();
      expect(screen.queryByText(/^git /u)).not.toBeInTheDocument();
    });

    it('renders a dormant session with its age', async () => {
      const idle = workspace({
        sessions: [
          {
            id: 'session-2',
            agent_kind: 'pi',
            agent_session_id: 'p-1',
            status: 'idle',
            dormant: true,
            cwd: null,
            transcript_path: null,
            started_at: iso(3 * DAY),
            last_activity_at: iso(3 * DAY),
            ended_at: null,
            end_reason: null,
          },
        ],
      });
      const { api } = apiReturning(oneFeatureResponse([idle]));
      render(<WherePage api={api} />);
      await openFeature();

      expect(screen.getByText('pi/idle 3d dormant')).toBeInTheDocument();
    });
  });

  describe('copy', () => {
    it('shows Copied for 2 s after a successful copy, then the normal label', async () => {
      vi.useRealTimers();
      const writeText = vi.fn(async () => undefined);
      setClipboard({ writeText });
      const { api } = apiReturning(oneFeatureResponse());
      render(<WherePage api={api} />);
      await openFeature();

      const button = (await screen.findAllByRole('button', { name: 'Copy resume command' }))[0];
      if (button === undefined) throw new Error('no copy button');

      vi.useFakeTimers();
      fireEvent.click(button);
      await act(async () => {
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith(RESUME);
      expect(screen.getByText('Copied')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_999);
      });
      expect(screen.getByText('Copied')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByText('Copied')).not.toBeInTheDocument();
      expect(button).toHaveTextContent(/^Copy$/u);
      expect(screen.getByText(RESUME)).toBeInTheDocument();
    });

    it('shows Copy failed when the clipboard is missing and keeps the command visible', async () => {
      setClipboard(undefined);
      const { api } = apiReturning(oneFeatureResponse());
      render(<WherePage api={api} />);
      await openFeature();

      fireEvent.click((await screen.findAllByRole('button', { name: 'Copy resume command' }))[0] as HTMLElement);

      expect(await screen.findByText('Copy failed')).toBeInTheDocument();
      expect(screen.getByText(RESUME)).toBeInTheDocument();
    });

    it('shows Copy failed when the write rejects', async () => {
      setClipboard({ writeText: vi.fn(async () => { throw new Error('denied'); }) });
      const { api } = apiReturning(oneFeatureResponse());
      render(<WherePage api={api} />);
      await openFeature();

      fireEvent.click((await screen.findAllByRole('button', { name: 'Copy resume command' }))[0] as HTMLElement);

      expect(await screen.findByText('Copy failed')).toBeInTheDocument();
      expect(screen.getByText(RESUME)).toBeInTheDocument();
    });
  });

  describe('controls', () => {
    it('asks for the stage view, and adds released and done when the checkbox is checked', async () => {
      const { api, getWhere } = apiReturning(oneFeatureResponse());
      const user = userEvent.setup();
      render(<WherePage api={api} />);

      await screen.findByRole('button', { name: /Keyword rank fusion/u });
      expect(getWhere).toHaveBeenCalledWith({ view: 'stage' });
      const checkbox = screen.getByRole('checkbox', { name: 'Show released and done' });
      expect(checkbox).not.toBeChecked();

      await user.click(checkbox);

      await waitFor(() => {
        expect(getWhere).toHaveBeenLastCalledWith({
          view: 'stage',
          include_released: true,
          include_done: true,
        });
      });
    });

    it('refetches the current query on Refresh', async () => {
      const { api, getWhere } = apiReturning(oneFeatureResponse());
      const user = userEvent.setup();
      render(<WherePage api={api} />);

      await screen.findByRole('button', { name: /Keyword rank fusion/u });
      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(getWhere).toHaveBeenCalledTimes(2);
      });
      expect(getWhere).toHaveBeenLastCalledWith({ view: 'stage' });
    });
  });

  describe('errors', () => {
    it('shows the error and a Retry button next to the last good data', async () => {
      let calls = 0;
      const { api } = apiReturning(async () => {
        calls += 1;
        if (calls === 2) throw new Error('where is down');
        return oneFeatureResponse();
      });
      const user = userEvent.setup();
      render(<WherePage api={api} />);

      await screen.findByText('Keyword rank fusion');
      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      expect(await screen.findByText('where is down')).toBeInTheDocument();
      expect(screen.getByText('Keyword rank fusion')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => {
        expect(screen.queryByText('where is down')).not.toBeInTheDocument();
      });
      expect(calls).toBe(3);
    });

    it('shows the loading line only before the first response', async () => {
      let resolve: (value: WhereResponse) => void = () => undefined;
      const { api } = apiReturning(() => new Promise<WhereResponse>((done) => { resolve = done; }));
      render(<WherePage api={api} />);

      expect(screen.getByText('Loading…')).toBeInTheDocument();

      await act(async () => {
        resolve(oneFeatureResponse());
      });

      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
      expect(screen.getByText('Keyword rank fusion')).toBeInTheDocument();
    });
  });
});
