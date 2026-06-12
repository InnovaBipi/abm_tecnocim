import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, generateToken, comparePassword } from '../middleware/auth';
import { getTenantConfig, sanitizeTenantConfig } from '../middleware/tenant';

const router = Router();

// --- Validation Schemas ---

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// --- POST /register ---
// Public self-registration is DISABLED. The platform is invite-only: accounts are
// provisioned by a tenant admin via POST /api/users (requireRole('admin')). Leaving an
// open registration endpoint let anyone create a member account in any tenant by slug.
router.post('/register', async (_req: Request, res: Response): Promise<void> => {
  res.status(403).json({
    success: false,
    error: 'Public registration is disabled. Contact your administrator to request access.',
  });
});

// --- POST /login ---
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = validation.data;

    // Find user by email, JOIN with tenant
    const users = await query<any[]>(
      `SELECT u.id, u.email, u.password, u.first_name, u.last_name, u.role,
              u.is_active, u.tenant_id,
              t.name as tenant_name, t.slug as tenant_slug, t.logo_url as tenant_logo_url,
              t.primary_color as tenant_primary_color, t.secondary_color as tenant_secondary_color,
              t.config as tenant_config, t.is_active as tenant_is_active
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = ? AND t.is_active = TRUE`,
      [email]
    );

    if (users.length === 0) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
      return;
    }

    // If user exists in multiple tenants, check if tenant_slug was provided to disambiguate
    let user: any;
    if (users.length > 1) {
      const tenantSlug = req.body.tenant_slug;
      if (tenantSlug) {
        user = users.find((u: any) => u.tenant_slug === tenantSlug);
        if (!user) {
          res.status(401).json({
            success: false,
            error: 'Invalid email or password.',
          });
          return;
        }
      } else {
        // Do NOT reveal which tenants an email belongs to before authentication —
        // that would leak tenant membership to anyone who knows the email. Verify
        // the password against every candidate tenant FIRST, then disambiguate.
        const matches: any[] = [];
        for (const candidate of users) {
          // eslint-disable-next-line no-await-in-loop
          const ok = await comparePassword(password, candidate.password);
          if (ok) {
            matches.push(candidate);
          }
        }

        if (matches.length === 0) {
          // Password invalid in all tenants — same generic error, no enumeration.
          res.status(401).json({
            success: false,
            error: 'Invalid email or password.',
          });
          return;
        }

        if (matches.length === 1) {
          // Authenticated against exactly one tenant — log straight in.
          user = matches[0];
        } else {
          // Authenticated against multiple tenants (same email+password reused).
          // Now it's safe to ask the user to choose — they've proven they own
          // the credentials for these tenants.
          res.status(409).json({
            success: false,
            error: 'multiple_tenants',
            tenants: matches.map((u: any) => ({
              slug: u.tenant_slug,
              name: u.tenant_name,
              logo_url: u.tenant_logo_url,
            })),
          });
          return;
        }
      }
    } else {
      user = users[0];
    }

    if (!user.is_active) {
      res.status(403).json({
        success: false,
        error: 'Account is deactivated. Please contact an administrator.',
      });
      return;
    }

    if (!user.tenant_is_active) {
      res.status(403).json({
        success: false,
        error: 'Tenant is deactivated. Please contact support.',
      });
      return;
    }

    // Verify password
    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
      return;
    }

    // Update last login (non-critical, don't let it break login)
    try {
      await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    } catch (lastLoginErr) {
      console.error('Failed to update last_login (non-critical):', lastLoginErr);
    }

    // Generate JWT with tenantId
    const token = generateToken(user.id, user.email, user.role, user.tenant_id);

    // Parse tenant config defensively
    let tenantConfig: any = {};
    try {
      tenantConfig = typeof user.tenant_config === 'string'
        ? JSON.parse(user.tenant_config)
        : (user.tenant_config || {});
    } catch (parseErr) {
      console.error('Failed to parse tenant_config for tenant', user.tenant_slug, ':', parseErr);
      tenantConfig = {};
    }

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          sender_email: user.sender_email ?? null,
          sender_name: user.sender_name ?? null,
        },
        tenant: {
          id: user.tenant_id,
          name: user.tenant_name,
          slug: user.tenant_slug,
          logo_url: user.tenant_logo_url,
          primary_color: user.tenant_primary_color,
          secondary_color: user.tenant_secondary_color,
          config: sanitizeTenantConfig(tenantConfig),
        },
      },
    });
  } catch (error: any) {
    console.error('Login error:', error?.message, error?.stack);
    res.status(500).json({
      success: false,
      error: 'An error occurred during login.',
      debug: process.env.NODE_ENV !== 'production' ? error?.message : undefined,
    });
  }
});

// --- GET /me ---
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await query<any[]>(
      'SELECT * FROM users WHERE id = ? AND tenant_id = ?',
      [req.user!.id, req.user!.tenantId]
    );

    if (users.length === 0) {
      res.status(404).json({
        success: false,
        error: 'User not found.',
      });
      return;
    }

    // Get full tenant info
    const tenant = await getTenantConfig(req.user!.tenantId);

    const u = users[0];
    res.json({
      success: true,
      data: {
        user: {
          id: u.id,
          email: u.email,
          first_name: u.first_name,
          last_name: u.last_name,
          role: u.role,
        },
        tenant: tenant ? {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          logo_url: tenant.logo_url,
          primary_color: tenant.primary_color,
          secondary_color: tenant.secondary_color,
          config: sanitizeTenantConfig(tenant.config),
        } : null,
      },
    });
  } catch (error: any) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching user info.',
    });
  }
});

export default router;
