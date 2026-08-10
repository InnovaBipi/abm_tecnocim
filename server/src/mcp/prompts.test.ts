import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerPrompts } from './prompts';
import type { McpAuth } from './context';

vi.mock('../config/database', () => ({ query: vi.fn() }));
vi.mock('../services/scheduling', () => ({ getMadridDateString: vi.fn(() => '2026-08-10') }));
import { query } from '../config/database';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

const auth: McpAuth = { userId: 'test-user', email: 'test@test.com', role: 'admin', tenantId: 'test-tenant-id' };

type Registered = { config: any; cb: (args: any, extra?: any) => Promise<any> };

function register(): Record<string, Registered> {
  const registered: Record<string, Registered> = {};
  const server = {
    registerPrompt: (name: string, config: any, cb: any) => {
      registered[name] = { config, cb };
    },
  } as any;
  registerPrompts(server, auth);
  return registered;
}

const textOf = (result: any): string => result.messages[0].content.text;

describe('MCP prompts', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('registers the three Phase D prompts', () => {
    const prompts = register();
    expect(Object.keys(prompts).sort()).toEqual(['barrido_respuestas', 'campana_360', 'programar_borradores']);
  });

  describe('campana_360', () => {
    it('builds a tenant-wide briefing when campaign_id is omitted', async () => {
      const prompts = register();
      mockQuery.mockResolvedValueOnce([{ total: 5, active: 2, paused: 3 }]);
      const result = await prompts['campana_360'].cb({});
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('tenant_id'), ['test-tenant-id']);
      const text = textOf(result);
      expect(text).toContain('5 campañas');
      expect(text).toContain('dashboard_stats');
      expect(text).toContain('SOLO LECTURA');
    });

    it('redirects to campaigns_list when the campaign does not exist', async () => {
      const prompts = register();
      mockQuery.mockResolvedValueOnce([]);
      const result = await prompts['campana_360'].cb({ campaign_id: 'missing-id' });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('tenant_id'), ['missing-id', 'test-tenant-id']);
      expect(textOf(result)).toContain('no existe');
    });

    it('embeds real campaign data when found', async () => {
      const prompts = register();
      mockQuery.mockResolvedValueOnce([{ id: 'cam-1', name: 'Mandatos', status: 'paused', start_date: '2026-09-01' }]);
      const result = await prompts['campana_360'].cb({ campaign_id: 'cam-1' });
      const text = textOf(result);
      expect(text).toContain('"Mandatos"');
      expect(text).toContain('campaign_metrics');
      expect(text).toContain('campaign_id=cam-1');
    });
  });

  describe('programar_borradores', () => {
    it('rejects malformed start_date without touching the DB', async () => {
      const prompts = register();
      const result = await prompts['programar_borradores'].cb({ campaign_id: 'cam-1', start_date: '01/09/2026' });
      expect(textOf(result)).toContain('no es válida');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('reports when the campaign has no drafts', async () => {
      const prompts = register();
      mockQuery
        .mockResolvedValueOnce([{ id: 'cam-1', name: 'Mandatos', status: 'paused', start_date: null }])
        .mockResolvedValueOnce([{ c: 0 }]);
      const result = await prompts['programar_borradores'].cb({ campaign_id: 'cam-1', start_date: '2099-09-01' });
      expect(textOf(result)).toContain('0 drafts');
    });

    it('embeds draft count and schedule steps on the happy path', async () => {
      const prompts = register();
      mockQuery
        .mockResolvedValueOnce([{ id: 'cam-1', name: 'Mandatos', status: 'paused', start_date: null }])
        .mockResolvedValueOnce([{ c: 42 }]);
      const result = await prompts['programar_borradores'].cb({ campaign_id: 'cam-1', start_date: '2099-09-01' });
      const text = textOf(result);
      expect(text).toContain('42 emails en draft');
      expect(text).toContain('campaign_schedule_drafts');
      expect(text).toContain('NO activa la campaña');
      expect(text).not.toContain('AVISOS');
    });

    it('warns when start_date is before the campaign start_date', async () => {
      const prompts = register();
      mockQuery
        .mockResolvedValueOnce([{ id: 'cam-1', name: 'Mandatos', status: 'paused', start_date: '2099-09-01' }])
        .mockResolvedValueOnce([{ c: 10 }]);
      const result = await prompts['programar_borradores'].cb({ campaign_id: 'cam-1', start_date: '2099-08-15' });
      const text = textOf(result);
      expect(text).toContain('AVISOS');
      expect(text).toContain('anterior a la start_date de la campaña');
    });

    it('warns when start_date is before Madrid-today', async () => {
      const prompts = register();
      mockQuery
        .mockResolvedValueOnce([{ id: 'cam-1', name: 'Mandatos', status: 'paused', start_date: null }])
        .mockResolvedValueOnce([{ c: 10 }]);
      const result = await prompts['programar_borradores'].cb({ campaign_id: 'cam-1', start_date: '2026-08-09' });
      expect(textOf(result)).toContain('ANTERIOR a hoy (2026-08-10)');
    });
  });

  describe('barrido_respuestas', () => {
    it('defaults since to 7 days ago and embeds the reply count', async () => {
      const prompts = register();
      mockQuery.mockResolvedValueOnce([{ c: 9 }]);
      const result = await prompts['barrido_respuestas'].cb({});
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('tenant_id');
      expect(params[0]).toBe('test-tenant-id');
      expect(params[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const text = textOf(result);
      expect(text).toContain('9 respuestas');
      expect(text).toContain('replies_list');
      expect(text).toContain('NUNCA envíes');
    });

    it('rejects malformed since', async () => {
      const prompts = register();
      const result = await prompts['barrido_respuestas'].cb({ since: 'ayer' });
      expect(textOf(result)).toContain('no es válida');
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
