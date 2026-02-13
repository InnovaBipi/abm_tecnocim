import mysql from 'mysql2/promise';
import { config } from './env';

const poolConfig: mysql.PoolOptions = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: config.NODE_ENV === 'production' ? 50 : 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

// Support SSL for production (e.g., DigitalOcean managed MySQL)
if (config.DB_SSL) {
  poolConfig.ssl = {
    rejectUnauthorized: false,
  };
}

const pool = mysql.createPool(poolConfig);

/**
 * Execute a SQL query against the connection pool.
 * @param sql - The SQL query string (use ? for parameter placeholders)
 * @param params - Array of parameter values to bind
 * @returns The query result rows and fields
 */
export async function query<T = any>(
  sql: string,
  params?: any[]
): Promise<T> {
  const [rows] = await pool.query(sql, params);
  return rows as T;
}

/**
 * Get a connection from the pool for transactions.
 */
export async function getConnection(): Promise<mysql.PoolConnection> {
  return pool.getConnection();
}

/**
 * Test the database connection.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await pool.execute('SELECT 1');
    console.log('Database connection successful.');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

export default pool;
