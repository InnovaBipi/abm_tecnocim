import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import {
  User,
  Mail,
  Key,
  Target,
  Save,
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function Settings() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  // Profile form
  const [profileForm, setProfileForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState(false);

  // Scoring rule modal
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Record<string, unknown> | null>(null);
  const [ruleForm, setRuleForm] = useState({
    name: '',
    field: '',
    condition: 'equals',
    value: '',
    score: '10',
  });

  // Queries
  const { data: emailData } = useQuery({
    queryKey: ['settings', 'email'],
    queryFn: () => settingsApi.getEmailSettings(),
  });

  const { data: apiKeysData } = useQuery({
    queryKey: ['settings', 'api-keys'],
    queryFn: () => settingsApi.getApiKeys(),
  });

  const { data: scoringData, isLoading: scoringLoading } = useQuery({
    queryKey: ['settings', 'scoring-rules'],
    queryFn: () => settingsApi.getScoringRules(),
  });

  // Mutations
  const updateProfileMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => settingsApi.updateProfile(data),
    onSuccess: () => {
      toast.success('Perfil actualizado exitosamente');
    },
    onError: () => {
      toast.error('Error al actualizar el perfil');
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      settingsApi.changePassword(data),
    onSuccess: () => {
      toast.success('Contrasena cambiada exitosamente');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: () => {
      toast.error('Error al cambiar la contrasena');
    },
  });

  const createRuleMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => settingsApi.createScoringRule(data),
    onSuccess: () => {
      toast.success('Regla creada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['settings', 'scoring-rules'] });
      setShowRuleModal(false);
      resetRuleForm();
    },
    onError: () => {
      toast.error('Error al crear la regla');
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      settingsApi.updateScoringRule(id, data),
    onSuccess: () => {
      toast.success('Regla actualizada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['settings', 'scoring-rules'] });
      setShowRuleModal(false);
      resetRuleForm();
    },
    onError: () => {
      toast.error('Error al actualizar la regla');
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteScoringRule(id),
    onSuccess: () => {
      toast.success('Regla eliminada');
      queryClient.invalidateQueries({ queryKey: ['settings', 'scoring-rules'] });
    },
    onError: () => {
      toast.error('Error al eliminar la regla');
    },
  });

  const emailSettings = emailData?.data?.data;
  const apiKeys = apiKeysData?.data?.data?.keys || apiKeysData?.data?.data || [];
  const scoringRules = scoringData?.data?.data?.rules || scoringData?.data?.data || [];

  const resetRuleForm = () => {
    setRuleForm({ name: '', field: '', condition: 'equals', value: '', score: '10' });
    setEditingRule(null);
  };

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate(profileForm);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Las contrasenas no coinciden');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('La nueva contrasena debe tener al menos 6 caracteres');
      return;
    }
    changePasswordMutation.mutate({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  const handleRuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...ruleForm, score: parseInt(ruleForm.score, 10) };
    if (editingRule) {
      const ruleId = (editingRule.id || editingRule._id) as string;
      updateRuleMutation.mutate({ id: ruleId, data: payload });
    } else {
      createRuleMutation.mutate(payload);
    }
  };

  const openEditRule = (rule: Record<string, unknown>) => {
    setEditingRule(rule);
    setRuleForm({
      name: rule.name as string || '',
      field: rule.field as string || '',
      condition: rule.condition as string || 'equals',
      value: rule.value as string || '',
      score: String(rule.score || 10),
    });
    setShowRuleModal(true);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configuracion</h1>
        <p className="text-slate-500 mt-1">Administra la configuracion de tu plataforma</p>
      </div>

      {/* Profile Section */}
      <Card padding="none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-slate-900">Perfil</h2>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSubmit} className="space-y-4 max-w-lg">
            <Input
              label="Nombre"
              value={profileForm.name}
              onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
              icon={<User className="h-4 w-4" />}
            />
            <Input
              label="Correo Electronico"
              type="email"
              value={profileForm.email}
              onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
              icon={<Mail className="h-4 w-4" />}
            />
            <Button type="submit" loading={updateProfileMutation.isPending} icon={<Save className="h-4 w-4" />}>
              Guardar Cambios
            </Button>
          </form>

          <hr className="my-6 border-slate-200" />

          <h3 className="text-sm font-semibold text-slate-700 mb-3">Cambiar Contrasena</h3>
          <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-lg">
            <Input
              label="Contrasena Actual"
              type={showPasswords ? 'text' : 'password'}
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
              required
            />
            <Input
              label="Nueva Contrasena"
              type={showPasswords ? 'text' : 'password'}
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
              required
            />
            <Input
              label="Confirmar Nueva Contrasena"
              type={showPasswords ? 'text' : 'password'}
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              required
            />
            <div className="flex items-center gap-4">
              <Button type="submit" loading={changePasswordMutation.isPending}>
                Cambiar Contrasena
              </Button>
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
              >
                {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showPasswords ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Email Settings */}
      <Card padding="none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-slate-900">Configuracion de Email</h2>
          </div>
        </CardHeader>
        <CardContent>
          {emailSettings ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Servidor SMTP</p>
                <p className="text-sm text-slate-900 mt-1">{emailSettings.smtp_host || 'No configurado'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Puerto</p>
                <p className="text-sm text-slate-900 mt-1">{emailSettings.smtp_port || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Nombre del Remitente</p>
                <p className="text-sm text-slate-900 mt-1">{emailSettings.from_name || 'No configurado'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Email del Remitente</p>
                <p className="text-sm text-slate-900 mt-1">{emailSettings.from_email || 'No configurado'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Estado</p>
                <div className="mt-1">
                  {emailSettings.is_configured ? (
                    <Badge variant="success">
                      <CheckCircle className="h-3 w-3 mr-1" /> Configurado
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      <XCircle className="h-3 w-3 mr-1" /> Sin configurar
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Cargando configuracion de email...</p>
          )}
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card padding="none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-slate-900">Claves API</h2>
          </div>
        </CardHeader>
        <CardContent>
          {apiKeys.length === 0 ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Shield className="h-5 w-5" />
              <p className="text-sm">Sin claves API configuradas</p>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key: Record<string, unknown>, index: number) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <div className="flex items-center gap-3">
                    <Key className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{key.name as string || key.service as string}</p>
                      <p className="text-xs text-slate-400 font-mono">
                        {key.masked_key as string || '****-****-****'}
                      </p>
                    </div>
                  </div>
                  {key.is_active ? (
                    <Badge variant="success">
                      <CheckCircle className="h-3 w-3 mr-1" /> Activa
                    </Badge>
                  ) : (
                    <Badge variant="danger">
                      <XCircle className="h-3 w-3 mr-1" /> Inactiva
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scoring Rules */}
      <Card padding="none">
        <CardHeader
          action={
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                resetRuleForm();
                setShowRuleModal(true);
              }}
            >
              Nueva Regla
            </Button>
          }
        >
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-slate-900">Reglas de Scoring</h2>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {scoringLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : scoringRules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Target className="h-8 w-8 text-slate-300 mb-2" />
              <p className="text-sm text-slate-500">Sin reglas de scoring configuradas</p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => {
                  resetRuleForm();
                  setShowRuleModal(true);
                }}
              >
                Crear Primera Regla
              </Button>
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow hoverable={false}>
                  <TableCell isHeader>Nombre</TableCell>
                  <TableCell isHeader>Campo</TableCell>
                  <TableCell isHeader>Condicion</TableCell>
                  <TableCell isHeader>Valor</TableCell>
                  <TableCell isHeader className="text-center">Puntos</TableCell>
                  <TableCell isHeader className="w-24">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {scoringRules.map((rule: Record<string, unknown>) => {
                  const ruleId = (rule.id || rule._id) as string;
                  return (
                    <TableRow key={ruleId}>
                      <TableCell className="font-medium text-slate-900">
                        {rule.name as string}
                      </TableCell>
                      <TableCell className="text-slate-600">{rule.field_name as string || rule.field as string}</TableCell>
                      <TableCell className="text-slate-600">{rule.operator as string || rule.condition as string}</TableCell>
                      <TableCell className="text-slate-600">{typeof rule.field_value === 'string' ? rule.field_value : JSON.stringify(rule.field_value)}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold ${
                          (rule.points as number || rule.score as number || 0) > 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}>
                          {(rule.points as number || rule.score as number || 0) > 0 ? '+' : ''}{rule.points as number || rule.score as number || 0}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditRule(rule)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Eliminar esta regla?')) {
                                deleteRuleMutation.mutate(ruleId);
                              }
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Rule modal */}
      <Modal
        isOpen={showRuleModal}
        onClose={() => {
          setShowRuleModal(false);
          resetRuleForm();
        }}
        title={editingRule ? 'Editar Regla de Scoring' : 'Nueva Regla de Scoring'}
      >
        <form onSubmit={handleRuleSubmit} className="space-y-4">
          <Input
            label="Nombre de la Regla"
            value={ruleForm.name}
            onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ej: Email corporativo"
            required
          />
          <Input
            label="Campo"
            value={ruleForm.field}
            onChange={(e) => setRuleForm((f) => ({ ...f, field: e.target.value }))}
            placeholder="Ej: email, title, company"
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Condicion</label>
              <select
                value={ruleForm.condition}
                onChange={(e) => setRuleForm((f) => ({ ...f, condition: e.target.value }))}
                className="form-select"
              >
                <option value="equals">Es igual a</option>
                <option value="contains">Contiene</option>
                <option value="starts_with">Empieza con</option>
                <option value="ends_with">Termina con</option>
                <option value="not_empty">No esta vacio</option>
                <option value="greater_than">Mayor que</option>
                <option value="less_than">Menor que</option>
              </select>
            </div>
            <Input
              label="Valor"
              value={ruleForm.value}
              onChange={(e) => setRuleForm((f) => ({ ...f, value: e.target.value }))}
              placeholder="Ej: gmail.com"
            />
          </div>
          <Input
            label="Puntos"
            type="number"
            value={ruleForm.score}
            onChange={(e) => setRuleForm((f) => ({ ...f, score: e.target.value }))}
            placeholder="10"
            helperText="Valores positivos suman puntos, negativos restan"
            required
          />
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <Button variant="secondary" type="button" onClick={() => {
              setShowRuleModal(false);
              resetRuleForm();
            }}>
              Cancelar
            </Button>
            <Button
              type="submit"
              loading={createRuleMutation.isPending || updateRuleMutation.isPending}
            >
              {editingRule ? 'Actualizar Regla' : 'Crear Regla'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
