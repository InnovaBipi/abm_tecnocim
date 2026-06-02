import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangePicker } from './DateRangePicker';

describe('DateRangePicker', () => {
  it('renders with selected range label', () => {
    render(<DateRangePicker value="30d" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /últimos 30 días/i })).toBeInTheDocument();
  });

  it('opens dropdown on click', async () => {
    const user = userEvent.setup();
    render(<DateRangePicker value="7d" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /últimos 7 días/i }));
    // All 4 options should be visible
    expect(screen.getByText('Últimos 30 días')).toBeInTheDocument();
    expect(screen.getByText('Últimos 90 días')).toBeInTheDocument();
    expect(screen.getByText('Últimos 12 meses')).toBeInTheDocument();
  });

  it('calls onChange when an option is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value="7d" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /últimos 7 días/i }));
    await user.click(screen.getByText('Últimos 90 días'));
    expect(onChange).toHaveBeenCalledWith('90d');
  });

  it('closes dropdown after selection', async () => {
    const user = userEvent.setup();
    render(<DateRangePicker value="7d" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /últimos 7 días/i }));
    await user.click(screen.getByText('Últimos 30 días'));
    // Dropdown should be closed - the options should no longer be visible
    expect(screen.queryByText('Últimos 90 días')).not.toBeInTheDocument();
  });
});
