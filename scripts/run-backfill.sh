#!/usr/bin/env bash
# =====================================================================
# Allin Signal · backfill driver
# =====================================================================
# Edge Functions time out at ~150s. The backfill endpoint processes one
# batch per call and returns; this loop drives it to completion.
#
# Usage:
#   chmod +x scripts/run-backfill.sh
#   ./scripts/run-backfill.sh free       # 5 calls/min, ~3.5h for 1000 days
#   ./scripts/run-backfill.sh starter    # unlimited, ~5 min for 1000 days
#
# Resume after Ctrl-C / failure: just re-run. Cursor is persisted in
# the scan_runs table.
# Start over: ./scripts/run-backfill.sh reset
# =====================================================================

set -e

REF="ojmbqmbiyjpokhspcjbs"
URL="https://${REF}.supabase.co/functions/v1/backfill"

# Replace with your anon key (Supabase → Settings → API)
ANON="${SUPABASE_ANON:?Set SUPABASE_ANON env var}"

TIER="${1:-free}"

if [ "$TIER" = "reset" ]; then
  echo "Clearing checkpoint..."
  curl -s -X POST "${URL}?reset=true" -H "Authorization: Bearer ${ANON}"
  echo
  exit 0
fi

DAYS="${DAYS:-1050}"   # ~4 years
echo "Starting backfill: tier=${TIER} days=${DAYS}"

while true; do
  RESP=$(curl -s -X POST "${URL}?tier=${TIER}&days=${DAYS}" \
              -H "Authorization: Bearer ${ANON}")
  echo "$(date '+%H:%M:%S')  ${RESP}"

  STATUS=$(echo "${RESP}" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  if [ "${STATUS}" = "done" ]; then
    echo "✅ Backfill complete."
    break
  fi
  if [ -z "${STATUS}" ]; then
    echo "❌ Unexpected response; retrying in 30s..."
    sleep 30
  fi
  # short pause between batches (the function itself sleeps between API calls)
  sleep 2
done
