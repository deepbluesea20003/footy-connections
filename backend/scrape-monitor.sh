#!/usr/bin/env bash
#
# scrape-monitor.sh — one-shot status snapshot of the historical Transfermarkt
# scrape (the `footy-scrape` Cloud Run job). Run it any time:
#
#   ./backend/scrape-monitor.sh
#
# Shows: recent executions + whether one is running, the latest progress log
# lines, and (if psql + DATABASE_URL are available) the cumulative rows in the DB.
# Read-only. Override JOB/REGION/GCP_PROJECT via env if they differ.
set -euo pipefail

JOB="${JOB:-footy-scrape}"
REGION="${REGION:-europe-west2}"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT" ] || { echo "No GCP project set (gcloud config set project …)"; exit 1; }

echo "== executions (most recent first) =="
gcloud run jobs executions list --job "$JOB" --region "$REGION" --project "$PROJECT" --limit 5 2>/dev/null || true

ACTIVE="$(gcloud run jobs executions list --job "$JOB" --region "$REGION" --project "$PROJECT" \
  --format='value(name)' --filter='status.runningCount>0' 2>/dev/null | head -1 || true)"
echo
if [ -n "$ACTIVE" ]; then echo "STATUS: running ($ACTIVE)"; else echo "STATUS: idle — run ./backend/scrape-resume.sh to continue"; fi

echo
echo "== recent progress (last 1h) =="
gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\" AND resource.labels.location=\"$REGION\"" \
  --project "$PROJECT" --limit 500 --freshness=1h --format='value(textPayload)' 2>/dev/null \
  | grep -iE "scraping comps|: [0-9]+ matches|scraped [0-9]+ matches|DONE|no fixtures|Error|error:" \
  | head -20 || echo "(no recent log lines)"

# Cumulative DB progress — optional (needs psql + a DATABASE_URL).
DB="${DATABASE_URL:-}"
if [ -z "$DB" ] && [ -f "$(dirname "$0")/.env" ]; then
  DB="$(grep -E '^DATABASE_URL=' "$(dirname "$0")/.env" | head -1 | cut -d= -f2-)"
fi
if command -v psql >/dev/null 2>&1 && [ -n "$DB" ]; then
  echo
  echo "== DB totals =="
  psql "$DB" -tA -F': ' -c \
    "SELECT 'scraped games', count(*) FROM games WHERE source='tm-scrape'
     UNION ALL SELECT 'scraped comp-seasons', count(DISTINCT competition_id||season) FROM games WHERE source='tm-scrape'
     UNION ALL SELECT 'total players', count(*) FROM players;" 2>/dev/null || echo "(db query skipped)"
fi
