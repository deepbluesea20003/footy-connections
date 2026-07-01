import type { Player } from "../types/player.js";
import type { ClubInfo } from "../db/loader.js";

export interface CareerStint {
  club: string;
  clubId: string | null;
  crestUrl: string | null;
  seasons: string[];
  firstSeason: string;
  lastSeason: string;
  /** Heuristically a loan spell (see markLoanStints). Display-only. */
  loan: boolean;
}

/** A player's clubs as a career timeline, most-recent first, with crests. */
export function playerCareer(player: Player, clubs: Map<string, ClubInfo>): CareerStint[] {
  return player.clubs
    .map((stint) => {
      const seasons = [...stint.seasons].sort();
      const crest = stint.clubId ? clubs.get(stint.clubId)?.crestUrl : undefined;
      return {
        club: stint.club,
        clubId: stint.clubId ?? null,
        crestUrl: crest ?? null,
        seasons,
        firstSeason: seasons[0] ?? "",
        lastSeason: seasons[seasons.length - 1] ?? "",
        loan: stint.loan ?? false,
      };
    })
    .sort((a, b) => b.lastSeason.localeCompare(a.lastSeason));
}

/** Compact player summary for lists (search-adjacent, squad rosters). */
export function playerSummary(player: Player) {
  return {
    id: player.id,
    name: player.name,
    dateOfBirth: player.dateOfBirth ?? null,
    nationality: player.nationality ?? null,
    imageUrl: player.imageUrl ?? null,
    popularity: player.popularity ?? null,
    wikipediaUrl: null,
    wikidataUrl: null,
  };
}

/** Full player detail for the selected-player card. */
export function playerDetail(player: Player, clubs: Map<string, ClubInfo>) {
  return {
    ...playerSummary(player),
    career: playerCareer(player, clubs),
  };
}
