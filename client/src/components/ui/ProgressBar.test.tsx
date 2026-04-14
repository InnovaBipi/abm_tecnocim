import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders a progressbar role element', () => {
    render(<ProgressBar value={50} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('sets correct aria attributes', () => {
    render(<ProgressBar value={30} max={200} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '200');
  });

  it('calculates percentage width correctly', () => {
    render(<ProgressBar value={25} max={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveStyle({ width: '25%' });
  });

  it('clamps percentage to 0-100 range', () => {
    const { rerender } = render(<ProgressBar value={150} max={100} />);
    expect(screen.getByRole('progressbar')).toHaveStyle({ width: '100%' });

    rerender(<ProgressBar value={-10} max={100} />);
    expect(screen.getByRole('progressbar')).toHaveStyle({ width: '0%' });
  });

  it('renders label when provided', () => {
    render(<ProgressBar value={50} label="Progress" />);
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('shows percentage text when showPercentage is true', () => {
    render(<ProgressBar value={75} showPercentage />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('does not show percentage by default', () => {
    render(<ProgressBar value={75} />);
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
  });
});
