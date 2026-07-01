#!/usr/bin/env bash
#
# scrape-resume.sh — resume the historical Transfermarkt scrape after a timeout.
#
#   ./backend/scrape-resume.sh
#
# Cloud Run job tasks cap at 24h; the full big-5 × 1990–2011 scrape is longer, so
# it exits partway and needs re-running. The scraper is resumable — it skips any
# game already in the DB — so resuming just continues where it left off.
#
# Safe to run repeatedly (and on a schedule): it only starts a new execution if
# none is currently running, so it never stacks concurrent scrapes. Override
# JOB/REGION/GCP_PROJECT via env if they differ.
set -euo pipefail

JOB="${JOB:-footy-scrape}"
REGION="${REGION:-europe-west2}"
PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT" ] || { echo "No GCP project set (gcloud config set project …)"; exit 1; }

ACTIVE="$(gcloud run jobs executions list --job "$JOB" --region "$REGION" --project "$PROJECT" \
  --format='value(name)' --filter='status.runningCount>0' 2>/dev/null | head -1 || true)"
if [ -n "$ACTIVE" ]; then
  echo "A run is already active ($ACTIVE) — leaving it. Nothing to resume."
  exit 0
fi

echo "No active run. Resuming $JOB…"
gcloud run jobs execute "$JOB" --region "$REGION" --project "$PROJECT"
