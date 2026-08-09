import { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authFromHeader } from './context';
import { registerReadOnlyTools } from './tools/readonly';

/** Public base URL of this server (for OAuth metadata discovery). */
function baseUrl(req: Request): string {
  const envUrl = process.env.PUBLIC_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Handle an MCP Streamable-HTTP request (stateless JSON mode). Each request:
 *  1. Validates the Bearer JWT → tenant-scoped auth (401 with WWW-Authenticate if missing).
 *  2. Builds a fresh McpServer with tools bound to that tenant.
 *  3. Lets the transport process the JSON-RPC request and reply.
 * Stateless (no session store) keeps it simple and horizontally safe for multiple clients.
 */
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const auth = authFromHeader(req.headers.authorization);
  if (!auth) {
    res.set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`
    );
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    return;
  }

  const server = new McpServer(
    { name: 'abm-tecnocim', version: '1.0.0' },
    { instructions: 'Tools to operate the ABM/CamiaCasa platform (prospects, campaigns, emails, replies). All actions are scoped to your tenant.' }
  );
  registerReadOnlyTools(server, auth);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    console.error('MCP request error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
}

/** GET/DELETE on /mcp are not used in stateless JSON mode. */
export function mcpMethodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
}
