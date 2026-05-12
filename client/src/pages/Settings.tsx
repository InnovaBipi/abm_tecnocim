import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, usersApi } from '@/services/api';
import { Select } from '@/components/ui/Select';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  User,
  Users,
  Mail,
  Send,
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
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import toast from 'react-hot-toast';

export default function Settings() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const { dialogProps, confirm } = useConfirmDialog();

  // Profile form
  const [profileForm, setProfileForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
    sender_email: user?.sender_email || '',
    sender_name: user?.sender_name || '',
  });

  // Team management (admin only)
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [userForm, setUserForm] = useState({
    first_name: '', last_name: '', email: '', password: '',
    role: 'member', sender_email: '', sender_name: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState(false);

  // Email settings form
  const [emailForm, setEmailForm] = useState<Record<string, string>>({});
  const [emailFormInitialized, setEmailFormInitialized] = useState(false);

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

  const updateEmailMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => settingsApi.updateEmailSettings(data),
    onSuccess: () => {
      toast.success('Configuracion de email actualizada');
      queryClient.invalidateQueries({ queryKey: ['settings', 'email'] });
    },
    onError: () => {
      toast.error('Error al actualizar la configuracion de email');
    },
  });

  // Users query & mutations (admin only)
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: user?.role === 'admin',
  });

  const createUserMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => usersApi.create(data),
    onSuccess: () => {
      toast.success('Usuario creado');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreateUserModal(false);
      setUserForm({ first_name: '', last_name: '', email: '', password: '', role: 'member', sender_email: '', sender_name: '' });
    },
    onError: () => toast.error('Error al crear usuario'),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => usersApi.update(id, data),
    onSuccess: () => {
      toast.success('Usuario actualizado');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
    },
    onError: () => toast.error('Error al actualizar usuario'),
  });

  const deactivateUserMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => {
      toast.success('Usuario desactivado');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Error al desactivar usuario'),
  });

  const teamUsers = usersData?.data?.data?.users || [];

  const emailSettings = emailData?.data?.data;
  const apiKeys = apiKeysData?.data?.data?.keys || apiKeysData?.data?.data || [];
  const scoringRules = scoringData?.data?.data?.rules || scoringData?.data?.data || [];

  // Initialize email form when data loads
  if (emailSettings && !emailFormInitialized) {
    setEmailForm({
      from_email: emailSettings.from_email || '',
      from_name: emailSettings.from_name || '',
      reply_to: emailSettings.reply_to || '',
      notification_email: emailSettings.notification_email || '',
      imap_host: emailSettings.imap_host || '',
      imap_port: String(emailSettings.imap_port || 993),
      imap_user: emailSettings.imap_user || '',
    });
    setEmailFormInitialized(true);
  }

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

      <Tabs
        tabs={[
          { id: 'profile', label: 'Perfil', icon: <User className="h-4 w-4" /> },
          ...(user?.role === 'admin' ? [{ id: 'team', label: 'Equipo', icon: <Users className="h-4 w-4" /> }] : []),
          { id: 'email', label: 'Email', icon: <Mail className="h-4 w-4" /> },
          { id: 'api-keys', label: 'Claves API', icon: <Key className="h-4 w-4" /> },
          { id: 'scoring', label: 'Scoring', icon: <Target className="h-4 w-4" /> },
        ]}
        defaultTab="profile"
      >
        {(activeTab) => (
          <>
            {/* Profile Tab */}
            {activeTab === 'profile' && (
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
                      value={profileForm.first_name}
                      onChange={(e) => setProfileForm((f) => ({ ...f, first_name: e.target.value }))}
                      icon={<User className="h-4 w-4" />}
                    />
                    <Input
                      label="Apellido"
                      value={profileForm.last_name}
                      onChange={(e) => setProfileForm((f) => ({ ...f, last_name: e.target.value }))}
                    />
                    <Input
                      label="Correo Electronico"
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
                      icon={<Mail className="h-4 w-4" />}
                    />

                    <hr className="my-4 border-slate-200" />
                    <h3 className="text-sm font-semibold text-slate-700 mb-1">Remitente de Emails</h3>
                    <p className="text-xs text-slate-500 mb-3">Estos datos se usaran como remitente cuando envies emails desde la plataforma.</p>

                    <Input
                      label="Email de Remitente"
                      type="email"
                      value={profileForm.sender_email}
                      onChange={(e) => setProfileForm((f) => ({ ...f, sender_email: e.target.value }))}
                      icon={<Send className="h-4 w-4" />}
                      placeholder="tu@tecnocim.com"
                    />
                    <Input
                      label="Nombre de Remitente"
                      value={profileForm.sender_name}
                      onChange={(e) => setProfileForm((f) => ({ ...f, sender_name: e.target.value }))}
                      placeholder="Tu Nombre Completo"
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
            )}

            {/* Team Tab (admin only) */}
            {activeTab === 'team' && user?.role === 'admin' && (
              <Card padding="none">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-primary-600" />
                      <h2 className="text-lg font-semibold text-slate-900">Equipo</h2>
                    </div>
                    <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => {
                      setUserForm({ first_name: '', last_name: '', email: '', password: '', role: 'member', sender_email: '', sender_name: '' });
                      setShowCreateUserModal(true);
                    }}>
                      Nuevo Usuario
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell isHeader>Nombre</TableCell>
                        <TableCell isHeader>Email</TableCell>
                        <TableCell isHeader>Rol</TableCell>
                        <TableCell isHeader>Email Remitente</TableCell>
                        <TableCell isHeader>Estado</TableCell>
                        <TableCell isHeader>Acciones</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {teamUsers.map((u: any) => (
                        <TableRow key={u.id}>
                          <TableCell>{u.first_name} {u.last_name}</TableCell>
                          <TableCell>{u.email}</TableCell>
                          <TableCell><Badge variant={u.role === 'admin' ? 'info' : 'default'}>{u.role}</Badge></TableCell>
                          <TableCell className="text-sm text-slate-500">{u.sender_email || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={u.is_active ? 'success' : 'danger'}>{u.is_active ? 'Activo' : 'Inactivo'}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <button
                                className="p-1 text-slate-400 hover:text-primary-600 rounded"
                                aria-label="Editar usuario"
                                onClick={() => {
                                  setEditingUser(u);
                                  setUserForm({
                                    first_name: u.first_name, last_name: u.last_name, email: u.email, password: '',
                                    role: u.role, sender_email: u.sender_email || '', sender_name: u.sender_name || '',
                                  });
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                              {u.id !== user?.id && u.is_active && (
                                <button
                                  className="p-1 text-slate-400 hover:text-red-600 rounded"
                                  aria-label="Desactivar usuario"
                                  onClick={() => {
                                    confirm({
                                      title: 'Desactivar usuario',
                                      description: `Desactivar a ${u.first_name} ${u.last_name}?`,
                                      onConfirm: () => deactivateUserMutation.mutate(u.id),
                                    });
                                  }}
                                >
                                  <XCircle className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Create/Edit User Modal */}
            <Modal
              isOpen={showCreateUserModal || !!editingUser}
              onClose={() => { setShowCreateUserModal(false); setEditingUser(null); }}
              title={editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editingUser) {
                    const { password, ...data } = userForm;
                    updateUserMutation.mutate({ id: editingUser.id, data });
                  } else {
                    createUserMutation.mutate(userForm);
                  }
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Nombre" value={userForm.first_name} onChange={(e) => setUserForm(f => ({ ...f, first_name: e.target.value }))} required />
                  <Input label="Apellido" value={userForm.last_name} onChange={(e) => setUserForm(f => ({ ...f, last_name: e.target.value }))} required />
                </div>
                <Input label="Email" type="email" value={userForm.email} onChange={(e) => setUserForm(f => ({ ...f, email: e.target.value }))} required />
                {!editingUser && (
                  <Input label="Contrasena" type="password" value={userForm.password} onChange={(e) => setUserForm(f => ({ ...f, password: e.target.value }))} required />
                )}
                <Select
                  label="Rol"
                  value={userForm.role}
                  onChange={(val) => setUserForm(f => ({ ...f, role: val }))}
                  options={[
                    { value: 'admin', label: 'Admin' },
                    { value: 'manager', label: 'Manager' },
                    { value: 'member', label: 'Miembro' },
                    { value: 'viewer', label: 'Visor' },
                  ]}
                />
                <hr className="border-slate-200" />
                <p className="text-sm font-medium text-slate-700">Remitente de Emails</p>
                <Input label="Email de Remitente" type="email" value={userForm.sender_email} onChange={(e) => setUserForm(f => ({ ...f, sender_email: e.target.value }))} placeholder="usuario@tecnocim.com" />
                <Input label="Nombre de Remitente" value={userForm.sender_name} onChange={(e) => setUserForm(f => ({ ...f, sender_name: e.target.value }))} placeholder="Nombre Apellido" />
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="secondary" type="button" onClick={() => { setShowCreateUserModal(false); setEditingUser(null); }}>Cancelar</Button>
                  <Button type="submit" loading={createUserMutation.isPending || updateUserMutation.isPending}>
                    {editingUser ? 'Guardar' : 'Crear Usuario'}
                  </Button>
                </div>
              </form>
            </Modal>

            {/* Email Tab */}
            {activeTab === 'email' && (
              <Card padding="none">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Mail className="h-5 w-5 text-primary-600" />
                    <h2 className="text-lg font-semibold text-slate-900">Configuracion de Email</h2>
                    {emailSettings?.is_configured ? (
                      <Badge variant="success">
                        <CheckCircle className="h-3 w-3 mr-1" /> Configurado
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <XCircle className="h-3 w-3 mr-1" /> Sin configurar
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      updateEmailMutation.mutate(emailForm);
                    }}
                    className="space-y-4 max-w-2xl"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Email del Remitente"
                        type="email"
                        value={emailForm.from_email || ''}
                        onChange={(e) => setEmailForm((f) => ({ ...f, from_email: e.target.value }))}
                        placeholder="noreply@tudominio.com"
                      />
                      <Input
                        label="Nombre del Remitente"
                        value={emailForm.from_name || ''}
                        onChange={(e) => setEmailForm((f) => ({ ...f, from_name: e.target.value }))}
                        placeholder="Mi Empresa"
                      />
                      <Input
                        label="Responder a (Reply-To)"
                        type="email"
                        value={emailForm.reply_to || ''}
                        onChange={(e) => setEmailForm((f) => ({ ...f, reply_to: e.target.value }))}
                        placeholder="contacto@tudominio.com"
                      />
                      <Input
                        label="Email de Notificaciones"
                        type="email"
                        value={emailForm.notification_email || ''}
                        onChange={(e) => setEmailForm((f) => ({ ...f, notification_email: e.target.value }))}
                        placeholder="admin@tudominio.com"
                        helperText="Recibe resumen de envios programados"
                      />
                    </div>

                    <hr className="border-slate-200" />
                    <h3 className="text-sm font-semibold text-slate-700">IMAP (Deteccion de Respuestas)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Servidor IMAP"
                        value={emailForm.imap_host || ''}
                        onChange={(e) => setEmailForm((f) => ({ ...f, imap_host: e.target.value }))}
                        placeholder="imap.tudominio.com"
                      />
                      <Input
                        label="Puerto IMAP"
                        type="number"
                        value={emailForm.imap_port || '993'}
                        onChange={(e) => setEmailForm((f) => ({ ...f, imap_port: e.target.value }))}
                      />
                      <Input
                        label="Usuario IMAP"
                        value={emailForm.imap_user || ''}
                        onChange={(e) => setEmailForm((f) => ({ ...f, imap_user: e.target.value }))}
                        placeholder="user@tudominio.com"
                      />
                      <Input
                        label="Contrasena IMAP"
                        type="password"
                        value={emailForm.imap_pass || ''}
                        onChange={(e) => setEmailForm((f) => ({ ...f, imap_pass: e.target.value }))}
                        placeholder="Dejar vacio para no cambiar"
                      />
                    </div>
                    {emailSettings?.imap_configured && (
                      <Badge variant="success">
                        <CheckCircle className="h-3 w-3 mr-1" /> IMAP configurado
                      </Badge>
                    )}

                    <Button
                      type="submit"
                      loading={updateEmailMutation.isPending}
                      icon={<Save className="h-4 w-4" />}
                    >
                      Guardar Configuracion de Email
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* API Keys Tab */}
            {activeTab === 'api-keys' && (
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
            )}

            {/* Scoring Tab */}
            {activeTab === 'scoring' && (
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
                                    aria-label="Editar regla"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      confirm({
                                        title: 'Eliminar regla de scoring?',
                                        description: 'Los scores de los prospectos se recalcularan sin esta regla.',
                                        confirmLabel: 'Eliminar',
                                        onConfirm: () => deleteRuleMutation.mutate(ruleId),
                                      });
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                    aria-label="Eliminar regla"
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
            )}
          </>
        )}
      </Tabs>

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

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
