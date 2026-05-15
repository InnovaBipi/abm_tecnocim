import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi, prospectsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import {
  Users,
  Plus,
  Trash2,
  Sparkles,
  Search,
} from 'lucide-react';
import { getStatusColor, getScoreColor } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';
import { EmailStatusBadge } from './EmailStatusBadge';
import type { CampaignData, GeneratedEmailsData } from './types';

interface CampaignProspectsProps {
  campaignId: string;
  campaign: CampaignData;
  generatedEmails?: GeneratedEmailsData;
}

export function CampaignProspects({ campaignId, campaign, generatedEmails }: CampaignProspectsProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useConfirmDialog();
  const [showAddProspectsModal, setShowAddProspectsModal] = useState(false);
  const [prospectSearch, setProspectSearch] = useState('');
  const [selectedProspectIds, setSelectedProspectIds] = useState<string[]>([]);

  const prospects: Record<string, unknown>[] = campaign.prospects || [];

  // --- Queries ---
  const { data: allProspectsData } = useQuery({
    queryKey: ['prospects', 'for-campaign', prospectSearch],
    queryFn: () => prospectsApi.list({ search: prospectSearch || undefined, limit: 20 }),
    enabled: showAddProspectsModal,
  });

  const allProspects = allProspectsData?.data?.data?.prospects || [];

  // --- Mutations ---
  const addProspectsMutation = useMutation({
    mutationFn: (prospectIds: string[]) => campaignsApi.addProspects(campaignId, prospectIds),
    onSuccess: () => {
      toast.success('Prospectos agregados a la propiedad');
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] });
      setShowAddProspectsModal(false);
      setSelectedProspectIds([]);
    },
    onError: () => toast.error('Error al agregar prospectos'),
  });

  const removeProspectMutation = useMutation({
    mutationFn: (prospectId: string) => campaignsApi.removeProspect(campaignId, prospectId),
    onSuccess: () => {
      toast.success('Prospecto removido');
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] });
    },
    onError: () => toast.error('Error al remover el prospecto'),
  });

  const generateEmailsMutation = useMutation({
    mutationFn: (prospectIds: string[]) => campaignsApi.generateEmails(campaignId, prospectIds, 4),
    onSuccess: (res) => {
      const data = res.data?.data;
      toast.success(`Generados emails para ${data?.total_generated || 0} prospecto(s)`);
      setSelectedProspectIds([]);
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId, 'generated-emails'] });
    },
    onError: () => toast.error('Error al generar emails'),
  });

  // Build a map of prospect email statuses from generated emails
  const prospectEmailStatus: Record<string, string> = {};
  if (generatedEmails?.emails) {
    for (const email of generatedEmails.emails) {
      const current = prospectEmailStatus[email.prospect_id];
      const priority: Record<string, number> = { replied: 6, opened: 5, sent: 4, scheduled: 3, approved: 2, draft: 1, rejected: 0 };
      if (!current || (priority[email.status] || 0) > (priority[current] || 0)) {
        prospectEmailStatus[email.prospect_id] = email.status;
      }
    }
  }

  return (
    <>
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
                        setSelectedProspectIds(prospects.map((p: Record<string, unknown>) => (p.id || p._id || p.prospectId) as string));
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

      <ConfirmDialog {...dialogProps} />
    </>
  );
}
