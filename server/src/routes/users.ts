import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticate, requireRole, hashPassword } from '../middleware/auth';

const router = Router();
router.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  role: z.enum(['admin', 'manager', 'member', 'viewer']).default('member'),
  sender_email: z.string().email().optional(),
  sender_name: z.string().optional(),
});

const updateUserSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'manager', 'member', 'viewer']).optional(),
  sender_email: z.string().email().nullable().optional(),
  sender_name: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

// --- GET / - List all users for tenant (admin only) ---
router.get('/', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await query<any[]>(
      `SELECT id, email, first_name, last_name, role, sender_email, sender_name,
              is_active, last_login, created_at
       FROM users WHERE tenant_id = ? ORDER BY created_at DESC`,
      [req.user!.tenantId]
    );
    res.json({ success: true, data: { users } });
  } catch (error: any) {
    console.error('List users error:', error);
    res.status(500).json({ success: false, error: 'Error listing users.' });
  }
});

// --- POST / - Create user (admin only) ---
router.post('/', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = createUserSchema.parse(req.body);

    const existing = await query<any[]>(
      'SELECT id FROM users WHERE email = ? AND tenant_id = ?',
      [data.email, req.user!.tenantId]
    );
    if (existing.length > 0) {
      res.status(409).json({ success: false, error: 'A user with this email already exists.' });
      return;
    }

    const id = uuidv4();
    const hashedPassword = await hashPassword(data.password);

    await query(
      `INSERT INTO users (id, tenant_id, email, password, first_name, last_name, role, sender_email, sender_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user!.tenantId, data.email, hashedPassword, data.first_name, data.last_name,
       data.role, data.sender_email || null, data.sender_name || null]
    );

    res.status(201).json({
      success: true,
      data: {
        id, email: data.email, first_name: data.first_name, last_name: data.last_name,
        role: data.role, sender_email: data.sender_email || null, sender_name: data.sender_name || null,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Create user error:', error);
    res.status(500).json({ success: false, error: 'Error creating user.' });
  }
});

// --- PUT /:id - Update user (admin only) ---
router.put('/:id', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);

    const existing = await query<any[]>(
      'SELECT id FROM users WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
    );
    if (existing.length === 0) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update.' });
      return;
    }

    params.push(id, req.user!.tenantId);
    await query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`, params);

    const updated = await query<any[]>(
      `SELECT id, email, first_name, last_name, role, sender_email, sender_name, is_active, last_login, created_at
       FROM users WHERE id = ? AND tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors[0].message });
      return;
    }
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: 'Error updating user.' });
  }
});

// --- DELETE /:id - Deactivate user (admin only) ---
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (id === req.user!.id) {
      res.status(400).json({ success: false, error: 'Cannot deactivate yourself.' });
      return;
    }

    const existing = await query<any[]>(
      'SELECT id FROM users WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
    );
    if (existing.length === 0) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }

    await query('UPDATE users SET is_active = FALSE WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ success: false, error: 'Error deactivating user.' });
  }
});

export default router;
