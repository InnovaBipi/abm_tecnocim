import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Select } from '@/components/ui/Select';
import {
  Users,
  Mail,
  MessageSquare,
  TrendingUp,
  Loader2,
  AlertCircle,
  Building,
  Sparkles,
  Inbox,
  BarChart3,
} from 'lucide-react';
import { getStatusColor, formatNumber } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import toast from 'react-hot-toast';
import { CampaignProspects, CampaignGenerate, CampaignBandeja, CampaignMetrics } from './campaign-detail';
import type { CampaignData, GeneratedEmailsData } from './campaign-detail';

const campaignStatusOptions = [
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activo' },
  { value: 'paused', label: 'Pausado' },
  { value: 'completed', label: 'Completado' },
];

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('prospects');

  // --- Queries ---
  const { data, isLoading, error } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!),
    enabled: !!id,
  });

  const { data: generatedEmailsData, refetch: refetchEmails } = useQuery({
    queryKey: ['campaigns', id, 'generated-emails'],
    queryFn: () => campaignsApi.getGeneratedEmails(id!),
    enabled: !!id && (activeTab === 'generate' || activeTab === 'bandeja' || activeTab === 'prospects' || activeTab === 'metrics'),
  });

  // --- Mutations ---
  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => campaignsApi.update(id!, { status }),
    onSuccess: () => {
      toast.success('Estado de la campaña actualizado');
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
    },
    onError: () => toast.error('Error al cambiar el estado'),
  });

  const campaign: CampaignData | undefined = data?.data?.data;
  const generatedEmails: GeneratedEmailsData | undefined = generatedEmailsData?.data?.data;

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
  const prospects = campaign.prospects || [];

  const tabs = [
    { id: 'prospects', label: 'Prospectos', icon: <Users className="h-4 w-4" /> },
    { id: 'generate', label: 'Generar Emails', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'bandeja', label: 'Bandeja', icon: <Inbox className="h-4 w-4" /> },
    { id: 'metrics', label: 'Métricas', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: 'Campañas', href: '/campaigns' },
        { label: campaign.name },
      ]} />

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
          if (tab === 'prospects') {
            return (
              <CampaignProspects
                campaignId={id!}
                campaign={campaign}
                generatedEmails={generatedEmails}
              />
            );
          }
          if (tab === 'generate') {
            return (
              <CampaignGenerate
                campaignId={id!}
                campaign={campaign}
                generatedEmails={generatedEmails}
                refetchEmails={refetchEmails}
              />
            );
          }
          if (tab === 'bandeja') {
            return (
              <CampaignBandeja
                campaignId={id!}
                campaign={campaign}
                generatedEmails={generatedEmails}
                refetchEmails={refetchEmails}
              />
            );
          }
          if (tab === 'metrics') {
            return (
              <CampaignMetrics
                campaignId={id!}
                campaign={campaign}
                generatedEmails={generatedEmails}
              />
            );
          }
          return null;
        }}
      </Tabs>
    </div>
  );
}
