import { query } from '../config/database';

export interface TenantConfig {
  email: {
    resend_api_key: string;
    from_email: string;
    from_name: string;
    reply_to: string;
    notification_email: string;
    webhook_secret?: string;
  };
  imap: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
  entity: {
    type_label: string;
    type_label_plural: string;
    icon: string;
    fields: Array<{
      key: string;
      label: string;
      type: string;
    }>;
  };
  ai: {
    company_description: string;
    sender_name: string;
    industry_context: string;
    contact_email?: string;
    contact_phone?: string;
    perplexity_system?: string;
    email_style?: string;
    key_differentiators?: string;
    default_language?: 'spanish' | 'catalan' | 'english';
  };
  legal: {
    legal_name: string;
    cif: string;
    address: string;
    privacy_url?: string;
    data_source?: string;
  };
  branding: {
    app_name: string;
    tagline: string;
    footer_html: string;
  };
  warmup: {
    daily_limit_base: number;
    daily_limit_max: number;
    ramp_up_days: number;
  };
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  config: TenantConfig;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// In-memory cache with TTL
const tenantCache = new Map<string, { tenant: Tenant; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get tenant configuration by ID. Results are cached for 5 minutes.
 */
export async function getTenantConfig(tenantId: string): Promise<Tenant | null> {
  // Check cache
  const cached = tenantCache.get(tenantId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tenant;
  }

  const rows = await query<any[]>(
    'SELECT * FROM tenants WHERE id = ? AND is_active = TRUE',
    [tenantId]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const tenant: Tenant = {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
  };

  tenantCache.set(tenantId, { tenant, cachedAt: Date.now() });
  return tenant;
}

/**
 * Get all active tenants.
 */
export async function getAllActiveTenants(): Promise<Tenant[]> {
  const rows = await query<any[]>(
    'SELECT * FROM tenants WHERE is_active = TRUE'
  );

  return rows.map((row: any) => ({
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
  }));
}

/**
 * Get tenant by slug.
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const rows = await query<any[]>(
    'SELECT * FROM tenants WHERE slug = ? AND is_active = TRUE',
    [slug]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
  };
}

/**
 * Clear the tenant config cache (call after settings changes).
 */
export function clearTenantCache(tenantId?: string): void {
  if (tenantId) {
    tenantCache.delete(tenantId);
  } else {
    tenantCache.clear();
  }
}

/**
 * Build a TenantAIContext object from a Tenant for use in AI email generation.
 * Import TenantAIContext from '../services/ai' at the call site.
 */
export function buildTenantAIContext(tenant: Tenant): {
  company_name: string;
  sender_name: string;
  company_description: string;
  industry_context: string;
  contact_email?: string;
  contact_phone?: string;
  entity_label?: string;
  entity_label_plural?: string;
  email_style?: string;
  key_differentiators?: string;
  default_language?: 'spanish' | 'catalan' | 'english';
} {
  const ai = tenant.config.ai || {} as any;
  const entity = tenant.config.entity || {} as any;
  return {
    company_name: tenant.name,
    sender_name: ai.sender_name || tenant.name,
    company_description: ai.company_description || tenant.name,
    industry_context: ai.industry_context || 'business services',
    contact_email: ai.contact_email || tenant.config.email?.reply_to,
    contact_phone: ai.contact_phone,
    entity_label: entity.type_label?.toLowerCase(),
    entity_label_plural: entity.type_label_plural?.toLowerCase(),
    email_style: ai.email_style,
    key_differentiators: ai.key_differentiators,
    default_language: ai.default_language,
  };
}
