/**
 * Authenticated context for an MCP request, derived from the platform JWT.
 * Every tool handler receives this and MUST scope its queries to `tenantId`.
 * The live request path builds this from `req.auth` (set by the SDK's requireBearerAuth,
 * which calls AbmOAuthProvider.verifyAccessToken) — see mcp/index.ts.
 */
export interface McpAuth {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
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
