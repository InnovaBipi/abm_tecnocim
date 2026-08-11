import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { campaignsApi, usersApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Search,
  Plus,
  Trash2,
  Megaphone,
  Loader2,
  AlertCircle,
  Users,
  Mail,
  MessageSquare,
  ChevronRight,
} from 'lucide-react';
import { getStatusColor, formatNumber, formatDate } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import toast from 'react-hot-toast';

const statusFilterOptions = [
  { value: '', label: 'Todos los estados' },
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activo' },
  { value: 'paused', label: 'Pausado' },
  { value: 'completed', label: 'Completado' },
];

const DEFAULT_ASSET_TYPE_OPTIONS = [
  { value: 'property', label: 'Propiedad' },
  { value: 'development', label: 'Desarrollo' },
  { value: 'land', label: 'Terreno' },
  { value: 'commercial', label: 'Comercial' },
  { value: 'general', label: 'General' },
];

const statusOptions = [
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activo' },
];

export default function Campaigns() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useConfirmDialog();
  const tenant = useAuthStore((s) => s.tenant);

  const entityLabel = tenant?.config?.entity?.type_label || 'Propiedad';
  const entityLabelPlural = tenant?.config?.entity?.type_label_plural || 'Propiedades';

  // Use tenant-specific entity fields for asset types, or fall back to defaults
  const assetTypeOptions = tenant?.config?.entity?.fields?.length
    ? tenant.config.entity.fields.map((f) => ({ value: f.name, label: f.label }))
    : DEFAULT_ASSET_TYPE_OPTIONS;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    assetType: 'general',
    assetName: '',
    status: 'draft',
    senderUserId: '',
  });

  const debouncedSearch = useDebouncedValue(search, 300);

  // Available senders for the campaign (active users with sender_email)
  const { data: sendersData } = useQuery({
    queryKey: ['users', 'senders'],
    queryFn: () => usersApi.senders(),
    enabled: showCreateModal,
    staleTime: 60_000,
  });
  const senders = sendersData?.data?.data?.senders || [];
  const senderOptions = [
    { value: '', label: 'Remitente del tenant (por defecto)' },
    ...senders.map((s: { id: string; first_name?: string; last_name?: string; sender_name?: string; sender_email: string }) => ({
      value: s.id,
      label: `${s.sender_name || [s.first_name, s.last_name].filter(Boolean).join(' ')} <${s.sender_email}>`,
    })),
  ];

  const { data, isLoading, error } = useQuery({
    queryKey: ['campaigns', { search: debouncedSearch, status: statusFilter }],
    queryFn: () =>
      campaignsApi.list({
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => campaignsApi.create(data),
    onSuccess: () => {
      toast.success('Campaña creada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setShowCreateModal(false);
      setCreateForm({ name: '', description: '', assetType: 'general', assetName: '', status: 'draft', senderUserId: '' });
    },
    onError: () => {
      toast.error('Error al crear la campaña');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => campaignsApi.delete(id),
    onSuccess: () => {
      toast.success('Campaña eliminada');
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: () => {
      toast.error('Error al eliminar la campaña');
    },
  });

  const campaigns = data?.data?.data?.campaigns || [];

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name) {
      toast.error('El nombre es obligatorio');
      return;
    }
    createMutation.mutate({
      name: createForm.name,
      description: createForm.description || undefined,
      asset_type: createForm.assetType,
      asset_location: createForm.assetName || undefined,
      status: createForm.status,
      sender_user_id: createForm.senderUserId || undefined,
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campañas</h1>
          <p className="text-slate-500 mt-1">Gestiona tus campañas de marketing basado en cuentas</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
          Nueva Campaña
        </Button>
      </div>

      {/* Filters */}
      <Card padding="md">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <Input
              placeholder="Buscar campañas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              icon={<Search className="h-4 w-4" />}
            />
          </div>
          <div className="w-48">
            <Select
              options={statusFilterOptions}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          </div>
        </div>
      </Card>

      {/* Campaigns grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          <span className="ml-2 text-slate-500">Cargando campañas...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-red-500">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p className="text-sm">Error al cargar las campañas</p>
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <Megaphone className="h-12 w-12 text-slate-300 mb-3" />
          <h3 className="text-lg font-medium text-slate-600">Sin campañas</h3>
          <p className="text-sm text-slate-400 mt-1">Crea tu primera campaña ABM</p>
          <Button className="mt-4" onClick={() => setShowCreateModal(true)}>
            Nueva Campaña
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((campaign: Record<string, unknown>) => {
            const id = (campaign.id || campaign._id) as string;
            const emailsSent = campaign.emails_sent as number || 0;
            const repliedCount = campaign.emails_replied as number || 0;
            const replyRate = emailsSent > 0 ? ((repliedCount / emailsSent) * 100).toFixed(1) : '0';

            return (
              <Card key={id} padding="none" className="hover:shadow-md transition-shadow">
                <div className="p-5">
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary-50 text-primary-600">
                        <Megaphone className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900 leading-tight">
                          {campaign.name as string}
                        </h3>
                        {!!campaign.asset_type && (
                          <span className="text-xs text-slate-500 capitalize">
                            {campaign.asset_type as string}
                            {campaign.asset_location ? ` - ${campaign.asset_location as string}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge className={getStatusColor(campaign.status as string || 'draft')}>
                      {campaign.status as string || 'borrador'}
                    </Badge>
                  </div>

                  {/* Description */}
                  {!!campaign.description && (
                    <p className="text-xs text-slate-500 mb-3 line-clamp-2">
                      {campaign.description as string}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-600">
                        {formatNumber(campaign.prospect_count as number || 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-600">
                        {formatNumber(emailsSent)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-600">
                        {replyRate}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer actions */}
                <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-t border-slate-100">
                  <span className="text-xs text-slate-400">
                    {campaign.created_at ? formatDate(campaign.created_at as string) : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirm({
                          title: '¿Eliminar campaña?',
                          description: 'Se eliminará la campaña y todos sus datos asociados.',
                          confirmLabel: 'Eliminar',
                          onConfirm: () => deleteMutation.mutate(id),
                        });
                      }}
                      className="p-1 rounded text-slate-400 hover:text-red-600 transition-colors"
                      aria-label={`Eliminar campaña ${campaign.name as string}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => navigate(`/campaigns/${id}`)}
                      className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
                    >
                      Ver detalle
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nueva Campaña"
        size="lg"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <Input
            label="Nombre de la Campaña"
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Campaña Q1 2025 - Propiedades Premium"
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Tipo de Activo"
              options={assetTypeOptions}
              value={createForm.assetType}
              onChange={(val) => setCreateForm((f) => ({ ...f, assetType: val }))}
            />
            <Input
              label="Nombre del Activo"
              value={createForm.assetName}
              onChange={(e) => setCreateForm((f) => ({ ...f, assetName: e.target.value }))}
              placeholder="Torre Palermo 500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Estado"
              options={statusOptions}
              value={createForm.status}
              onChange={(val) => setCreateForm((f) => ({ ...f, status: val }))}
            />
            <Select
              label="Remitente"
              options={senderOptions}
              value={createForm.senderUserId}
              onChange={(val) => setCreateForm((f) => ({ ...f, senderUserId: val }))}
            />
          </div>
          <div>
            <label className="form-label">Descripción</label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="form-input"
              placeholder="Describe el objetivo de esta campaña..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Crear Campaña
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
