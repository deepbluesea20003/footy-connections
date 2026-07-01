# CLAUDE.md

Guidance for working in this repo. Keep it accurate — update it when the shape of
the code changes.

## What this is

**Football Separation Number** — a "six degrees" game over football squads: find
the shortest chain between two players through shared *matchday squads*. The edge
model is **co-appearance**: two players named in the same club's squad for the same
game are teammates. So a connection is only ever shown if they genuinely played
together.

- `backend/` — Node 22 + Express 5 + TypeScript (ESM). Serves `/api/*` and, in
  prod, the built frontend. Also home to the data-import scripts.
- `frontend/` — React 19 + Vite 7 + Tailwind 4. A 3-tab game; "build the chain"
  (Play) is the primary mode.
- npm **workspaces** (`backend`, `frontend`); root scripts proxy into them.

Data lives in **Neon** (serverless Postgres). The graph is built **in memory at
startup** from the DB (`backend/src/db/loader.ts`). If `DATABASE_URL` is unset it
falls back to a small hardcoded seed (`backend/src/data/`), so the UI runs with
zero infra.

## Commands

Run from repo root unless noted. Data scripts load `backend/.env` (needs `DATABASE_URL`).

```bash
npm run dev                 # backend (API + graph) on :3000
npm run dev:frontend        # frontend on :5173 (Vite proxies /api → :3000)
npm test                    # backend tests (vitest, backend/tests/)
npm run build               # build backend + frontend

# Data pipeline — run in this order (each is a clean, idempotent full reload):
npm run load:reep   --workspace=backend  # CC0 identity register → canonical player ids
npm run import:tm   --workspace=backend  # Transfermarkt CSVs: top divisions + cups
npm run import:af   --workspace=backend  # API-Football bulk: lower tiers, merged via reep
npm run reconcile   --workspace=backend  # fold DOB-less orphan nodes into their reep node (--apply)
npm run recompute:pop --workspace=backend # search ranking: market value, else Big-5 appearances
npm run scrape:tm   --workspace=backend  # optional: scrape EFL/lower tiers from Transfermarkt (ToS-grey)
```

## The data layer (the important part)

Everything is **co-appearance from `game_lineups`** (a player in a club's squad for
a game). The graph hub is keyed `gameId::clubId`, so two players share a hub iff
they were in the same squad for the same game — see `loader.ts` / `graph/build.ts`.

**Sources, fused into one graph:**
- **Transfermarkt open CSVs** (`import-transfermarkt.ts`) — top divisions + cups.
  The spine: brings faces (`image_url`), `market_value`, DOB, nationality.
- **API-Football bulk** (`import-api-football.ts`) — lower tiers TM doesn't cover
  (`AF_LEAGUE_IDS`). Appends to the same tables.
- **Transfermarkt scraper** (`scrape-transfermarkt.ts`) — optional EFL/lower-tier
  fill using TM's own ids (same id space as `import:tm`, so no cross-source
  resolution needed). Heavy + ToS-grey; run as a background job, not casually.

**Identity fusion — reep** (`db/reep.ts`, `load-reep.ts`): the
[reep](https://github.com/withqwerty/reep) CC0 register maps each provider's player
id (`key_transfermarkt`, `key_api_football`) to one shared `reep_id`.
`canonicalId(maps, source, sourceId)` returns that `reep_id` (so the same person
across TM + API-Football collapses to one node) **or a source-prefixed fallback**
(`tr:<id>`, `ap:<id>`) when reep doesn't know the id. This fallback is where
duplicates come from — see gotchas.

### Schema (authoritative version)

The live schema is created by `import-transfermarkt.ts` → `ensureSchema()` (it
`DROP`s and recreates on each run). The tables that matter:
`players` (canonical `id` = reep_id or `tr:`/`ap:` fallback; `name`, `date_of_birth`,
`nationality`, `image_url`, `market_value`, `popularity`) · `clubs` · `games`
(competition, `season` = start year, date, home/away, `source`) · `game_lineups`
(the edge source: `game_id`, `club_id`, `player_id`, `type`). reep lookup tables:
`reep_people`, `reep_map`.

> `backend/src/db/schema.sql` is **legacy** (describes an older Wikidata-era shape,
> incl. `player_club_seasons` / `player_external_ids` / `import_*`) — don't trust it.
> The trigram search index is applied at runtime by `db/search-schema.ts`.

### Search ranking

`DbPlayerSearchService` (`services/db-player-search.ts`) runs search **in Postgres**
(pg_trgm). A candidate must match *every* query token (word-prefix or word-similar,
both on the GIN trigram index), then results are ranked by relevance tier
(exact > full-prefix > all-tokens-prefix > fuzzy), word similarity, then
`popularity`. So same-name collisions (the several "Pelé"s) resolve fame-first.
`popularity = ln(1 + market_value)` — note this is **0 for any player without a
market value** (old players, most lower-tier/API-Football rows).
`InMemoryPlayerSearchService` is the no-DB fallback (seed data + tests).

### Images (derived, never stored)

`utils/image.ts`: player portraits are Transfermarkt URLs upgraded to the `big`
variant (`bigPortrait`); club crests are derived from the TM club id (`crestUrl`).
Zero storage/egress.

### Gotchas

- **Duplicate players come from the reep fallback.** When reep can't resolve a
  provider id it mints a standalone `tr:`/`ap:` node. API-Football is the weak spot
  (its rows have no DOB and mostly fail reep), so a player can split into a rich
  reep node + a bare `ap:` node — this breaks chains through their lower-league
  spell. Name+DOB dedup can't catch it (no DOB on the `ap:` side).
- **Career timeline has no loan flag.** `loader.ts` groups `game_lineups` by
  club+season; a loan just appears as real appearances for the loan club, so loan
  spells overlap the parent-club block.
- **Neon serverless driver is HTTP-per-query.** `loader.ts` uses a direct `pg`
  connection + server-side cursor (`pg-query-stream`) to stream the multi-million-row
  join in one query; the HTTP driver would need hundreds of paginated round-trips
  and can truncate large reads. Imports use `directUrl()` + `pg` COPY for the same reason.
- **Scraper is rate-limited + ToS-grey.** Keep the delay and descriptive UA.

## API

Built in `app.ts` (`initApp` loads the graph, then mounts routers): `/api/separation`
(shortest path + graph explore), `/api/players` (search + `/:id` career timeline),
`/api/clubs` (`/:id/squad?season=`), `/api/game` (Play mode; `services/game.ts`).

## Deploy

- **Web app** — root `Dockerfile`. `npm run build` then `node backend/dist/index.js`;
  serves `frontend/dist` + `/api/*` on `PORT` (8080 in container, 3000 in dev).
- **Data population** — `backend/deploy-data-job.sh` builds `backend/Dockerfile.job`
  with Cloud Build and runs it as a GCP Cloud Run Job. The job runs the three
  download-only phases in sequence (`load-reep → import:tm → import:af`); it's a
  clean full reload (~minutes), so just re-run to refresh. `--schedule` adds a
  weekly auto-run; pass `DATABASE_URL=<branch-url>` to test against a Neon branch.

## Conventions

- ESM throughout; **local imports use `.js` extensions** (TS compiled to ESM).
- Scripts read env via `tsx --env-file=.env`; never hardcode secrets. `DATABASE_URL`
  is the one required secret.
- Tests live in `backend/tests/` (vitest). Run `npm test` before declaring done.
