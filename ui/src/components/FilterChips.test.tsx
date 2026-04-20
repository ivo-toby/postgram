import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChips from './FilterChips.tsx';

describe('FilterChips', () => {
  const types = ['document', 'memory', 'person'];

  it('renders a chip per type', () => {
    render(<FilterChips types={types} visible={new Set(types)} onToggle={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('calls onToggle with type when clicked', () => {
    const onToggle = vi.fn();
    render(<FilterChips types={types} visible={new Set(types)} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('document'));
    expect(onToggle).toHaveBeenCalledWith('document');
  });

  it('applies opacity-40 class for hidden types', () => {
    const { container } = render(
      <FilterChips types={types} visible={new Set(['memory'])} onToggle={vi.fn()} />
    );
    const buttons = container.querySelectorAll('button');
    // document is not in visible set — should have opacity-40
    expect(buttons[0]?.className).toContain('opacity-40');
    // memory is in visible set — should have opacity-100
    expect(buttons[1]?.className).toContain('opacity-100');
  });
});
