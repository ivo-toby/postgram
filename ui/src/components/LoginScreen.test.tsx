import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LoginScreen from './LoginScreen.tsx';

describe('LoginScreen', () => {
  it('renders API key input and submit button', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('calls onLogin with entered key', () => {
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByPlaceholderText(/api key/i), {
      target: { value: 'pgm_testkey123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(onLogin).toHaveBeenCalledWith('pgm_testkey123');
  });

  it('does not call onLogin with empty key', () => {
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('does not call onLogin with whitespace-only key', () => {
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByPlaceholderText(/api key/i), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    expect(onLogin).not.toHaveBeenCalled();
  });
});
