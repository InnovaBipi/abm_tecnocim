import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sequencesApi, prospectsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import {
  Plus,
  Trash2,
  Mail,
  Loader2,
  AlertCircle,
  Sparkles,
  Save,
  Users,
  Play,
  Pause,
  Clock,
  Wand2,
  Search,
  Check,
  Eye,
  ChevronDown,
  ChevronUp,
  GitBranch,
} from 'lucide-react';
import { getStatusColor, formatNumber } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import toast from 'react-hot-toast';

export default function SequenceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showStepModal, setShowStepModal] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [stepForm, setStepForm] = useState({
    subject: '',
    body_html: '',
    delay_days: '0',
    delay_hours: '0',
  });
  const [localSteps, setLocalSteps] = useState<any[] | null>(null);

  // AI Generation state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiProspectSearch, setAiProspectSearch] = useState('');
  const [aiSelectedProspect, setAiSelectedProspect] = useState<any>(null);
  const [aiPreviewSteps, setAiPreviewSteps] = useState<any[] | null>(null);
  const [aiPreviewMeta, setAiPreviewMeta] = useState<any>(null);
  const [expandedPreviewStep, setExpandedPreviewStep] = useState<number | null>(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sequences', id],
    queryFn: () => sequencesApi.get(id!),
    enabled: !!id,
  });

  // Search prospects for AI generation
  const { data: prospectSearchData, isFetching: isSearchingProspects } = useQuery({
    queryKey: ['prospects-search', aiProspectSearch],
    queryFn: () => prospectsApi.list({ search: aiProspectSearch, limit: 10, status: 'enriched' } as any),
    enabled: showAiModal && aiProspectSearch.length >= 2,
  });

  // Also search without status filter for broader results
  const { data: prospectSearchAllData } = useQuery({
    queryKey: ['prospects-search-all', aiProspectSearch],
    queryFn: () => prospectsApi.list({ search: aiProspectSearch, limit: 10 } as any),
    enabled: showAiModal && aiProspectSearch.length >= 2,
  });

  const saveStepsMutation = useMutation({
    mutationFn: (steps: any[]) => sequencesApi.addSteps(id!, steps),
    onSuccess: () => {
      toast.success('Pasos guardados exitosamente');
      queryClient.invalidateQueries({ queryKey: ['sequences', id] });
      setLocalSteps(null);
    },
    onError: () => {
      toast.error('Error al guardar los pasos');
    },
  });

  const generateMutation = useMutation({
    mutationFn: (stepNumber: number) => sequencesApi.generateStep(id!, stepNumber),
    onSuccess: (response) => {
      const generated = response?.data?.data;
      if (generated) {
        setStepForm((f) => ({
          ...f,
          subject: generated.subject || f.subject,
          body_html: generated.body || f.body_html,
        }));
        toast.success('Email generado con IA');
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al generar con IA');
    },
  });

  const generatePersonalizedMutation = useMutation({
    mutationFn: (prospectId: string) => sequencesApi.generatePersonalized(id!, prospectId),
    onSuccess: (response) => {
      const data = response?.data?.data;
      if (data?.steps) {
        setAiPreviewSteps(data.steps);
        setAiPreviewMeta(data);
        setExpandedPreviewStep(0);
        toast.success('Secuencia personalizada generada');
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al generar secuencia personalizada');
    },
  });

  const generateBranchedMutation = useMutation({
    mutationFn: (prospectId: string) => sequencesApi.generateBranched(id!, prospectId),
    onSuccess: (response) => {
      const data = response?.data?.data;
      if (data?.steps) {
        setAiPreviewSteps(data.steps);
        setAiPreviewMeta(data);
        setExpandedPreviewStep(0);
        toast.success('Secuencia inteligente con branching generada');
        queryClient.invalidateQueries({ queryKey: ['sequences', id] });
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Error al generar secuencia inteligente');
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => sequencesApi.pause(id!),
    onSuccess: () => {
      toast.success('Secuencia pausada');
      queryClient.invalidateQueries({ queryKey: ['sequences', id] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => sequencesApi.resume(id!),
    onSuccess: () => {
      toast.success('Secuencia activada');
      queryClient.invalidateQueries({ queryKey: ['sequences', id] });
    },
  });

  const sequence = data?.data?.data;
  const steps = localSteps || sequence?.steps || [];
  const enrollments = sequence?.enrollments || [];
  const hasUnsavedChanges = localSteps !== null;

  // Merge search results (enriched first, then all)
  const searchResults = (() => {
    const enriched = prospectSearchData?.data?.data?.prospects || [];
    const all = prospectSearchAllData?.data?.data?.prospects || [];
    const seen = new Set(enriched.map((p: any) => p.id));
    const merged = [...enriched];
    for (const p of all) {
      if (!seen.has(p.id)) {
        merged.push(p);
        seen.add(p.id);
      }
    }
    return merged;
  })();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        <span className="ml-2 text-slate-500">Cargando secuencia...</span>
      </div>
    );
  }

  if (error || !sequence) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-red-500">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p className="text-sm">Error al cargar la secuencia</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/sequences')}>
          Volver a Secuencias
        </Button>
      </div>
    );
  }

  const openNewStep = () => {
    setEditingStepIndex(null);
    setStepForm({ subject: '', body_html: '', delay_days: '0', delay_hours: '0' });
    setShowStepModal(true);
  };

  const openEditStep = (index: number) => {
    const step = steps[index];
    setEditingStepIndex(index);
    setStepForm({
      subject: step.subject || '',
      body_html: step.body_html || step.body_text || '',
      delay_days: String(step.delay_days || 0),
      delay_hours: String(step.delay_hours || 0),
    });
    setShowStepModal(true);
  };

  const handleSaveStep = () => {
    const current = [...steps];
    const stepData = {
      step_number: editingStepIndex !== null ? current[editingStepIndex].step_number : current.length + 1,
      step_type: 'email' as const,
      subject: stepForm.subject,
      body_html: stepForm.body_html,
      body_text: stepForm.body_html,
      delay_days: parseInt(stepForm.delay_days) || 0,
      delay_hours: parseInt(stepForm.delay_hours) || 0,
      is_active: true,
    };

    if (editingStepIndex !== null) {
      current[editingStepIndex] = { ...current[editingStepIndex], ...stepData };
    } else {
      current.push(stepData);
    }

    setLocalSteps(current);
    setShowStepModal(false);
    toast.success(editingStepIndex !== null ? 'Paso actualizado' : 'Paso agregado');
  };

  const handleDeleteStep = (index: number) => {
    if (!confirm('Eliminar este paso?')) return;
    const current = [...steps];
    current.splice(index, 1);
    // Renumber steps
    current.forEach((s, i) => { s.step_number = i + 1; });
    setLocalSteps(current);
  };

  const handleSaveAllSteps = () => {
    if (!localSteps || localSteps.length === 0) {
      toast.error('Agrega al menos un paso');
      return;
    }
    saveStepsMutation.mutate(localSteps);
  };

  const openAiGeneration = () => {
    setAiSelectedProspect(null);
    setAiProspectSearch('');
    setAiPreviewSteps(null);
    setAiPreviewMeta(null);
    setShowAiModal(true);
  };

  const handleApplyAiSteps = () => {
    if (!aiPreviewSteps) return;
    const newSteps = aiPreviewSteps.map((s: any, i: number) => ({
      step_number: i + 1,
      step_type: 'email' as const,
      subject: s.subject,
      body_html: s.body_html,
      body_text: s.body_html,
      delay_days: s.delay_days || 0,
      delay_hours: 0,
      is_active: true,
    }));
    setLocalSteps(newSteps);
    setShowAiModal(false);
    toast.success('Secuencia aplicada. Revisa y guarda los cambios.');
  };

  // Helper to strip HTML for preview
  const stripHtml = (html: string) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: 'Campanas', href: '/campaigns' },
        { label: sequence.name || 'Secuencia' },
      ]} />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-100 text-primary-700">
            <Mail className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{sequence.name}</h1>
              <Badge className={getStatusColor(sequence.status || 'draft')} size="md">
                {sequence.status || 'borrador'}
              </Badge>
            </div>
            {sequence.campaign_name && (
              <p className="text-sm text-slate-500 mt-1">Campana: {sequence.campaign_name}</p>
            )}
            {sequence.description && (
              <p className="text-sm text-slate-400 mt-0.5">{sequence.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sequence.status === 'active' ? (
            <Button variant="secondary" size="sm" icon={<Pause className="h-4 w-4" />}
              onClick={() => pauseMutation.mutate()} loading={pauseMutation.isPending}>
              Pausar
            </Button>
          ) : (
            <Button size="sm" icon={<Play className="h-4 w-4" />}
              onClick={() => resumeMutation.mutate()} loading={resumeMutation.isPending}>
              Activar
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Pasos</p>
              <p className="text-xl font-bold text-slate-900">{steps.length}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Inscritos</p>
              <p className="text-xl font-bold text-slate-900">{formatNumber(enrollments.length)}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Activos</p>
              <p className="text-xl font-bold text-slate-900">
                {formatNumber(sequence.enrollmentStats?.active || 0)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Steps */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">
            Pasos de la Secuencia ({steps.length})
          </h3>
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <Button
                size="sm"
                icon={<Save className="h-4 w-4" />}
                loading={saveStepsMutation.isPending}
                onClick={handleSaveAllSteps}
              >
                Guardar Cambios
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Wand2 className="h-4 w-4" />}
              onClick={openAiGeneration}
              className="!bg-gradient-to-r !from-purple-500 !to-indigo-500 !text-white !border-0 hover:!from-purple-600 hover:!to-indigo-600"
            >
              Personalizar con IA
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={openNewStep}
            >
              Agregar Paso
            </Button>
          </div>
        </div>

        {hasUnsavedChanges && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4">
            <p className="text-sm text-amber-700">Tienes cambios sin guardar. Haz clic en "Guardar Cambios" para aplicarlos.</p>
          </div>
        )}

        {steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Mail className="h-8 w-8 mb-2" />
            <p className="text-sm">Sin pasos configurados</p>
            <div className="flex items-center gap-3 mt-3">
              <Button size="sm" variant="secondary" onClick={openNewStep}>
                Agregar Manualmente
              </Button>
              <Button
                size="sm"
                onClick={openAiGeneration}
                icon={<Wand2 className="h-4 w-4" />}
                className="!bg-gradient-to-r !from-purple-500 !to-indigo-500 !text-white !border-0"
              >
                Generar con IA
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step: any, index: number) => {
              const isCondition = step.step_type === 'condition';
              const condConfig = step.condition_config
                ? (typeof step.condition_config === 'string' ? JSON.parse(step.condition_config) : step.condition_config)
                : null;
              const branchLabel = step.branch_label;

              return (
              <div
                key={step.id || index}
                className={`border rounded-lg p-4 transition-colors ${
                  isCondition
                    ? 'border-amber-300 bg-amber-50/50 hover:border-amber-400'
                    : 'border-slate-200 hover:border-primary-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold shrink-0 ${
                      isCondition
                        ? 'bg-amber-100 text-amber-700 rotate-45'
                        : 'bg-primary-50 text-primary-600'
                    }`}>
                      {isCondition ? (
                        <GitBranch className="h-4 w-4 -rotate-45" />
                      ) : (
                        step.step_number || index + 1
                      )}
                    </div>
                    <div>
                      {isCondition ? (
                        <>
                          <p className="text-sm font-medium text-amber-800">
                            {condConfig?.type === 'opened' ? 'Ha abierto el email?' :
                             condConfig?.type === 'clicked' ? 'Ha clicado un enlace?' :
                             condConfig?.type === 'replied' ? 'Ha respondido?' : 'Condicion'}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {condConfig?.threshold_hours && (
                              <span className="text-xs text-amber-600">
                                Ventana: {condConfig.threshold_hours}h
                              </span>
                            )}
                            <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                              SI →
                            </span>
                            <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                              NO →
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-slate-900">
                              {step.subject || 'Sin asunto'}
                            </p>
                            {branchLabel && (
                              <span className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded font-medium ${
                                branchLabel === 'engaged' || branchLabel === 'direct_close'
                                  ? 'bg-green-100 text-green-700'
                                  : branchLabel === 'not_engaged' || branchLabel === 'soft_close'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {branchLabel === 'initial' ? 'Inicial' :
                                 branchLabel === 'engaged' ? 'Engaged' :
                                 branchLabel === 'not_engaged' ? 'No engaged' :
                                 branchLabel === 'direct_close' ? 'CTA directo' :
                                 branchLabel === 'soft_close' ? 'Cierre suave' :
                                 branchLabel}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                            {step.body_text || stripHtml(step.body_html || '') || 'Sin contenido'}
                          </p>
                        </>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        {(step.delay_days > 0 || step.delay_hours > 0) && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {step.delay_days > 0 ? `${step.delay_days}d` : ''}
                            {step.delay_hours > 0 ? ` ${step.delay_hours}h` : ''}
                            despues
                          </span>
                        )}
                        {sequence.stepStats && sequence.stepStats[index] && (
                          <>
                            <span>Enviados: {sequence.stepStats[index].sent || 0}</span>
                            <span>Abiertos: {sequence.stepStats[index].opened || 0}</span>
                            <span>Respondidos: {sequence.stepStats[index].replied || 0}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {!isCondition && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEditStep(index)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                      title="Editar"
                    >
                      <Mail className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteStep(index)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Enrollments */}
      {enrollments.length > 0 && (
        <Card padding="md">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            Prospectos Inscritos ({enrollments.length})
          </h3>
          <div className="space-y-2">
            {enrollments.slice(0, 20).map((enrollment: any) => (
              <div key={enrollment.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {enrollment.full_name || `${enrollment.first_name || ''} ${enrollment.last_name || ''}`.trim() || enrollment.email}
                  </p>
                  <p className="text-xs text-slate-400">{enrollment.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Paso {enrollment.current_step}</span>
                  <Badge className={getStatusColor(enrollment.status || 'active')} size="sm">
                    {enrollment.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Step Modal */}
      <Modal
        isOpen={showStepModal}
        onClose={() => setShowStepModal(false)}
        title={editingStepIndex !== null ? `Editar Paso ${editingStepIndex + 1}` : 'Nuevo Paso'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {editingStepIndex !== null
                ? `Editando paso ${editingStepIndex + 1} de la secuencia`
                : `Nuevo paso ${steps.length + 1}`}
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={<Sparkles className="h-4 w-4" />}
              loading={generateMutation.isPending}
              onClick={() => generateMutation.mutate(
                editingStepIndex !== null ? editingStepIndex + 1 : steps.length + 1
              )}
            >
              Generar con IA
            </Button>
          </div>

          <Input
            label="Asunto del Email"
            value={stepForm.subject}
            onChange={(e) => setStepForm((f) => ({ ...f, subject: e.target.value }))}
            placeholder="Oportunidad de inversion en Cataluna"
          />

          <div>
            <label className="form-label">Contenido del Email</label>
            <textarea
              value={stepForm.body_html}
              onChange={(e) => setStepForm((f) => ({ ...f, body_html: e.target.value }))}
              rows={10}
              className="form-input font-mono text-sm"
              placeholder="Hola {{first_name}},&#10;&#10;Me pongo en contacto contigo..."
            />
            <p className="text-xs text-slate-400 mt-1">
              Variables disponibles: {'{{first_name}}'}, {'{{last_name}}'}, {'{{company_name}}'}, {'{{title}}'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Dias de espera"
              type="number"
              value={stepForm.delay_days}
              onChange={(e) => setStepForm((f) => ({ ...f, delay_days: e.target.value }))}
              placeholder="0"
            />
            <Input
              label="Horas de espera"
              type="number"
              value={stepForm.delay_hours}
              onChange={(e) => setStepForm((f) => ({ ...f, delay_hours: e.target.value }))}
              placeholder="0"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <Button variant="secondary" type="button" onClick={() => setShowStepModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveStep}>
              {editingStepIndex !== null ? 'Actualizar Paso' : 'Agregar Paso'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI Generation Modal */}
      <Modal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        title="Personalizar Secuencia con IA"
        size="lg"
      >
        <div className="space-y-5">
          {/* Step 1: Select Prospect */}
          {!aiPreviewSteps ? (
            <>
              <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-4 border border-purple-100">
                <div className="flex items-start gap-3">
                  <Wand2 className="h-5 w-5 text-purple-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-purple-900">Generacion inteligente</p>
                    <p className="text-xs text-purple-700 mt-1">
                      Selecciona un prospecto con datos de enrichment. La IA usara su perfil, empresa,
                      investigacion y la informacion de la campana para generar emails hiper-personalizados.
                    </p>
                  </div>
                </div>
              </div>

              {/* Search */}
              <div>
                <label className="form-label">Buscar Prospecto</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={aiProspectSearch}
                    onChange={(e) => {
                      setAiProspectSearch(e.target.value);
                      setAiSelectedProspect(null);
                    }}
                    placeholder="Buscar por nombre, email o empresa..."
                    className="form-input pl-10"
                  />
                  {isSearchingProspects && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
                  )}
                </div>
              </div>

              {/* Results */}
              {searchResults.length > 0 && !aiSelectedProspect && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {searchResults.map((p: any) => (
                    <button
                      key={p.id}
                      className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors text-left"
                      onClick={() => {
                        setAiSelectedProspect(p);
                        setAiProspectSearch('');
                      }}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()}
                        </p>
                        <p className="text-xs text-slate-500">
                          {p.title}{p.company_name ? ` - ${p.company_name}` : ''} | {p.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.status === 'enriched' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
                            Enriched
                          </span>
                        )}
                        {p.lead_score > 0 && (
                          <span className="text-xs font-bold text-slate-400">{p.lead_score}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Selected Prospect */}
              {aiSelectedProspect && (
                <div className="border-2 border-purple-200 bg-purple-50 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-100 text-purple-700 text-sm font-bold">
                        {(aiSelectedProspect.first_name || '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-purple-900">
                          {aiSelectedProspect.full_name || `${aiSelectedProspect.first_name || ''} ${aiSelectedProspect.last_name || ''}`.trim()}
                        </p>
                        <p className="text-xs text-purple-700">
                          {aiSelectedProspect.title}
                          {aiSelectedProspect.company_name ? ` @ ${aiSelectedProspect.company_name}` : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setAiSelectedProspect(null)}
                      className="text-xs text-purple-500 hover:text-purple-700"
                    >
                      Cambiar
                    </button>
                  </div>
                </div>
              )}

              {/* Generate Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <Button variant="secondary" onClick={() => setShowAiModal(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => generatePersonalizedMutation.mutate(aiSelectedProspect.id)}
                  disabled={!aiSelectedProspect || generateBranchedMutation.isPending}
                  loading={generatePersonalizedMutation.isPending}
                  icon={<Wand2 className="h-4 w-4" />}
                  className="!bg-gradient-to-r !from-purple-500 !to-indigo-500 !text-white !border-0 hover:!from-purple-600 hover:!to-indigo-600"
                >
                  {generatePersonalizedMutation.isPending ? 'Generando...' : 'Lineal'}
                </Button>
                <Button
                  onClick={() => generateBranchedMutation.mutate(aiSelectedProspect.id)}
                  disabled={!aiSelectedProspect || generatePersonalizedMutation.isPending}
                  loading={generateBranchedMutation.isPending}
                  icon={<GitBranch className="h-4 w-4" />}
                  className="!bg-gradient-to-r !from-amber-500 !to-orange-500 !text-white !border-0 hover:!from-amber-600 hover:!to-orange-600"
                >
                  {generateBranchedMutation.isPending ? 'Generando...' : 'Inteligente'}
                </Button>
              </div>
            </>
          ) : (
            /* Step 2: Preview Generated Steps */
            <>
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                <div className="flex items-start gap-3">
                  <Eye className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-900">Preview de la secuencia generada</p>
                    <p className="text-xs text-green-700 mt-1">
                      Personalizada para <strong>{aiPreviewMeta?.prospect?.name}</strong> ({aiPreviewMeta?.prospect?.title} @ {aiPreviewMeta?.prospect?.company}).
                      Revisa cada email y aplica si te convence.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {aiPreviewSteps.map((step: any, index: number) => (
                  <div key={index} className="border border-slate-200 rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
                      onClick={() => setExpandedPreviewStep(expandedPreviewStep === index ? null : index)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-50 text-purple-600 text-sm font-bold shrink-0">
                          {step.step_number}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{step.subject}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {step.delay_days === 0 ? 'Envio inmediato' : `Dia ${step.delay_days}`}
                          </p>
                        </div>
                      </div>
                      {expandedPreviewStep === index
                        ? <ChevronUp className="h-4 w-4 text-slate-400" />
                        : <ChevronDown className="h-4 w-4 text-slate-400" />
                      }
                    </button>
                    {expandedPreviewStep === index && (
                      <div className="px-4 pb-4 border-t border-slate-100">
                        <div
                          className="mt-3 text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: step.body_html }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-between pt-4 border-t border-slate-200">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAiPreviewSteps(null);
                    setAiPreviewMeta(null);
                  }}
                >
                  Volver a generar
                </Button>
                <div className="flex items-center gap-3">
                  <Button variant="secondary" onClick={() => setShowAiModal(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleApplyAiSteps}
                    icon={<Check className="h-4 w-4" />}
                    className="!bg-gradient-to-r !from-green-500 !to-emerald-500 !text-white !border-0 hover:!from-green-600 hover:!to-emerald-600"
                  >
                    Aplicar Secuencia
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
