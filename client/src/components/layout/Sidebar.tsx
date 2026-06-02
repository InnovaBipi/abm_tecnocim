import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  LayoutDashboard,
  Users,
  Building2,
  Building,
  Send,
  Upload,
  Settings,
  LogOut,
} from 'lucide-react';

export function Sidebar() {
  const location = useLocation();
  const { user, tenant, logout } = useAuthStore();

  const entityLabel = tenant?.config?.entity?.type_label_plural || 'Propiedades';
  const appName = tenant?.config?.branding?.app_name || tenant?.name || 'Tecnocim Innova';
  const tagline = tenant?.config?.branding?.tagline || 'Prospecting';
  const logoUrl = tenant?.logo_url || '/logo.png';

  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/prospects', label: 'Prospectos', icon: Users },
    { to: '/companies', label: 'Empresas', icon: Building2 },
    { to: '/campaigns', label: entityLabel, icon: Building },
    { to: '/outbox', label: 'Bandeja de Salida', icon: Send },
    { to: '/imports', label: 'Importar', icon: Upload },
    { to: '/settings', label: 'Configuración', icon: Settings },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-64 bg-slate-900 border-r border-slate-700 flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700">
        <img src={logoUrl} alt={appName} className="h-9 w-auto max-w-[140px] object-contain" />
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">{appName}</h1>
          <p className="text-xs text-slate-400 -mt-0.5">{tagline}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'sidebar-link',
                active ? 'sidebar-link-active' : 'sidebar-link-inactive'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-white' : 'text-slate-400')} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* User info & logout */}
      <div className="px-3 py-4 border-t border-slate-700">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-600 text-white text-sm font-semibold">
            {user?.first_name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Usuario' : 'Usuario'}
            </p>
            <p className="text-xs text-slate-400 truncate">
              {user?.email || ''}
            </p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-white/5 transition-colors"
            title="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
