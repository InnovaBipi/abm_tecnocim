import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatNumber, formatRelativeDate, getScoreColor } from '@/lib/utils';
import {
  Users,
  Building2,
  Megaphone,
  Mail,
  TrendingUp,
  Activity,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
}

function StatCard({ title, value, icon, change, changeType = 'neutral' }: StatCardProps) {
  return (
    <Card className="stat-card">
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
    </Card>
  );
}

export default function Dashboard() {
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => dashboardApi.getStats(),
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
    queryKey: ['dashboard', 'campaign-performance'],
    queryFn: () => dashboardApi.getCampaignPerformance(),
  });

  const stats = statsData?.data?.data;
  const recentActivity = activityData?.data?.data || [];
  const topProspects = topProspectsData?.data?.data || [];
  const campaignPerf = campaignPerfData?.data?.data || [];

  // Mock chart data (will be replaced by API data)
  const emailChartData = stats?.emailsOverTime || [
    { date: 'Ene', enviados: 120, abiertos: 89, respondidos: 24 },
    { date: 'Feb', enviados: 150, abiertos: 112, respondidos: 35 },
    { date: 'Mar', enviados: 180, abiertos: 140, respondidos: 42 },
    { date: 'Abr', enviados: 220, abiertos: 165, respondidos: 55 },
    { date: 'May', enviados: 280, abiertos: 210, respondidos: 72 },
    { date: 'Jun', enviados: 310, abiertos: 248, respondidos: 88 },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Resumen general de tu plataforma ABM</p>
      </div>

      {/* Stat cards */}
      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="stat-card animate-pulse">
              <div className="h-16 bg-slate-100 rounded" />
            </Card>
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
          />
          <StatCard
            title="Empresas"
            value={formatNumber(stats?.total_companies || 0)}
            icon={<Building2 className="h-5 w-5" />}
          />
          <StatCard
            title="Campanas Activas"
            value={formatNumber(stats?.active_campaigns || 0)}
            icon={<Megaphone className="h-5 w-5" />}
          />
          <StatCard
            title="Emails Enviados"
            value={formatNumber(stats?.emails_sent || 0)}
            icon={<Mail className="h-5 w-5" />}
            change={stats?.reply_rate ? `${stats.reply_rate}% reply rate` : undefined}
            changeType={stats?.reply_rate > 0 ? 'positive' : 'neutral'}
          />
        </div>
      )}

      {/* Charts and tables row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Email chart - 2 columns */}
        <Card padding="none" className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary-600" />
              <h3 className="font-semibold text-slate-900">Emails Enviados</h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Resumen de actividad de emails</p>
          </div>
          <div className="p-6">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={emailChartData}>
                <defs>
                  <linearGradient id="gradientEnviados" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
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
                  stroke="#4f46e5"
                  fill="url(#gradientEnviados)"
                  strokeWidth={2}
                  name="Enviados"
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
          </div>
        </Card>

        {/* Top prospects - 1 column */}
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
                <div key={prospect.id as string || index} className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50 transition-colors">
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
