import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortableHeader } from './SortableHeader';

function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <thead>
        <tr>{ui}</tr>
      </thead>
    </table>
  );
}

describe('SortableHeader', () => {
  const defaultProps = {
    label: 'Name',
    field: 'name',
    currentSort: null,
    currentDirection: null as null,
    onSort: vi.fn(),
  };

  it('renders the label text', () => {
    renderInTable(<SortableHeader {...defaultProps} />);
    expect(screen.getByRole('button', { name: /name/i })).toBeInTheDocument();
  });

  it('renders as a th with scope="col"', () => {
    renderInTable(<SortableHeader {...defaultProps} />);
    expect(screen.getByRole('columnheader')).toHaveAttribute('scope', 'col');
  });

  it('calls onSort with asc when clicking inactive column', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderInTable(<SortableHeader {...defaultProps} onSort={onSort} />);
    await user.click(screen.getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('calls onSort with desc when clicking asc column', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderInTable(
      <SortableHeader
        {...defaultProps}
        onSort={onSort}
        currentSort="name"
        currentDirection="asc"
      />
    );
    await user.click(screen.getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('calls onSort with null when clicking desc column (reset)', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderInTable(
      <SortableHeader
        {...defaultProps}
        onSort={onSort}
        currentSort="name"
        currentDirection="desc"
      />
    );
    await user.click(screen.getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('name', null);
  });
});
