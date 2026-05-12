import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

/**
 * Evaluate A/B test winners for a specific tenant.
 * Score = open_rate + 3 * reply_rate. Min 30 sends per variant.
 *
 * TENANT ISOLATION: Every query uses WHERE tenant_id = ? parameter.
 */
export async function evaluateAbTestsForTenant(
  tenantId: string,
  minSends: number = 30
): Promise<void> {
  // Get variant metrics — all email_events subqueries scoped by tenant_id
  const variants = await query<any[]>(
    `SELECT ss.sequence_id, ss.step_number, ss.ab_variant,
            (SELECT COUNT(*) FROM email_events ee
             WHERE ee.tenant_id = ? AND ee.step_id = ss.id AND ee.event_type = 'sent') as sends,
            (SELECT COUNT(*) FROM email_events ee
             WHERE ee.tenant_id = ? AND ee.step_id = ss.id AND ee.event_type = 'opened') as opens,
            (SELECT COUNT(*) FROM email_events ee
             WHERE ee.tenant_id = ? AND ee.step_id = ss.id AND ee.event_type = 'replied') as replies
     FROM sequence_steps ss
     JOIN email_sequences es ON ss.sequence_id = es.id AND es.tenant_id = ?
     WHERE ss.ab_variant IS NOT NULL`,
    [tenantId, tenantId, tenantId, tenantId]
  );

  if (variants.length === 0) return;

  // Group by sequence + step_number, filter by minimum sends
  const groups: Record<string, Array<typeof variants[0]>> = {};
  for (const v of variants) {
    if (v.sends < minSends) continue;
    const key = `${v.sequence_id}:${v.step_number}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  }

  for (const [key, group] of Object.entries(groups)) {
    if (group.length < 2) continue;

    // Score and rank variants
    const scored = group.map(v => ({
      ...v,
      score: (v.opens / Math.max(v.sends, 1)) + 3 * (v.replies / Math.max(v.sends, 1)),
    }));
    scored.sort((a, b) => b.score - a.score);
    const winnerVariant = scored[0].ab_variant;

    for (const v of scored) {
      const isWinner = v.ab_variant === winnerVariant;

      // Upsert result row. Uses UNIQUE KEY (sequence_id, step_number, variant).
      // ON DUPLICATE KEY UPDATE handles the upsert atomically.
      // tenant_id is always provided as a value for INSERT.
      await query(
        `INSERT INTO ab_test_results
         (id, tenant_id, sequence_id, step_number, variant, sends, opens, clicks, replies, is_winner, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           sends = VALUES(sends), opens = VALUES(opens), replies = VALUES(replies),
           is_winner = VALUES(is_winner), decided_at = NOW()`,
        [uuidv4(), tenantId, v.sequence_id, v.step_number, v.ab_variant,
         v.sends, v.opens, v.replies, isWinner]
      );
    }

    console.log(`A/B winner for tenant ${tenantId}, ${key}: variant ${winnerVariant}`);
  }
}
