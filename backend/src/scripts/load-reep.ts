/**
 * Loads the reep identity register (github.com/withqwerty/reep, CC0) into Postgres
 * so the source importers can resolve a provider's player id to a single canonical
 * person. reep maps Transfermarkt, API-Football, FBref, etc. ids to one `reep_id`
 * (with name + date_of_birth), which is how we fuse the TM and API-Football datasets
 * without double-counting a player who appears in both.
 *
 * Populates `reep_people` (reep_id -> name, dob) and `reep_map` (source, source_id ->
 * reep_id) for the keys we use. Idempotent: drops + recreates each run.
 *
 * Run: DATABASE_URL=... npm run load:reep --workspace=backend
 */
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { parse } from "csv-parse";
import { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directUrl } from "../db/pg-url.js";

/** Download a URL to a local file first (a fast consumer), so a slow cross-network
 *  COPY can't stall the source stream into an HTTP idle-timeout. */
async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`fetch ${url}: ${res.status}`);
  await finished((Readable.fromWeb(res.body as never) as Readable).pipe(createWriteStream(dest)));
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const PEOPLE_CSV =
  process.env.REEP_PEOPLE_CSV ?? "https://raw.githubusercontent.com/withqwerty/reep/main/data/people.csv";
// Provider key column -> the `source` label our importers pass to canonicalId().
const KEYS: Record<string, string> = { key_transfermarkt: "transfermarkt", key_api_football: "api_football" };

const ts = () => new Date().toISOString().slice(11, 19);
const cell = (v: string | null | undefined) =>
  v === null || v === undefined || v === "" ? "" : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
/** reep DOBs are sometimes partial/garbage; keep only valid full calendar dates. */
const validDate = (v: string | undefined) =>
  v && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v.slice(0, 10)) ? v.slice(0, 10) : "";

async function main() {
  const client = new Client({ connectionString: directUrl(DATABASE_URL!), ssl: { rejectUnauthorized: false } });
  await client.connect();

  await client.query(`
    DROP TABLE IF EXISTS reep_people, reep_map;
    CREATE TABLE reep_people (reep_id TEXT PRIMARY KEY, name TEXT, date_of_birth TEXT);
    CREATE TABLE reep_map (source TEXT NOT NULL, source_id TEXT NOT NULL, reep_id TEXT NOT NULL);
  `);
  console.log(`[${ts()}] reep schema ready; streaming ${PEOPLE_CSV}…`);

  const tmp = join(tmpdir(), "reep-people.csv");
  console.log(`[${ts()}] downloading to ${tmp}…`);
  await downloadTo(PEOPLE_CSV, tmp);

  // A single connection can only run one COPY at a time, so stream people via
  // COPY and buffer the (small) map rows, then COPY those afterwards.
  const peopleCopy = client.query(copyFrom(`COPY reep_people (reep_id, name, date_of_birth) FROM STDIN WITH (FORMAT csv, NULL '')`));
  const parser = createReadStream(tmp).pipe(
    parse({ columns: true, relax_quotes: true, skip_records_with_error: true })
  );
  let people = 0;
  const mapLines: string[] = [];
  const seenReep = new Set<string>();
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    const reepId = r.reep_id;
    if (!reepId) continue;
    if (!seenReep.has(reepId)) {
      seenReep.add(reepId);
      const line = [reepId, r.name ?? r.full_name ?? "", validDate(r.date_of_birth)].map(cell).join(",") + "\n";
      if (!peopleCopy.write(line)) await once(peopleCopy, "drain");
      people++;
      if (people % 100000 === 0) console.log(`[${ts()}]   ${people.toLocaleString()} people…`);
    }
    for (const [col, source] of Object.entries(KEYS)) {
      if (r[col]) mapLines.push(`${cell(source)},${cell(r[col])},${cell(reepId)}\n`);
    }
  }
  peopleCopy.end();
  await finished(peopleCopy);

  console.log(`[${ts()}] copying ${mapLines.length.toLocaleString()} id mappings…`);
  const mapCopy = client.query(copyFrom(`COPY reep_map (source, source_id, reep_id) FROM STDIN WITH (FORMAT csv, NULL '')`));
  for (const line of mapLines) if (!mapCopy.write(line)) await once(mapCopy, "drain");
  mapCopy.end();
  await finished(mapCopy);
  const maps = mapLines.length;
  await client.query(`CREATE INDEX idx_reep_map ON reep_map (source, source_id)`);
  console.log(`[${ts()}] DONE — ${people.toLocaleString()} people, ${maps.toLocaleString()} provider-id mappings`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
