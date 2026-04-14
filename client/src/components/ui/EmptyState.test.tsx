import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  const defaultProps = {
    icon: <span>icon</span>,
    title: 'No prospects found',
  };

  it('renders title and icon', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByText('No prospects found')).toBeInTheDocument();
    expect(screen.getByText('icon')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState {...defaultProps} description="Try adjusting your filters" />);
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.queryByText('Try adjusting')).not.toBeInTheDocument();
  });

  it('renders primary action button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        {...defaultProps}
        action={{ label: 'Add Prospect', onClick }}
      />
    );
    const button = screen.getByRole('button', { name: /add prospect/i });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders secondary action button', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <EmptyState
        {...defaultProps}
        action={{ label: 'Add', onClick: onPrimary }}
        secondaryAction={{ label: 'Import', onClick: onSecondary }}
      />
    );
    await user.click(screen.getByRole('button', { name: /import/i }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('does not render action buttons when none provided', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
