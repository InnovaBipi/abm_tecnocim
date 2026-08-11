/**
 * Tests for server/src/services/replies.ts — shared reply-recording pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

import { query } from '../config/database';
import { recordReply } from './replies';

const mockQuery = query as ReturnType<typeof vi.fn>;

const T = 'test-tenant-id';
const P = 'prospect-1';

function findCall(fragment: string) {
  return mockQuery.mock.calls.find((c) => (c[0] as string).includes(fragment));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every query resolves to an empty array / no affected rows
  mockQuery.mockResolvedValue([] as any);
});

describe('recordReply', () => {
  it('negative: prospect rejected + DNC, enrollments stopped, scheduled cancelled', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE sequence_enrollments')) return { affectedRows: 2 };
      if (sql.includes("UPDATE generated_emails")) return { affectedRows: 3 };
      return [];
    });

    const r = await recordReply({
      tenantId: T, prospectId: P, classification: 'negative',
      source: 'manual', from: 'ceo@acme.com', receivedBy: 'robert.belmonte@tecnocim.com',
      recordedBy: 'user-robert', subject: 'RE: no gracias',
    });

    expect(r.prospectStatus).toBe('rejected');
    expect(r.doNotContact).toBe(true);
    expect(r.enrollmentsStopped).toBe(2);
    expect(r.scheduledCancelled).toBe(3);

    const prospectUpdate = findCall('UPDATE prospects')!;
    expect(prospectUpdate[0]).toContain("status = 'rejected'");
    expect(prospectUpdate[0]).toContain('do_not_contact = TRUE');
    expect(prospectUpdate[0]).toContain('tenant_id = ?');
    expect(prospectUpdate[1]).toEqual([P, T]);

    const cancel = findCall('UPDATE generated_emails')!;
    expect(cancel[0]).toContain('prospect_rejected');
    expect(cancel[0]).toContain('tenant_id = ?');
  });

  it('positive: prospect replied, follow-ups cancelled with prospect_replied reason', async () => {
    const r = await recordReply({
      tenantId: T, prospectId: P, classification: 'positive', source: 'imap', from: 'ceo@acme.com',
    });
    expect(r.prospectStatus).toBe('replied');
    expect(r.doNotContact).toBe(false);
    const cancel = findCall('UPDATE generated_emails')!;
    expect(cancel[0]).toContain('prospect_replied');
  });

  it('out_of_office: only last_replied is touched', async () => {
    const r = await recordReply({
      tenantId: T, prospectId: P, classification: 'out_of_office', source: 'imap',
    });
    expect(r.prospectStatus).toBe('unchanged');
    const prospectUpdate = findCall('UPDATE prospects')!;
    expect(prospectUpdate[0]).toContain('last_replied = NOW()');
    expect(prospectUpdate[0]).not.toContain("status = 'rejected'");
    expect(findCall('UPDATE generated_emails')).toBeUndefined();
    expect(findCall('UPDATE sequence_enrollments')).toBeUndefined();
  });

  it('fills from_email and per-sender metadata in the replied event', async () => {
    await recordReply({
      tenantId: T, prospectId: P, classification: 'other', source: 'manual',
      from: 'ceo@acme.com', receivedBy: 'robert.belmonte@tecnocim.com', recordedBy: 'user-robert',
      snippet: 'Interesante, hablemos',
    });
    const insert = findCall('INSERT INTO email_events')!;
    expect(insert[0]).toContain('from_email');
    // params: [id, tenant, enrollment, prospect, sequence, step, subject, from, metadata]
    expect(insert[1][1]).toBe(T);
    expect(insert[1][7]).toBe('ceo@acme.com');
    const metadata = JSON.parse(insert[1][8]);
    expect(metadata).toMatchObject({
      source: 'manual',
      received_by: 'robert.belmonte@tecnocim.com',
      recorded_by: 'user-robert',
      reply_classification: 'other',
      reply_snippet: 'Interesante, hablemos',
    });
  });

  it('attributes via In-Reply-To first, tenant-scoped', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('resend_email_id = ? OR message_id = ?')) {
        return [{ sequence_id: 'seq-1', enrollment_id: 'enr-1', step_id: 'step-1' }];
      }
      return [];
    });
    await recordReply({
      tenantId: T, prospectId: P, classification: 'positive', source: 'imap', inReplyTo: '<msg-id-123>',
    });
    const match = findCall('resend_email_id = ? OR message_id = ?')!;
    expect(match[0]).toContain('tenant_id = ?');
    expect(match[1]).toEqual(['<msg-id-123>', '<msg-id-123>', P, T]);
    // No fallback enrollment lookup needed
    expect(findCall('FROM sequence_enrollments se')).toBeUndefined();
    const insert = findCall('INSERT INTO email_events')!;
    expect(insert[1][2]).toBe('enr-1');
  });

  it('every UPDATE/SELECT is tenant-scoped', async () => {
    await recordReply({ tenantId: T, prospectId: P, classification: 'negative', source: 'manual' });
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).toContain('tenant_id');
      expect(call[1]).toContain(T);
    }
  });
});
