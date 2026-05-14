import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi, prospectsApi, outboxApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  ArrowLeft,
  Users,
  Mail,
  MessageSquare,
  TrendingUp,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Building,
  Search,
  Sparkles,
  Inbox,
  BarChart3,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Edit3,
  Send,
  AlertTriangle,
  Code,
  Eye,
} from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { getStatusColor, getScoreColor, formatNumber } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import toast from 'react-hot-toast';

const campaignStatusOptions = [
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activo' },
  { value: 'paused', label: 'Pausado' },
  { value: 'completed', label: 'Completado' },
];

// --- Email status badge helper ---
function EmailStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    none: { label: 'Sin generar', className: 'bg-slate-100 text-slate-500' },
    draft: { label: 'Generado', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    approved: { label: 'Aprobado', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    scheduled: { label: 'Programado', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    sent: { label: 'Enviado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    opened: { label: 'Abierto', className: 'bg-green-50 text-green-700 border-green-200' },
    replied: { label: 'Respondido', className: 'bg-purple-50 text-purple-700 border-purple-200' },
    bounced: { label: 'Rebotado', className: 'bg-red-50 text-red-700 border-red-200' },
    rejected: { label: 'Rechazado', className: 'bg-red-50 text-red-600 border-red-200' },
  };
  const c = config[status] || config.none;
  return <Badge className={c.className}>{c.label}</Badge>;
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState('prospects');
  const [showAddProspectsModal, setShowAddProspectsModal] = useState(false);
  const [prospectSearch, setProspectSearch] = useState('');
  const [selectedProspectIds, setSelectedProspectIds] = useState<string[]>([]);

  // Generate emails state
  const [numSteps, setNumSteps] = useState(4);
  const [generatingFor, setGeneratingFor] = useState<string[]>([]);

  // Bandeja state
  const [editingEmail, setEditingEmail] = useState<any>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('edit');
  const [expandedProspects, setExpandedProspects] = useState<Set<string>>(new Set());
  const [bandejaFilter, setBandejaFilter] = useState('all');

  // --- Queries ---
  const { data, isLoading, error } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!),
    enabled: !!id,
  });

  const { data: allProspectsData } = useQuery({
    queryKey: ['prospects', 'for-campaign', prospectSearch],
    queryFn: () => prospectsApi.list({ search: prospectSearch || undefined, limit: 20 }),
    enabled: showAddProspectsModal,
  });

  const { data: generatedEmailsData, refetch: refetchEmails } = useQuery({
    queryKey: ['campaigns', id, 'generated-emails'],
    queryFn: () => campaignsApi.getGeneratedEmails(id!),
    enabled: !!id && (activeTab === 'generate' || activeTab === 'bandeja'),
  });

  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['campaigns', id, 'metrics'],
    queryFn: () => campaignsApi.getMetrics(id!),
    enabled: !!id && activeTab === 'metrics',
  });

  // --- Mutations ---
  const addProspectsMutation = useMutation({
    mutationFn: (prospectIds: string[]) => campaignsApi.addProspects(id!, prospectIds),
    onSuccess: () => {
      toast.success('Prospectos agregados a la propiedad');
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
      setShowAddProspectsModal(false);
      setSelectedProspectIds([]);
    },
    onError: () => toast.error('Error al agregar prospectos'),
  });

  const removeProspectMutation = useMutation({
    mutationFn: (prospectId: string) => campaignsApi.removeProspect(id!, prospectId),
    onSuccess: () => {
      toast.success('Prospecto removido');
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
    },
    onError: () => toast.error('Error al remover el prospecto'),
  });

  const generateEmailsMutation = useMutation({
    mutationFn: (prospectIds: string[]) => campaignsApi.generateEmails(id!, prospectIds, numSteps),
    onSuccess: (res) => {
      const data = res.data?.data;
      toast.success(`Generados emails para ${data?.total_generated || 0} prospecto(s)`);
      setGeneratingFor([]);
      refetchEmails();
    },
    onError: () => {
      toast.error('Error al generar emails');
      setGeneratingFor([]);
    },
  });

  const approveEmailsMutation = useMutation({
    mutationFn: (emailIds: string[]) => campaignsApi.approveEmails(id!, emailIds),
    onSuccess: (res) => {
      const count = res.data?.data?.count || 0;
      toast.success(`${count} email(s) programados para envio`);
      refetchEmails();
    },
    onError: () => toast.error('Error al programar emails'),
  });

  const rejectEmailsMutation = useMutation({
    mutationFn: (emailIds: string[]) => campaignsApi.rejectEmails(id!, emailIds),
    onSuccess: () => {
      toast.success('Emails rechazados');
      refetchEmails();
    },
    onError: () => toast.error('Error al rechazar'),
  });

  const editEmailMutation = useMutation({
    mutationFn: ({ emailId, data }: { emailId: string; data: { subject?: string; body_html?: string } }) =>
      campaignsApi.editGeneratedEmail(id!, emailId, data),
    onSuccess: () => {
      toast.success('Email actualizado');
      setEditingEmail(null);
      refetchEmails();
    },
    onError: () => toast.error('Error al guardar'),
  });

  const sendEmailsMutation = useMutation({
    mutationFn: (emailIds: string[]) => outboxApi.send(emailIds),
    onSuccess: (res) => {
      const data = res.data?.data;
      toast.success(`Enviados: ${data?.sent || 0}, Fallidos: ${data?.failed || 0}`);
      refetchEmails();
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
    },
    onError: () => toast.error('Error al enviar emails'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => campaignsApi.update(id!, { status }),
    onSuccess: () => {
      toast.success('Estado de la campana actualizado');
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
    },
    onError: () => toast.error('Error al cambiar el estado'),
  });

  const campaign = data?.data?.data;
  const allProspects = allProspectsData?.data?.data?.prospects || [];
  const generatedEmails = generatedEmailsData?.data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        <span className="ml-2 text-slate-500">Cargando propiedad...</span>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-red-500">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p className="text-sm">Error al cargar la propiedad</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/campaigns')}>
          Volver a Propiedades
        </Button>
      </div>
    );
  }

  const emailsSent = campaign.emailStats?.sent || 0;
  const repliedCount = campaign.emailStats?.replied || 0;
  const replyRate = emailsSent > 0 ? ((repliedCount / emailsSent) * 100).toFixed(1) : '0';
  const prospects: any[] = campaign.prospects || [];

  // Build a map of prospect email statuses from generated emails
  const prospectEmailStatus: Record<string, string> = {};
  if (generatedEmails?.emails) {
    for (const email of generatedEmails.emails) {
      const current = prospectEmailStatus[email.prospect_id];
      // Priority: replied > sent > approved > draft > none
      const priority: Record<string, number> = { replied: 6, opened: 5, sent: 4, scheduled: 3, approved: 2, draft: 1, rejected: 0 };
      if (!current || (priority[email.status] || 0) > (priority[current] || 0)) {
        prospectEmailStatus[email.prospect_id] = email.status;
      }
    }
  }

  const tabs = [
    { id: 'prospects', label: 'Prospectos', icon: <Users className="h-4 w-4" /> },
    { id: 'generate', label: 'Generar Emails', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'bandeja', label: 'Bandeja', icon: <Inbox className="h-4 w-4" /> },
    { id: 'metrics', label: 'Metricas', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  const toggleProspectExpand = (pid: string) => {
    setExpandedProspects(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/campaigns')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        aria-label="Volver a la lista de campanas"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a Campanas
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-100 text-primary-700">
            <Building className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
              <Badge className={getStatusColor(campaign.status || 'draft')} size="md">
                {campaign.status || 'borrador'}
              </Badge>
            </div>
            {campaign.asset_type && (
              <p className="text-sm text-slate-500 mt-1 capitalize">
                {campaign.asset_type}
                {campaign.asset_location ? ` - ${campaign.asset_location}` : ''}
              </p>
            )}
            {campaign.description && (
              <p className="text-sm text-slate-500 mt-1">{campaign.description}</p>
            )}
          </div>
        </div>
        <div className="w-40">
          <Select
            options={campaignStatusOptions}
            value={campaign.status || 'draft'}
            onChange={(val) => {
              if (val !== campaign.status) {
                updateStatusMutation.mutate(val);
              }
            }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Prospectos</p>
              <p className="text-xl font-bold text-slate-900">{formatNumber(campaign.prospect_count || prospects.length)}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-50 text-primary-600">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Emails Enviados</p>
              <p className="text-xl font-bold text-slate-900">{formatNumber(emailsSent)}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Respuestas</p>
              <p className="text-xl font-bold text-slate-900">{formatNumber(repliedCount)}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-50 text-amber-600">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Tasa de Respuesta</p>
              <p className="text-xl font-bold text-slate-900">{replyRate}%</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {(tab) => {
          // ========================
          // TAB: PROSPECTOS
          // ========================
          if (tab === 'prospects') {
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">
                    Prospectos de la Propiedad ({prospects.length})
                  </h3>
                  <div className="flex gap-2">
                    {selectedProspectIds.length > 0 && (
                      <Button
                        size="sm"
                        icon={<Sparkles className="h-4 w-4" />}
                        onClick={() => {
                          setGeneratingFor(selectedProspectIds);
                          generateEmailsMutation.mutate(selectedProspectIds);
                        }}
                        loading={generateEmailsMutation.isPending}
                      >
                        Generar Emails ({selectedProspectIds.length})
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => setShowAddProspectsModal(true)}
                    >
                      Agregar Prospectos
                    </Button>
                  </div>
                </div>

                {prospects.length === 0 ? (
                  <Card className="flex flex-col items-center justify-center py-12">
                    <Users className="h-8 w-8 text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">Sin prospectos asignados</p>
                    <Button size="sm" className="mt-3" onClick={() => setShowAddProspectsModal(true)}>
                      Agregar Prospectos
                    </Button>
                  </Card>
                ) : (
                  <Table>
                    <TableHead>
                      <TableRow hoverable={false}>
                        <TableCell isHeader className="w-10">
                          <input
                            type="checkbox"
                            checked={selectedProspectIds.length === prospects.length && prospects.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedProspectIds(prospects.map((p: any) => p.id || p._id || p.prospectId));
                              } else {
                                setSelectedProspectIds([]);
                              }
                            }}
                            className="rounded border-slate-300 text-primary-600"
                            aria-label="Seleccionar todos los prospectos"
                          />
                        </TableCell>
                        <TableCell isHeader>Nombre</TableCell>
                        <TableCell isHeader>Email</TableCell>
                        <TableCell isHeader>Empresa</TableCell>
                        <TableCell isHeader className="text-center">Puntuacion</TableCell>
                        <TableCell isHeader>Emails</TableCell>
                        <TableCell isHeader>Estado</TableCell>
                        <TableCell isHeader className="w-16">{null}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {prospects.map((prospect: Record<string, unknown>) => {
                        const pId = (prospect.id || prospect._id || prospect.prospectId) as string;
                        const pName = (prospect.full_name as string) || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || '-';
                        const emailSt = prospectEmailStatus[pId] || 'none';
                        const isSelected = selectedProspectIds.includes(pId);

                        return (
                          <TableRow key={pId}>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedProspectIds(prev =>
                                    isSelected ? prev.filter(i => i !== pId) : [...prev, pId]
                                  );
                                }}
                                className="rounded border-slate-300 text-primary-600"
                                aria-label={`Seleccionar ${pName}`}
                              />
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => navigate(`/prospects/${pId}`)}
                                className="text-sm font-medium text-primary-600 hover:underline"
                              >
                                {pName}
                              </button>
                            </TableCell>
                            <TableCell className="text-slate-500">{prospect.email as string || '-'}</TableCell>
                            <TableCell className="text-slate-600">{prospect.company_name as string || '-'}</TableCell>
                            <TableCell className="text-center">
                              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold ${getScoreColor(prospect.lead_score as number || 0)}`}>
                                {prospect.lead_score as number || 0}
                              </span>
                            </TableCell>
                            <TableCell>
                              <EmailStatusBadge status={emailSt} />
                            </TableCell>
                            <TableCell>
                              <Badge className={getStatusColor(prospect.status as string || 'new')}>
                                {prospect.status as string || 'nuevo'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => {
                                  confirm({
                                    title: 'Remover prospecto?',
                                    description: 'El prospecto sera removido de esta campana.',
                                    confirmLabel: 'Remover',
                                    onConfirm: () => removeProspectMutation.mutate(pId),
                                  });
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                aria-label={`Remover ${pName}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          }

          // ========================
          // TAB: GENERAR EMAILS
          // ========================
          if (tab === 'generate') {
            return (
              <div className="space-y-6">
                {/* Config */}
                <Card padding="md">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Configuracion de Generacion</h3>
                      <p className="text-xs text-slate-500 mt-1">Numero de emails por prospecto en la secuencia</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-slate-600">Pasos:</label>
                      <select
                        value={numSteps}
                        onChange={(e) => setNumSteps(parseInt(e.target.value))}
                        className="form-select w-20"
                      >
                        {[2, 3, 4, 5, 6].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </Card>

                {/* Generate for all */}
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">
                    Prospectos ({prospects.length})
                  </h3>
                  <Button
                    icon={<Sparkles className="h-4 w-4" />}
                    onClick={() => {
                      const pIds = prospects.map((p: any) => p.id || p._id || p.prospectId);
                      setGeneratingFor(pIds);
                      generateEmailsMutation.mutate(pIds);
                    }}
                    loading={generateEmailsMutation.isPending}
                    disabled={prospects.length === 0}
                  >
                    Generar para Todos
                  </Button>
                </div>

                {/* Prospect list with collapsible previews */}
                <div className="space-y-3">
                  {prospects.map((prospect: any) => {
                    const pId = prospect.id || prospect._id || prospect.prospectId;
                    const pName = prospect.full_name || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || '-';
                    const isExpanded = expandedProspects.has(pId);
                    const prospectEmails = (generatedEmails?.emails || []).filter((e: any) => e.prospect_id === pId);
                    const isGenerating = generatingFor.includes(pId) && generateEmailsMutation.isPending;

                    return (
                      <Card key={pId} padding="none">
                        <div className="flex items-center justify-between px-4 py-3">
                          <button
                            onClick={() => toggleProspectExpand(pId)}
                            className="flex items-center gap-3 flex-1 text-left"
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                            <div>
                              <p className="text-sm font-medium text-slate-900">{pName}</p>
                              <p className="text-xs text-slate-500">{prospect.email} {prospect.title ? `- ${prospect.title}` : ''}</p>
                            </div>
                          </button>
                          <div className="flex items-center gap-2">
                            {prospectEmails.length > 0 && (
                              <span className="text-xs text-slate-500">{prospectEmails.length} emails</span>
                            )}
                            <Button
                              size="sm"
                              variant={prospectEmails.length > 0 ? 'secondary' : 'primary'}
                              icon={isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                              onClick={() => {
                                setGeneratingFor([pId]);
                                generateEmailsMutation.mutate([pId]);
                              }}
                              disabled={generateEmailsMutation.isPending}
                            >
                              {prospectEmails.length > 0 ? 'Regenerar' : 'Generar'}
                            </Button>
                          </div>
                        </div>

                        {/* Expanded preview */}
                        {isExpanded && prospectEmails.length > 0 && (
                          <div className="border-t border-slate-100 bg-slate-50/50">
                            {prospectEmails.map((email: any) => (
                              <div key={email.id} className="px-6 py-3 border-b border-slate-100 last:border-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-primary-600">Paso {email.step_number}</span>
                                  <span className="text-xs text-slate-400">- Dia {email.delay_days}</span>
                                  <EmailStatusBadge status={email.status} />
                                </div>
                                <p className="text-sm font-medium text-slate-800">{email.subject}</p>
                                <div
                                  className="text-xs text-slate-600 mt-1 line-clamp-3"
                                  dangerouslySetInnerHTML={{ __html: email.body_html }}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {isExpanded && prospectEmails.length === 0 && (
                          <div className="border-t border-slate-100 px-6 py-6 text-center text-sm text-slate-400">
                            Sin emails generados. Haz clic en "Generar" para crear la secuencia.
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          }

          // ========================
          // TAB: BANDEJA (Validacion)
          // ========================
          if (tab === 'bandeja') {
            const emailsByProspect: any[] = generatedEmails?.byProspect || [];
            const stats = generatedEmails?.stats || {};
            const allEmailsList: any[] = generatedEmails?.emails || [];

            const filteredByProspect = emailsByProspect.map((group: any) => ({
              ...group,
              emails: bandejaFilter === 'all'
                ? group.emails
                : group.emails.filter((e: any) => e.status === bandejaFilter),
            })).filter((group: any) => group.emails.length > 0);

            const allDraftIds = allEmailsList.filter((e: any) => e.status === 'draft').map((e: any) => e.id);

            const allScheduledIds = allEmailsList.filter((e: any) => e.status === 'scheduled').map((e: any) => e.id);
            const hasScheduledEmails = allScheduledIds.length > 0;
            const campaignIsDraft = campaign.status === 'draft';

            return (
              <div className="space-y-4">
                {/* Campaign activation alert */}
                {hasScheduledEmails && campaignIsDraft && (
                  <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-800">
                        Campana en borrador — los emails programados no se enviaran automaticamente
                      </p>
                      <p className="text-xs text-amber-600 mt-0.5">
                        Activa la campana para que el scheduler envie los emails en el horario optimo.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => updateStatusMutation.mutate('active')}
                      loading={updateStatusMutation.isPending}
                    >
                      Activar Campana
                    </Button>
                  </div>
                )}

                {/* Stats bar */}
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500">Total:</span>
                    <span className="font-semibold">{allEmailsList.length}</span>
                  </div>
                  {Object.entries(stats).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-1.5 text-sm">
                      <EmailStatusBadge status={status} />
                      <span className="font-medium">{count as number}</span>
                    </div>
                  ))}
                </div>

                {/* Filter + bulk actions */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {['all', 'draft', 'scheduled', 'rejected', 'sent'].map((f) => (
                      <button
                        key={f}
                        onClick={() => setBandejaFilter(f)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          bandejaFilter === f
                            ? 'bg-primary-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {f === 'all' ? 'Todos' : f === 'draft' ? 'Pendientes' : f === 'scheduled' ? 'Programados' : f === 'rejected' ? 'Rechazados' : 'Enviados'}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {hasScheduledEmails && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Send className="h-4 w-4" />}
                        onClick={() => {
                          confirm({
                            title: 'Enviar emails ahora?',
                            description: `Se enviaran ${allScheduledIds.length} email(s) programados inmediatamente.`,
                            confirmLabel: 'Enviar Ahora',
                            onConfirm: () => sendEmailsMutation.mutate(allScheduledIds),
                          });
                        }}
                        loading={sendEmailsMutation.isPending}
                      >
                        Enviar Ahora ({allScheduledIds.length})
                      </Button>
                    )}
                    {allDraftIds.length > 0 && (
                      <Button
                        size="sm"
                        icon={<Check className="h-4 w-4" />}
                        onClick={() => approveEmailsMutation.mutate(allDraftIds)}
                        loading={approveEmailsMutation.isPending}
                      >
                        Programar Todos ({allDraftIds.length})
                      </Button>
                    )}
                  </div>
                </div>

                {/* Emails grouped by prospect */}
                {filteredByProspect.length === 0 ? (
                  <Card className="flex flex-col items-center justify-center py-12">
                    <Inbox className="h-8 w-8 text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">
                      {allEmailsList.length === 0
                        ? 'Sin emails generados. Ve a "Generar Emails" para crear la secuencia.'
                        : 'Sin emails con este filtro.'}
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {filteredByProspect.map((group: any) => (
                      <Card key={group.prospect_id} padding="none">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{group.prospect_name}</p>
                              <p className="text-xs text-slate-500">{group.prospect_email} {group.prospect_title ? `- ${group.prospect_title}` : ''}</p>
                            </div>
                            <span className="text-xs text-slate-400">{group.emails.length} email(s)</span>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100">
                          {group.emails.map((email: any) => (
                            <div key={email.id} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium text-primary-600">Paso {email.step_number}</span>
                                    <EmailStatusBadge status={email.status} />
                                  </div>
                                  <p className="text-sm font-medium text-slate-800 truncate">{email.subject}</p>
                                  <div
                                    className="text-xs text-slate-500 mt-1 line-clamp-2"
                                    dangerouslySetInnerHTML={{ __html: email.body_html }}
                                  />
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {(email.status === 'draft' || email.status === 'rejected') && (
                                    <button
                                      onClick={() => approveEmailsMutation.mutate([email.id])}
                                      className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                                      title="Programar envio" aria-label="Programar envio"
                                    >
                                      <Check className="h-4 w-4" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setEditingEmail(email);
                                      setEditSubject(email.subject || '');
                                      setEditBody(email.body_html || '');
                                      setEditMode('edit');
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                    title="Editar" aria-label="Editar email"
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </button>
                                  {(email.status === 'draft' || email.status === 'scheduled') && (
                                    <button
                                      onClick={() => rejectEmailsMutation.mutate([email.id])}
                                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                                      title="Rechazar"
                                      aria-label="Rechazar email"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          // ========================
          // TAB: METRICAS
          // ========================
          if (tab === 'metrics') {
            const geStats = generatedEmails?.stats || {};
            const metrics = metricsData?.data?.data;
            const rates = metrics?.rates || {};
            const totals = metrics?.totals || {};
            const stepBreakdown: any[] = metrics?.step_breakdown || [];

            const funnelData = [
              { name: 'Enviados', value: totals.sent || 0, color: '#ff7f00' },
              { name: 'Abiertos', value: totals.opened || 0, color: '#f59e0b' },
              { name: 'Clickeados', value: totals.clicked || 0, color: '#3b82f6' },
              { name: 'Respondidos', value: totals.replied || 0, color: '#10b981' },
            ];

            return (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-slate-900">Metricas de la Campana</h3>

                {/* Pipeline stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card className="stat-card text-center">
                    <p className="text-xs text-slate-500">Generados</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{(geStats.draft || 0) + (geStats.scheduled || 0) + (geStats.sent || 0) + (geStats.approved || 0)}</p>
                  </Card>
                  <Card className="stat-card text-center">
                    <p className="text-xs text-slate-500">Programados</p>
                    <p className="text-2xl font-bold text-indigo-600 mt-1">{geStats.scheduled || 0}</p>
                  </Card>
                  <Card className="stat-card text-center">
                    <p className="text-xs text-slate-500">Enviados</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{formatNumber(emailsSent)}</p>
                  </Card>
                  <Card className="stat-card text-center">
                    <p className="text-xs text-slate-500">Respuestas</p>
                    <p className="text-2xl font-bold text-purple-600 mt-1">{formatNumber(repliedCount)}</p>
                  </Card>
                </div>

                {/* Engagement rates */}
                {metricsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    <span className="ml-2 text-sm text-slate-400">Cargando metricas...</span>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Card className="stat-card">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-50 text-amber-600">
                            <Mail className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Open Rate</p>
                            <p className="text-xl font-bold text-slate-900">{rates.open_rate || 0}%</p>
                          </div>
                        </div>
                      </Card>
                      <Card className="stat-card">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
                            <TrendingUp className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Click Rate</p>
                            <p className="text-xl font-bold text-slate-900">{rates.click_rate || 0}%</p>
                          </div>
                        </div>
                      </Card>
                      <Card className="stat-card">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600">
                            <MessageSquare className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Reply Rate</p>
                            <p className="text-xl font-bold text-slate-900">{rates.reply_rate || 0}%</p>
                          </div>
                        </div>
                      </Card>
                    </div>

                    {/* Engagement funnel chart */}
                    {(totals.sent || 0) > 0 && (
                      <Card>
                        <h4 className="text-sm font-semibold text-slate-700 mb-4">Embudo de Engagement</h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={funnelData} layout="vertical" margin={{ left: 10, right: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} />
                            <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#64748b' }} width={100} />
                            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                              {funnelData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </Card>
                    )}

                    {/* Per-step breakdown */}
                    {stepBreakdown.length > 0 && (
                      <Card padding="none">
                        <div className="px-5 py-4 border-b border-slate-100">
                          <h4 className="text-sm font-semibold text-slate-700">Desglose por Paso</h4>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50">
                                <th scope="col" className="text-center px-4 py-3 font-medium text-slate-500">Paso</th>
                                <th scope="col" className="text-left px-4 py-3 font-medium text-slate-500">Asunto</th>
                                <th scope="col" className="text-center px-4 py-3 font-medium text-slate-500">Total</th>
                                <th scope="col" className="text-center px-4 py-3 font-medium text-slate-500">Enviados</th>
                                <th scope="col" className="text-center px-4 py-3 font-medium text-slate-500">Rebotados</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {stepBreakdown.map((row: any) => (
                                <tr key={row.step_number} className="hover:bg-slate-50">
                                  <td className="text-center px-4 py-3 text-slate-600 font-medium">#{row.step_number}</td>
                                  <td className="px-4 py-3 text-slate-800 truncate max-w-[200px]">{row.step_subject || '-'}</td>
                                  <td className="text-center px-4 py-3 text-slate-600">{row.total}</td>
                                  <td className="text-center px-4 py-3">
                                    <span className="text-emerald-600 font-medium">{row.sent}</span>
                                  </td>
                                  <td className="text-center px-4 py-3">
                                    <span className={row.bounced > 0 ? 'text-red-600 font-medium' : 'text-slate-600'}>{row.bounced}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}
                  </>
                )}
              </div>
            );
          }

          return null;
        }}
      </Tabs>

      {/* Add prospects modal */}
      <Modal
        isOpen={showAddProspectsModal}
        onClose={() => {
          setShowAddProspectsModal(false);
          setSelectedProspectIds([]);
          setProspectSearch('');
        }}
        title="Agregar Prospectos a la Propiedad"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            placeholder="Buscar prospectos..."
            value={prospectSearch}
            onChange={(e) => setProspectSearch(e.target.value)}
            icon={<Search className="h-4 w-4" />}
          />

          <div className="max-h-[300px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {allProspects.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <p className="text-sm">Sin resultados</p>
              </div>
            ) : (
              allProspects.map((prospect: Record<string, unknown>) => {
                const pId = (prospect.id || prospect._id) as string;
                const pName = (prospect.full_name as string) || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || '-';
                const isSelected = selectedProspectIds.includes(pId);

                return (
                  <div
                    key={pId}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      isSelected ? 'bg-primary-50' : 'hover:bg-slate-50'
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedProspectIds((prev) =>
                        isSelected ? prev.filter((i) => i !== pId) : [...prev, pId]
                      );
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedProspectIds((prev) =>
                          isSelected ? prev.filter((i) => i !== pId) : [...prev, pId]
                        );
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="rounded border-slate-300 text-primary-600"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{pName}</p>
                      <p className="text-xs text-slate-500">{prospect.email as string}</p>
                    </div>
                    {!!prospect.company_name && (
                      <span className="text-xs text-slate-400">{prospect.company_name as string}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <span className="text-sm text-slate-500">
              {selectedProspectIds.length} prospecto(s) seleccionado(s)
            </span>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAddProspectsModal(false);
                  setSelectedProspectIds([]);
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => addProspectsMutation.mutate(selectedProspectIds)}
                loading={addProspectsMutation.isPending}
                disabled={selectedProspectIds.length === 0}
              >
                Agregar ({selectedProspectIds.length})
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit email modal */}
      <Modal
        isOpen={!!editingEmail}
        onClose={() => setEditingEmail(null)}
        title={`Editar Email - Paso ${editingEmail?.step_number || ''}`}
        size="lg"
      >
        {editingEmail && (
          <div className="space-y-4">
            <div>
              <label className="form-label">Asunto</label>
              <Input
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
              />
            </div>
            <Tabs
              tabs={[
                { id: 'edit', label: 'Editar', icon: <Code className="h-4 w-4" /> },
                { id: 'preview', label: 'Vista previa', icon: <Eye className="h-4 w-4" /> },
              ]}
              activeTab={editMode}
              onTabChange={(tab) => setEditMode(tab as 'edit' | 'preview')}
            >
              {(tab) => {
                if (tab === 'edit') {
                  return (
                    <div>
                      <label className="form-label">Cuerpo (HTML)</label>
                      <textarea
                        className="form-input min-h-[200px] font-mono text-xs"
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                      />
                    </div>
                  );
                }
                if (tab === 'preview') {
                  return (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1">Asunto</p>
                        <p className="text-base font-semibold text-slate-900">{editSubject || '(sin asunto)'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-2">Cuerpo</p>
                        <div className="border border-slate-200 rounded-lg p-4 bg-white min-h-[200px]">
                          {editBody ? (
                            <div
                              className="prose prose-sm max-w-none text-slate-700"
                              dangerouslySetInnerHTML={{ __html: editBody }}
                            />
                          ) : (
                            <p className="text-sm text-slate-400 italic">Sin contenido</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            </Tabs>
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <Button variant="secondary" onClick={() => setEditingEmail(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => editEmailMutation.mutate({
                  emailId: editingEmail.id,
                  data: { subject: editSubject, body_html: editBody },
                })}
                loading={editEmailMutation.isPending}
              >
                Guardar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
