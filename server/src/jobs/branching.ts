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
  currentStep: { id: string; step_number: number; yes_next_step_id?: string; no_next_step_id?: string }
): Promise<ResolvedStep | null> {
  // Look for the next step in linear order
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
    const condConfig: ConditionConfig | null = typeof nextCandidate.condition_config === 'string'
      ? JSON.parse(nextCandidate.condition_config)
      : nextCandidate.condition_config;

    if (!condConfig) {
      console.warn(`Condition step ${nextCandidate.id} has no config, defaulting to YES path`);
      if (nextCandidate.yes_next_step_id) {
        const yesStep = await query<any[]>(
          'SELECT * FROM sequence_steps WHERE sequence_id = ? AND id = ? AND is_active = TRUE',
          [enrollment.sequence_id, nextCandidate.yes_next_step_id]
        );
        return yesStep.length > 0 ? { step: yesStep[0], conditionResult: true, conditionStepId: nextCandidate.id } : null;
      }
      return null;
    }

    const result = await evaluateCondition(condConfig, enrollment);
    const targetStepId = result
      ? nextCandidate.yes_next_step_id
      : nextCandidate.no_next_step_id;

    if (!targetStepId) {
      return null; // No routing for this branch — sequence ends
    }

    const targetStep = await query<any[]>(
      'SELECT * FROM sequence_steps WHERE sequence_id = ? AND id = ? AND is_active = TRUE',
      [enrollment.sequence_id, targetStepId]
    );

    return targetStep.length > 0 ? { step: targetStep[0], conditionResult: result, conditionStepId: nextCandidate.id } : null;
  }

  // Not a condition — return it directly (linear behavior)
  return { step: nextCandidate };
}
