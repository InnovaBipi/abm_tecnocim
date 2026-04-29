import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, type TenantOption } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Home, Mail, Lock, Building2, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[] | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error('Por favor, completa todos los campos');
      return;
    }

    // If tenant selection is shown, require a selection
    if (tenantOptions && !selectedTenant) {
      toast.error('Selecciona una cuenta para continuar');
      return;
    }

    setLoading(true);

    try {
      await login(email, password, selectedTenant || undefined);
      toast.success('Inicio de sesion exitoso');
      navigate(from, { replace: true });
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; tenants?: TenantOption[] } } };

      // Handle multiple tenants response
      if (err?.response?.data?.error === 'multiple_tenants' && err?.response?.data?.tenants) {
        setTenantOptions(err.response.data.tenants);
        setSelectedTenant(null);
        toast('Selecciona la cuenta a la que quieres acceder', { icon: '\u2139\uFE0F' });
      } else {
        const message = err?.response?.data?.error || 'Error al iniciar sesion. Verifica tus credenciales.';
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-primary-50/30 to-slate-100">
      <div className="w-full max-w-md mx-4">
        {/* Logo & branding */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Tecnocim" className="h-14 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-slate-900">Bienvenido de nuevo</h1>
          <p className="text-slate-500 mt-1">Accede para gestionar tus campañas de prospección</p>
        </div>

        {/* Login form */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-1">Iniciar Sesion</h2>
          <p className="text-sm text-slate-500 mb-6">Ingresa tus credenciales para acceder al sistema</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Correo Electronico"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setTenantOptions(null); setSelectedTenant(null); }}
              icon={<Mail className="h-4 w-4" />}
              autoComplete="email"
              autoFocus
              required
            />

            <div className="relative">
              <Input
                label="Contrasena"
                type={showPassword ? 'text' : 'password'}
                placeholder="Tu contrasena"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={<Lock className="h-4 w-4" />}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[34px] p-1 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
                onClick={() => toast('Contacta al administrador para restablecer tu contrasena')}
              >
                Olvidaste tu contrasena?
              </button>
            </div>

            {/* Tenant selection (shown when user has accounts in multiple tenants) */}
            {tenantOptions && (
              <div className="space-y-2 animate-in slide-in-from-top-2 fade-in duration-300">
                <label className="block text-sm font-medium text-slate-700">Selecciona tu cuenta</label>
                <div className="space-y-2">
                  {tenantOptions.map((t) => (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => setSelectedTenant(t.slug)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
                        selectedTenant === t.slug
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <Building2 className="h-5 w-5 text-slate-400 shrink-0" />
                      <span className="font-medium text-slate-900">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={loading}
            >
              {tenantOptions ? 'Acceder' : 'Iniciar Sesion'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Tecnocim &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
