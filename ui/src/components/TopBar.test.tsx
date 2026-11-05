import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopBar from './TopBar.tsx';

describe('TopBar', () => {
  it('renders a Tasks tab and navigates to tasks', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(<TopBar onLogout={vi.fn()} currentPage="search" onNavigate={onNavigate} />);

    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });

  it('renders a Where tab between Tasks and Admin and navigates to where', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(<TopBar onLogout={vi.fn()} currentPage="search" onNavigate={onNavigate} />);

    const labels = within(screen.getByRole('navigation'))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(['Search', 'Graph', 'Projector', 'Tasks', 'Where', 'Admin']);

    await user.click(screen.getByRole('button', { name: 'Where' }));
    expect(onNavigate).toHaveBeenCalledWith('where');
  });

  it('marks the Where tab active only on the where page', () => {
    const { rerender } = render(<TopBar onLogout={vi.fn()} currentPage="tasks" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Where' })).not.toHaveClass('bg-gray-800');

    rerender(<TopBar onLogout={vi.fn()} currentPage="where" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Where' })).toHaveClass('bg-gray-800');
    expect(screen.getByRole('button', { name: 'Tasks' })).not.toHaveClass('bg-gray-800');
  });

  it('marks the active tab with aria-current', () => {
    render(<TopBar onLogout={vi.fn()} currentPage="where" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Where' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Tasks' })).not.toHaveAttribute('aria-current');
  });

  it('keeps an accessible Logout button', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(<TopBar onLogout={onLogout} currentPage="search" onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Logout' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
