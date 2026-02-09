import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

interface ScoringRule {
  id: string;
  name: string;
  category: string;
  field_name: string;
  operator: string;
  field_value: any;
  points: number;
  is_active: boolean;
}

/**
 * Calculate the lead score for a single prospect based on all active scoring rules.
 * Evaluates demographic, firmographic, behavioral, and engagement rules.
 */
export async function calculateScore(prospectId: string): Promise<{
  score: number;
  breakdown: Record<string, number>;
}> {
  // Load the prospect with company data
  const prospects = await query<any[]>(
    `SELECT p.*, c.name as company_name, c.industry as company_industry,
            c.employee_count as company_employee_count, c.tier as company_tier,
            c.annual_revenue as company_annual_revenue
     FROM prospects p
     LEFT JOIN companies c ON p.company_id = c.id
     WHERE p.id = ?`,
    [prospectId]
  );

  if (prospects.length === 0) {
    throw new Error(`Prospect ${prospectId} not found.`);
  }

  const prospect = prospects[0];

  // Load active scoring rules
  const rules = await query<ScoringRule[]>(
    'SELECT * FROM scoring_rules WHERE is_active = TRUE ORDER BY category, points DESC'
  );

  // Load engagement data
  const emailEvents = await query<any[]>(
    `SELECT event_type, COUNT(*) as count
     FROM email_events
     WHERE prospect_id = ?
     GROUP BY event_type`,
    [prospectId]
  );

  const engagementMap: Record<string, number> = {};
  for (const event of emailEvents) {
    engagementMap[event.event_type] = event.count;
  }

  // Build prospect data map for rule evaluation
  const prospectData: Record<string, any> = {
    // Demographic fields
    seniority: prospect.seniority,
    title: prospect.title,
    department: prospect.department,
    city: prospect.city,
    region: prospect.region,
    country: prospect.country,

    // Firmographic fields (from company)
    industry: prospect.company_industry,
    employee_count: prospect.company_employee_count,
    annual_revenue: prospect.company_annual_revenue,
    company_tier: prospect.company_tier,

    // Engagement fields
    email_opened: (engagementMap['opened'] || 0) > 0,
    email_clicked: (engagementMap['clicked'] || 0) > 0,
    email_replied: (engagementMap['replied'] || 0) > 0,
    email_bounced: (engagementMap['bounced'] || 0) > 0,
    negative_reply: false, // Would need NLP analysis to detect

    // Behavioral fields
    email_open_count: engagementMap['opened'] || 0,
    email_click_count: engagementMap['clicked'] || 0,
    email_reply_count: engagementMap['replied'] || 0,

    // Status
    status: prospect.status,
    email_verified: prospect.email_verified,
    email_status: prospect.email_status,
  };

  // Evaluate each rule
  let totalScore = 0;
  const breakdown: Record<string, number> = {};

  for (const rule of rules) {
    const matches = evaluateRule(rule, prospectData);
    if (matches) {
      totalScore += rule.points;
      breakdown[rule.name] = rule.points;
    }
  }

  // Clamp score to 0-100 range
  totalScore = Math.max(0, Math.min(100, totalScore));

  // Save the score
  await query(
    'UPDATE prospects SET lead_score = ? WHERE id = ?',
    [totalScore, prospectId]
  );

  // Save score history
  await query(
    `INSERT INTO prospect_score_history (id, prospect_id, score, score_breakdown)
     VALUES (?, ?, ?, ?)`,
    [uuidv4(), prospectId, totalScore, JSON.stringify(breakdown)]
  );

  return { score: totalScore, breakdown };
}

/**
 * Evaluate a single scoring rule against prospect data.
 */
function evaluateRule(rule: ScoringRule, data: Record<string, any>): boolean {
  const fieldValue = data[rule.field_name];

  // Parse the rule's expected value
  let expectedValue: any;
  try {
    expectedValue = typeof rule.field_value === 'string'
      ? JSON.parse(rule.field_value)
      : rule.field_value;
  } catch {
    expectedValue = rule.field_value;
  }

  // If field is undefined/null and operator is not 'exists', skip
  if (fieldValue === undefined || fieldValue === null) {
    return rule.operator === 'not_exists';
  }

  const fieldStr = String(fieldValue).toLowerCase();
  const expectedStr = String(expectedValue).toLowerCase();

  switch (rule.operator) {
    case 'equals':
      if (typeof fieldValue === 'boolean') {
        return fieldValue === (expectedValue === true || expectedValue === 'true');
      }
      return fieldStr === expectedStr;

    case 'not_equals':
      return fieldStr !== expectedStr;

    case 'contains':
      return fieldStr.includes(expectedStr);

    case 'not_contains':
      return !fieldStr.includes(expectedStr);

    case 'greater_than':
      return Number(fieldValue) > Number(expectedValue);

    case 'less_than':
      return Number(fieldValue) < Number(expectedValue);

    case 'in': {
      const allowedValues = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      return allowedValues.some((v: any) => String(v).toLowerCase() === fieldStr);
    }

    case 'not_in': {
      const disallowedValues = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
      return !disallowedValues.some((v: any) => String(v).toLowerCase() === fieldStr);
    }

    case 'exists':
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';

    case 'not_exists':
      return fieldValue === undefined || fieldValue === null || fieldValue === '';

    default:
      console.warn(`Unknown scoring operator: ${rule.operator}`);
      return false;
  }
}

/**
 * Recalculate lead scores for all active prospects.
 * Intended to be run as a scheduled job.
 */
export async function recalculateAllScores(): Promise<{
  processed: number;
  errors: number;
}> {
  console.log('Starting batch score recalculation...');

  const prospects = await query<any[]>(
    `SELECT id FROM prospects
     WHERE status NOT IN ('unsubscribed', 'bounced')
     AND do_not_contact = FALSE`
  );

  let processed = 0;
  let errors = 0;

  for (const prospect of prospects) {
    try {
      await calculateScore(prospect.id);
      processed++;
    } catch (err: any) {
      console.error(`Score calculation failed for ${prospect.id}:`, err.message);
      errors++;
    }
  }

  console.log(`Batch score recalculation complete. Processed: ${processed}, Errors: ${errors}`);
  return { processed, errors };
}
