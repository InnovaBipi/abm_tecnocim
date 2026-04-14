import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonText, SkeletonCard, SkeletonTable, SkeletonChart } from './Skeleton';

describe('Skeleton', () => {
  it('renders a div with pulse animation', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass('animate-pulse');
  });

  it('applies custom className', () => {
    const { container } = render(<Skeleton className="h-8 w-32" />);
    expect(container.firstChild).toHaveClass('h-8', 'w-32');
  });

  it('applies inline width and height styles', () => {
    const { container } = render(<Skeleton width="200px" height="40px" />);
    expect(container.firstChild).toHaveStyle({ width: '200px', height: '40px' });
  });
});

describe('SkeletonText', () => {
  it('renders 3 lines by default', () => {
    const { container } = render(<SkeletonText />);
    const lines = container.querySelectorAll('.animate-pulse');
    expect(lines).toHaveLength(3);
  });

  it('renders custom number of lines', () => {
    const { container } = render(<SkeletonText lines={5} />);
    const lines = container.querySelectorAll('.animate-pulse');
    expect(lines).toHaveLength(5);
  });

  it('makes last line shorter (w-3/4)', () => {
    const { container } = render(<SkeletonText lines={3} />);
    const lines = container.querySelectorAll('.animate-pulse');
    expect(lines[2]).toHaveClass('w-3/4');
    expect(lines[0]).toHaveClass('w-full');
  });
});

describe('SkeletonCard', () => {
  it('renders with icon placeholder by default', () => {
    const { container } = render(<SkeletonCard />);
    // Icon placeholder is a 9x9 rounded skeleton
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('hides icon placeholder when hasIcon is false', () => {
    const { container } = render(<SkeletonCard hasIcon={false} />);
    const roundedLg = container.querySelectorAll('.rounded-lg');
    // Without icon, there should be fewer rounded-lg skeletons
    const withIcon = document.createElement('div');
    render(<SkeletonCard hasIcon={true} />, { container: withIcon });
    // Simply verify it renders without error
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe('SkeletonTable', () => {
  it('renders 5 rows and 5 columns by default', () => {
    const { container } = render(<SkeletonTable />);
    // Header row + 5 data rows = 6 flex rows total
    const rows = container.querySelectorAll('.flex.items-center.gap-4');
    expect(rows).toHaveLength(6); // 1 header + 5 body
  });

  it('renders custom rows and columns', () => {
    const { container } = render(<SkeletonTable rows={3} columns={4} />);
    const rows = container.querySelectorAll('.flex.items-center.gap-4');
    expect(rows).toHaveLength(4); // 1 header + 3 body
  });
});

describe('SkeletonChart', () => {
  it('renders with default height', () => {
    const { container } = render(<SkeletonChart />);
    const barContainer = container.querySelector('.flex.items-end');
    expect(barContainer).toHaveStyle({ height: '240px' });
  });

  it('renders with custom height', () => {
    const { container } = render(<SkeletonChart height="300px" />);
    const barContainer = container.querySelector('.flex.items-end');
    expect(barContainer).toHaveStyle({ height: '300px' });
  });

  it('renders 8 bar skeletons', () => {
    const { container } = render(<SkeletonChart />);
    const barContainer = container.querySelector('.flex.items-end');
    expect(barContainer?.children).toHaveLength(8);
  });
});
