import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/stores/authStore';

export function Layout() {
  const tenant = useAuthStore((s) => s.tenant);

  // Apply tenant colors as CSS custom properties for theming
  const tenantStyle: React.CSSProperties | undefined = tenant?.primary_color
    ? {
        '--tenant-primary': tenant.primary_color,
        '--tenant-secondary': tenant.secondary_color || '#6366f1',
      } as React.CSSProperties
    : undefined;

  return (
    <div className="min-h-screen bg-slate-50" style={tenantStyle}>
      <Sidebar />
      <div className="pl-64">
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
