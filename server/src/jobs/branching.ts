import { query } from '../config/database';

// =============================================
// Decision Tree: Condition Evaluation & Step Resolution
// =============================================

export interface ConditionConfig {
  type: 'opened' | 'clicked' | 'replied';
  step_id?: string;
  threshold_hours?: number;
}

export interface EnrollmentContext {
  id: string;
  sequence_id: string;
  prospect_id: string;
  current_step: number;
  current_step_id?: string;
  tenant_id: string;
}

export interface ResolvedStep {
  step: any;
  conditionResult?: boolean;
  conditionStepId?: string;
}

/**
 * Evaluate a behavioral condition against email events for a prospect.
 * Checks if the prospect performed the specified action (opened, clicked, replied)
 * within the threshold window.
 *
 * @returns true if the condition is met (YES path), false otherwise (NO path)
 */
export async function evaluateCondition(
  config: ConditionConfig,
  enrollment: { prospect_id: string; sequence_id: string; tenant_id: string }
): Promise<boolean> {
  const eventTypeMap: Record<string, string> = {
    opened: 'opened',
    clicked: 'clicked',
    replied: 'replied',
  };

  const eventType = eventTypeMap[config.type];
  if (!eventType) {
    console.warn(`Unknown condition type: ${config.type}, defaulting to NO path`);
    return false;
  }

  // Query email_events with full tenant isolation
  const params: any[] = [enrollment.tenant_id, enrollment.prospect_id, enrollment.sequence_id, eventType];
  let stepFilter = '';
  let thresholdFilter = '';

  if (config.step_id) {
    stepFilter = ' AND step_id = ?';
    params.push(config.step_id);
  }

  if (config.threshold_hours) {
    thresholdFilter = ' AND occurred_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)';
    params.push(config.threshold_hours);
  }

  const result = await query<any[]>(
    `SELECT COUNT(*) as count FROM email_events
     WHERE tenant_id = ? AND prospect_id = ? AND sequence_id = ? AND event_type = ?${stepFilter}${thresholdFilter}`,
    params
  );

  return (result[0]?.count || 0) > 0;
}

/**
 * Evaluate a condition step and return the resolved target step (YES or NO path).
 */
async function evaluateConditionStep(
  condStep: any,
  enrollment: EnrollmentContext
): Promise<ResolvedStep | null> {
  const condConfig: ConditionConfig | null = typeof condStep.condition_config === 'string'
    ? JSON.parse(condStep.condition_config)
    : condStep.condition_config;

  if (!condConfig) {
    console.warn(`Condition step ${condStep.id} has no config, defaulting to YES path`);
    if (condStep.yes_next_step_id) {
      const yesStep = await query<any[]>(
        'SELECT * FROM sequence_steps WHERE sequence_id = ? AND id = ? AND is_active = TRUE',
        [enrollment.sequence_id, condStep.yes_next_step_id]
      );
      return yesStep.length > 0 ? { step: yesStep[0], conditionResult: true, conditionStepId: condStep.id } : null;
    }
    return null;
  }

  const result = await evaluateCondition(condConfig, enrollment);
  const targetStepId = result ? condStep.yes_next_step_id : condStep.no_next_step_id;

  if (!targetStepId) {
    return null;
  }

  const targetStep = await query<any[]>(
    'SELECT * FROM sequence_steps WHERE sequence_id = ? AND id = ? AND is_active = TRUE',
    [enrollment.sequence_id, targetStepId]
  );

  return targetStep.length > 0 ? { step: targetStep[0], conditionResult: result, conditionStepId: condStep.id } : null;
}

/**
 * Resolve the next step for an enrollment, supporting both linear and branched sequences.
 *
 * Linear mode (default): Returns step_number + 1 — identical to existing behavior.
 * Branched mode: If the next step is a condition node, evaluates it and routes
 * to the YES or NO target step based on prospect behavior.
 *
 * Tenant isolation is enforced via sequence_id (child of tenant-scoped email_sequences).
 * Step-by-ID lookups also filter by sequence_id to prevent cross-sequence access.
 *
 * @returns The resolved next step with optional condition metadata, or null if sequence is complete.
 */
export async function resolveNextStep(
  enrollment: EnrollmentContext,
  currentStep: { id: string; step_number: number; step_type?: string; yes_next_step_id?: string; no_next_step_id?: string }
): Promise<ResolvedStep | null> {
  // GRAPH NAVIGATION: If current step has an explicit yes_next_step_id, follow it.
  // This handles email steps in branched sequences that need to skip to the
  // correct next step (e.g., step 3 "engaged" → step 5 "condition clicked?"
  // instead of step 4 "not_engaged").
  if (currentStep.yes_next_step_id) {
    const explicitNext = await query<any[]>(
      'SELECT * FROM sequence_steps WHERE sequence_id = ? AND id = ? AND is_active = TRUE',
      [enrollment.sequence_id, currentStep.yes_next_step_id]
    );

    if (explicitNext.length === 0) {
      return null; // Wired step doesn't exist — sequence ends
    }

    const nextStep = explicitNext[0];

    // If the explicit next step is a condition, evaluate it
    if (nextStep.step_type === 'condition') {
      return evaluateConditionStep(nextStep, enrollment);
    }

    return { step: nextStep };
  }

  // LINEAR FALLBACK: No explicit routing — use step_number + 1 (existing behavior)
  const candidateNextNumber = currentStep.step_number + 1;
  const candidates = await query<any[]>(
    `SELECT * FROM sequence_steps
     WHERE sequence_id = ? AND step_number = ? AND is_active = TRUE`,
    [enrollment.sequence_id, candidateNextNumber]
  );

  if (candidates.length === 0) {
    return null; // Sequence complete
  }

  const nextCandidate = candidates[0];

  // If the next step is a condition, evaluate it and route to YES or NO path
  if (nextCandidate.step_type === 'condition') {
    return evaluateConditionStep(nextCandidate, enrollment);
  }

  // Not a condition — return it directly (linear behavior)
  return { step: nextCandidate };
}
