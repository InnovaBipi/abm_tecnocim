import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi, prospectsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
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
  Megaphone,
  Search,
} from 'lucide-react';
import { getStatusColor, getScoreColor, formatNumber, formatRelativeDate } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('prospects');
  const [showAddProspectsModal, setShowAddProspectsModal] = useState(false);
  const [prospectSearch, setProspectSearch] = useState('');
  const [selectedProspectIds, setSelectedProspectIds] = useState<string[]>([]);

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

  const addProspectsMutation = useMutation({
    mutationFn: (prospectIds: string[]) => campaignsApi.addProspects(id!, prospectIds),
    onSuccess: () => {
      toast.success('Prospectos agregados a la campana');
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
      setShowAddProspectsModal(false);
      setSelectedProspectIds([]);
    },
    onError: () => {
      toast.error('Error al agregar prospectos');
    },
  });

  const removeProspectMutation = useMutation({
    mutationFn: (prospectId: string) => campaignsApi.removeProspect(id!, prospectId),
    onSuccess: () => {
      toast.success('Prospecto removido de la campana');
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
    },
    onError: () => {
      toast.error('Error al remover el prospecto');
    },
  });

  const campaign = data?.data?.data;
  const allProspects = allProspectsData?.data?.data?.prospects || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        <span className="ml-2 text-slate-500">Cargando campana...</span>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-red-500">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p className="text-sm">Error al cargar la campana</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/campaigns')}>
          Volver a Campanas
        </Button>
      </div>
    );
  }

  const emailsSent = campaign.emailStats?.sent || 0;
  const repliedCount = campaign.emailStats?.replied || 0;
  const replyRate = emailsSent > 0 ? ((repliedCount / emailsSent) * 100).toFixed(1) : '0';
  const prospects = campaign.prospects || [];
  const sequences = campaign.sequences || [];

  const tabs = [
    { id: 'prospects', label: 'Prospectos', icon: <Users className="h-4 w-4" /> },
    { id: 'sequences', label: 'Secuencias', icon: <Mail className="h-4 w-4" /> },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/campaigns')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a Campanas
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-100 text-primary-700">
            <Megaphone className="h-7 w-7" />
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
          if (tab === 'prospects') {
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">
                    Prospectos de la Campana ({prospects.length})
                  </h3>
                  <Button
                    size="sm"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => setShowAddProspectsModal(true)}
                  >
                    Agregar Prospectos
                  </Button>
                </div>

                {prospects.length === 0 ? (
                  <Card className="flex flex-col items-center justify-center py-12">
                    <Users className="h-8 w-8 text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">Sin prospectos asignados</p>
                    <Button
                      size="sm"
                      className="mt-3"
                      onClick={() => setShowAddProspectsModal(true)}
                    >
                      Agregar Prospectos
                    </Button>
                  </Card>
                ) : (
                  <Table>
                    <TableHead>
                      <TableRow hoverable={false}>
                        <TableCell isHeader>Nombre</TableCell>
                        <TableCell isHeader>Email</TableCell>
                        <TableCell isHeader>Empresa</TableCell>
                        <TableCell isHeader className="text-center">Puntuacion</TableCell>
                        <TableCell isHeader>Estado</TableCell>
                        <TableCell isHeader className="w-16"></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {prospects.map((prospect: Record<string, unknown>) => {
                        const pId = (prospect.id || prospect._id || prospect.prospectId) as string;
                        const pName = (prospect.full_name as string) || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || '-';
                        return (
                          <TableRow key={pId}>
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
                              <Badge className={getStatusColor(prospect.status as string || 'new')}>
                                {prospect.status as string || 'nuevo'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => {
                                  if (confirm('Remover este prospecto de la campana?')) {
                                    removeProspectMutation.mutate(pId);
                                  }
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
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

          if (tab === 'sequences') {
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">
                    Secuencias ({sequences.length})
                  </h3>
                  <Button
                    size="sm"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => navigate('/sequences')}
                  >
                    Crear Secuencia
                  </Button>
                </div>

                {sequences.length === 0 ? (
                  <Card className="flex flex-col items-center justify-center py-12">
                    <Mail className="h-8 w-8 text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500">Sin secuencias asociadas</p>
                    <Button
                      size="sm"
                      className="mt-3"
                      onClick={() => navigate('/sequences')}
                    >
                      Crear Secuencia
                    </Button>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {sequences.map((seq: Record<string, unknown>, index: number) => (
                      <Card key={seq.id as string || index} padding="md">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">{seq.name as string}</h4>
                            <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                              <span>{seq.enrollment_count as number || 0} inscritos</span>
                              <span>{seq.step_count as number || 0} pasos</span>
                            </div>
                          </div>
                          <Badge className={getStatusColor(seq.status as string || 'draft')}>
                            {seq.status as string || 'borrador'}
                          </Badge>
                        </div>
                      </Card>
                    ))}
                  </div>
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
        title="Agregar Prospectos a la Campana"
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
                    onClick={() => {
                      setSelectedProspectIds((prev) =>
                        isSelected ? prev.filter((i) => i !== pId) : [...prev, pId]
                      );
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
                    {prospect.company_name && (
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
    </div>
  );
}
