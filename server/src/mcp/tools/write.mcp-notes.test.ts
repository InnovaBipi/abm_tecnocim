import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), getConnection: vi.fn() }));
vi.mock('../../services/scheduling', () => ({
  distributeEmailsAcrossBusinessDays: vi.fn(),
  resolveProspectTimezone: vi.fn(),
  isBusinessDay: vi.fn(),
  getNextBusinessDay: vi.fn(),
}));
vi.mock('../../middleware/tenant', () => ({
  getTenantConfig: vi.fn(),
  buildTenantAIContext: vi.fn(),
  clearTenantCache: vi.fn(),
}));
vi.mock('../../utils/sanitizeHtml', () => ({ sanitizeEmailHtml: (h: string) => h }));

import { query } from '../../config/database';
import { clearTenantCache } from '../../middleware/tenant';
import { registerWriteTools } from './write';
import type { McpAuth } from '../context';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockClearCache = clearTenantCache as unknown as ReturnType<typeof vi.fn>;

function getTool(role: string): (args: any) => Promise<any> {
  const auth: McpAuth = { userId: 'test-user', email: 'test@test.com', role, tenantId: 'test-tenant-id' };
  const tools: Record<string, any> = {};
  const server = { registerTool: (n: string, _c: any, cb: any) => { tools[n] = cb; } } as any;
  registerWriteTools(server, auth);
  return tools['settings_set_mcp_notes'];
}

const parse = (result: any) => JSON.parse(result.content[0].text);

describe('settings_set_mcp_notes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClearCache.mockReset();
  });

  it('rejects non-admin/manager roles', async () => {
    const tool = getTool('member');
    const out = parse(await tool({ instructions: 'x' }));
    expect(out.error).toContain('admin or manager');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('sets the notes via JSON_MERGE_PATCH scoped to the tenant and clears the cache', async () => {
    const tool = getTool('admin');
    mockQuery.mockResolvedValueOnce({});
    const out = parse(await tool({ instructions: 'No activar antes del 2026-09-01.' }));
    expect(out.updated).toBe(true);
    expect(out.cleared).toBe(false);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('JSON_MERGE_PATCH');
    expect(params).toEqual(['No activar antes del 2026-09-01.', 'test-tenant-id']);
    expect(mockClearCache).toHaveBeenCalledWith('test-tenant-id');
  });

  it('clears the notes when given an empty string (null removes the key)', async () => {
    const tool = getTool('manager');
    mockQuery.mockResolvedValueOnce({});
    const out = parse(await tool({ instructions: '   ' }));
    expect(out.cleared).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual([null, 'test-tenant-id']);
  });

  it('caps the notes at 4000 chars', async () => {
    const tool = getTool('admin');
    const out = parse(await tool({ instructions: 'x'.repeat(4001) }));
    expect(out.error).toContain('4000');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
