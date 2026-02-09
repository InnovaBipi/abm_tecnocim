import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- GET /stats - Key metrics ---
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Total prospects
    const prospectCount = await query<any[]>('SELECT COUNT(*) as count FROM prospects');

    // Total companies
    const companyCount = await query<any[]>('SELECT COUNT(*) as count FROM companies');

    // Active campaigns
    const activeCampaigns = await query<any[]>(
      "SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'"
    );

    // Emails sent (total)
    const emailsSent = await query<any[]>(
      "SELECT COUNT(*) as count FROM email_events WHERE event_type = 'sent'"
    );

    // Reply rate
    const emailsReplied = await query<any[]>(
      "SELECT COUNT(*) as count FROM email_events WHERE event_type = 'replied'"
    );
    const sentCount = emailsSent[0].count || 0;
    const repliedCount = emailsReplied[0].count || 0;
    const replyRate = sentCount > 0 ? Math.round((repliedCount / sentCount) * 10000) / 100 : 0;

    // Open rate
    const emailsOpened = await query<any[]>(
      "SELECT COUNT(*) as count FROM email_events WHERE event_type = 'opened'"
    );
    const openedCount = emailsOpened[0].count || 0;
    const openRate = sentCount > 0 ? Math.round((openedCount / sentCount) * 10000) / 100 : 0;

    // Average lead score
    const avgScore = await query<any[]>(
      'SELECT AVG(lead_score) as avg_score FROM prospects WHERE lead_score > 0'
    );

    // Prospects by status breakdown
    const statusBreakdown = await query<any[]>(
      'SELECT status, COUNT(*) as count FROM prospects GROUP BY status ORDER BY count DESC'
    );

    // New prospects this week
    const newThisWeek = await query<any[]>(
      `SELECT COUNT(*) as count FROM prospects
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );

    // New prospects this month
    const newThisMonth = await query<any[]>(
      `SELECT COUNT(*) as count FROM prospects
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
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
router.get('/recent-activity', async (_req: Request, res: Response): Promise<void> => {
  try {
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
       ORDER BY pa.occurred_at DESC
       LIMIT 20`
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
router.get('/top-prospects', async (_req: Request, res: Response): Promise<void> => {
  try {
    const prospects = await query<any[]>(
      `SELECT p.id, p.email, p.first_name, p.last_name, p.full_name, p.title,
              p.status, p.lead_score, p.last_contacted, p.last_replied,
              c.name as company_name, c.tier as company_tier
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.lead_score > 0
       ORDER BY p.lead_score DESC
       LIMIT 10`
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
router.get('/campaign-performance', async (_req: Request, res: Response): Promise<void> => {
  try {
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
         SELECT es.campaign_id,
                SUM(CASE WHEN ee.event_type = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN ee.event_type = 'delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN ee.event_type = 'opened' THEN 1 ELSE 0 END) as opened,
                SUM(CASE WHEN ee.event_type = 'clicked' THEN 1 ELSE 0 END) as clicked,
                SUM(CASE WHEN ee.event_type = 'replied' THEN 1 ELSE 0 END) as replied,
                SUM(CASE WHEN ee.event_type = 'bounced' THEN 1 ELSE 0 END) as bounced
         FROM email_events ee
         JOIN email_sequences es ON ee.sequence_id = es.id
         WHERE es.campaign_id IS NOT NULL
         GROUP BY es.campaign_id
       ) stats ON stats.campaign_id = cam.id
       ORDER BY cam.created_at DESC`
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

export default router;
