import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanySelect } from './CompanySelect';

vi.mock('@/services/api', () => ({
  companiesApi: {
    list: vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: 'c1', name: 'Acme Corp', domain: 'acme.com' },
          { id: 'c2', name: 'Globex Inc', domain: 'globex.com' },
        ],
      },
    }),
    get: vi.fn().mockResolvedValue({
      data: { data: { id: 'c1', name: 'Acme Corp', domain: 'acme.com' } },
    }),
  },
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('CompanySelect', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it('renders with label', () => {
    renderWithQuery(<CompanySelect value={null} onChange={onChange} label="Empresa" />);
    expect(screen.getByLabelText('Empresa')).toBeInTheDocument();
  });

  it('shows placeholder text', () => {
    renderWithQuery(<CompanySelect value={null} onChange={onChange} placeholder="Buscar..." />);
    expect(screen.getByPlaceholderText('Buscar...')).toBeInTheDocument();
  });

  it('opens dropdown on focus and shows "Sin empresa" option', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CompanySelect value={null} onChange={onChange} label="Empresa" />);

    await user.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    expect(screen.getByText('Sin empresa')).toBeInTheDocument();
  });

  it('shows companies in dropdown', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CompanySelect value={null} onChange={onChange} label="Empresa" />);

    await user.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });
    expect(screen.getByText('Globex Inc')).toBeInTheDocument();
  });

  it('calls onChange with company id on selection', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CompanySelect value={null} onChange={onChange} label="Empresa" />);

    await user.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Acme Corp'));
    expect(onChange).toHaveBeenCalledWith('c1');
  });

  it('calls onChange with null when selecting "Sin empresa"', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CompanySelect value="c1" onChange={onChange} label="Empresa" />);

    await user.click(screen.getByRole('combobox'));

    await waitFor(() => {
      expect(screen.getByText('Sin empresa')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Sin empresa'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('has combobox role with proper ARIA attributes', () => {
    renderWithQuery(<CompanySelect value={null} onChange={onChange} label="Empresa" />);
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(combobox).toHaveAttribute('aria-autocomplete', 'list');
  });
});
