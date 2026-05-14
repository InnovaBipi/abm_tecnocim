import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { outboxApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Send,
  Loader2,
  Check,
  X,
  Mail,
  Clock,
  CheckCircle,
  AlertCircle,
  Eye,
  CalendarClock,
  Zap,
} from 'lucide-react';
import { formatRelativeDate } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import toast from 'react-hot-toast';

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    draft: { label: 'Pendiente', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    approved: { label: 'Aprobado', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    rejected: { label: 'Rechazado', className: 'bg-red-50 text-red-600 border-red-200' },
    scheduled: { label: 'Programado', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    sent: { label: 'Enviado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    opened: { label: 'Abierto', className: 'bg-green-50 text-green-700 border-green-200' },
    replied: { label: 'Respondido', className: 'bg-purple-50 text-purple-700 border-purple-200' },
    bounced: { label: 'Rebotado', className: 'bg-red-50 text-red-700 border-red-200' },
  };
  const c = config[status] || { label: status, className: 'bg-slate-50 text-slate-600' };
  return <Badge className={c.className}>{c.label}</Badge>;
}

export default function Outbox() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { dialogProps, confirm: confirmAction } = useConfirmDialog();
  const [previewEmail, setPreviewEmail] = useState<any>(null);

  const statusParam = activeFilter === 'all' ? undefined : activeFilter;

  const { data: statsData, error: statsError } = useQuery({
    queryKey: ['outbox', 'stats'],
    queryFn: () => outboxApi.stats(),
  });

  const { data: emailsData, isLoading, error: emailsError } = useQuery({
    queryKey: ['outbox', 'list', activeFilter],
    queryFn: () => outboxApi.list({ status: statusParam, limit: 100 }),
    placeholderData: keepPreviousData,
  });

  const approveMutation = useMutation({
    mutationFn: (emailId: string) => outboxApi.approve(emailId),
    onSuccess: (res) => {
      const scheduledFor = res.data?.data?.scheduled_for;
      const dateStr = scheduledFor
        ? new Date(scheduledFor).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      toast.success(dateStr ? `Email programado para ${dateStr}` : 'Email programado');
      queryClient.invalidateQueries({ queryKey: ['outbox'] });
    },
    onError: () => toast.error('Error al aprobar'),
  });

  const rejectMutation = useMutation({
    mutationFn: (emailId: string) => outboxApi.reject(emailId),
    onSuccess: () => {
      toast.success('Email rechazado');
      queryClient.invalidateQueries({ queryKey: ['outbox'] });
    },
    onError: () => toast.error('Error al rechazar'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => outboxApi.bulkApprove(ids),
    onSuccess: (res) => {
      const count = res.data?.data?.count || 0;
      toast.success(`${count} email(s) programados`);
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['outbox'] });
    },
    onError: () => toast.error('Error al aprobar'),
  });

  const sendMutation = useMutation({
    mutationFn: (ids?: string[]) => outboxApi.send(ids),
    onSuccess: (res) => {
      const d = res.data?.data;
      toast.success(`Enviados: ${d?.sent || 0}, Fallidos: ${d?.failed || 0}`);
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['outbox'] });
    },
    onError: () => toast.error('Error al enviar emails'),
  });

  const stats = statsData?.data?.data;
  const emails: any[] = emailsData?.data?.data?.emails || [];

  const scheduledCount = stats?.byStatus?.scheduled || 0;

  const filters = [
    { key: 'all', label: 'Todos', count: stats?.total || 0 },
    { key: 'draft', label: 'Pendientes', count: stats?.byStatus?.draft || 0 },
    { key: 'scheduled', label: 'Programados', count: scheduledCount },
    { key: 'sent', label: 'Enviados', count: stats?.byStatus?.sent || 0 },
    { key: 'rejected', label: 'Rechazados', count: stats?.byStatus?.rejected || 0 },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-100 text-primary-700">
            <Send className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Bandeja de Salida</h1>
            <p className="text-sm text-slate-500">Todos los emails generados en todas las propiedades</p>
          </div>
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <Button
              variant="secondary"
              icon={<Check className="h-4 w-4" />}
              onClick={() => bulkApproveMutation.mutate(selectedIds)}
              loading={bulkApproveMutation.isPending}
            >
              Aprobar Seleccionados ({selectedIds.length})
            </Button>
          )}
          {scheduledCount > 0 && (
            <Button
              icon={<Zap className="h-4 w-4" />}
              onClick={() => {
                confirmAction({
                  title: `Forzar envio de ${scheduledCount} email(s)?`,
                  description: 'Los emails programados se enviaran inmediatamente.',
                  variant: 'warning',
                  confirmLabel: 'Enviar ahora',
                  onConfirm: () => sendMutation.mutate(undefined),
                });
              }}
              loading={sendMutation.isPending}
            >
              Forzar Envio ({scheduledCount})
            </Button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      {statsError ? (
        <div className="flex flex-col items-center justify-center py-8 text-red-500">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p className="text-sm">Error al cargar las estadisticas</p>
        </div>
      ) : (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="stat-card text-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-600 mx-auto mb-2">
            <Mail className="h-4 w-4" />
          </div>
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-xl font-bold text-slate-900">{stats?.total || 0}</p>
        </Card>
        <Card className="stat-card text-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 text-amber-600 mx-auto mb-2">
            <Clock className="h-4 w-4" />
          </div>
          <p className="text-xs text-slate-500">Pendientes</p>
          <p className="text-xl font-bold text-amber-600">{stats?.byStatus?.draft || 0}</p>
        </Card>
        <Card className="stat-card text-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 mx-auto mb-2">
            <CalendarClock className="h-4 w-4" />
          </div>
          <p className="text-xs text-slate-500">Programados</p>
          <p className="text-xl font-bold text-indigo-600">{scheduledCount}</p>
        </Card>
        <Card className="stat-card text-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 mx-auto mb-2">
            <Send className="h-4 w-4" />
          </div>
          <p className="text-xs text-slate-500">Enviados</p>
          <p className="text-xl font-bold text-emerald-600">{stats?.byStatus?.sent || 0}</p>
        </Card>
        <Card className="stat-card text-center">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-50 text-red-600 mx-auto mb-2">
            <AlertCircle className="h-4 w-4" />
          </div>
          <p className="text-xs text-slate-500">Rechazados</p>
          <p className="text-xl font-bold text-red-600">{stats?.byStatus?.rejected || 0}</p>
        </Card>
      </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-3">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => { setActiveFilter(f.key); setSelectedIds([]); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeFilter === f.key
                ? 'bg-primary-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Emails table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          <span className="ml-2 text-slate-500">Cargando emails...</span>
        </div>
      ) : emailsError ? (
        <div className="flex flex-col items-center justify-center py-16 text-red-500">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p className="text-sm">Error al cargar los emails</p>
        </div>
      ) : emails.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-12">
          <Mail className="h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">Sin emails en esta vista</p>
        </Card>
      ) : (
        <Table>
          <TableHead>
            <TableRow hoverable={false}>
              <TableCell isHeader className="w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.length === emails.length && emails.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(emails.map((em: any) => em.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                  className="rounded border-slate-300 text-primary-600"
                />
              </TableCell>
              <TableCell isHeader>Prospecto</TableCell>
              <TableCell isHeader>Propiedad</TableCell>
              <TableCell isHeader>Asunto</TableCell>
              <TableCell isHeader className="text-center">Paso</TableCell>
              <TableCell isHeader>Estado</TableCell>
              <TableCell isHeader>Fecha</TableCell>
              <TableCell isHeader className="w-24">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {emails.map((email: any) => {
              const isSelected = selectedIds.includes(email.id);
              return (
                <TableRow key={email.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedIds(prev =>
                          isSelected ? prev.filter(i => i !== email.id) : [...prev, email.id]
                        );
                      }}
                      className="rounded border-slate-300 text-primary-600"
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => navigate(`/prospects/${email.prospect_id}`)}
                      className="text-sm font-medium text-primary-600 hover:underline"
                    >
                      {email.full_name || `${email.first_name || ''} ${email.last_name || ''}`.trim()}
                    </button>
                    <p className="text-xs text-slate-400">{email.prospect_email}</p>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => navigate(`/campaigns/${email.campaign_id}`)}
                      className="text-sm text-slate-600 hover:text-primary-600"
                    >
                      {email.campaign_name}
                    </button>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => setPreviewEmail(email)}
                      className="text-sm text-slate-800 hover:text-primary-600 truncate max-w-[250px] block text-left"
                      title="Ver email completo"
                    >
                      {email.subject}
                    </button>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary-50 text-primary-700 text-xs font-bold">
                      {email.step_number}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={email.status} />
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {email.status === 'scheduled' && email.scheduled_for ? (
                      <span className="text-indigo-600" title={new Date(email.scheduled_for).toLocaleString('es-ES')}>
                        {new Date(email.scheduled_for).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    ) : (
                      formatRelativeDate(email.created_at)
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPreviewEmail(email)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                        title="Ver email" aria-label="Ver email"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {(email.status === 'draft' || email.status === 'rejected') && (
                        <button
                          onClick={() => approveMutation.mutate(email.id)}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Aprobar y programar" aria-label="Aprobar y programar"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                      {email.status === 'scheduled' && (
                        <button
                          onClick={() => {
                            confirmAction({
                              title: 'Forzar envio?',
                              description: `Se enviara el email a ${email.prospect_email} inmediatamente.`,
                              variant: 'warning',
                              confirmLabel: 'Enviar',
                              onConfirm: () => sendMutation.mutate([email.id]),
                            });
                          }}
                          className="p-1.5 rounded-lg text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Forzar envio" aria-label="Forzar envio"
                        >
                          <Zap className="h-4 w-4" />
                        </button>
                      )}
                      {(email.status === 'draft' || email.status === 'scheduled') && (
                        <button
                          onClick={() => rejectMutation.mutate(email.id)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                          title="Rechazar" aria-label="Rechazar"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Email preview modal */}
      <Modal
        isOpen={!!previewEmail}
        onClose={() => setPreviewEmail(null)}
        title="Vista previa del email"
        size="lg"
      >
        {previewEmail && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="bg-slate-50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-16">Para:</span>
                <span className="text-sm text-slate-800">
                  {previewEmail.full_name || `${previewEmail.first_name || ''} ${previewEmail.last_name || ''}`.trim()}
                  {' '}<span className="text-slate-400">({previewEmail.prospect_email})</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-16">Propiedad:</span>
                <button
                  onClick={() => { setPreviewEmail(null); navigate(`/campaigns/${previewEmail.campaign_id}`); }}
                  className="text-sm text-primary-600 hover:underline"
                >
                  {previewEmail.campaign_name}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500 w-16">Paso:</span>
                <span className="text-sm text-slate-800">{previewEmail.step_number}</span>
                <StatusBadge status={previewEmail.status} />
              </div>
            </div>

            {/* Subject */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Asunto</p>
              <p className="text-base font-semibold text-slate-900">{previewEmail.subject}</p>
            </div>

            {/* Body */}
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">Cuerpo</p>
              <div className="border border-slate-200 rounded-lg p-4 bg-white">
                <div
                  className="prose prose-sm max-w-none text-slate-700"
                  dangerouslySetInnerHTML={{ __html: previewEmail.body_html }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
              <span className="text-xs text-slate-400">
                {previewEmail.status === 'scheduled' && previewEmail.scheduled_for
                  ? `Programado: ${new Date(previewEmail.scheduled_for).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
                  : `Creado ${formatRelativeDate(previewEmail.created_at)}`
                }
              </span>
              <div className="flex gap-2">
                {(previewEmail.status === 'draft' || previewEmail.status === 'scheduled') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<X className="h-4 w-4" />}
                    onClick={() => {
                      rejectMutation.mutate(previewEmail.id);
                      setPreviewEmail(null);
                    }}
                  >
                    Rechazar
                  </Button>
                )}
                {(previewEmail.status === 'draft' || previewEmail.status === 'rejected') && (
                  <Button
                    size="sm"
                    icon={<Check className="h-4 w-4" />}
                    onClick={() => {
                      approveMutation.mutate(previewEmail.id);
                      setPreviewEmail(null);
                    }}
                  >
                    Aprobar
                  </Button>
                )}
                {previewEmail.status === 'scheduled' && (
                  <Button
                    size="sm"
                    icon={<Zap className="h-4 w-4" />}
                    onClick={() => {
                      confirmAction({
                        title: 'Forzar envio?',
                        description: `Se enviara el email a ${previewEmail.prospect_email} inmediatamente.`,
                        variant: 'warning',
                        confirmLabel: 'Enviar',
                        onConfirm: () => {
                          sendMutation.mutate([previewEmail.id]);
                          setPreviewEmail(null);
                        },
                      });
                    }}
                    loading={sendMutation.isPending}
                  >
                    Forzar Envio
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
