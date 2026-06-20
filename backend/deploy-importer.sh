#!/usr/bin/env bash
#
# deploy-importer.sh — host the resumable Wikidata importer on GCP and fire it off.
#
# Each job run does two resumable phases: it imports squad history, then enriches
# newly-imported players (sitelinks/photo/nationality) and refreshes search
# popularity — so the search ranking stays current with every run.
#
# What it does (all server-side; no local Docker required):
#   1. Builds backend/Dockerfile.job with Cloud Build, pushes to Artifact Registry.
#   2. Stores DATABASE_URL (from backend/.env) in Secret Manager.
#   3. Creates/updates a Cloud Run Job (24h task timeout, resumable, retries).
#   4. Executes the job once — fire-and-forget. Re-running resumes from the
#      Neon checkpoint, so you can just kick it off and walk away.
#
# Usage:
#   gcloud auth login && gcloud config set project YOUR_PROJECT_ID
#   ./backend/deploy-importer.sh             # full deploy + execute once
#   ./backend/deploy-importer.sh --once      # skip build/deploy, just re-execute
#   ./backend/deploy-importer.sh --schedule  # full deploy + add a daily auto-run
#   ./backend/deploy-importer.sh --no-run    # deploy only, don't execute
#
# Overridable via env: REGION, MEMORY, CPU, JOB, REPO, SECRET, CRON, DATABASE_URL.
#
# Cost: stays inside GCP's free tier. Cloud Run gives ~180k vCPU-sec + 360k
# GiB-sec/month free; one 24h run at 1 vCPU / 2 GiB uses ~86k / ~173k, so ~2 full
# runs/month are free — and the importer self-stops at the storage budget, so it
# usually finishes well inside that. Cloud Build (120 min/day), Artifact Registry
# (0.5 GB), Secret Manager and Cloud Scheduler (3 jobs) free tiers cover the rest.
set -euo pipefail

# ---- config -----------------------------------------------------------------
REGION="${REGION:-europe-west2}"
JOB="${JOB:-footy-wikidata-import}"
REPO="${REPO:-footy}"
SECRET="${SECRET:-footy-db-url}"
MEMORY="${MEMORY:-2Gi}"
CPU="${CPU:-1}"
CRON="${CRON:-0 3 * * *}"          # daily 03:00 (used with --schedule)
TASK_TIMEOUT="${TASK_TIMEOUT:-86400s}"  # 24h — Cloud Run Jobs max
MAX_RETRIES="${MAX_RETRIES:-5}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DO_BUILD=1; DO_RUN=1; DO_SCHEDULE=0
for arg in "$@"; do
  case "$arg" in
    --once)      DO_BUILD=0; DO_RUN=1 ;;
    --no-run)    DO_RUN=0 ;;
    --schedule)  DO_SCHEDULE=1 ;;
    -h|--help)   sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
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
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/footy-importer:latest"

# ---- DATABASE_URL -----------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ] && [ -f "${ROOT}/backend/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "${ROOT}/backend/.env" | head -1 | cut -d= -f2-)"
fi
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL not found in env or backend/.env"

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
  # Use a temp file instead of stdin (--data-file=- can hang on some systems)
  _tmpfile=$(mktemp)
  trap "rm -f $_tmpfile" EXIT
  printf '%s' "$DATABASE_URL" > "$_tmpfile"
  if gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file="$_tmpfile" >/dev/null
  else
    gcloud secrets create "$SECRET" --project "$PROJECT" \
      --replication-policy=automatic --data-file="$_tmpfile" >/dev/null
  fi
  rm -f "$_tmpfile"
  # The job's runtime SA (Compute default) must read the secret.
  gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
    --member="serviceAccount:${COMPUTE_SA}" --role=roles/secretmanager.secretAccessor \
    --quiet >/dev/null 2>&1 || warn "could not bind secret accessor to $COMPUTE_SA (may already exist)"

  # ---- artifact registry ----------------------------------------------------
  if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    say "Creating Artifact Registry repo: $REPO ($REGION)…"
    gcloud artifacts repositories create "$REPO" --repository-format=docker \
      --location "$REGION" --project "$PROJECT" --description="footy images" --quiet
  fi

  # ---- build ----------------------------------------------------------------
  say "Building image with Cloud Build (no local Docker)… this takes a couple of minutes."
  gcloud builds submit "$ROOT" --project "$PROJECT" \
    --config "${ROOT}/backend/cloudbuild.importer.yaml" \
    --substitutions="_IMAGE=${IMAGE}"

  # ---- create / update job --------------------------------------------------
  COMMON_FLAGS=(--image "$IMAGE" --region "$REGION" --project "$PROJECT"
    --set-secrets "DATABASE_URL=${SECRET}:latest"
    --max-retries "$MAX_RETRIES" --task-timeout "$TASK_TIMEOUT"
    --memory "$MEMORY" --cpu "$CPU")
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
  SA_NAME="footy-scheduler"
  SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1; then
    say "Creating scheduler service account…"
    gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
      --display-name="Footy importer scheduler" --quiet
  fi
  gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --project "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/run.invoker --quiet >/dev/null
  RUN_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run"
  if gcloud scheduler jobs describe "${JOB}-daily" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    say "Updating daily schedule ($CRON)…"
    gcloud scheduler jobs update http "${JOB}-daily" --location "$REGION" --project "$PROJECT" \
      --schedule="$CRON" --uri="$RUN_URI" --http-method=POST \
      --oauth-service-account-email="$SA_EMAIL" --quiet
  else
    say "Creating daily schedule ($CRON)…"
    gcloud scheduler jobs create http "${JOB}-daily" --location "$REGION" --project "$PROJECT" \
      --schedule="$CRON" --uri="$RUN_URI" --http-method=POST \
      --oauth-service-account-email="$SA_EMAIL" --quiet
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
    npm run status                                   # from this repo (reads Neon)
    gcloud run jobs executions list --job $JOB --region $REGION
    gcloud beta run jobs logs read $JOB --region $REGION   # live logs
  Re-run / resume any time:
    ./backend/deploy-importer.sh --once
EOF
