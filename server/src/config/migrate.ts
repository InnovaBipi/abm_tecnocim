import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { config } from './env';

/**
 * Migration runner: applies schema.sql and all numbered migration-NNN-*.sql files.
 * Tracks applied migrations in a _migrations table to avoid re-running.
 */
async function runMigration(): Promise<void> {
  const dbDir = path.resolve(__dirname, '..', '..', '..', 'database');
  const schemaPath = path.join(dbDir, 'schema.sql');

  const connection = await mysql.createConnection({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    multipleStatements: true,
    ssl: config.DB_SSL ? { rejectUnauthorized: true } : undefined,
  });

  try {
    // 1. Apply schema.sql (idempotent via CREATE TABLE IF NOT EXISTS)
    if (fs.existsSync(schemaPath)) {
      console.log('Applying schema.sql...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
      await connection.query(schemaSql);
      console.log('schema.sql applied.');
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
        console.log(`  [skip] ${file} (already applied)`);
        continue;
      }

      console.log(`  [apply] ${file}...`);
      const sql = fs.readFileSync(path.join(dbDir, file), 'utf-8');

      try {
        await connection.query(sql);
        await connection.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
        console.log(`  [done] ${file}`);
      } catch (err: any) {
        // Handle "column already exists" or "table already exists" gracefully
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log(`  [warn] ${file}: ${err.message} (continuing)`);
          await connection.query('INSERT IGNORE INTO _migrations (name) VALUES (?)', [file]);
        } else {
          console.error(`  [FAIL] ${file}: ${err.message}`);
          throw err;
        }
      }
    }

    console.log('All migrations applied successfully.');
  } catch (error: any) {
    console.error('Migration failed:', error.message);
    if (error.code !== 'ER_TABLE_EXISTS_ERROR') {
      process.exit(1);
    }
  } finally {
    await connection.end();
  }
}

runMigration().catch((err) => {
  console.error('Unhandled migration error:', err);
  process.exit(1);
});
