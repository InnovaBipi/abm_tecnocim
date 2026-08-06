/**
 * Tests for sendEmail() attachment support in server/src/services/email.ts
 *
 * Verifies the change is additive/backward-compatible:
 *  - no attachments arg  -> Resend payload has NO `attachments` key
 *  - attachments arg      -> Resend payload includes the `attachments` array
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock('../config/env', () => ({
  config: { RESEND_API_KEY: 'test_key', EMAIL_FROM: 'from@test.com', EMAIL_REPLY_TO: 'reply@test.com' },
}));

vi.mock('../config/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../config/database', () => ({ query: vi.fn() }));
vi.mock('../middleware/tenant', () => ({ getTenantConfig: vi.fn().mockResolvedValue(null) }));
vi.mock('../utils/crypto', () => ({ decryptSecret: vi.fn((s: string) => s) }));
vi.mock('../routes/unsubscribe', () => ({
  getEmailFooter: vi.fn(() => ''),
  getUnsubscribeUrl: vi.fn(() => 'http://unsub.test'),
}));

import { sendEmail } from './email';

describe('sendEmail attachments', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'res_1' }, error: null });
  });

  it('omits the attachments key when none are provided (backward compatible)', async () => {
    await sendEmail('to@test.com', 'Subject', '<p>Hi</p>');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty('attachments');
    expect(payload.to).toEqual(['to@test.com']);
  });

  it('includes the attachments array when provided', async () => {
    const attachments = [{ filename: 'nota.pdf', content: 'JVBERi0xLjQK' }];
    await sendEmail('to@test.com', 'Subject', '<p>Hi</p>', undefined, undefined, undefined, undefined, undefined, attachments);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.attachments).toEqual(attachments);
  });

  it('omits the attachments key for an empty attachments array', async () => {
    await sendEmail('to@test.com', 'Subject', '<p>Hi</p>', undefined, undefined, undefined, undefined, undefined, []);
    const payload = sendMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty('attachments');
  });
});
