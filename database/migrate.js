const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function migrate() {
  console.log('Connecting to DigitalOcean MySQL...');

  const connection = await mysql.createConnection({
    host: 'db-mysql-fra1-15909-do-user-33157620-0.i.db.ondigitalocean.com',
    port: 25060,
    user: 'doadmin',
    password: 'AVNS_fSJzmyNeigDEDse7XuJ',
    ssl: { rejectUnauthorized: false },
    multipleStatements: true,
  });

  console.log('Connected!');

  // Create and use the database
  await connection.query('CREATE DATABASE IF NOT EXISTS camiacasa_abm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.query('USE camiacasa_abm');
  console.log('Database camiacasa_abm ready.');

  // Drop all tables first for clean migration
  console.log('Dropping existing tables (clean slate)...');
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  const [tables] = await connection.query('SHOW TABLES');
  for (const t of tables) {
    const name = Object.values(t)[0];
    await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
    console.log(`  Dropped ${name}`);
  }
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');

  // Read and execute the full schema
  console.log('\nRunning schema migration...');
  let schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Remove CREATE DATABASE and USE (already done above)
  schema = schema.replace(/CREATE DATABASE.*?;/s, '');
  schema = schema.replace(/USE camiacasa_abm;/, '');

  // Execute entire schema as one multi-statement query
  await connection.query(schema);
  console.log('Schema executed successfully!');

  // Verify
  console.log('\nVerifying...');
  const [newTables] = await connection.query('SHOW TABLES');
  console.log(`Tables created: ${newTables.length}`);
  newTables.forEach(t => console.log(`  - ${Object.values(t)[0]}`));

  const [rules] = await connection.query('SELECT COUNT(*) as c FROM scoring_rules');
  console.log(`\nScoring rules: ${rules[0].c}`);

  const [users] = await connection.query('SELECT email, role FROM users');
  console.log(`Users: ${users.length}`);
  users.forEach(u => console.log(`  - ${u.email} (${u.role})`));

  await connection.end();
  console.log('\nMigration complete!');
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
