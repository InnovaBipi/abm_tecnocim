import { create } from 'zustand';
import { authApi } from '@/services/api';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface TenantConfig {
  email?: {
    from_email?: string;
    from_name?: string;
    reply_to?: string;
    notification_email?: string;
    resend_api_key?: string;
  };
  imap?: {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
  };
  entity?: {
    type_label?: string;
    type_label_plural?: string;
    icon?: string;
    fields?: Array<{ name: string; label: string; type: string }>;
  };
  ai?: {
    company_description?: string;
    sender_name?: string;
    industry_context?: string;
  };
  branding?: {
    app_name?: string;
    tagline?: string;
    footer_html?: string;
  };
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  config: TenantConfig;
}

export interface TenantOption {
  slug: string;
  name: string;
  logo_url?: string;
}

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, tenant_slug?: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

// Helper to safely parse JSON from localStorage
function loadFromStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: loadFromStorage<Tenant>('tenant'),
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),
  isLoading: false,

  login: async (email: string, password: string, tenant_slug?: string) => {
    const response = await authApi.login(email, password, tenant_slug);
    const { token, user, tenant } = response.data.data;

    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    if (tenant) {
      localStorage.setItem('tenant', JSON.stringify(tenant));
    }

    set({
      user,
      tenant: tenant || null,
      token,
      isAuthenticated: true,
    });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tenant');

    set({
      user: null,
      tenant: null,
      token: null,
      isAuthenticated: false,
    });

    window.location.href = '/login';
  },

  loadUser: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isAuthenticated: false, user: null, tenant: null, token: null, isLoading: false });
      return;
    }

    set({ isLoading: true });

    try {
      const response = await authApi.getMe();
      const { user, tenant } = response.data.data;

      localStorage.setItem('user', JSON.stringify(user));
      if (tenant) {
        localStorage.setItem('tenant', JSON.stringify(tenant));
      }

      set({
        user,
        tenant: tenant || loadFromStorage<Tenant>('tenant'),
        token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('tenant');

      set({
        user: null,
        tenant: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
}));
