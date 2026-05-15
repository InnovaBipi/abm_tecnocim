/**
 * One-time script to manually apply migration-008 performance indexes
 * to the production database.
 *
 * Usage:
 *   node scripts/apply-migration-008.js
 *
 * Requires the same environment variables as the server:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD (or DB_PASS), DB_NAME, DB_SSL
 *
 * You can also run it with a .env file:
 *   node -e "require('dotenv').config({path:'server/.env'})" -e "" && node scripts/apply-migration-008.js
 *
 * Or inline:
 *   DB_HOST=... DB_PORT=... DB_USER=... DB_PASSWORD=... DB_NAME=abm_tecnocim DB_SSL=true node scripts/apply-migration-008.js
 */

const mysql = require('mysql2/promise');
const path = require('path');

// Try to load dotenv from server/.env if available
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', 'server', '.env') });
} catch (_) {
  // dotenv not installed at root level — env vars must be set externally
}

const indexes = [
  {
    name: 'idx_event_tenant_type',
    sql: 'CREATE INDEX idx_event_tenant_type ON email_events (tenant_id, event_type)',
  },
  {
    name: 'idx_ge_tenant_status',
    sql: 'CREATE INDEX idx_ge_tenant_status ON generated_emails (tenant_id, status)',
  },
  {
    name: 'idx_ge_tenant_status_scheduled',
    sql: 'CREATE INDEX idx_ge_tenant_status_scheduled ON generated_emails (tenant_id, status, scheduled_for)',
  },
  {
    name: 'idx_enrollment_tenant_status',
    sql: 'CREATE INDEX idx_enrollment_tenant_status ON sequence_enrollments (tenant_id, status)',
  },
  {
    name: 'idx_activity_tenant_prospect',
    sql: 'CREATE INDEX idx_activity_tenant_prospect ON prospect_activities (tenant_id, prospect_id, occurred_at DESC)',
  },
];

async function main() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'abm_tecnocim',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };

  console.log(`Connecting to ${config.host}:${config.port}/${config.database} as ${config.user}...`);

  const connection = await mysql.createConnection(config);

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const idx of indexes) {
    try {
      console.log(`  Creating index: ${idx.name} ...`);
      await connection.query(idx.sql);
      console.log(`    OK - created`);
      applied++;
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log(`    SKIP - already exists`);
        skipped++;
      } else {
        console.error(`    FAIL - ${err.message}`);
        failed++;
      }
    }
  }

  // Mark migration as applied in _migrations table so the file-based
  // migration runner won't try to re-apply it on next deploy.
  const migrationName = 'migration-008-performance-indexes.sql';
  try {
    await connection.query(
      'INSERT IGNORE INTO _migrations (name) VALUES (?)',
      [migrationName]
    );
    console.log(`\n  Recorded "${migrationName}" in _migrations table.`);
  } catch (err) {
    console.error(`  Warning: could not record migration in _migrations: ${err.message}`);
  }

  await connection.end();

  console.log(`\nDone. Applied: ${applied}, Skipped: ${skipped}, Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
