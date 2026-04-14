import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { prospectsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { SortableHeader, SortDirection } from '@/components/ui/SortableHeader';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import {
  Search,
  Plus,
  Upload,
  Trash2,
  Megaphone,
  AlertCircle,
  UserPlus,
} from 'lucide-react';
import { formatRelativeDate, getStatusColor, getScoreColor } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import toast from 'react-hot-toast';

const statusOptions = [
  { value: '', label: 'Todos los estados' },
  { value: 'new', label: 'Nuevo' },
  { value: 'contacted', label: 'Contactado' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'converted', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
];

const sourceOptions = [
  { value: '', label: 'Todas las fuentes' },
  { value: 'manual', label: 'Manual' },
  { value: 'import', label: 'Importacion' },
  { value: 'web', label: 'Web' },
  { value: 'referral', label: 'Referido' },
  { value: 'linkedin', label: 'LinkedIn' },
];

export default function Prospects() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    source: 'manual',
  });
  const { dialogProps, confirm } = useConfirmDialog();
  const debouncedSearch = useDebouncedValue(search, 300);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const limit = 20;

  const handleSort = (field: string, direction: SortDirection) => {
    setSortBy(direction ? field : null);
    setSortDirection(direction);
    setPage(1);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['prospects', { page, limit, search: debouncedSearch, status: statusFilter, source: sourceFilter, sortBy, sortDirection }],
    queryFn: () =>
      prospectsApi.list({
        page,
        limit,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        source: sourceFilter || undefined,
        sortBy: sortBy || undefined,
        sortOrder: sortDirection || undefined,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => prospectsApi.create(data),
    onSuccess: () => {
      toast.success('Prospecto creado exitosamente');
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      setShowCreateModal(false);
      setCreateForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        company: '',
        title: '',
        source: 'manual',
      });
    },
    onError: () => {
      toast.error('Error al crear el prospecto');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => prospectsApi.delete(id),
    onSuccess: () => {
      toast.success('Prospecto eliminado');
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
    onError: () => {
      toast.error('Error al eliminar el prospecto');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => prospectsApi.bulkDelete(ids),
    onSuccess: () => {
      toast.success('Prospectos eliminados exitosamente');
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
    onError: () => {
      toast.error('Error al eliminar los prospectos');
    },
  });

  const prospects = data?.data?.data?.prospects || [];
  const total = data?.data?.data?.pagination?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const handleSelectAll = () => {
    if (selectedIds.length === prospects.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(prospects.map((p: Record<string, unknown>) => p.id as string || p._id as string));
    }
  };

  const handleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.email) {
      toast.error('El email es obligatorio');
      return;
    }
    createMutation.mutate({
      email: createForm.email,
      first_name: createForm.firstName,
      last_name: createForm.lastName,
      phone: createForm.phone || undefined,
      title: createForm.title || undefined,
      source: createForm.source,
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Prospectos</h1>
          <p className="text-slate-500 mt-1">Gestiona tu base de prospectos</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<Upload className="h-4 w-4" />}
            onClick={() => navigate('/imports')}
          >
            Importar CSV
          </Button>
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setShowCreateModal(true)}
          >
            Nuevo Prospecto
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card padding="md">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <Input
              placeholder="Buscar por nombre, email, empresa..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              icon={<Search className="h-4 w-4" />}
            />
          </div>
          <div className="w-48">
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={(val) => {
                setStatusFilter(val);
                setPage(1);
              }}
              placeholder="Estado"
            />
          </div>
          <div className="w-48">
            <Select
              options={sourceOptions}
              value={sourceFilter}
              onChange={(val) => {
                setSourceFilter(val);
                setPage(1);
              }}
              placeholder="Fuente"
            />
          </div>
        </div>
      </Card>

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 bg-primary-50 border border-primary-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-primary-700">
            {selectedIds.length} prospecto(s) seleccionado(s)
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="secondary"
              size="sm"
              icon={<Megaphone className="h-3.5 w-3.5" />}
              onClick={() => toast('Funcionalidad en desarrollo')}
            >
              Agregar a campana
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              loading={bulkDeleteMutation.isPending}
              onClick={() => {
                confirm({
                  title: `Eliminar ${selectedIds.length} prospecto(s)?`,
                  description: 'Esta accion no se puede deshacer. Los prospectos seran eliminados permanentemente.',
                  confirmLabel: 'Eliminar',
                  onConfirm: () => bulkDeleteMutation.mutate(selectedIds),
                });
              }}
            >
              Eliminar
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <SkeletonTable rows={8} columns={7} />
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-red-500">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p className="text-sm">Error al cargar los prospectos</p>
        </div>
      ) : prospects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UserPlus className="h-7 w-7" />}
            title="Sin prospectos"
            description="Agrega tu primer prospecto o importa un archivo CSV para comenzar"
            action={{
              label: 'Nuevo Prospecto',
              onClick: () => setShowCreateModal(true),
              icon: <Plus className="h-4 w-4" />,
            }}
            secondaryAction={{
              label: 'Importar CSV',
              onClick: () => navigate('/imports'),
            }}
          />
        </Card>
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow hoverable={false}>
                <TableCell isHeader className="w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === prospects.length && prospects.length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                </TableCell>
                <SortableHeader label="Nombre" field="full_name" currentSort={sortBy} currentDirection={sortDirection} onSort={handleSort} />
                <TableCell isHeader>Email</TableCell>
                <TableCell isHeader>Empresa</TableCell>
                <TableCell isHeader>Cargo</TableCell>
                <SortableHeader label="Puntuacion" field="lead_score" currentSort={sortBy} currentDirection={sortDirection} onSort={handleSort} className="text-center" />
                <SortableHeader label="Estado" field="status" currentSort={sortBy} currentDirection={sortDirection} onSort={handleSort} />
                <SortableHeader label="Ultima actividad" field="last_contacted" currentSort={sortBy} currentDirection={sortDirection} onSort={handleSort} />
                <TableCell isHeader className="w-20">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {prospects.map((prospect: Record<string, unknown>) => {
                const id = (prospect.id || prospect._id) as string;
                const name = (prospect.full_name as string) || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || '-';
                return (
                  <TableRow key={id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(id)}
                        onChange={() => handleSelect(id)}
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => navigate(`/prospects/${id}`)}
                        className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline"
                      >
                        {name}
                      </button>
                    </TableCell>
                    <TableCell className="text-slate-500">{prospect.email as string || '-'}</TableCell>
                    <TableCell className="text-slate-600">{prospect.company_name as string || '-'}</TableCell>
                    <TableCell className="text-slate-500">{prospect.title as string || '-'}</TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold ${getScoreColor(prospect.lead_score as number || 0)}`}>
                        {prospect.lead_score as number || 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(prospect.status as string || 'new')}>
                        {prospect.status as string || 'nuevo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {prospect.last_contacted || prospect.updated_at
                        ? formatRelativeDate((prospect.last_contacted || prospect.updated_at) as string)
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          confirm({
                            title: 'Eliminar prospecto?',
                            description: `Se eliminara a ${name} permanentemente.`,
                            confirmLabel: 'Eliminar',
                            onConfirm: () => deleteMutation.mutate(id),
                          });
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        aria-label="Eliminar prospecto"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Pagination */}
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
        title="Nuevo Prospecto"
        size="lg"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nombre"
              value={createForm.firstName}
              onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="Juan"
              required
            />
            <Input
              label="Apellido"
              value={createForm.lastName}
              onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="Perez"
              required
            />
          </div>
          <Input
            label="Correo Electronico"
            type="email"
            value={createForm.email}
            onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="juan@empresa.com"
            required
          />
          <Input
            label="Telefono"
            value={createForm.phone}
            onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+54 11 1234-5678"
          />
          <Input
            label="Empresa"
            value={createForm.company}
            onChange={(e) => setCreateForm((f) => ({ ...f, company: e.target.value }))}
            placeholder="Nombre de la empresa"
          />
          <Input
            label="Cargo"
            value={createForm.title}
            onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Director Comercial"
          />
          <Select
            label="Fuente"
            options={sourceOptions.filter((o) => o.value !== '')}
            value={createForm.source}
            onChange={(val) => setCreateForm((f) => ({ ...f, source: val }))}
          />
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Crear Prospecto
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
