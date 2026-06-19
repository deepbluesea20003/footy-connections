# CLAUDE.md

Guidance for working in this repo. Keep it accurate — update it when the shape of
the code changes.

## What this is

**Football Separation Number** — find the shortest connection between any two
footballers through shared teammates (a "six degrees" graph over club squads).

- `backend/` — Node 22 + Express 5 + TypeScript (ESM). Serves the API and, in
  prod, the built frontend. Also home to the data-import scripts.
- `frontend/` — React 19 + Vite 7 + Tailwind 4. Talks to `/api/*`.
- npm **workspaces** (`backend`, `frontend`); root scripts proxy into them.

Data lives in **Neon** (serverless Postgres). The graph is built **in memory at
startup** from the DB (`backend/src/db/loader.ts` → `graph/build.ts`). If
`DATABASE_URL` is unset, the app falls back to a small hardcoded seed
(`backend/src/data/`), so it runs with zero infra for local UI work.

## Commands

Run from repo root unless noted. Every data script loads `backend/.env`.

```bash
npm run dev                 # backend (API + graph) on :3000
npm run dev:frontend        # frontend on :5173 (Vite proxies /api → :3000)
npm test                    # backend tests (vitest)
npm run build               # build backend + frontend
npm run status              # import progress snapshot (clubs / storage / counts)

# Data pipeline (all need DATABASE_URL in backend/.env):
npm run seed   --workspace=backend          # ~89 hardcoded players, bootstrap
npm run fetch  --workspace=backend          # recent PL squads (FOOTBALL_DATA_API_KEY)
npm run import:wikidata --workspace=backend  # deep global history (the big one)
npm run enrich:reep     --workspace=backend  # stamp players with reep canonical IDs
```

## The data pipeline (the important/complex part)

`import:wikidata` (`backend/src/scripts/fetch-from-wikidata.ts`) is a long-running,
**fully resumable** batch importer. Everything below is why it's structured the
way it is — don't "simplify" these away:

- **Two phases, both checkpointed in Neon.** `discovery` enumerates every football
  club with ≥ `MIN_CLUB_MEMBERS` squad members into `import_club_queue`;
  `processing` works that queue most-notable-first, pulling each club's full P54
  membership history, expanding date ranges into seasons, and upserting
  `players` / `player_external_ids` / `player_club_seasons`.
- **Idempotent + resumable.** Every write is `ON CONFLICT DO NOTHING/UPDATE`; each
  club is an atomic checkpoint. Kill it (SIGTERM / crash / Cloud Run preemption)
  and re-run — it picks up from the queue. `main()` also retries transient
  DB/network blips.
- **Storage-budget capped.** Processing stops once `pg_database_size` approaches
  `MAX_DB_BYTES` (~440 MB) so it stays inside Neon's free tier and imports the
  most-connected clubs first.
- **Identity resolution.** Players dedupe across sources via
  `backend/src/db/player-identity.ts` — keyed on Wikidata QID and on
  normalized name + date_of_birth. The DB is always kept a superset of the
  in-memory cache so FKs can't dangle.
- **Tunables (env):** `MIN_CLUB_MEMBERS`, `MIN_SEASON_YEAR`, `MAX_DB_BYTES`,
  `WIKIDATA_DELAY_MS`, `PROCESS_BATCH`, `PROCESS_LIMIT`, `WIKIDATA_UA`,
  `CURRENT_SEASON_START_YEAR`.
- **Reset for a clean re-import:** `TRUNCATE import_club_queue; DELETE FROM import_jobs;`

### Gotchas

- **Wikidata is dirty.** P54 dates can be vandalized/garbage (URLs where a date
  belongs, absurd end-years that create phantom teammate hubs). `validDate()` and
  `seasonsBetween()` (`utils/season.ts`, bounded by `MIN_SEASON_YEAR` /
  `CURRENT_SEASON_START_YEAR`) exist to bound this — keep them.
- **Neon serverless driver is HTTP-per-query.** Big reads must paginate;
  `loader.ts` cursor-paginates the ~1M-row join on the full ORDER BY tuple
  because a single query can be truncated by the driver. Don't collapse it.
- **SPARQL is rate-limited.** `WIKIDATA_DELAY_MS` between requests + 429/Retry-After
  backoff. Be polite; keep the descriptive `User-Agent`.

## Schema

`backend/src/db/schema.sql` (also self-created by scripts via `ensureSchema`):
`players` (slug PK, dedup key = name+dob) · `player_external_ids`
(per-source provider IDs) · `clubs` · `player_club_seasons` (the graph edges).
Importer bookkeeping: `import_jobs` (phase/cursor), `import_club_queue` (work queue).
`players.reep_id` is added later by `enrich:reep`.

## Running the importer in the cloud (free, hands-off)

Don't fill the DB from a laptop. The importer is meant to run as a **GCP Cloud Run
Job**, built by **Cloud Build** (no local Docker needed) from
`backend/Dockerfile.job`.

```bash
gcloud auth login && gcloud config set project YOUR_PROJECT_ID
./backend/deploy-importer.sh              # build → push → create job → execute once
./backend/deploy-importer.sh --schedule   # also add a daily Cloud Scheduler trigger
./backend/deploy-importer.sh --once       # just re-execute an already-deployed job
```

The job is resumable and self-limiting, so "kick off and walk away" works: a run
fills toward the storage budget and exits; re-running (or the daily schedule)
resumes until the queue is drained. Watch progress with `npm run status` locally,
or job logs in the Cloud Run console. See `backend/deploy-importer.sh` header for
all knobs (region, memory, image names) and free-tier notes.

## Web app deploy

The API+frontend server image is the root `Dockerfile` (separate from the importer
job). `npm run build` then `node backend/dist/index.js`; serves `frontend/dist`
and `/api/*`. Listens on `PORT` (8080 in the container, 3000 in dev).

## Conventions

- ESM throughout; **imports use `.js` extensions** for local files (TS compiled to
  ESM) — e.g. `import { sql } from "./connection.js"`.
- Scripts read env via `tsx --env-file=.env`; never hardcode secrets. `DATABASE_URL`
  is the one required secret.
- Tests live in `backend/tests/` (vitest). Run `npm test` before declaring done.
