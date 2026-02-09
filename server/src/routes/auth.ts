import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, generateToken, hashPassword, comparePassword } from '../middleware/auth';

const router = Router();

// --- Validation Schemas ---

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
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

    const { email, password, first_name, last_name } = validation.data;

    // Check if user already exists
    const existing = await query<any[]>(
      'SELECT id FROM users WHERE email = ?',
      [email]
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
      `INSERT INTO users (id, email, password, first_name, last_name, role)
       VALUES (?, ?, ?, ?, ?, 'member')`,
      [userId, email, hashedPassword, first_name, last_name]
    );

    // Generate JWT
    const token = generateToken(userId, email, 'member');

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

    // Find user by email
    const users = await query<any[]>(
      'SELECT id, email, password, first_name, last_name, role, is_active FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
      return;
    }

    const user = users[0];

    if (!user.is_active) {
      res.status(403).json({
        success: false,
        error: 'Account is deactivated. Please contact an administrator.',
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

    // Generate JWT
    const token = generateToken(user.id, user.email, user.role);

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
      'SELECT id, email, first_name, last_name, role, is_active, last_login, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    if (users.length === 0) {
      res.status(404).json({
        success: false,
        error: 'User not found.',
      });
      return;
    }

    res.json({
      success: true,
      data: users[0],
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
