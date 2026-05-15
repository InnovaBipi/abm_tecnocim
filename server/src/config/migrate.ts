import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { config } from './env';
import { logger } from './logger';

/**
 * Migration runner: applies schema.sql and all numbered migration-NNN-*.sql files.
 * Tracks applied migrations in a _migrations table to avoid re-running.
 *
 * Can be used in two ways:
 * 1. CLI: `npm run db:migrate` (runs directly via tsx)
 * 2. Server startup: import { runMigrations } and call before app.listen()
 */
export async function runMigrations(): Promise<void> {
  // Resolve database directory: works in both dev (../../../database) and prod (../../database)
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'database'),  // dev: server/src/config -> root/database
    path.resolve(__dirname, '..', '..', 'database'),         // prod: server/dist/config -> server/database
  ];
  const dbDir = candidates.find(d => fs.existsSync(d)) || candidates[0];
  const schemaPath = path.join(dbDir, 'schema.sql');

  const connection = await mysql.createConnection({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    multipleStatements: true,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // 1. Apply schema.sql (idempotent via CREATE TABLE IF NOT EXISTS)
    if (fs.existsSync(schemaPath)) {
      logger.debug('Applying schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
      await connection.query(schemaSql);
      logger.debug('schema.sql applied');
    }

    // 2. Ensure _migrations tracking table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Get list of already-applied migrations
    const [applied] = await connection.query<any[]>('SELECT name FROM _migrations');
    const appliedSet = new Set((applied || []).map((r: any) => r.name));

    // 4. Find and sort all migration-NNN-*.sql files
    const migrationFiles = fs.readdirSync(dbDir)
      .filter(f => /^migration-\d{3}-.+\.sql$/.test(f))
      .sort();

    // 5. Apply pending migrations in order
    for (const file of migrationFiles) {
      if (appliedSet.has(file)) {
        logger.debug('Migration already applied, skipping', { file });
        continue;
      }

      logger.info('Applying migration', { file });
      const sql = fs.readFileSync(path.join(dbDir, file), 'utf-8');

      try {
        await connection.query(sql);
        await connection.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
        logger.info('Migration applied', { file });
      } catch (err: any) {
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERROR') {
          logger.warn('Migration warning, continuing', { file, error: err.message });
          await connection.query('INSERT IGNORE INTO _migrations (name) VALUES (?)', [file]);
        } else {
          logger.error('Migration failed', { file, error: err.message });
          throw err;
        }
      }
    }

    logger.info('All migrations applied successfully');
  } catch (error: any) {
    logger.error('Migration failed', { error: error.message });
    if (error.code !== 'ER_TABLE_EXISTS_ERROR') {
      throw error;
    }
  } finally {
    await connection.end();
  }
}

// Run directly when executed via CLI (npm run db:migrate)
const isDirectExecution = require.main === module ||
  process.argv[1]?.includes('migrate');

if (isDirectExecution) {
  runMigrations().catch((err) => {
    logger.error('Unhandled migration error', { error: err.message || String(err) });
    process.exit(1);
  });
}
