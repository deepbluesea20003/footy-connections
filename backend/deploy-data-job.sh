#!/usr/bin/env bash
#
# deploy-data-job.sh — host the fused data population on GCP and fire it off.
#
# Each run rebuilds the co-appearance dataset from DOWNLOADS ONLY (reep + the
# Transfermarkt CSVs + the API-Football bulk dataset) — no scraping, so there's
# no IP-block / anti-bot risk. Five sequential, idempotent phases:
#   1. load-reep            — CC0 identity register (canonical player ids)
#   2. import-transfermarkt — top divisions + cups (faces, market value, history)
#   3. import-api-football  — lower tiers (AF_LEAGUE_IDS), merged into one graph via reep
#   4. reconcile-identities — fold DOB-less orphan nodes into their reep node
#   5. recompute-popularity — search ranking (market value, else Big-5 appearances)
# It's a clean full reload (~minutes), not a checkpointed resume, so just re-run
# to refresh; safe to run repeatedly.
#
# What it does (all server-side; no local Docker required):
#   1. Builds backend/Dockerfile.job with Cloud Build, pushes to Artifact Registry.
#   2. Stores DATABASE_URL (from backend/.env, or env override) in Secret Manager.
#   3. Creates/updates a Cloud Run Job (24h timeout, 4Gi memory, retries).
#   4. Executes it once.
#
# Usage:
#   gcloud auth login && gcloud config set project YOUR_PROJECT_ID
#   ./backend/deploy-data-job.sh                       # full deploy + execute once (uses backend/.env)
#   DATABASE_URL=<branch-url> ./backend/deploy-data-job.sh   # test run against a Neon branch
#   AF_LEAGUE_IDS=2,3,4,103,... ./backend/deploy-data-job.sh  # widen lower-tier coverage
#   ./backend/deploy-data-job.sh --once                # skip build, just re-execute
#   ./backend/deploy-data-job.sh --schedule            # also add a weekly auto-run
#   ./backend/deploy-data-job.sh --no-run              # deploy only
#
# Overridable via env: REGION, MEMORY, CPU, JOB, REPO, SECRET, CRON, DATABASE_URL,
#   AF_LEAGUE_IDS, AF_MIN_SEASON, TM_COMP_TYPES, AF_FIXTURE_PLAYERS_URL.
#
# Note: the API-Football appearances file is ~577MB via GitHub LFS (1GB/month free
# bandwidth). For frequent runs, mirror it to GCS once and set AF_FIXTURE_PLAYERS_URL.
set -euo pipefail

# ---- config -----------------------------------------------------------------
REGION="${REGION:-europe-west2}"
JOB="${JOB:-footy-data-import}"
REPO="${REPO:-footy}"
SECRET="${SECRET:-footy-db-url}"
MEMORY="${MEMORY:-4Gi}"            # holds the ~577MB appearances file in /tmp (tmpfs)
CPU="${CPU:-1}"
CRON="${CRON:-0 4 * * 1}"          # weekly Mon 04:00 (used with --schedule)
TASK_TIMEOUT="${TASK_TIMEOUT:-86400s}"
MAX_RETRIES="${MAX_RETRIES:-3}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DO_BUILD=1; DO_RUN=1; DO_SCHEDULE=0
for arg in "$@"; do
  case "$arg" in
    --once)      DO_BUILD=0; DO_RUN=1 ;;
    --no-run)    DO_RUN=0 ;;
    --schedule)  DO_SCHEDULE=1 ;;
    -h|--help)   sed -n '2,33p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mXX \033[0m %s\n' "$*" >&2; exit 1; }

# ---- preflight --------------------------------------------------------------
command -v gcloud >/dev/null || die "gcloud not found. Install the Google Cloud SDK."

ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
[ -n "$ACCOUNT" ] || die "Not logged in. Run: gcloud auth login"

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
[ -n "$PROJECT" ] && [ "$PROJECT" != "(unset)" ] || \
  die "No project set. Run: gcloud config set project YOUR_PROJECT_ID"

say "Account: $ACCOUNT"
say "Project: $PROJECT   Region: $REGION   Job: $JOB"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/footy-data-job:latest"

# ---- DATABASE_URL -----------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ] && [ -f "${ROOT}/backend/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "${ROOT}/backend/.env" | head -1 | cut -d= -f2-)"
fi
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL not found in env or backend/.env"

# Optional scope/env passed through to the job.
ENV_KV=""
for k in AF_LEAGUE_IDS AF_MIN_SEASON TM_COMP_TYPES AF_FIXTURE_PLAYERS_URL; do
  v="${!k:-}"; [ -n "$v" ] && ENV_KV="${ENV_KV:+$ENV_KV,}${k}=${v}"
done

# ---- enable APIs ------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ] || [ "$DO_SCHEDULE" -eq 1 ]; then
  say "Enabling required APIs (idempotent)…"
  APIS="run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com"
  [ "$DO_SCHEDULE" -eq 1 ] && APIS="$APIS cloudscheduler.googleapis.com"
  gcloud services enable $APIS --project "$PROJECT" --quiet
fi

# ---- secret -----------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ]; then
  say "Storing DATABASE_URL in Secret Manager ($SECRET)…"
  _tmpfile=$(mktemp); trap "rm -f $_tmpfile" EXIT
  printf '%s' "$DATABASE_URL" > "$_tmpfile"
  if gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file="$_tmpfile" >/dev/null
  else
    gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy=automatic --data-file="$_tmpfile" >/dev/null
  fi
  rm -f "$_tmpfile"
  gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
    --member="serviceAccount:${COMPUTE_SA}" --role=roles/secretmanager.secretAccessor \
    --quiet >/dev/null 2>&1 || warn "could not bind secret accessor to $COMPUTE_SA (may already exist)"

  if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    say "Creating Artifact Registry repo: $REPO ($REGION)…"
    gcloud artifacts repositories create "$REPO" --repository-format=docker \
      --location "$REGION" --project "$PROJECT" --description="footy images" --quiet
  fi

  say "Building image with Cloud Build (no local Docker)…"
  gcloud builds submit "$ROOT" --project "$PROJECT" \
    --config "${ROOT}/backend/cloudbuild.data.yaml" \
    --substitutions="_IMAGE=${IMAGE}"

  COMMON_FLAGS=(--image "$IMAGE" --region "$REGION" --project "$PROJECT"
    --set-secrets "DATABASE_URL=${SECRET}:latest"
    --max-retries "$MAX_RETRIES" --task-timeout "$TASK_TIMEOUT"
    --memory "$MEMORY" --cpu "$CPU")
  [ -n "$ENV_KV" ] && COMMON_FLAGS+=(--set-env-vars "$ENV_KV")
  if gcloud run jobs describe "$JOB" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    say "Updating existing Cloud Run Job…"
    gcloud run jobs update "$JOB" "${COMMON_FLAGS[@]}" --quiet
  else
    say "Creating Cloud Run Job…"
    gcloud run jobs create "$JOB" "${COMMON_FLAGS[@]}" --quiet
  fi
fi

# ---- schedule (optional) ----------------------------------------------------
if [ "$DO_SCHEDULE" -eq 1 ]; then
  SA_NAME="footy-scheduler"; SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name="Footy data scheduler" --quiet
  fi
  gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --project "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/run.invoker --quiet >/dev/null
  RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run"
  if gcloud scheduler jobs describe "${JOB}-cron" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${JOB}-cron" --location "$REGION" --project "$PROJECT" \
      --schedule="$CRON" --uri="$RUN_URI" --http-method=POST --oauth-service-account-email="$SA_EMAIL" --quiet
  else
    gcloud scheduler jobs create http "${JOB}-cron" --location "$REGION" --project "$PROJECT" \
      --schedule="$CRON" --uri="$RUN_URI" --http-method=POST --oauth-service-account-email="$SA_EMAIL" --quiet
  fi
fi

# ---- execute ----------------------------------------------------------------
if [ "$DO_RUN" -eq 1 ]; then
  say "Executing the job (fire-and-forget)…"
  gcloud run jobs execute "$JOB" --region "$REGION" --project "$PROJECT" --quiet
fi

cat <<EOF

$(say "Done.")
  Watch progress:
    gcloud run jobs executions list --job $JOB --region $REGION
    gcloud beta run jobs logs read $JOB --region $REGION   # live logs
  Re-run any time:
    ./backend/deploy-data-job.sh --once
EOF
