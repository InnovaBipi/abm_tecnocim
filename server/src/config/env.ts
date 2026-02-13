import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (parent of server/)
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

export interface EnvConfig {
  // Server
  NODE_ENV: string;
  PORT: number;

  // Database
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  DB_SSL: boolean;

  // JWT
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;

  // Resend (Email)
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  EMAIL_FROM: string;
  EMAIL_REPLY_TO: string;

  // AI / Enrichment
  GEMINI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  FIRECRAWL_API_KEY: string;

  // Frontend
  FRONTEND_URL: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    console.warn(`Warning: Environment variable ${key} is not set.`);
    return '';
  }
  return value;
}

export const config: EnvConfig = {
  // Server
  NODE_ENV: getEnvVar('NODE_ENV', 'development'),
  PORT: parseInt(getEnvVar('PORT', '3001'), 10),

  // Database
  DB_HOST: getEnvVar('DB_HOST', 'localhost'),
  DB_PORT: parseInt(getEnvVar('DB_PORT', '3306'), 10),
  DB_USER: getEnvVar('DB_USER', 'root'),
  DB_PASSWORD: getEnvVar('DB_PASS', ''),
  DB_NAME: getEnvVar('DB_NAME', 'camiacasa_abm'),
  DB_SSL: getEnvVar('DB_SSL', 'false') === 'true',

  // JWT
  JWT_SECRET: getEnvVar('JWT_SECRET', 'change-me-in-production'),
  JWT_EXPIRES_IN: getEnvVar('JWT_EXPIRES_IN', '7d'),

  // Resend (Email)
  RESEND_API_KEY: getEnvVar('RESEND_API_KEY', ''),
  RESEND_WEBHOOK_SECRET: getEnvVar('RESEND_WEBHOOK_SECRET', ''),
  EMAIL_FROM: getEnvVar('EMAIL_FROM', 'noreply@camiacasa.cat'),
  EMAIL_REPLY_TO: getEnvVar('EMAIL_REPLY_TO', 'alfons.marques@camiacasa.cat'),

  // AI / Enrichment
  GEMINI_API_KEY: getEnvVar('GEMINI_API_KEY', ''),
  PERPLEXITY_API_KEY: getEnvVar('PERPLEXITY_API_KEY', ''),
  FIRECRAWL_API_KEY: getEnvVar('FIRECRAWL_API_KEY', ''),

  // Frontend
  FRONTEND_URL: getEnvVar('FRONTEND_URL', 'http://localhost:5173'),
};

export default config;
