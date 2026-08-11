import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';

/**
 * Cross-campaign contact guard.
 *
 * Server-side guarantee that a prospect already impacted (or queued) by one
 * campaign is not contacted again by another campaign of the same tenant.
 * Until now this dedup only existed client-side (prospecting command prompts),
 * which breaks down with multiple human operators (Alfons/Robert).
 *
 * Policy (agreed 11-ago-2026):
 * - sent/opened/replied/bounced in another campaign  -> BLOCK, released after
 *   cooldown_days (tenant config contact_guard.cooldown_days, default 365).
 * - approved/scheduled in another campaign           -> BLOCK, always (queued).
 * - active enrollment in another live campaign       -> BLOCK (reserves the
 *   prospect), only when checkEnrollment is on (layers A/B).
 * - draft only in another campaign                   -> warning (draft_only).
 * - same company_id / same email domain conflict     -> warning list, never blocks.
 * - force:true on write endpoints overrides, audited via
 *   generated_emails.metadata.$.contact_guard_override.
 *
 * The operated campaign is ALWAYS excluded so a campaign's own follow-ups
 * (steps 2-3) never self-block.
 */

export type BlockReason =
  | 'contacted_other_campaign'
  | 'queued_other_campaign'
  | 'enrolled_other_campaign';

export interface GuardVerdict {
  blocked: boolean;
  reason?: BlockReason;
  other_campaign_id?: string;
  other_campaign_name?: string;
  email_status?: string;
  draft_only?: boolean;
}

export interface DomainWarning {
  prospect_id: string;
  conflicting_prospect_id: string;
  conflicting_email: string;
  via: 'company' | 'email_domain';
  other_campaign_id: string;
  other_campaign_name: string;
}

export interface GuardOptions {
  checkEnrollment?: boolean;  // layers A/B: true; layer C (send-time): false
  checkDomain?: boolean;      // layers A/B: true; layer C: false (cost)
  queuedBlocks?: boolean;     // default true; layer C passes false (only real sends block)
  cooldownDays?: number;      // override; default tenant config ?? 365
}

export interface GuardResult {
  verdicts: Map<string, GuardVerdict>;
  blockedIds: string[];
  domainWarnings: DomainWarning[];
}

const CHUNK = 500;

const FREE_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es',
  'live.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'aol.com',
  'proton.me', 'protonmail.com',
]);

// Strength order when a prospect has several rows in other campaigns
const STATUS_RANK: Record<string, number> = {
  replied: 7, opened: 6, sent: 5, bounced: 4, scheduled: 3, approved: 2, draft: 1,
};
const CONTACTED = new Set(['sent', 'opened', 'replied', 'bounced']);
const QUEUED = new Set(['approved', 'scheduled']);

export async function getCooldownDays(tenantId: string): Promise<number> {
  const tenant = await getTenantConfig(tenantId);
  const cfg: any = tenant?.config as any;
  const days = cfg?.contact_guard?.cooldown_days;
  return typeof days === 'number' && days >= 0 ? days : 365;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Batch check: for each prospect, is it already impacted/queued/reserved by a
 * DIFFERENT campaign of this tenant? One query per concern per chunk, no N+1.
 */
export async function checkCrossCampaignContact(
  tenantId: string,
  campaignId: string,
  prospectIds: string[],
  opts: GuardOptions = {}
): Promise<GuardResult> {
  const verdicts = new Map<string, GuardVerdict>();
  const domainWarnings: DomainWarning[] = [];
  const ids = [...new Set(prospectIds)].filter(Boolean);
  for (const id of ids) verdicts.set(id, { blocked: false });
  if (ids.length === 0) return { verdicts, blockedIds: [], domainWarnings };

  const queuedBlocks = opts.queuedBlocks !== false;
  const cooldownDays = opts.cooldownDays ?? await getCooldownDays(tenantId);

  for (const batch of chunk(ids, CHUNK)) {
    const ph = batch.map(() => '?').join(',');

    // Q1: emails for these prospects in OTHER campaigns of this tenant
    const rows = await query<any[]>(
      `SELECT ge.prospect_id, ge.status, ge.sent_at, c.id AS campaign_id, c.name AS campaign_name
       FROM generated_emails ge
       JOIN campaigns c ON c.id = ge.campaign_id AND c.tenant_id = ge.tenant_id
       WHERE ge.tenant_id = ? AND ge.campaign_id <> ? AND ge.prospect_id IN (${ph})`,
      [tenantId, campaignId, ...batch]
    );

    const now = Date.now();
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    for (const row of rows) {
      const v = verdicts.get(row.prospect_id)!;
      let effective = row.status as string;
      if (CONTACTED.has(effective) && cooldownDays > 0 && row.sent_at) {
        const age = now - new Date(row.sent_at).getTime();
        if (age > cooldownMs) continue; // recycled: old contact no longer blocks
      }
      if (QUEUED.has(effective) && !queuedBlocks) effective = 'draft'; // degrade to non-blocking
      const currentRank = v.email_status ? STATUS_RANK[v.email_status] || 0 : 0;
      const newRank = STATUS_RANK[effective] || 0;
      if (newRank <= currentRank) continue;
      v.email_status = effective;
      v.other_campaign_id = row.campaign_id;
      v.other_campaign_name = row.campaign_name;
      if (CONTACTED.has(effective)) {
        v.blocked = true; v.reason = 'contacted_other_campaign'; v.draft_only = false;
      } else if (QUEUED.has(effective)) {
        v.blocked = true; v.reason = 'queued_other_campaign'; v.draft_only = false;
      } else if (!v.blocked) {
        v.draft_only = true;
      }
    }

    // Q2: active enrollment in another live campaign (reservation).
    // campaign_prospects has no tenant_id -> tenant scoping via campaigns JOIN.
    if (opts.checkEnrollment) {
      const enrolled = await query<any[]>(
        `SELECT cp.prospect_id, c.id AS campaign_id, c.name AS campaign_name
         FROM campaign_prospects cp
         JOIN campaigns c ON c.id = cp.campaign_id
         WHERE c.tenant_id = ? AND cp.campaign_id <> ? AND cp.prospect_id IN (${ph})
           AND cp.status = 'active' AND c.status IN ('draft', 'active', 'paused')`,
        [tenantId, campaignId, ...batch]
      );
      for (const row of enrolled) {
        const v = verdicts.get(row.prospect_id)!;
        if (v.blocked) continue; // an email-based reason is stronger/more specific
        v.blocked = true;
        v.reason = 'enrolled_other_campaign';
        v.other_campaign_id = row.campaign_id;
        v.other_campaign_name = row.campaign_name;
      }
    }

    // Q3: company/domain-level conflicts -> warnings only, never block
    if (opts.checkDomain) {
      const own = await query<any[]>(
        `SELECT id, email, company_id, LOWER(SUBSTRING_INDEX(email, '@', -1)) AS dom
         FROM prospects WHERE tenant_id = ? AND id IN (${ph})`,
        [tenantId, ...batch]
      );
      const companyIds = [...new Set(own.map(p => p.company_id).filter(Boolean))];
      const domains = [...new Set(own.map(p => p.dom).filter((d: string) => d && !FREE_DOMAINS.has(d)))];
      if (companyIds.length > 0 || domains.length > 0) {
        const compPh = companyIds.map(() => '?').join(',');
        const domPh = domains.map(() => '?').join(',');
        const conds: string[] = [];
        const params: any[] = [tenantId, campaignId];
        if (companyIds.length > 0) { conds.push(`p2.company_id IN (${compPh})`); params.push(...companyIds); }
        if (domains.length > 0) { conds.push(`LOWER(SUBSTRING_INDEX(p2.email, '@', -1)) IN (${domPh})`); params.push(...domains); }
        const conflicts = await query<any[]>(
          `SELECT DISTINCT p2.id, p2.email, p2.company_id,
                  LOWER(SUBSTRING_INDEX(p2.email, '@', -1)) AS dom,
                  c.id AS campaign_id, c.name AS campaign_name
           FROM generated_emails ge
           JOIN prospects p2 ON p2.id = ge.prospect_id AND p2.tenant_id = ge.tenant_id
           JOIN campaigns c ON c.id = ge.campaign_id AND c.tenant_id = ge.tenant_id
           WHERE ge.tenant_id = ? AND ge.campaign_id <> ?
             AND ge.status IN ('approved', 'scheduled', 'sent', 'opened', 'replied', 'bounced')
             AND (${conds.join(' OR ')})`,
          params
        );
        const batchSet = new Set(batch);
        for (const p of own) {
          for (const c2 of conflicts) {
            if (batchSet.has(c2.id) || c2.id === p.id) continue;
            const viaCompany = p.company_id && c2.company_id === p.company_id;
            const viaDomain = p.dom && !FREE_DOMAINS.has(p.dom) && c2.dom === p.dom;
            if (!viaCompany && !viaDomain) continue;
            domainWarnings.push({
              prospect_id: p.id,
              conflicting_prospect_id: c2.id,
              conflicting_email: c2.email,
              via: viaCompany ? 'company' : 'email_domain',
              other_campaign_id: c2.campaign_id,
              other_campaign_name: c2.campaign_name,
            });
          }
        }
      }
    }
  }

  const blockedIds = [...verdicts.entries()].filter(([, v]) => v.blocked).map(([id]) => id);
  return { verdicts, blockedIds, domainWarnings };
}

/** Flatten blocked verdicts into the shape API responses expose. */
export function formatBlocked(result: GuardResult): Array<{
  prospect_id: string;
  reason: BlockReason;
  other_campaign_id: string | null;
  other_campaign_name: string | null;
  email_status: string | null;
}> {
  return result.blockedIds.map((id) => {
    const v = result.verdicts.get(id)!;
    return {
      prospect_id: id,
      reason: v.reason!,
      other_campaign_id: v.other_campaign_id || null,
      other_campaign_name: v.other_campaign_name || null,
      email_status: v.email_status || null,
    };
  });
}

/**
 * Layer C decision (send time): skip unless the row carries an explicit
 * audited override. Pure function so the scheduler path is testable.
 */
export function shouldSkipEmail(verdict: GuardVerdict | undefined, metadata: any): boolean {
  if (!verdict?.blocked) return false;
  const meta = typeof metadata === 'string' ? safeParse(metadata) : metadata;
  return !meta?.contact_guard_override;
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
