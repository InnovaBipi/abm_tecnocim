import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { companiesApi, prospectsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard, SkeletonTable } from '@/components/ui/Skeleton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import {
  Building2,
  Globe,
  Users,
  MapPin,
  Linkedin,
  Edit3,
  Save,
  X,
  ExternalLink,
  Loader2,
  AlertCircle,
  UserPlus,
  TrendingUp,
  Mail,
  Info,
} from 'lucide-react';
import { getTierColor, formatNumber, getScoreColor, formatRelativeDate } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import toast from 'react-hot-toast';

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState('info');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});

  const { data: companyData, isLoading } = useQuery({
    queryKey: ['company', id],
    queryFn: () => companiesApi.get(id!),
    enabled: !!id,
  });

  const { data: prospectsData, isLoading: prospectsLoading } = useQuery({
    queryKey: ['company-prospects', id],
    queryFn: () => prospectsApi.list({ companyId: id, limit: 50 }),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => companiesApi.update(id!, data),
    onSuccess: () => {
      toast.success('Empresa actualizada');
      queryClient.invalidateQueries({ queryKey: ['company', id] });
      setIsEditing(false);
    },
    onError: () => toast.error('Error al actualizar'),
  });

  const company = companyData?.data?.data;
  const prospects = prospectsData?.data?.data?.prospects || [];

  const startEditing = () => {
    setEditForm({
      name: company?.name || '',
      domain: company?.domain || '',
      industry: company?.industry || '',
      employee_count: company?.employee_count || '',
      website_url: company?.website_url || '',
      linkedin_url: company?.linkedin_url || '',
      city: company?.city || '',
      country: company?.country || '',
      description: company?.description || '',
      tier: company?.tier || 'C',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editForm);
  };

  const tabs = [
    { id: 'info', label: 'Informacion', icon: <Info className="h-4 w-4" /> },
    { id: 'prospects', label: `Prospectos (${prospects.length})`, icon: <Users className="h-4 w-4" /> },
    { id: 'engagement', label: 'Engagement', icon: <TrendingUp className="h-4 w-4" /> },
  ];

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <SkeletonCard className="w-full" />
        </div>
        <SkeletonTable rows={5} columns={4} />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 lg:p-8">
        <Card>
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="Empresa no encontrada"
            description="La empresa que buscas no existe o fue eliminada"
            action={{ label: 'Volver a empresas', onClick: () => navigate('/companies') }}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: 'Empresas', href: '/companies' },
        { label: company.name },
      ]} />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            {company.domain ? (
              <img
                src={`https://www.google.com/s2/favicons?domain=${company.domain}&sz=64`}
                alt={company.name}
                className="w-12 h-12 rounded-lg bg-slate-100 p-1"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-slate-400" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{company.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                {company.domain && (
                  <a
                    href={`https://${company.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {company.domain}
                  </a>
                )}
                {company.industry && (
                  <span className="text-sm text-slate-500">{company.industry}</span>
                )}
                <Badge className={getTierColor(company.tier || 'D')} size="md">
                  Tier {company.tier || '-'}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button variant="secondary" onClick={() => setIsEditing(false)} icon={<X className="h-4 w-4" />}>
                Cancelar
              </Button>
              <Button onClick={handleSave} loading={updateMutation.isPending} icon={<Save className="h-4 w-4" />}>
                Guardar
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={startEditing} icon={<Edit3 className="h-4 w-4" />}>
              Editar
            </Button>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Score</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-2xl font-bold ${company.account_score >= 60 ? 'text-emerald-600' : company.account_score >= 30 ? 'text-amber-600' : 'text-slate-600'}`}>
              {company.account_score || 0}
            </span>
            <ProgressBar
              value={company.account_score || 0}
              variant={company.account_score >= 60 ? 'success' : company.account_score >= 30 ? 'warning' : 'primary'}
              size="sm"
              className="flex-1"
            />
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Prospectos</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{prospects.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Empleados</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{company.employee_count ? formatNumber(company.employee_count) : '-'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 font-medium">Ubicacion</p>
          <p className="text-sm font-medium text-slate-900 mt-1 flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-slate-400" />
            {[company.city, company.country].filter(Boolean).join(', ') || '-'}
          </p>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {() => null}
      </Tabs>

      {/* Tab content */}
      <div className="transition-opacity duration-200">
        {activeTab === 'info' && (
          <Card>
            {isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Nombre" value={editForm.name as string} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                  <Input label="Dominio" value={editForm.domain as string} onChange={(e) => setEditForm((f) => ({ ...f, domain: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Industria" value={editForm.industry as string} onChange={(e) => setEditForm((f) => ({ ...f, industry: e.target.value }))} />
                  <Input label="Empleados" type="number" value={editForm.employee_count as string} onChange={(e) => setEditForm((f) => ({ ...f, employee_count: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Website" value={editForm.website_url as string} onChange={(e) => setEditForm((f) => ({ ...f, website_url: e.target.value }))} />
                  <Input label="LinkedIn" value={editForm.linkedin_url as string} onChange={(e) => setEditForm((f) => ({ ...f, linkedin_url: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Ciudad" value={editForm.city as string} onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))} />
                  <Input label="Pais" value={editForm.country as string} onChange={(e) => setEditForm((f) => ({ ...f, country: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Descripcion</label>
                  <textarea
                    value={editForm.description as string}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    rows={4}
                    className="form-input"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {company.description && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Descripcion</h3>
                    <p className="text-sm text-slate-700 leading-relaxed">{company.description}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Datos</h3>
                    <dl className="space-y-3">
                      <div className="flex justify-between">
                        <dt className="text-sm text-slate-500">Industria</dt>
                        <dd className="text-sm font-medium text-slate-900">{company.industry || '-'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-slate-500">Empleados</dt>
                        <dd className="text-sm font-medium text-slate-900">{company.employee_count ? formatNumber(company.employee_count) : '-'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-slate-500">Revenue anual</dt>
                        <dd className="text-sm font-medium text-slate-900">{company.annual_revenue ? `$${formatNumber(company.annual_revenue)}` : '-'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-sm text-slate-500">Target</dt>
                        <dd className="text-sm font-medium text-slate-900">{company.is_target ? 'Si' : 'No'}</dd>
                      </div>
                    </dl>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Links</h3>
                    <div className="space-y-2">
                      {company.website_url && (
                        <a href={company.website_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary-600 hover:underline">
                          <Globe className="h-4 w-4" /> Website
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {company.linkedin_url && (
                        <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary-600 hover:underline">
                          <Linkedin className="h-4 w-4" /> LinkedIn
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        {activeTab === 'prospects' && (
          <>
            {prospectsLoading ? (
              <SkeletonTable rows={5} columns={5} />
            ) : prospects.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<UserPlus className="h-7 w-7" />}
                  title="Sin prospectos asociados"
                  description="Aun no hay prospectos vinculados a esta empresa"
                  action={{ label: 'Ver prospectos', onClick: () => navigate('/prospects') }}
                />
              </Card>
            ) : (
              <Table>
                <TableHead>
                  <TableRow hoverable={false}>
                    <TableCell isHeader>Nombre</TableCell>
                    <TableCell isHeader>Email</TableCell>
                    <TableCell isHeader>Cargo</TableCell>
                    <TableCell isHeader className="text-center">Score</TableCell>
                    <TableCell isHeader>Estado</TableCell>
                    <TableCell isHeader>Ultima actividad</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {prospects.map((prospect: Record<string, unknown>) => {
                    const pId = (prospect.id || prospect._id) as string;
                    const name = (prospect.full_name as string) || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim() || '-';
                    return (
                      <TableRow key={pId}>
                        <TableCell>
                          <button
                            onClick={() => navigate(`/prospects/${pId}`)}
                            className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline"
                          >
                            {name}
                          </button>
                        </TableCell>
                        <TableCell className="text-slate-500">{prospect.email as string}</TableCell>
                        <TableCell className="text-slate-500">{prospect.title as string || '-'}</TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold ${getScoreColor(prospect.lead_score as number || 0)}`}>
                            {prospect.lead_score as number || 0}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge>{prospect.status as string || 'new'}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {prospect.updated_at ? formatRelativeDate(prospect.updated_at as string) : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}

        {activeTab === 'engagement' && (
          <Card>
            <EmptyState
              icon={<Mail className="h-7 w-7" />}
              title="Proximamente"
              description="Las metricas de engagement a nivel empresa estaran disponibles pronto"
            />
          </Card>
        )}
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
