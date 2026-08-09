import { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpAuth } from './context';
import { registerReadOnlyTools } from './tools/readonly';
import { registerWriteTools } from './tools/write';

/**
 * Handle an MCP Streamable-HTTP request (stateless JSON mode). Auth is enforced UPSTREAM by the
 * SDK `requireBearerAuth` middleware, which validates the OAuth access token (= platform JWT) and
 * sets `req.auth`. Here we derive the tenant-scoped context and build a fresh McpServer per request.
 */
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const info = (req as any).auth as { extra?: Record<string, any> } | undefined;
  const extra = info?.extra;
  if (!extra?.tenantId || !extra?.userId) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    return;
  }
  const auth: McpAuth = {
    tenantId: extra.tenantId,
    userId: extra.userId,
    email: extra.email,
    role: extra.role,
  };

  const server = new McpServer(
    { name: 'abm-tecnocim', version: '1.0.0' },
    { instructions: 'Tools to operate the ABM/CamiaCasa platform (prospects, campaigns, emails, replies). All actions are scoped to your tenant.' }
  );
  registerReadOnlyTools(server, auth);
  registerWriteTools(server, auth);

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
