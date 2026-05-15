import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import rateLimit from 'express-rate-limit';

import { config } from './config/env';
import { logger } from './config/logger';
import { testConnection } from './config/database';
import pool from './config/database';
import { startScheduler } from './jobs/scheduler';
import { authenticate } from './middleware/auth';

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
    logger.error('CRITICAL: JWT_SECRET must be changed from default in production!');
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
    const fs = require('fs');
    const dbPaths = [
      path.resolve(__dirname, '..', '..', '..', 'database'),  // dev: dist -> root/database
      path.resolve(__dirname, '..', '..', 'database'),         // prod: dist -> server/database
      path.resolve(__dirname, '..', 'database'),               // prod alt: dist -> dist/database (cp in build)
      path.resolve(__dirname, 'database'),                     // prod alt2: dist/database direct
    ];
    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: config.NODE_ENV,
        version: '1.0.1',
        migrate: {
          __dirname,
          paths: dbPaths.map(p => ({ path: p, exists: fs.existsSync(p) })),
        },
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

  // Admin: run pending migrations on-demand
  app.post('/api/admin/migrate', authenticate, async (req, res) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Admin role required' });
      return;
    }
    try {
      const { runMigrations } = await import('./config/migrate');
      await runMigrations();
      res.json({ success: true, data: { message: 'Migrations applied via files' } });
    } catch (fileErr: any) {
      logger.warn('File-based migration failed, trying inline fallback', { error: fileErr.message });
      // Inline fallback for when database/ directory is unavailable at runtime
      try {
        const { query: dbQuery } = await import('./config/database');
        const statements = [
          'CREATE INDEX idx_event_tenant_type ON email_events (tenant_id, event_type)',
          'CREATE INDEX idx_ge_tenant_status ON generated_emails (tenant_id, status)',
          'CREATE INDEX idx_ge_tenant_status_scheduled ON generated_emails (tenant_id, status, scheduled_for)',
          'CREATE INDEX idx_enrollment_tenant_status ON sequence_enrollments (tenant_id, status)',
          'CREATE INDEX idx_activity_tenant_prospect ON prospect_activities (tenant_id, prospect_id, occurred_at DESC)',
        ];
        const results: string[] = [];
        for (const sql of statements) {
          try {
            await dbQuery(sql);
            results.push('OK: ' + sql.substring(0, 60));
          } catch (e: any) {
            if (e.code === 'ER_DUP_KEYNAME') {
              results.push('SKIP: index already exists');
            } else {
              results.push('ERR: ' + (e.code || '') + ' ' + e.message?.substring(0, 80));
            }
          }
        }
        res.json({ success: true, data: { message: 'Inline migration-008 applied', results } });
      } catch (inlineErr: any) {
        logger.error('Inline migration also failed', { error: inlineErr.message });
        res.status(500).json({ success: false, error: 'Migration failed: ' + fileErr.message });
      }
    }
  });

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
    logger.error('Unhandled error', { message: err.message, stack: err.stack });

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
    logger.warn('Could not connect to the database. The server will start but database operations will fail.');
    logger.warn('Make sure your .env file is configured correctly and the MySQL server is running.');
  }

  // --- Auto-run pending database migrations ---
  if (dbConnected) {
    try {
      const { runMigrations } = await import('./config/migrate');
      await runMigrations();
    } catch (error: any) {
      logger.warn('Migration check failed', { error: error.message });
    }
  }

  // --- Start scheduler ---
  try {
    startScheduler();
  } catch (error: any) {
    logger.warn('Scheduler failed to start', { error: error.message });
  }

  // --- Start server ---
  const server = app.listen(config.PORT, () => {
    logger.info('ABM Platform Server started', {
      environment: config.NODE_ENV,
      port: config.PORT,
      dbConnected,
    });
    logger.debug('Server details', {
      frontend: config.FRONTEND_URL,
      dbHost: config.DB_HOST,
      dbPort: config.DB_PORT,
      dbName: config.DB_NAME,
    });
  });

  // --- Graceful shutdown ---
  const shutdown = (signal: string) => {
    logger.info('Shutting down gracefully', { signal });
    server.close(() => {
      logger.info('HTTP server closed');
      pool.end().then(() => {
        logger.info('Database pool closed');
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after 30s timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start the application
main().catch((error) => {
  logger.error('Failed to start server', { error: error.message || String(error) });
  process.exit(1);
});
