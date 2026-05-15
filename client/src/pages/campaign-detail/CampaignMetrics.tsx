import { useQuery } from '@tanstack/react-query';
import { campaignsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import {
  Mail,
  MessageSquare,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { CampaignData, GeneratedEmailsData } from './types';

interface CampaignMetricsProps {
  campaignId: string;
  campaign: CampaignData;
  generatedEmails?: GeneratedEmailsData;
}

export function CampaignMetrics({ campaignId, campaign, generatedEmails }: CampaignMetricsProps) {
  const emailsSent = campaign.emailStats?.sent || 0;
  const repliedCount = campaign.emailStats?.replied || 0;
  const geStats = generatedEmails?.stats || {};

  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['campaigns', campaignId, 'metrics'],
    queryFn: () => campaignsApi.getMetrics(campaignId),
    enabled: !!campaignId,
  });

  const metrics = metricsData?.data?.data;
  const rates = metrics?.rates || {};
  const totals = metrics?.totals || {};
  const stepBreakdown: Record<string, unknown>[] = metrics?.step_breakdown || [];

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
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {((geStats.draft as number) || 0) + ((geStats.scheduled as number) || 0) + ((geStats.sent as number) || 0) + ((geStats.approved as number) || 0)}
          </p>
        </Card>
        <Card className="stat-card text-center">
          <p className="text-xs text-slate-500">Programados</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{(geStats.scheduled as number) || 0}</p>
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
                    {stepBreakdown.map((row) => (
                      <tr key={row.step_number as number} className="hover:bg-slate-50">
                        <td className="text-center px-4 py-3 text-slate-600 font-medium">#{row.step_number as number}</td>
                        <td className="px-4 py-3 text-slate-800 truncate max-w-[200px]">{(row.step_subject as string) || '-'}</td>
                        <td className="text-center px-4 py-3 text-slate-600">{row.total as number}</td>
                        <td className="text-center px-4 py-3">
                          <span className="text-emerald-600 font-medium">{row.sent as number}</span>
                        </td>
                        <td className="text-center px-4 py-3">
                          <span className={(row.bounced as number) > 0 ? 'text-red-600 font-medium' : 'text-slate-600'}>{row.bounced as number}</span>
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
