import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi, outboxApi } from '@/services/api';
import { sanitizeHtml } from '@/lib/sanitize';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import {
  Inbox,
  Check,
  X,
  Edit3,
  Send,
  AlertTriangle,
  Code,
  Eye,
} from 'lucide-react';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import toast from 'react-hot-toast';
import { EmailStatusBadge } from './EmailStatusBadge';
import type { CampaignData, GeneratedEmailsData } from './types';

interface CampaignBandejaProps {
  campaignId: string;
  campaign: CampaignData;
  generatedEmails?: GeneratedEmailsData;
  refetchEmails: () => void;
}

export function CampaignBandeja({ campaignId, campaign, generatedEmails, refetchEmails }: CampaignBandejaProps) {
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useConfirmDialog();
  const [bandejaFilter, setBandejaFilter] = useState('all');
  const [editingEmail, setEditingEmail] = useState<Record<string, unknown> | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('edit');

  const emailsByProspect = generatedEmails?.byProspect || [];
  const stats = generatedEmails?.stats || {};
  const allEmailsList = generatedEmails?.emails || [];

  const filteredByProspect = emailsByProspect.map((group) => ({
    ...group,
    emails: bandejaFilter === 'all'
      ? group.emails
      : group.emails.filter((e) => e.status === bandejaFilter),
  })).filter((group) => group.emails.length > 0);

  const allDraftIds = allEmailsList.filter((e) => e.status === 'draft').map((e) => e.id);
  const allScheduledIds = allEmailsList.filter((e) => e.status === 'scheduled').map((e) => e.id);
  const hasScheduledEmails = allScheduledIds.length > 0;
  const campaignIsDraft = campaign.status === 'draft';

  // --- Mutations ---
  const approveEmailsMutation = useMutation({
    mutationFn: (emailIds: string[]) => campaignsApi.approveEmails(campaignId, emailIds),
    onSuccess: (res) => {
      const count = res.data?.data?.count || 0;
      toast.success(`${count} email(s) programados para envío`);
      refetchEmails();
    },
    onError: () => toast.error('Error al programar emails'),
  });

  const rejectEmailsMutation = useMutation({
    mutationFn: (emailIds: string[]) => campaignsApi.rejectEmails(campaignId, emailIds),
    onSuccess: () => {
      toast.success('Emails rechazados');
      refetchEmails();
    },
    onError: () => toast.error('Error al rechazar'),
  });

  const editEmailMutation = useMutation({
    mutationFn: ({ emailId, data }: { emailId: string; data: { subject?: string; body_html?: string } }) =>
      campaignsApi.editGeneratedEmail(campaignId, emailId, data),
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
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] });
    },
    onError: () => toast.error('Error al enviar emails'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => campaignsApi.update(campaignId, { status }),
    onSuccess: () => {
      toast.success('Estado de la campaña actualizado');
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] });
    },
    onError: () => toast.error('Error al cambiar el estado'),
  });

  return (
    <>
      <div className="space-y-4">
        {/* Campaign activation alert */}
        {hasScheduledEmails && campaignIsDraft && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                Campaña en borrador — los emails programados no se enviarán automáticamente
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Activa la campaña para que el scheduler envíe los emails en el horario óptimo.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => updateStatusMutation.mutate('active')}
              loading={updateStatusMutation.isPending}
            >
              Activar Campaña
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
                    description: `Se enviarán ${allScheduledIds.length} email(s) programados inmediatamente.`,
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
            {filteredByProspect.map((group) => (
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
                  {group.emails.map((email) => (
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
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(email.body_html) }}
                          />
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {(email.status === 'draft' || email.status === 'rejected') && (
                            <button
                              onClick={() => approveEmailsMutation.mutate([email.id])}
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title="Programar envío" aria-label="Programar envío"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingEmail(email as unknown as Record<string, unknown>);
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

      {/* Edit email modal */}
      <Modal
        isOpen={!!editingEmail}
        onClose={() => setEditingEmail(null)}
        title={`Editar Email - Paso ${(editingEmail as Record<string, unknown>)?.step_number || ''}`}
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
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(editBody) }}
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
                  emailId: (editingEmail as Record<string, unknown>).id as string,
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
    </>
  );
}
