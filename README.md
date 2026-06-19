# Football Separation Number

Find the shortest connection between any two Premier League players through shared teammates.

## Quick Start

```bash
npm install
npm run dev              # backend on :3000
npm run dev:frontend     # frontend on :5173 (proxies to backend)
```

## Project Structure

```
backend/    Node.js + Express + TypeScript API
frontend/   React + Vite + Tailwind CSS
```

## API

- `POST /api/separation` — `{ player1, player2 }` → shortest path + separation number
- `GET /api/players/search?q=` — autocomplete player search
- `GET /api/health` — status check

## Data

Player/club/season data lives in Neon (PostgreSQL). The graph is built in-memory
at startup from the DB; if `DATABASE_URL` is unset the app falls back to a small
hardcoded seed. Identity is deduped across sources by Wikidata QID and name+DOB
(see `backend/src/db/player-identity.ts`).

Importers (each loads `backend/.env`):

```bash
npm run seed            --workspace=backend   # bootstrap the ~89 hardcoded players
npm run fetch           --workspace=backend   # recent PL squads from football-data.org (needs FOOTBALL_DATA_API_KEY)
npm run import:wikidata --workspace=backend   # deep history from Wikidata (30+ years, global)
```

### Wikidata importer (resumable)

`import:wikidata` is a long-running, resumable batch job. It discovers every
football club with squad members into a Neon work queue (`import_club_queue`),
then processes each club — pulling its full member history, expanding date
ranges into seasons, and upserting players + `player_club_seasons`. All progress
is checkpointed, so it resumes after any interruption (SIGTERM/crash/preemption).

Tunable via env: `MIN_SEASON_YEAR`, `WIKIDATA_DELAY_MS`, `DISCOVERY_MAX_PAGES`,
`PROCESS_LIMIT`, `PROCESS_BATCH`, `WIKIDATA_UA`.

**Run it in the cloud (recommended)** — don't fill the DB from a laptop. One
command builds the importer with Cloud Build (no local Docker), deploys it as a
GCP Cloud Run Job, and fires it off:

```bash
gcloud auth login && gcloud config set project YOUR_PROJECT_ID
./backend/deploy-importer.sh             # build → deploy → execute once
./backend/deploy-importer.sh --schedule  # also auto-run daily until complete
```

It's resumable and self-limiting (stops at the storage budget), so re-running
just continues. Stays inside GCP's free tier — see the script header for details.
Reset for a clean re-import with `TRUNCATE import_club_queue; DELETE FROM import_jobs;`.

## Testing

```bash
npm test
```

## Deploy (Cloud Run)

```bash
docker build -t football-separation .
docker run -p 8080:8080 football-separation
```
