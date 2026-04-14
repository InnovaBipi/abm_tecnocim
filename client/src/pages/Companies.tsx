import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { companiesApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import {
  Search,
  Plus,
  Trash2,
  Building2,
  AlertCircle,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { getTierColor, formatNumber } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import toast from 'react-hot-toast';

const tierOptions = [
  { value: '', label: 'Todos los tiers' },
  { value: 'A', label: 'Tier A' },
  { value: 'B', label: 'Tier B' },
  { value: 'C', label: 'Tier C' },
  { value: 'D', label: 'Tier D' },
];

const industryOptions = [
  { value: '', label: 'Todas las industrias' },
  { value: 'technology', label: 'Tecnologia' },
  { value: 'finance', label: 'Finanzas' },
  { value: 'healthcare', label: 'Salud' },
  { value: 'education', label: 'Educacion' },
  { value: 'real_estate', label: 'Inmobiliaria' },
  { value: 'retail', label: 'Retail' },
  { value: 'manufacturing', label: 'Manufactura' },
  { value: 'consulting', label: 'Consultoria' },
  { value: 'other', label: 'Otra' },
];

export default function Companies() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useConfirmDialog();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    domain: '',
    industry: '',
    tier: 'C',
    description: '',
    website: '',
    employeeCount: '',
    address: '',
  });

  const limit = 20;
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading, error } = useQuery({
    queryKey: ['companies', { page, limit, search: debouncedSearch, tier: tierFilter, industry: industryFilter }],
    queryFn: () =>
      companiesApi.list({
        page,
        limit,
        search: debouncedSearch || undefined,
        tier: tierFilter || undefined,
        industry: industryFilter || undefined,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => companiesApi.create(data),
    onSuccess: () => {
      toast.success('Empresa creada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setShowCreateModal(false);
      setCreateForm({ name: '', domain: '', industry: '', tier: 'C', description: '', website: '', employeeCount: '', address: '' });
    },
    onError: () => {
      toast.error('Error al crear la empresa');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => companiesApi.delete(id),
    onSuccess: () => {
      toast.success('Empresa eliminada');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: () => {
      toast.error('Error al eliminar la empresa');
    },
  });

  const companies = data?.data?.data?.companies || [];
  const total = data?.data?.data?.pagination?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name) {
      toast.error('El nombre es obligatorio');
      return;
    }
    const payload: Record<string, unknown> = {
      name: createForm.name,
      domain: createForm.domain || undefined,
      industry: createForm.industry || undefined,
      tier: createForm.tier,
      description: createForm.description || undefined,
      website_url: createForm.website || undefined,
      employee_count: createForm.employeeCount || undefined,
    };
    createMutation.mutate(payload);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Empresas</h1>
          <p className="text-slate-500 mt-1">Gestiona las empresas objetivo de tu ABM</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
          Nueva Empresa
        </Button>
      </div>

      {/* Filters */}
      <Card padding="md">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <Input
              placeholder="Buscar por nombre, dominio..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              icon={<Search className="h-4 w-4" />}
            />
          </div>
          <div className="w-44">
            <Select
              options={tierOptions}
              value={tierFilter}
              onChange={(val) => {
                setTierFilter(val);
                setPage(1);
              }}
            />
          </div>
          <div className="w-52">
            <Select
              options={industryOptions}
              value={industryFilter}
              onChange={(val) => {
                setIndustryFilter(val);
                setPage(1);
              }}
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          <span className="ml-2 text-slate-500">Cargando empresas...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-red-500">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p className="text-sm">Error al cargar las empresas</p>
        </div>
      ) : companies.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <Building2 className="h-12 w-12 text-slate-300 mb-3" />
          <h3 className="text-lg font-medium text-slate-600">Sin empresas</h3>
          <p className="text-sm text-slate-400 mt-1">Agrega tu primera empresa objetivo</p>
          <Button className="mt-4" onClick={() => setShowCreateModal(true)}>
            Nueva Empresa
          </Button>
        </Card>
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow hoverable={false}>
                <TableCell isHeader>Nombre</TableCell>
                <TableCell isHeader>Dominio</TableCell>
                <TableCell isHeader>Industria</TableCell>
                <TableCell isHeader className="text-center">Tier</TableCell>
                <TableCell isHeader className="text-center">Prospectos</TableCell>
                <TableCell isHeader className="text-center">Puntuacion</TableCell>
                <TableCell isHeader className="w-20">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {companies.map((company: Record<string, unknown>) => {
                const id = (company.id || company._id) as string;
                return (
                  <TableRow key={id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {company.domain ? (
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${company.domain}&sz=32`}
                            alt=""
                            className="w-8 h-8 rounded-lg bg-slate-100 p-1"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-600">
                            <Building2 className="h-4 w-4" />
                          </div>
                        )}
                        <button
                          onClick={() => navigate(`/companies/${id}`)}
                          className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline"
                        >
                          {company.name as string}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {company.domain ? (
                        <a
                          href={`https://${company.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-primary-600 hover:underline"
                        >
                          {company.domain as string}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600">{company.industry as string || '-'}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={getTierColor(company.tier as string || 'D')} size="md">
                        {company.tier as string || '-'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-slate-600">
                      {formatNumber(company.prospect_count as number || 0)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-medium text-slate-900">
                        {company.account_score as number || 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => {
                          confirm({
                            title: 'Eliminar empresa?',
                            description: `Se eliminara "${company.name}" permanentemente.`,
                            confirmLabel: 'Eliminar',
                            onConfirm: () => deleteMutation.mutate(id),
                          });
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        aria-label="Eliminar empresa"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={limit}
            onPageChange={setPage}
          />
        </>
      )}

      {/* Create modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nueva Empresa"
        size="lg"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nombre de la Empresa"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Empresa S.A."
              required
            />
            <Input
              label="Dominio"
              value={createForm.domain}
              onChange={(e) => setCreateForm((f) => ({ ...f, domain: e.target.value }))}
              placeholder="empresa.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Industria"
              options={industryOptions.filter((o) => o.value !== '')}
              value={createForm.industry}
              onChange={(val) => setCreateForm((f) => ({ ...f, industry: val }))}
              placeholder="Seleccionar industria"
            />
            <Select
              label="Tier"
              options={tierOptions.filter((o) => o.value !== '')}
              value={createForm.tier}
              onChange={(val) => setCreateForm((f) => ({ ...f, tier: val }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Sitio Web"
              value={createForm.website}
              onChange={(e) => setCreateForm((f) => ({ ...f, website: e.target.value }))}
              placeholder="https://empresa.com"
            />
            <Input
              label="Cantidad de Empleados"
              type="number"
              value={createForm.employeeCount}
              onChange={(e) => setCreateForm((f) => ({ ...f, employeeCount: e.target.value }))}
              placeholder="100"
            />
          </div>
          <Input
            label="Direccion"
            value={createForm.address}
            onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Buenos Aires, Argentina"
          />
          <div>
            <label className="form-label">Descripcion</label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="form-input"
              placeholder="Descripcion de la empresa..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Crear Empresa
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
