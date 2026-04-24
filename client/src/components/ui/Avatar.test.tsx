import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('renders initials when no src provided', () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('renders img with alt text when src is provided', () => {
    render(<Avatar name="John Doe" src="https://example.com/avatar.jpg" />);
    const img = screen.getByRole('img', { name: 'John Doe' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('applies size classes', () => {
    const { rerender } = render(<Avatar name="Alice Brown" size="sm" />);
    expect(screen.getByText('AB')).toHaveClass('w-8', 'h-8');

    rerender(<Avatar name="Alice Brown" size="lg" />);
    expect(screen.getByText('AB')).toHaveClass('w-14', 'h-14');
  });

  it('has title attribute with full name', () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByTitle('John Doe')).toBeInTheDocument();
  });

  it('generates consistent color for same name', () => {
    const { container: c1 } = render(<Avatar name="Alice" />);
    const { container: c2 } = render(<Avatar name="Alice" />);
    expect((c1.firstChild as HTMLElement)?.className).toBe((c2.firstChild as HTMLElement)?.className);
  });
});
