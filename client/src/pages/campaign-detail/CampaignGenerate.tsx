import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { EmailStatusBadge } from './EmailStatusBadge';
import type { CampaignData, GeneratedEmailsData } from './types';

interface CampaignGenerateProps {
  campaignId: string;
  campaign: CampaignData;
  generatedEmails?: GeneratedEmailsData;
  refetchEmails: () => void;
}

export function CampaignGenerate({ campaignId, campaign, generatedEmails, refetchEmails }: CampaignGenerateProps) {
  const queryClient = useQueryClient();
  const [numSteps, setNumSteps] = useState(4);
  const [generatingFor, setGeneratingFor] = useState<string[]>([]);
  const [expandedProspects, setExpandedProspects] = useState<Set<string>>(new Set());

  const prospects: Record<string, unknown>[] = campaign.prospects || [];

  const generateEmailsMutation = useMutation({
    mutationFn: (prospectIds: string[]) => campaignsApi.generateEmails(campaignId, prospectIds, numSteps),
    onSuccess: (res) => {
      const data = res.data?.data;
      toast.success(`Generados emails para ${data?.total_generated || 0} prospecto(s)`);
      setGeneratingFor([]);
      refetchEmails();
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] });
    },
    onError: () => {
      toast.error('Error al generar emails');
      setGeneratingFor([]);
    },
  });

  const toggleProspectExpand = (pid: string) => {
    setExpandedProspects(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };

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
            const pIds = prospects.map((p: Record<string, unknown>) => (p.id || p._id || p.prospectId) as string);
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
        {prospects.map((prospect: Record<string, unknown>) => {
          const pId = (prospect.id || prospect._id || prospect.prospectId) as string;
          const pName = (prospect.full_name as string) || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || '-';
          const isExpanded = expandedProspects.has(pId);
          const prospectEmails = (generatedEmails?.emails || []).filter((e) => e.prospect_id === pId);
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
                    <p className="text-xs text-slate-500">{prospect.email as string} {prospect.title ? `- ${prospect.title}` : ''}</p>
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
                  {prospectEmails.map((email) => (
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
                  Sin emails generados. Haz clic en &quot;Generar&quot; para crear la secuencia.
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
