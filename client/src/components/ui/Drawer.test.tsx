import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from './Drawer';

describe('Drawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    children: <p>Drawer content</p>,
  };

  it('renders nothing when closed', () => {
    render(<Drawer {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Drawer content')).not.toBeInTheDocument();
  });

  it('renders children when open', () => {
    render(<Drawer {...defaultProps} />);
    expect(screen.getByText('Drawer content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Drawer {...defaultProps} title="Edit Prospect" />);
    expect(screen.getByText('Edit Prospect')).toBeInTheDocument();
  });

  it('renders close button with aria-label when title is shown', () => {
    render(<Drawer {...defaultProps} title="Details" />);
    expect(screen.getByRole('button', { name: /cerrar/i })).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer {...defaultProps} onClose={onClose} title="Details" />);
    await user.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Drawer {...defaultProps} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking overlay', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<Drawer {...defaultProps} onClose={onClose} />);
    const overlay = container.querySelector('.bg-black\\/30');
    if (overlay) await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });
});
