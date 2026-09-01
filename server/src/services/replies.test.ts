/**
 * Tests for server/src/services/replies.ts — shared reply-recording pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

import { query } from '../config/database';
import { recordReply } from './replies';

const mockQuery = query as ReturnType<typeof vi.fn>;

const T = 'test-tenant-id';
const P = 'prospect-1';

// The prospects.status ENUM, read from the schema that actually ships (server/database is the
// copy the build deploys), so the guard below tracks the column instead of a stale copy of it.
const PROSPECT_STATUS_ENUM = (() => {
  const schema = readFileSync(resolve(__dirname, '../../database/schema.sql'), 'utf8');
  const table = schema.match(/CREATE TABLE[^;]*?\bprospects\b[^;]*?;/s)?.[0] ?? '';
  const members = table.match(/^\s*status\s+ENUM\(([^)]*)\)/m)?.[1] ?? '';
  const parsed = [...members.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!parsed.length) throw new Error('Could not parse prospects.status ENUM from schema.sql');
  return parsed;
})();

function findCall(fragment: string) {
  return mockQuery.mock.calls.find((c) => (c[0] as string).includes(fragment));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every query resolves to an empty array / no affected rows
  mockQuery.mockResolvedValue([] as any);
});

describe('recordReply', () => {
  it('negative: prospect unsubscribed + DNC, enrollments stopped, scheduled cancelled', async () => {
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

    expect(r.prospectStatus).toBe('unsubscribed');
    expect(r.doNotContact).toBe(true);
    expect(r.enrollmentsStopped).toBe(2);
    expect(r.scheduledCancelled).toBe(3);

    const prospectUpdate = findCall('UPDATE prospects')!;
    expect(prospectUpdate[0]).toContain("status = 'unsubscribed'");
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
    expect(prospectUpdate[0]).not.toContain("status = 'unsubscribed'");
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

  // Regression guard. This service once wrote status = 'rejected', which is a member of
  // generated_emails.status but not of prospects.status, so MySQL threw "Data truncated for
  // column 'status'". Asserting the literal string is not enough — the value has to be checked
  // against the real ENUM, so this reads it from the schema rather than restating it here.
  it.each(['negative', 'unsubscribe', 'positive', 'out_of_office', 'other'] as const)(
    'writes a valid prospects.status ENUM member for %s replies',
    async (classification) => {
      await recordReply({ tenantId: T, prospectId: P, classification, source: 'manual' });

      for (const call of mockQuery.mock.calls) {
        const sql = call[0] as string;
        if (!sql.includes('UPDATE prospects')) continue;
        const written = sql.match(/status\s*=\s*'([^']+)'/)?.[1];
        if (written) expect(PROSPECT_STATUS_ENUM).toContain(written);
      }
    }
  );
});
