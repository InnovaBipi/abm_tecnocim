import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, generateToken, hashPassword, comparePassword } from '../middleware/auth';
import { getTenantConfig, getTenantBySlug } from '../middleware/tenant';

const router = Router();

// --- Validation Schemas ---

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  tenant_slug: z.string().min(1, 'Tenant slug is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// --- POST /register ---
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, first_name, last_name, tenant_slug } = validation.data;

    // Resolve tenant by slug
    const tenant = await getTenantBySlug(tenant_slug);
    if (!tenant) {
      res.status(400).json({
        success: false,
        error: 'Invalid tenant.',
      });
      return;
    }

    // Check if user already exists in this tenant
    const existing = await query<any[]>(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ?',
      [email, tenant.id]
    );

    if (existing.length > 0) {
      res.status(409).json({
        success: false,
        error: 'An account with this email already exists.',
      });
      return;
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const userId = uuidv4();

    await query(
      `INSERT INTO users (id, tenant_id, email, password, first_name, last_name, role)
       VALUES (?, ?, ?, ?, ?, ?, 'member')`,
      [userId, tenant.id, email, hashedPassword, first_name, last_name]
    );

    // Generate JWT with tenantId
    const token = generateToken(userId, email, 'member', tenant.id);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: userId,
          email,
          first_name,
          last_name,
          role: 'member',
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          logo_url: tenant.logo_url,
          primary_color: tenant.primary_color,
          secondary_color: tenant.secondary_color,
          config: tenant.config,
        },
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred during registration.',
    });
  }
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
        // Return list of available tenants so frontend can ask user to choose
        // Don't verify password yet — just signal that disambiguation is needed
        res.status(409).json({
          success: false,
          error: 'multiple_tenants',
          tenants: users.map((u: any) => ({
            slug: u.tenant_slug,
            name: u.tenant_name,
            logo_url: u.tenant_logo_url,
          })),
        });
        return;
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

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Generate JWT with tenantId
    const token = generateToken(user.id, user.email, user.role, user.tenant_id);

    const tenantConfig = typeof user.tenant_config === 'string'
      ? JSON.parse(user.tenant_config)
      : user.tenant_config;

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
          sender_email: user.sender_email,
          sender_name: user.sender_name,
        },
        tenant: {
          id: user.tenant_id,
          name: user.tenant_name,
          slug: user.tenant_slug,
          logo_url: user.tenant_logo_url,
          primary_color: user.tenant_primary_color,
          secondary_color: user.tenant_secondary_color,
          config: tenantConfig,
        },
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred during login.',
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
          config: tenant.config,
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
