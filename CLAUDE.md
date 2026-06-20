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
npm run enrich:wikidata --workspace=backend  # sitelinks/photo/nationality → search ranking
npm run enrich:crests   --workspace=backend  # club crests (football-data.org → Wikidata P154)
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

### Search-ranking enrichment

`enrich:wikidata` (`backend/src/scripts/enrich-from-wikidata.ts`) is a separate,
short (~20 min) pass that makes search return the *notable* player first (the real
Pelé, not his namesakes). Keyed on the QID already in `player_external_ids`, it
batches SPARQL to fetch per player: `sitelinks` (Wikipedia language-edition count
= fame proxy), `image_file` (Commons P18 photo), and `nationality` (P27). It then
computes `players.popularity` = `log(1+sitelinks)` + a light career/recency term
from `player_club_seasons`. `search()` ([`services/player-search.ts`]) orders every
match tier by `popularity`, so same-name collisions resolve fame-first.

- **Idempotent + resumable.** Only rows with `sitelinks IS NULL` are fetched;
  missing entities are stamped `0` so they aren't retried. Re-run any time;
  `--recompute` redoes only the popularity blend (after tuning weights), no
  network. Tunables: `ENRICH_BATCH`, `ENRICH_CHUNK`, `ENRICH_LIMIT`, `WIKIDATA_DELAY_MS`.
- **Photos are hotlinked, not stored.** We persist only the Commons filename and
  build a sized `Special:FilePath` thumbnail URL at request time (`utils/image.ts`)
  — zero storage/egress cost.

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
`players.reep_id` is added later by `enrich:reep`; `players.sitelinks` /
`image_file` / `popularity` by `enrich:wikidata` (search ranking);
`clubs.crest_url` by `enrich:crests` (connection-UI crests). UI detail comes from
`GET /api/players/:id` (career timeline) and `GET /api/clubs/:id/squad?season=`
(roster), both served in-memory from the graph + player/club maps.

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

Each run does **two phases** (`Dockerfile.job` CMD): the importer, then
`enrich:wikidata`, so newly-imported players get their search signals (sitelinks /
photo / nationality) and `popularity` is recomputed every run. Both are resumable
and the enrichment only fetches players it hasn't seen, so the incremental cost is
small. Redeploy (`./backend/deploy-importer.sh`) to pick up the updated image.

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
