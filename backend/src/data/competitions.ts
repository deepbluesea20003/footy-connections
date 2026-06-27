// Curated, human-readable names for the competitions we expose as game filters.
// The dataset holds ~50 competition codes (Transfermarkt "GB1" / API-Football
// "af:2"), most of them obscure lower tiers we don't want to surface as filter
// chips. We curate the well-known leagues here; everything else still *plays*
// (a puzzle can route through any competition) — it just isn't a filter option,
// and falls back to no fun-fact league label.

export interface League {
  id: string;
  name: string;
  country: string;
}

// Order = display priority in the settings popup (biggest leagues first).
export const LEAGUES: League[] = [
  { id: "GB1", name: "Premier League", country: "England" },
  { id: "ES1", name: "LaLiga", country: "Spain" },
  { id: "IT1", name: "Serie A", country: "Italy" },
  { id: "L1", name: "Bundesliga", country: "Germany" },
  { id: "FR1", name: "Ligue 1", country: "France" },
  { id: "NL1", name: "Eredivisie", country: "Netherlands" },
  { id: "PO1", name: "Primeira Liga", country: "Portugal" },
  { id: "BE1", name: "Belgian Pro League", country: "Belgium" },
  { id: "TR1", name: "Süper Lig", country: "Türkiye" },
  { id: "SC1", name: "Scottish Premiership", country: "Scotland" },
  { id: "RU1", name: "Russian Premier League", country: "Russia" },
  { id: "GR1", name: "Super League", country: "Greece" },
  { id: "UKR1", name: "Ukrainian Premier League", country: "Ukraine" },
  { id: "DK1", name: "Danish Superliga", country: "Denmark" },
  { id: "MLS1", name: "Major League Soccer", country: "USA" },
  { id: "BRA1", name: "Brazil Série A", country: "Brazil" },
  { id: "ARG1", name: "Liga Profesional", country: "Argentina" },
  { id: "SA1", name: "Saudi Pro League", country: "Saudi Arabia" },
  { id: "CL", name: "UEFA Champions League", country: "Europe" },
  // English lower tiers come from API-Football (documented in import-api-football.ts).
  { id: "af:2", name: "EFL Championship", country: "England" },
  { id: "af:3", name: "EFL League One", country: "England" },
  { id: "af:4", name: "EFL League Two", country: "England" },
];

export const CURATED_LEAGUE_IDS: Set<string> = new Set(LEAGUES.map((l) => l.id));

const NAME_BY_ID = new Map(LEAGUES.map((l) => [l.id, l.name] as const));

/** Human-readable competition name, or undefined for non-curated codes. */
export function competitionName(id?: string | null): string | undefined {
  return id ? NAME_BY_ID.get(id) : undefined;
}
