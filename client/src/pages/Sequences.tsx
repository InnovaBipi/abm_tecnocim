import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sequencesApi, campaignsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import {
  Plus,
  Mail,
  Trash2,
  Play,
  Pause,
  Loader2,
  AlertCircle,
  Users,
  Send,
  MessageSquare,
} from 'lucide-react';
import { getStatusColor, formatNumber } from '@/lib/utils';
import toast from 'react-hot-toast';

const statusOptions = [
  { value: '', label: 'Todos los estados' },
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activo' },
  { value: 'paused', label: 'Pausado' },
  { value: 'completed', label: 'Completado' },
];

export default function Sequences() {
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    campaignId: '',
    description: '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['sequences', { status: statusFilter }],
    queryFn: () => sequencesApi.list({ status: statusFilter || undefined }),
  });

  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', 'for-select'],
    queryFn: () => campaignsApi.list({ limit: 100 }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => sequencesApi.create(data),
    onSuccess: () => {
      toast.success('Secuencia creada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
      setShowCreateModal(false);
      setCreateForm({ name: '', campaignId: '', description: '' });
    },
    onError: () => {
      toast.error('Error al crear la secuencia');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sequencesApi.delete(id),
    onSuccess: () => {
      toast.success('Secuencia eliminada');
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
    },
    onError: () => {
      toast.error('Error al eliminar la secuencia');
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => sequencesApi.pause(id),
    onSuccess: () => {
      toast.success('Secuencia pausada');
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
    },
    onError: () => {
      toast.error('Error al pausar la secuencia');
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => sequencesApi.resume(id),
    onSuccess: () => {
      toast.success('Secuencia reanudada');
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
    },
    onError: () => {
      toast.error('Error al reanudar la secuencia');
    },
  });

  const sequences = data?.data?.data?.sequences || [];
  const campaigns = campaignsData?.data?.data?.campaigns || [];
  const campaignOptions = campaigns.map((c: Record<string, unknown>) => ({
    value: (c.id || c._id) as string,
    label: c.name as string,
  }));

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name) {
      toast.error('El nombre es obligatorio');
      return;
    }
    createMutation.mutate(createForm);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Secuencias</h1>
          <p className="text-slate-500 mt-1">Gestiona tus secuencias de emails automatizadas</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
          Nueva Secuencia
        </Button>
      </div>

      {/* Filters */}
      <Card padding="md">
        <div className="flex items-end gap-4">
          <div className="w-52">
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Estado"
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          <span className="ml-2 text-slate-500">Cargando secuencias...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-red-500">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p className="text-sm">Error al cargar las secuencias</p>
        </div>
      ) : sequences.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16">
          <Mail className="h-12 w-12 text-slate-300 mb-3" />
          <h3 className="text-lg font-medium text-slate-600">Sin secuencias</h3>
          <p className="text-sm text-slate-400 mt-1">Crea tu primera secuencia de emails</p>
          <Button className="mt-4" onClick={() => setShowCreateModal(true)}>
            Nueva Secuencia
          </Button>
        </Card>
      ) : (
        <Table>
          <TableHead>
            <TableRow hoverable={false}>
              <TableCell isHeader>Nombre</TableCell>
              <TableCell isHeader>Campana</TableCell>
              <TableCell isHeader>Estado</TableCell>
              <TableCell isHeader className="text-center">
                <Users className="h-4 w-4 inline mr-1" />
                Inscritos
              </TableCell>
              <TableCell isHeader className="text-center">
                <Send className="h-4 w-4 inline mr-1" />
                Enviados
              </TableCell>
              <TableCell isHeader className="text-center">
                <MessageSquare className="h-4 w-4 inline mr-1" />
                Respondidos
              </TableCell>
              <TableCell isHeader className="w-32">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sequences.map((sequence: Record<string, unknown>) => {
              const seqId = (sequence.id || sequence._id) as string;
              const status = sequence.status as string || 'draft';

              return (
                <TableRow key={seqId}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{sequence.name as string}</p>
                      {sequence.description && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">
                          {sequence.description as string}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {sequence.campaignName as string || sequence.campaign as string || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(status)}>{status}</Badge>
                  </TableCell>
                  <TableCell className="text-center text-slate-600">
                    {formatNumber(sequence.enrolledCount as number || 0)}
                  </TableCell>
                  <TableCell className="text-center text-slate-600">
                    {formatNumber(sequence.sentCount as number || 0)}
                  </TableCell>
                  <TableCell className="text-center text-slate-600">
                    {formatNumber(sequence.repliedCount as number || 0)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {status === 'active' ? (
                        <button
                          onClick={() => pauseMutation.mutate(seqId)}
                          className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 transition-colors"
                          title="Pausar"
                        >
                          <Pause className="h-4 w-4" />
                        </button>
                      ) : status === 'paused' || status === 'draft' ? (
                        <button
                          onClick={() => resumeMutation.mutate(seqId)}
                          className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 transition-colors"
                          title="Reanudar"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        onClick={() => {
                          if (confirm('Eliminar esta secuencia?')) {
                            deleteMutation.mutate(seqId);
                          }
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Create modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nueva Secuencia"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <Input
            label="Nombre de la Secuencia"
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Secuencia de seguimiento - Q1"
            required
          />
          <Select
            label="Campana Asociada"
            options={campaignOptions}
            value={createForm.campaignId}
            onChange={(val) => setCreateForm((f) => ({ ...f, campaignId: val }))}
            placeholder="Seleccionar campana (opcional)"
          />
          <div>
            <label className="form-label">Descripcion</label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="form-input"
              placeholder="Describe el objetivo de esta secuencia..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <Button variant="secondary" type="button" onClick={() => setShowCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Crear Secuencia
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
