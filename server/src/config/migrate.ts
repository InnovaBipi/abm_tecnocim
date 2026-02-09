import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { config } from './env';

/**
 * Migration runner: reads schema.sql from the database/ directory
 * and executes it against the MySQL database.
 */
async function runMigration(): Promise<void> {
  const schemaPath = path.resolve(__dirname, '..', '..', '..', 'database', 'schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found at: ${schemaPath}`);
    process.exit(1);
  }

  console.log(`Reading schema from: ${schemaPath}`);
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

  // Create a connection (not pool) with multipleStatements enabled
  const connection = await mysql.createConnection({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    multipleStatements: true,
    ssl: config.DB_SSL ? { rejectUnauthorized: true } : undefined,
  });

  try {
    console.log('Running database migration...');
    await connection.query(schemaSql);
    console.log('Migration completed successfully.');
  } catch (error: any) {
    console.error('Migration failed:', error.message);
    // If error is about tables already existing, that may be OK
    if (error.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('Some tables already exist. This is expected if running migration again.');
    } else {
      process.exit(1);
    }
  } finally {
    await connection.end();
  }
}

// Run if executed directly
runMigration().catch((err) => {
  console.error('Unhandled migration error:', err);
  process.exit(1);
});
