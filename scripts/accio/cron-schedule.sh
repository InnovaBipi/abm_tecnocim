#!/bin/bash
# Daily ACCIÓ approval runner (bounces-gated)
# Scheduled: 14:30 Madrid (Europe/Madrid timezone)
# Runs: Mon-Fri only

CAMPAIGN_ID="09ff25ad-04e5-4d5e-906d-af3a0795c2f3"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/daily-approve-$(date +%Y%m%d).log"

{
  echo "=== $(date) ==="
  echo "Campaign: $CAMPAIGN_ID"
  
  # Run approval (bounce-gated, --tranche 75 for Phase 1 escalation)
  node "$SCRIPT_DIR/daily-approve.js" --campaign "$CAMPAIGN_ID" --tranche 75 --bounce-thresh 4
  
  echo "=== Done $(date) ==="
} >> "$LOG_FILE" 2>&1

exit 0
