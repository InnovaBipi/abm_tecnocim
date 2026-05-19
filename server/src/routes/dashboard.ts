import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Helper: parse optional date range from query params
function parseDateRange(req: Request): { dateFrom: string | null; dateTo: string | null } {
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo = req.query.date_to as string | undefined;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return {
    dateFrom: dateFrom && re.test(dateFrom) ? dateFrom : null,
    dateTo: dateTo && re.test(dateTo) ? dateTo : null,
  };
}

// --- GET /stats - Key metrics ---
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const { dateFrom, dateTo } = parseDateRange(req);

    // Date filter clause for email_events
    const hasDateFilter = dateFrom && dateTo;
    const dateClause = hasDateFilter ? ' AND occurred_at >= ? AND occurred_at <= ?' : '';
    const dateParams = hasDateFilter ? [dateFrom, dateTo + ' 23:59:59'] : [];

    // Total prospects (cumulative, no date filter)
    const prospectCount = await query<any[]>('SELECT COUNT(*) as count FROM prospects WHERE tenant_id = ?', [tenantId]);

    // Total companies (cumulative)
    const companyCount = await query<any[]>('SELECT COUNT(*) as count FROM companies WHERE tenant_id = ?', [tenantId]);

    // Active campaigns (cumulative)
    const activeCampaigns = await query<any[]>(
      "SELECT COUNT(*) as count FROM campaigns WHERE status = 'active' AND tenant_id = ?",
      [tenantId]
    );

    // Emails sent: count from generated_emails (outbox) to avoid double-counting webhook echo events
    const dateClauseOutbox = hasDateFilter ? ' AND sent_at >= ? AND sent_at <= ?' : '';
    const emailsSent = await query<any[]>(
      `SELECT COUNT(*) as count FROM generated_emails WHERE status = 'sent' AND tenant_id = ?${dateClauseOutbox}`,
      [tenantId, ...dateParams]
    );

    // Reply rate (filtered by date range)
    const emailsReplied = await query<any[]>(
      `SELECT COUNT(*) as count FROM email_events WHERE event_type = 'replied' AND tenant_id = ?${dateClause}`,
      [tenantId, ...dateParams]
    );
    const sentCount = emailsSent[0].count || 0;
    const repliedCount = emailsReplied[0].count || 0;
    const replyRate = sentCount > 0 ? Math.round((repliedCount / sentCount) * 10000) / 100 : 0;

    // Open rate (filtered by date range)
    const emailsOpened = await query<any[]>(
      `SELECT COUNT(*) as count FROM email_events WHERE event_type = 'opened' AND tenant_id = ?${dateClause}`,
      [tenantId, ...dateParams]
    );
    const openedCount = emailsOpened[0].count || 0;
    const openRate = sentCount > 0 ? Math.round((openedCount / sentCount) * 10000) / 100 : 0;

    // Average lead score
    const avgScore = await query<any[]>(
      'SELECT AVG(lead_score) as avg_score FROM prospects WHERE lead_score > 0 AND tenant_id = ?',
      [tenantId]
    );

    // Prospects by status breakdown
    const statusBreakdown = await query<any[]>(
      'SELECT status, COUNT(*) as count FROM prospects WHERE tenant_id = ? GROUP BY status ORDER BY count DESC',
      [tenantId]
    );

    // New prospects this week
    const newThisWeek = await query<any[]>(
      `SELECT COUNT(*) as count FROM prospects
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND tenant_id = ?`,
      [tenantId]
    );

    // New prospects this month
    const newThisMonth = await query<any[]>(
      `SELECT COUNT(*) as count FROM prospects
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND tenant_id = ?`,
      [tenantId]
    );

    res.json({
      success: true,
      data: {
        total_prospects: prospectCount[0].count,
        total_companies: companyCount[0].count,
        active_campaigns: activeCampaigns[0].count,
        emails_sent: sentCount,
        reply_rate: replyRate,
        open_rate: openRate,
        avg_lead_score: Math.round(avgScore[0].avg_score || 0),
        new_prospects_this_week: newThisWeek[0].count,
        new_prospects_this_month: newThisMonth[0].count,
        status_breakdown: statusBreakdown,
      },
    });
  } catch (error: any) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching dashboard stats.',
    });
  }
});

// --- GET /recent-activity - Last 20 activities across all prospects ---
router.get('/recent-activity', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    const activities = await query<any[]>(
      `SELECT pa.*,
              p.email as prospect_email,
              p.first_name as prospect_first_name,
              p.last_name as prospect_last_name,
              p.full_name as prospect_full_name,
              u.first_name as performed_by_first_name,
              u.last_name as performed_by_last_name
       FROM prospect_activities pa
       JOIN prospects p ON pa.prospect_id = p.id
       LEFT JOIN users u ON pa.performed_by = u.id
       WHERE pa.tenant_id = ?
       ORDER BY pa.occurred_at DESC
       LIMIT 20`,
      [tenantId]
    );

    res.json({
      success: true,
      data: activities,
    });
  } catch (error: any) {
    console.error('Recent activity error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching recent activity.',
    });
  }
});

// --- GET /top-prospects - Top 10 prospects by lead score ---
router.get('/top-prospects', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    const prospects = await query<any[]>(
      `SELECT p.id, p.email, p.first_name, p.last_name, p.full_name, p.title,
              p.status, p.lead_score, p.last_contacted, p.last_replied,
              c.name as company_name, c.tier as company_tier
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.lead_score > 0 AND p.tenant_id = ?
       ORDER BY p.lead_score DESC
       LIMIT 10`,
      [tenantId]
    );

    res.json({
      success: true,
      data: prospects,
    });
  } catch (error: any) {
    console.error('Top prospects error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching top prospects.',
    });
  }
});

// --- GET /campaign-performance - Per-campaign stats ---
router.get('/campaign-performance', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const { dateFrom, dateTo } = parseDateRange(req);

    const hasDateFilter = dateFrom && dateTo;
    const dateClause = hasDateFilter ? ' AND ee.occurred_at >= ? AND ee.occurred_at <= ?' : '';
    const dateParams = hasDateFilter ? [dateFrom, dateTo + ' 23:59:59'] : [];

    const campaigns = await query<any[]>(
      `SELECT
         cam.id,
         cam.name,
         cam.status,
         cam.campaign_type,
         cam.start_date,
         cam.end_date,
         (SELECT COUNT(*) FROM campaign_prospects cp
          WHERE cp.campaign_id = cam.id AND cp.status = 'active') as prospect_count,
         COALESCE(stats.sent, 0) as emails_sent,
         COALESCE(stats.delivered, 0) as emails_delivered,
         COALESCE(stats.opened, 0) as emails_opened,
         COALESCE(stats.clicked, 0) as emails_clicked,
         COALESCE(stats.replied, 0) as emails_replied,
         COALESCE(stats.bounced, 0) as emails_bounced,
         CASE WHEN COALESCE(stats.sent, 0) > 0
              THEN ROUND((COALESCE(stats.opened, 0) / stats.sent) * 100, 1)
              ELSE 0 END as open_rate,
         CASE WHEN COALESCE(stats.sent, 0) > 0
              THEN ROUND((COALESCE(stats.replied, 0) / stats.sent) * 100, 1)
              ELSE 0 END as reply_rate,
         CASE WHEN COALESCE(stats.sent, 0) > 0
              THEN ROUND((COALESCE(stats.clicked, 0) / stats.sent) * 100, 1)
              ELSE 0 END as click_rate
       FROM campaigns cam
       LEFT JOIN (
         SELECT ge.campaign_id,
                SUM(CASE WHEN ge.status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN ge.status = 'bounced' THEN 1 ELSE 0 END) as bounced,
                0 as delivered,
                (SELECT COUNT(*) FROM email_events ee2
                 WHERE ee2.event_type = 'opened' AND ee2.tenant_id = ge.tenant_id
                 AND ee2.prospect_id IN (SELECT ge3.prospect_id FROM generated_emails ge3 WHERE ge3.campaign_id = ge.campaign_id AND ge3.tenant_id = ge.tenant_id AND ge3.status = 'sent')) as opened,
                (SELECT COUNT(*) FROM email_events ee2
                 WHERE ee2.event_type = 'clicked' AND ee2.tenant_id = ge.tenant_id
                 AND ee2.prospect_id IN (SELECT ge3.prospect_id FROM generated_emails ge3 WHERE ge3.campaign_id = ge.campaign_id AND ge3.tenant_id = ge.tenant_id AND ge3.status = 'sent')) as clicked,
                (SELECT COUNT(*) FROM email_events ee2
                 WHERE ee2.event_type = 'replied' AND ee2.tenant_id = ge.tenant_id
                 AND ee2.prospect_id IN (SELECT ge3.prospect_id FROM generated_emails ge3 WHERE ge3.campaign_id = ge.campaign_id AND ge3.tenant_id = ge.tenant_id AND ge3.status = 'sent')) as replied
         FROM generated_emails ge
         WHERE ge.tenant_id = ?${hasDateFilter ? ' AND ge.sent_at >= ? AND ge.sent_at <= ?' : ''}
         GROUP BY ge.campaign_id
       ) stats ON stats.campaign_id = cam.id
       WHERE cam.tenant_id = ?
       ORDER BY cam.created_at DESC`,
      [tenantId, ...dateParams, tenantId]
    );

    res.json({
      success: true,
      data: campaigns,
    });
  } catch (error: any) {
    console.error('Campaign performance error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching campaign performance.',
    });
  }
});

// --- GET /deliverability - Delivery health metrics ---
router.get('/deliverability', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const { dateFrom, dateTo } = parseDateRange(req);

    const hasDateFilter = dateFrom && dateTo;
    const dateClause = hasDateFilter ? ' AND occurred_at >= ? AND occurred_at <= ?' : '';
    const dateParams = hasDateFilter ? [dateFrom, dateTo + ' 23:59:59'] : [];

    const totals = await query<any[]>(
      `SELECT
         SUM(CASE WHEN event_type = 'sent' THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN event_type = 'delivered' THEN 1 ELSE 0 END) as delivered,
         SUM(CASE WHEN event_type = 'bounced' THEN 1 ELSE 0 END) as bounced,
         SUM(CASE WHEN event_type = 'complaint' THEN 1 ELSE 0 END) as complaints,
         SUM(CASE WHEN event_type = 'opened' THEN 1 ELSE 0 END) as opened,
         SUM(CASE WHEN event_type = 'clicked' THEN 1 ELSE 0 END) as clicked,
         SUM(CASE WHEN event_type = 'replied' THEN 1 ELSE 0 END) as replied
       FROM email_events
       WHERE tenant_id = ?${dateClause}`,
      [tenantId, ...dateParams]
    );

    const t = totals[0] || {};
    const sent = t.sent || 0;

    // Warm-up status: domain age in days
    const firstSent = await query<any[]>(
      `SELECT MIN(occurred_at) as first_sent FROM email_events WHERE event_type = 'sent' AND tenant_id = ?`,
      [tenantId]
    );
    let domainAgeDays = 0;
    if (firstSent[0]?.first_sent) {
      domainAgeDays = Math.floor((Date.now() - new Date(firstSent[0].first_sent).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }

    let warmupPhase = 'not_started';
    if (domainAgeDays > 30) warmupPhase = 'completed';
    else if (domainAgeDays > 0) warmupPhase = 'in_progress';

    res.json({
      success: true,
      data: {
        sent,
        delivered: t.delivered || 0,
        bounced: t.bounced || 0,
        complaints: t.complaints || 0,
        opened: t.opened || 0,
        clicked: t.clicked || 0,
        replied: t.replied || 0,
        delivery_rate: sent > 0 ? Math.round(((t.delivered || 0) / sent) * 10000) / 100 : 0,
        bounce_rate: sent > 0 ? Math.round(((t.bounced || 0) / sent) * 10000) / 100 : 0,
        complaint_rate: sent > 0 ? Math.round(((t.complaints || 0) / sent) * 10000) / 100 : 0,
        open_rate: sent > 0 ? Math.round(((t.opened || 0) / sent) * 10000) / 100 : 0,
        click_rate: sent > 0 ? Math.round(((t.clicked || 0) / sent) * 10000) / 100 : 0,
        reply_rate: sent > 0 ? Math.round(((t.replied || 0) / sent) * 10000) / 100 : 0,
        warmup: {
          domain_age_days: domainAgeDays,
          phase: warmupPhase,
        },
      },
    });
  } catch (error: any) {
    console.error('Deliverability error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching deliverability data.' });
  }
});

// --- GET /funnel - Prospect status breakdown with conversion rates ---
router.get('/funnel', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    const stages = await query<any[]>(
      `SELECT status, COUNT(*) as count FROM prospects WHERE tenant_id = ? GROUP BY status ORDER BY
       FIELD(status, 'new', 'enriched', 'qualified', 'contacted', 'replied', 'interested', 'meeting', 'converted', 'unsubscribed', 'bounced')`,
      [tenantId]
    );

    const total = stages.reduce((sum: number, s: any) => sum + s.count, 0);

    // Calculate conversion rates between consecutive funnel stages
    const funnelOrder = ['new', 'enriched', 'qualified', 'contacted', 'replied', 'interested', 'meeting', 'converted'];
    const stageMap: Record<string, number> = {};
    for (const s of stages) {
      stageMap[s.status] = s.count;
    }

    const funnel = funnelOrder.map((status, index) => {
      const count = stageMap[status] || 0;
      const prevCount = index > 0 ? (stageMap[funnelOrder[index - 1]] || 0) : total;
      return {
        status,
        count,
        percentage: total > 0 ? Math.round((count / total) * 10000) / 100 : 0,
        conversion_from_prev: prevCount > 0 ? Math.round((count / prevCount) * 10000) / 100 : 0,
      };
    });

    res.json({
      success: true,
      data: {
        total,
        stages,
        funnel,
      },
    });
  } catch (error: any) {
    console.error('Funnel error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching funnel data.' });
  }
});

// --- GET /sequence-step-performance - Per-step open/click/reply rates ---
router.get('/sequence-step-performance', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    const performance = await query<any[]>(
      `SELECT
         es.id as sequence_id,
         es.name as sequence_name,
         ss.step_number,
         ss.subject as step_subject,
         SUM(CASE WHEN ee.event_type = 'sent' THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN ee.event_type = 'opened' THEN 1 ELSE 0 END) as opened,
         SUM(CASE WHEN ee.event_type = 'clicked' THEN 1 ELSE 0 END) as clicked,
         SUM(CASE WHEN ee.event_type = 'replied' THEN 1 ELSE 0 END) as replied,
         SUM(CASE WHEN ee.event_type = 'bounced' THEN 1 ELSE 0 END) as bounced
       FROM email_events ee
       JOIN sequence_steps ss ON ee.step_id = ss.id
       JOIN email_sequences es ON ee.sequence_id = es.id
       WHERE ee.tenant_id = ?
       GROUP BY es.id, es.name, ss.step_number, ss.subject
       ORDER BY es.name, ss.step_number`,
      [tenantId]
    );

    const result = performance.map((row: any) => ({
      ...row,
      open_rate: row.sent > 0 ? Math.round((row.opened / row.sent) * 10000) / 100 : 0,
      click_rate: row.sent > 0 ? Math.round((row.clicked / row.sent) * 10000) / 100 : 0,
      reply_rate: row.sent > 0 ? Math.round((row.replied / row.sent) * 10000) / 100 : 0,
    }));

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Sequence step performance error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching step performance.' });
  }
});

// --- GET /engagement-trends - Daily email volumes (date range or last 30 days) ---
router.get('/engagement-trends', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const { dateFrom, dateTo } = parseDateRange(req);

    const hasDateFilter = dateFrom && dateTo;
    const dateClause = hasDateFilter
      ? 'occurred_at >= ? AND occurred_at <= ?'
      : 'occurred_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    const dateParams = hasDateFilter ? [dateFrom, dateTo + ' 23:59:59'] : [];

    const trends = await query<any[]>(
      `SELECT
         DATE(occurred_at) as date,
         SUM(CASE WHEN event_type = 'sent' THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN event_type = 'delivered' THEN 1 ELSE 0 END) as delivered,
         SUM(CASE WHEN event_type = 'opened' THEN 1 ELSE 0 END) as opened,
         SUM(CASE WHEN event_type = 'clicked' THEN 1 ELSE 0 END) as clicked,
         SUM(CASE WHEN event_type = 'replied' THEN 1 ELSE 0 END) as replied
       FROM email_events
       WHERE ${dateClause} AND tenant_id = ?
       GROUP BY DATE(occurred_at)
       ORDER BY date ASC`,
      [...dateParams, tenantId]
    );

    res.json({
      success: true,
      data: trends,
    });
  } catch (error: any) {
    console.error('Engagement trends error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching engagement trends.' });
  }
});

// --- GET /hot-prospects - Prospects with engagement in last 48h ---
router.get('/hot-prospects', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    const hotProspects = await query<any[]>(
      `SELECT
         p.id, p.email, p.first_name, p.last_name, p.full_name,
         p.title, p.status, p.lead_score,
         c.name as company_name,
         COUNT(ee.id) as activity_count,
         MAX(ee.occurred_at) as last_activity,
         GROUP_CONCAT(DISTINCT ee.event_type ORDER BY ee.occurred_at DESC) as event_types
       FROM email_events ee
       JOIN prospects p ON ee.prospect_id = p.id
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE ee.occurred_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
       AND ee.event_type IN ('opened', 'clicked', 'replied')
       AND ee.tenant_id = ?
       GROUP BY p.id, p.email, p.first_name, p.last_name, p.full_name,
                p.title, p.status, p.lead_score, c.name
       ORDER BY activity_count DESC, last_activity DESC
       LIMIT 20`,
      [tenantId]
    );

    res.json({
      success: true,
      data: hotProspects,
    });
  } catch (error: any) {
    console.error('Hot prospects error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching hot prospects.' });
  }
});

export default router;
