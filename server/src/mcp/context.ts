import jwt from 'jsonwebtoken';
import { config } from '../config/env';

/**
 * Authenticated context for an MCP request, derived from the platform JWT.
 * Every tool handler receives this and MUST scope its queries to `tenantId`.
 */
export interface McpAuth {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
}

/**
 * Validate an `Authorization: Bearer <jwt>` header using the same HS256 JWT the
 * REST API issues. Returns the tenant-scoped auth context, or null if missing/invalid.
 * In Phase B this same token is what the OAuth /token endpoint mints.
 */
export function authFromHeader(authHeader?: string): McpAuth | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as any;
    if (!decoded?.tenantId || !decoded?.userId) return null;
    return {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
    };
  } catch {
    return null;
  }
}

/** Helper: standard MCP text result. */
export function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}
