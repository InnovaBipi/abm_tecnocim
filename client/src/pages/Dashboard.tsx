import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { dashboardApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker';
import { SkeletonCard, SkeletonChart, SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatNumber, formatRelativeDate, getScoreColor } from '@/lib/utils';
import {
  Users,
  Building2,
  Megaphone,
  Mail,
  TrendingUp,
  Activity,
  AlertCircle,
  Shield,
  Flame,
  ArrowDown,
  MousePointerClick,
  Upload,
  UserPlus,
  Loader2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  href?: string;
}

function StatCard({ title, value, icon, change, changeType = 'neutral', href }: StatCardProps) {
  const navigate = useNavigate();
  const content = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
        {change && (
          <p
            className={`text-xs font-medium mt-2 ${
              changeType === 'positive'
                ? 'text-emerald-600'
                : changeType === 'negative'
                ? 'text-red-600'
                : 'text-slate-500'
            }`}
          >
            {change}
          </p>
        )}
      </div>
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-50 text-primary-600">
        {icon}
      </div>
    </div>
  );

  return (
    <Card
      className={`stat-card ${href ? 'cursor-pointer hover:border-primary-200 hover:shadow-md transition-all' : ''}`}
      {...(href ? { onClick: () => navigate(href) } : {})}
    >
      {content}
    </Card>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos dias';
  if (hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<DateRange>('30d');

  // Convert DateRange to API params
  const dateParams = useMemo(() => {
    const now = new Date();
    const to = now.toISOString().split('T')[0];
    const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };
    const days = daysMap[dateRange] || 30;
    const from = new Date(now.getTime() - days * 86400000);
    return { date_from: from.toISOString().split('T')[0], date_to: to };
  }, [dateRange]);

  const rangeLabel = useMemo(() => {
    const labels: Record<string, string> = {
      '7d': 'Ultimos 7 dias', '30d': 'Ultimos 30 dias',
      '90d': 'Ultimos 90 dias', '12m': 'Ultimos 12 meses',
    };
    return labels[dateRange] || 'Ultimos 30 dias';
  }, [dateRange]);

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'stats', dateRange],
    queryFn: () => dashboardApi.getStats(dateParams),
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: () => dashboardApi.getRecentActivity({ limit: 10 }),
  });

  const { data: topProspectsData, isLoading: topProspectsLoading } = useQuery({
    queryKey: ['dashboard', 'top-prospects'],
    queryFn: () => dashboardApi.getTopProspects({ limit: 5 }),
  });

  const { data: campaignPerfData, isLoading: campaignPerfLoading } = useQuery({
    queryKey: ['dashboard', 'campaign-performance', dateRange],
    queryFn: () => dashboardApi.getCampaignPerformance(dateParams),
  });

  const { data: deliverabilityData, isLoading: deliverabilityLoading } = useQuery({
    queryKey: ['dashboard', 'deliverability', dateRange],
    queryFn: () => dashboardApi.getDeliverability(dateParams),
  });

  const { data: engagementData, isLoading: engagementLoading } = useQuery({
    queryKey: ['dashboard', 'engagement-trends', dateRange],
    queryFn: () => dashboardApi.getEngagementTrends(dateParams),
  });

  const { data: hotProspectsData, isLoading: hotProspectsLoading } = useQuery({
    queryKey: ['dashboard', 'hot-prospects'],
    queryFn: () => dashboardApi.getHotProspects(),
  });

  const { data: funnelData, isLoading: funnelLoading } = useQuery({
    queryKey: ['dashboard', 'funnel'],
    queryFn: () => dashboardApi.getFunnel(),
  });

  const { data: stepPerfData, isLoading: stepPerfLoading } = useQuery({
    queryKey: ['dashboard', 'sequence-step-performance'],
    queryFn: () => dashboardApi.getSequenceStepPerformance(),
  });

  const stats = statsData?.data?.data;
  const recentActivity = activityData?.data?.data || [];
  const topProspects = topProspectsData?.data?.data || [];
  const campaignPerf = campaignPerfData?.data?.data || [];
  const deliverability = deliverabilityData?.data?.data;
  const engagementTrends = engagementData?.data?.data || [];
  const hotProspects = hotProspectsData?.data?.data || [];
  const funnel = funnelData?.data?.data;
  const stepPerf = stepPerfData?.data?.data || [];

  // Format engagement trends for chart (memoized to avoid re-mapping on every render)
  const chartData = useMemo(() => engagementTrends.map((d: any) => ({
    date: new Date(d.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
    enviados: d.sent || 0,
    abiertos: d.opened || 0,
    respondidos: d.replied || 0,
  })), [engagementTrends]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Page header with greeting + date range */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {getGreeting()}, {user?.first_name || 'Usuario'}
          </h1>
          <p className="text-slate-500 mt-1">
            {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<UserPlus className="h-4 w-4" />}
          onClick={() => navigate('/prospects')}
        >
          Nuevo Prospecto
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Megaphone className="h-4 w-4" />}
          onClick={() => navigate('/campaigns')}
        >
          Nueva Campana
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload className="h-4 w-4" />}
          onClick={() => navigate('/imports')}
        >
          Importar CSV
        </Button>
      </div>

      {/* Stat cards */}
      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Prospectos"
            value={formatNumber(stats?.total_prospects || 0)}
            icon={<Users className="h-5 w-5" />}
            change={stats?.new_prospects_this_month ? `+${stats.new_prospects_this_month} este mes` : undefined}
            changeType={stats?.new_prospects_this_month > 0 ? 'positive' : 'neutral'}
            href="/prospects"
          />
          <StatCard
            title="Empresas"
            value={formatNumber(stats?.total_companies || 0)}
            icon={<Building2 className="h-5 w-5" />}
            href="/companies"
          />
          <StatCard
            title="Campanas Activas"
            value={formatNumber(stats?.active_campaigns || 0)}
            icon={<Megaphone className="h-5 w-5" />}
            href="/campaigns"
          />
          <StatCard
            title="Emails Enviados"
            value={formatNumber(stats?.emails_sent || 0)}
            icon={<Mail className="h-5 w-5" />}
            change={stats?.reply_rate ? `${stats.reply_rate}% reply rate` : undefined}
            changeType={stats?.reply_rate > 0 ? 'positive' : 'neutral'}
            href="/outbox"
          />
        </div>
      )}

      {/* Deliverability health cards */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-5 w-5 text-primary-600" />
          <h2 className="text-lg font-semibold text-slate-900">Salud de Entregabilidad</h2>
        </div>
        {deliverabilityLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Tasa de Entrega"
              value={`${deliverability?.delivery_rate || 0}%`}
              icon={<Mail className="h-5 w-5" />}
              change={`${deliverability?.delivered || 0} de ${deliverability?.sent || 0}`}
              changeType={
                (deliverability?.delivery_rate || 0) >= 95
                  ? 'positive'
                  : (deliverability?.delivery_rate || 0) >= 80
                  ? 'neutral'
                  : 'negative'
              }
            />
            <StatCard
              title="Tasa de Rebote"
              value={`${deliverability?.bounce_rate || 0}%`}
              icon={<ArrowDown className="h-5 w-5" />}
              change={`${deliverability?.bounced || 0} rebotados`}
              changeType={(deliverability?.bounce_rate || 0) <= 2 ? 'positive' : 'negative'}
            />
            <StatCard
              title="Quejas Spam"
              value={`${deliverability?.complaint_rate || 0}%`}
              icon={<AlertCircle className="h-5 w-5" />}
              change={`${deliverability?.complaints || 0} quejas`}
              changeType={(deliverability?.complaint_rate || 0) <= 0.1 ? 'positive' : 'negative'}
            />
            <StatCard
              title="Warm-up"
              value={
                deliverability?.warmup?.phase === 'completed'
                  ? 'Completado'
                  : deliverability?.warmup?.phase === 'in_progress'
                  ? `Dia ${deliverability?.warmup?.domain_age_days || 0}/30`
                  : 'Sin iniciar'
              }
              icon={<Flame className="h-5 w-5" />}
              change={
                deliverability?.warmup?.phase === 'completed'
                  ? 'Sin limite diario'
                  : deliverability?.warmup?.phase === 'in_progress'
                  ? 'Limites activos'
                  : undefined
              }
              changeType={deliverability?.warmup?.phase === 'completed' ? 'positive' : 'neutral'}
            />
          </div>
        )}
      </div>

      {/* Charts row: engagement trends + hot prospects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Engagement trends chart - 2 columns */}
        <Card padding="none" className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary-600" />
              <h3 className="font-semibold text-slate-900">Tendencia de Engagement</h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{rangeLabel}</p>
          </div>
          <div className="p-6">
            {engagementLoading ? (
              <div className="flex items-center justify-center h-[280px]">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[280px] text-slate-400">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">Sin datos de engagement</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gradientEnviados" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ff7f00" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#ff7f00" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradientRespondidos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="enviados"
                    stroke="#ff7f00"
                    fill="url(#gradientEnviados)"
                    strokeWidth={2}
                    name="Enviados"
                  />
                  <Area
                    type="monotone"
                    dataKey="abiertos"
                    stroke="#f59e0b"
                    fill="none"
                    strokeWidth={2}
                    name="Abiertos"
                  />
                  <Area
                    type="monotone"
                    dataKey="respondidos"
                    stroke="#10b981"
                    fill="url(#gradientRespondidos)"
                    strokeWidth={2}
                    name="Respondidos"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Hot prospects panel - 1 column */}
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <h3 className="font-semibold text-slate-900">Prospectos Calientes</h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Engagement en ultimas 48h</p>
          </div>
          <div className="divide-y divide-slate-100 max-h-[340px] overflow-y-auto scrollbar-thin">
            {hotProspectsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : hotProspects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">Sin actividad reciente</p>
              </div>
            ) : (
              hotProspects.map((prospect: any, index: number) => (
                <div
                  key={prospect.id || index}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => prospect.id && navigate(`/prospects/${prospect.id}`)}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-50 text-orange-500">
                    <Flame className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {prospect.full_name || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || prospect.email}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {prospect.company_name || '-'} &middot; {prospect.activity_count} acciones
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold ${getScoreColor(
                      prospect.lead_score || 0
                    )}`}
                  >
                    {prospect.lead_score || 0}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Funnel + Top prospects row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel visualization */}
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <ArrowDown className="h-5 w-5 text-primary-600" />
              <h3 className="font-semibold text-slate-900">Embudo de Conversion</h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Progresion de estados</p>
          </div>
          <div className="p-6">
            {funnelLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : !funnel?.funnel?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">Sin datos de embudo</p>
              </div>
            ) : (
              <div className="space-y-3">
                {funnel.funnel.map((stage: any, index: number) => {
                  const maxCount = Math.max(...funnel.funnel.map((s: any) => s.count), 1);
                  const barWidth = Math.max((stage.count / maxCount) * 100, 4);
                  const stageLabels: Record<string, string> = {
                    new: 'Nuevo', enriched: 'Enriquecido', qualified: 'Calificado',
                    contacted: 'Contactado', replied: 'Respondido', interested: 'Interesado',
                    meeting: 'Reunion', converted: 'Convertido',
                  };

                  return (
                    <div key={stage.status} className="flex items-center gap-3">
                      <div className="w-24 text-sm text-slate-600 text-right shrink-0">
                        {stageLabels[stage.status] || stage.status}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-6 relative">
                            <div
                              className="bg-primary-500 h-6 rounded-full transition-all flex items-center justify-end pr-2"
                              style={{ width: `${barWidth}%`, minWidth: '2rem' }}
                            >
                              <span className="text-xs font-medium text-white">{stage.count}</span>
                            </div>
                          </div>
                          <span className="text-xs text-slate-400 w-12 text-right">
                            {stage.percentage}%
                          </span>
                        </div>
                        {index > 0 && stage.conversion_from_prev > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5 ml-1">
                            {stage.conversion_from_prev}% conversion
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Top prospects */}
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary-600" />
              <h3 className="font-semibold text-slate-900">Top Prospectos</h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Mayor puntuacion</p>
          </div>
          <div className="divide-y divide-slate-100">
            {topProspectsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : topProspects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">Sin datos disponibles</p>
              </div>
            ) : (
              topProspects.map((prospect: Record<string, unknown>, index: number) => (
                <div
                  key={prospect.id as string || index}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => prospect.id && navigate(`/prospects/${prospect.id}`)}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-600 text-sm font-semibold">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {prospect.full_name as string || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || prospect.email as string}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {prospect.company_name as string || '-'}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold ${getScoreColor(
                      prospect.lead_score as number || 0
                    )}`}
                  >
                    {prospect.lead_score as number || 0}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Sequence step performance table */}
      <Card padding="none">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-5 w-5 text-primary-600" />
            <h3 className="font-semibold text-slate-900">Rendimiento por Paso de Secuencia</h3>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">Open, click y reply rates por paso</p>
        </div>
        <div className="overflow-x-auto">
          {stepPerfLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : stepPerf.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <AlertCircle className="h-8 w-8 mb-2" />
              <p className="text-sm">Sin datos de secuencias</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-6 py-3 font-medium text-slate-500">Secuencia</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500">Paso</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500">Enviados</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500">Open Rate</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500">Click Rate</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500">Reply Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stepPerf.map((row: any, index: number) => (
                  <tr key={`${row.sequence_id}-${row.step_number}` || index} className="hover:bg-slate-50">
                    <td className="px-6 py-3 text-slate-900 font-medium truncate max-w-[200px]">
                      {row.sequence_name}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-600">
                      #{row.step_number}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-600">
                      {row.sent}
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={row.open_rate >= 30 ? 'text-emerald-600 font-medium' : 'text-slate-600'}>
                        {row.open_rate}%
                      </span>
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={row.click_rate >= 5 ? 'text-emerald-600 font-medium' : 'text-slate-600'}>
                        {row.click_rate}%
                      </span>
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={row.reply_rate >= 5 ? 'text-emerald-600 font-medium' : 'text-slate-600'}>
                        {row.reply_rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Bottom row: recent activity + campaign performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent activity */}
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary-600" />
              <h3 className="font-semibold text-slate-900">Actividad Reciente</h3>
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto scrollbar-thin">
            {activityLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">Sin actividad reciente</p>
              </div>
            ) : (
              recentActivity.map((activity: Record<string, unknown>, index: number) => (
                <div key={activity.id as string || index} className="flex items-start gap-3 px-6 py-3">
                  <div className="w-2 h-2 rounded-full bg-primary-400 mt-2 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700">
                      {activity.description as string || activity.activity_type as string}
                      {activity.prospect_full_name ? ` — ${activity.prospect_full_name}` : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatRelativeDate(activity.occurred_at as string || activity.created_at as string)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Campaign performance */}
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary-600" />
              <h3 className="font-semibold text-slate-900">Rendimiento de Campanas</h3>
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto scrollbar-thin">
            {campaignPerfLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : campaignPerf.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <AlertCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">Sin campanas activas</p>
              </div>
            ) : (
              campaignPerf.map((campaign: Record<string, unknown>, index: number) => (
                <div key={campaign.id as string || index} className="px-6 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {campaign.name as string}
                    </p>
                    <Badge variant={campaign.status === 'active' ? 'success' : 'default'}>
                      {campaign.status as string}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>{campaign.prospect_count as number || 0} prospectos</span>
                    <span>{campaign.emails_sent as number || 0} enviados</span>
                    <span>{campaign.emails_replied as number || 0} respondidos</span>
                  </div>
                  {(campaign.emails_sent as number) > 0 && (
                    <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5">
                      <div
                        className="bg-primary-600 h-1.5 rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            ((campaign.emails_replied as number || 0) /
                              (campaign.emails_sent as number || 1)) *
                              100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
