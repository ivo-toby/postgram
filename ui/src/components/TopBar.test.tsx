import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
