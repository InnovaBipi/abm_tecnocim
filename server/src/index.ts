import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import rateLimit from 'express-rate-limit';

import { config } from './config/env';
import { testConnection } from './config/database';
import pool from './config/database';
import { startScheduler } from './jobs/scheduler';

// Import route handlers
import authRoutes from './routes/auth';
import prospectRoutes from './routes/prospects';
import companyRoutes from './routes/companies';
import campaignRoutes from './routes/campaigns';
import sequenceRoutes from './routes/sequences';
import importRoutes from './routes/imports';
import dashboardRoutes from './routes/dashboard';
import settingsRoutes from './routes/settings';
import outboxRoutes from './routes/outbox';
import usersRoutes from './routes/users';
import webhookRoutes from './routes/webhooks';
import unsubscribeRoutes from './routes/unsubscribe';

async function main(): Promise<void> {
  // --- Production safety checks ---
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.includes('change')) {
    console.error('CRITICAL: JWT_SECRET must be changed from default in production!');
    process.exit(1);
  }

  // Create Express app
  const app = express();

  // --- Global Middleware ---

  // Security headers
  app.use(helmet());

  // CORS - allow frontend origin
  app.use(cors({
    origin: config.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Request logging
  app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Body parsing (capture raw body for webhook signature verification)
  app.use(express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      if (req.originalUrl?.startsWith('/api/webhooks')) {
        req.rawBody = buf.toString('utf8');
      }
    },
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Static file serving for uploads
  app.use('/uploads', express.static(path.resolve(__dirname, '..', 'uploads')));

  // --- Health check ---
  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: config.NODE_ENV,
        version: '1.0.0',
      },
    });
  });

  // --- Rate limiters ---
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Massa intents. Espera 15 minuts.' },
  });

  const sendLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 200, // 200 email sends per hour per tenant
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => req.user?.tenantId || req.ip || 'anonymous',
    message: { success: false, error: 'Límit d\'enviaments assolit. Espera 1 hora.' },
  });

  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 uploads per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Massa pujades. Espera 1 hora.' },
  });

  // --- API Routes ---
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/prospects', prospectRoutes);
  app.use('/api/companies', companyRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/sequences', sequenceRoutes);
  app.use('/api/imports', uploadLimiter, importRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/outbox', outboxRoutes);
  app.use('/api/users', usersRoutes);

  // Email sending rate limit on specific send endpoint
  app.use('/api/outbox/send', sendLimiter);

  // Public routes (no auth, no rate limit on webhooks - Resend needs to reach us)
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/unsubscribe', unsubscribeRoutes);

  // --- 404 handler ---
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found.',
    });
  });

  // --- Global error handler ---
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);

    // Handle multer errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: 'File size exceeds the maximum limit of 50MB.',
      });
      return;
    }

    if (err.message === 'Only CSV and Excel files are allowed.') {
      res.status(400).json({
        success: false,
        error: err.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: config.NODE_ENV === 'production'
        ? 'An internal server error occurred.'
        : err.message,
    });
  });

  // --- Test database connection ---
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.warn('WARNING: Could not connect to the database. The server will start but database operations will fail.');
    console.warn('Make sure your .env file is configured correctly and the MySQL server is running.');
  }

  // --- Start scheduler ---
  try {
    startScheduler();
  } catch (error: any) {
    console.warn('WARNING: Scheduler failed to start:', error.message);
  }

  // --- Start server ---
  const server = app.listen(config.PORT, () => {
    console.log('');
    console.log('=========================================');
    console.log('  ABM Platform Server');
    console.log('=========================================');
    console.log(`  Environment: ${config.NODE_ENV}`);
    console.log(`  Port:        ${config.PORT}`);
    console.log(`  Frontend:    ${config.FRONTEND_URL}`);
    console.log(`  Database:    ${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}`);
    console.log(`  DB Connected: ${dbConnected ? 'Yes' : 'No'}`);
    console.log('=========================================');
    console.log('');
    console.log('API endpoints:');
    console.log('  GET  /api/health           - Health check');
    console.log('  POST /api/auth/register    - Register');
    console.log('  POST /api/auth/login       - Login');
    console.log('  CRUD /api/prospects        - Prospects');
    console.log('  CRUD /api/companies        - Companies');
    console.log('  CRUD /api/campaigns        - Campaigns');
    console.log('  CRUD /api/sequences        - Email sequences');
    console.log('  CRUD /api/outbox           - Outbox (generated emails)');
    console.log('  POST /api/webhooks/resend  - Resend webhook');
    console.log('  GET  /api/unsubscribe      - Unsubscribe link');
    console.log('');
  });

  // --- Graceful shutdown ---
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed.');
      pool.end().then(() => {
        console.log('Database pool closed.');
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      console.error('Forced shutdown after 30s timeout.');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start the application
main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
