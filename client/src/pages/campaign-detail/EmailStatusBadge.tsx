import { Badge } from '@/components/ui/Badge';

const statusConfig: Record<string, { label: string; className: string }> = {
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

export function EmailStatusBadge({ status }: { status: string }) {
  const c = statusConfig[status] || statusConfig.none;
  return <Badge className={c.className}>{c.label}</Badge>;
}
