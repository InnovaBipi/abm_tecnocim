import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prospectsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import {
  ArrowLeft,
  Save,
  RefreshCw,
  User,
  Mail,
  Phone,
  Building2,
  Briefcase,
  Globe,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Send,
} from 'lucide-react';
import { formatDateTime, formatRelativeDate, getScoreColor, getStatusColor } from '@/lib/utils';
import toast from 'react-hot-toast';

const statusOptions = [
  { value: 'new', label: 'Nuevo' },
  { value: 'contacted', label: 'Contactado' },
  { value: 'qualified', label: 'Calificado' },
  { value: 'converted', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
];

export default function ProspectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('info');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['prospects', id],
    queryFn: () => prospectsApi.get(id!),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) => prospectsApi.update(id!, updates),
    onSuccess: () => {
      toast.success('Prospecto actualizado exitosamente');
      queryClient.invalidateQueries({ queryKey: ['prospects', id] });
      setIsEditing(false);
    },
    onError: () => {
      toast.error('Error al actualizar el prospecto');
    },
  });

  const enrichMutation = useMutation({
    mutationFn: () => prospectsApi.enrich(id!),
    onSuccess: () => {
      toast.success('Prospecto enriquecido exitosamente');
      queryClient.invalidateQueries({ queryKey: ['prospects', id] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al enriquecer el prospecto');
    },
  });

  const recalcScoreMutation = useMutation({
    mutationFn: () => prospectsApi.recalculateScore(id!),
    onSuccess: (response) => {
      const score = response?.data?.data?.score;
      toast.success(`Score recalculado: ${score}`);
      queryClient.invalidateQueries({ queryKey: ['prospects', id] });
    },
    onError: () => {
      toast.error('Error al recalcular el score');
    },
  });

  const prospect = data?.data?.data;

  const handleEdit = () => {
    setEditForm({
      first_name: prospect?.first_name || '',
      last_name: prospect?.last_name || '',
      email: prospect?.email || '',
      phone: prospect?.phone || '',
      title: prospect?.title || '',
      linkedin_url: prospect?.linkedin_url || '',
      status: prospect?.status || 'new',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editForm);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        <span className="ml-2 text-slate-500">Cargando prospecto...</span>
      </div>
    );
  }

  if (error || !prospect) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-red-500">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p className="text-sm">Error al cargar el prospecto</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/prospects')}>
          Volver a Prospectos
        </Button>
      </div>
    );
  }

  const name = prospect.full_name || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || 'Sin nombre';
  const score = prospect.lead_score || 0;

  const tabs = [
    { id: 'info', label: 'Informacion', icon: <User className="h-4 w-4" /> },
    { id: 'activity', label: 'Actividad', icon: <Clock className="h-4 w-4" /> },
    { id: 'emails', label: 'Emails', icon: <Mail className="h-4 w-4" /> },
    { id: 'enrichment', label: 'Enrichment', icon: <Globe className="h-4 w-4" /> },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/prospects')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a Prospectos
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-100 text-primary-700 text-xl font-bold">
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{name}</h1>
              <button
                onClick={() => recalcScoreMutation.mutate()}
                disabled={recalcScoreMutation.isPending}
                title="Recalcular score"
                className={`inline-flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold cursor-pointer hover:ring-2 hover:ring-primary-300 transition-all ${getScoreColor(score)}`}
              >
                {recalcScoreMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : score}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
              {prospect.title && (
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3.5 w-3.5" />
                  {prospect.title}
                </span>
              )}
              {prospect.company_name && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {prospect.company_name}
                </span>
              )}
            </div>
          </div>
        </div>
        <Badge className={getStatusColor(prospect.status || 'new')} size="md">
          {prospect.status || 'nuevo'}
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {(tab) => {
          if (tab === 'info') {
            return (
              <Card padding="md">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-slate-900">Datos del Prospecto</h3>
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setIsEditing(false)}>
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        icon={<Save className="h-4 w-4" />}
                        loading={updateMutation.isPending}
                        onClick={handleSave}
                      >
                        Guardar
                      </Button>
                    </div>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={handleEdit}>
                      Editar
                    </Button>
                  )}
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Nombre"
                      value={editForm.first_name as string}
                      onChange={(e) => setEditForm((f) => ({ ...f, first_name: e.target.value }))}
                      icon={<User className="h-4 w-4" />}
                    />
                    <Input
                      label="Apellido"
                      value={editForm.last_name as string}
                      onChange={(e) => setEditForm((f) => ({ ...f, last_name: e.target.value }))}
                    />
                    <Input
                      label="Correo Electronico"
                      type="email"
                      value={editForm.email as string}
                      onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                      icon={<Mail className="h-4 w-4" />}
                    />
                    <Input
                      label="Telefono"
                      value={editForm.phone as string}
                      onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                      icon={<Phone className="h-4 w-4" />}
                    />
                    <Input
                      label="Cargo"
                      value={editForm.title as string}
                      onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                      icon={<Briefcase className="h-4 w-4" />}
                    />
                    <Input
                      label="LinkedIn"
                      value={editForm.linkedin_url as string}
                      onChange={(e) => setEditForm((f) => ({ ...f, linkedin_url: e.target.value }))}
                      icon={<Globe className="h-4 w-4" />}
                    />
                    <Select
                      label="Estado"
                      options={statusOptions}
                      value={editForm.status as string}
                      onChange={(val) => setEditForm((f) => ({ ...f, status: val }))}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <InfoField icon={<User className="h-4 w-4" />} label="Nombre completo" value={name} />
                    <InfoField icon={<Mail className="h-4 w-4" />} label="Email" value={prospect.email} />
                    <InfoField icon={<Phone className="h-4 w-4" />} label="Telefono" value={prospect.phone} />
                    <InfoField icon={<Building2 className="h-4 w-4" />} label="Empresa" value={prospect.company_name} />
                    <InfoField icon={<Briefcase className="h-4 w-4" />} label="Cargo" value={prospect.title} />
                    <InfoField icon={<Globe className="h-4 w-4" />} label="LinkedIn" value={prospect.linkedin_url} />
                    <InfoField label="Fuente" value={prospect.source} />
                    <InfoField label="Creado" value={prospect.created_at ? formatDateTime(prospect.created_at) : '-'} />
                  </div>
                )}
              </Card>
            );
          }

          if (tab === 'activity') {
            const activities = prospect.activities || [];
            return (
              <Card padding="md">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Historial de Actividad</h3>
                {activities.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Clock className="h-8 w-8 mb-2" />
                    <p className="text-sm">Sin actividad registrada</p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {activities.map((activity: Record<string, unknown>, index: number) => (
                      <div key={index} className="flex gap-3 py-3 border-b border-slate-100 last:border-b-0">
                        <div className="w-2 h-2 rounded-full bg-primary-400 mt-2 shrink-0" />
                        <div>
                          <p className="text-sm text-slate-700">{activity.description as string || activity.title as string}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatRelativeDate(activity.occurred_at as string)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          }

          if (tab === 'emails') {
            const emails = prospect.emails || [];
            return (
              <Card padding="md">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Historial de Emails</h3>
                {emails.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Mail className="h-8 w-8 mb-2" />
                    <p className="text-sm">Sin emails enviados</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {emails.map((email: Record<string, unknown>, index: number) => (
                      <div key={index} className="border border-slate-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Send className="h-4 w-4 text-slate-400" />
                            <span className="text-sm font-medium text-slate-900">
                              {email.subject as string || 'Sin asunto'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {email.status === 'delivered' || email.status === 'sent' ? (
                              <Badge variant="success">Enviado</Badge>
                            ) : email.status === 'opened' ? (
                              <Badge variant="info">Abierto</Badge>
                            ) : email.status === 'replied' ? (
                              <Badge variant="purple">Respondido</Badge>
                            ) : email.status === 'bounced' ? (
                              <Badge variant="danger">Rebotado</Badge>
                            ) : (
                              <Badge>{email.status as string}</Badge>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-slate-400">
                          {email.sent_at ? formatDateTime(email.sent_at as string) : '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          }

          if (tab === 'enrichment') {
            const enrichment = prospect.enrichment || prospect.enrichmentData;
            return (
              <Card padding="md">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">Datos de Enriquecimiento</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw className="h-4 w-4" />}
                    onClick={() => enrichMutation.mutate()}
                    loading={enrichMutation.isPending}
                  >
                    Re-enriquecer
                  </Button>
                </div>
                {!enrichment ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Globe className="h-8 w-8 mb-2" />
                    <p className="text-sm">Sin datos de enriquecimiento</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      icon={<RefreshCw className="h-4 w-4" />}
                      onClick={() => enrichMutation.mutate()}
                      loading={enrichMutation.isPending}
                    >
                      Enriquecer ahora
                    </Button>
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-lg p-4 overflow-x-auto">
                    <pre className="text-xs text-slate-600 whitespace-pre-wrap">
                      {JSON.stringify(enrichment, null, 2)}
                    </pre>
                  </div>
                )}
              </Card>
            );
          }

          return null;
        }}
      </Tabs>
    </div>
  );
}

function InfoField({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && <div className="text-slate-400 mt-0.5 shrink-0">{icon}</div>}
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-900 mt-0.5">{value || '-'}</p>
      </div>
    </div>
  );
}
