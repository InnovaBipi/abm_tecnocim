import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sequencesApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import {
  ArrowLeft,
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
} from 'lucide-react';
import { getStatusColor, formatNumber } from '@/lib/utils';
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

  const { data, isLoading, error } = useQuery({
    queryKey: ['sequences', id],
    queryFn: () => sequencesApi.get(id!),
    enabled: !!id,
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

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/sequences')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a Secuencias
      </button>

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
            <Button size="sm" className="mt-3" onClick={openNewStep}>
              Agregar Primer Paso
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step: any, index: number) => (
              <div
                key={step.id || index}
                className="border border-slate-200 rounded-lg p-4 hover:border-primary-200 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary-50 text-primary-600 text-sm font-bold shrink-0">
                      {step.step_number || index + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {step.subject || 'Sin asunto'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {step.body_text || step.body_html || 'Sin contenido'}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        {(step.delay_days > 0 || step.delay_hours > 0) && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {step.delay_days > 0 ? `${step.delay_days}d` : ''}
                            {step.delay_hours > 0 ? ` ${step.delay_hours}h` : ''}
                            despues
                          </span>
                        )}
                        {/* Per-step stats from stepStats */}
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
                </div>
              </div>
            ))}
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
    </div>
  );
}
