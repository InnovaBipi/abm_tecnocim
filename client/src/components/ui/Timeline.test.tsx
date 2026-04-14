import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline';

describe('Timeline', () => {
  const items = [
    { id: '1', icon: <span>E</span>, title: 'Email sent', description: 'To john@example.com', timestamp: '2 hours ago' },
    { id: '2', icon: <span>R</span>, title: 'Reply received', timestamp: '1 hour ago' },
  ];

  it('renders nothing for empty items array', () => {
    const { container } = render(<Timeline items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all timeline items', () => {
    render(<Timeline items={items} />);
    expect(screen.getByText('Email sent')).toBeInTheDocument();
    expect(screen.getByText('Reply received')).toBeInTheDocument();
  });

  it('renders timestamps', () => {
    render(<Timeline items={items} />);
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
    expect(screen.getByText('1 hour ago')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<Timeline items={items} />);
    expect(screen.getByText('To john@example.com')).toBeInTheDocument();
  });

  it('renders icons', () => {
    render(<Timeline items={items} />);
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });
});
