import type { Player } from "../types/player.js";
import { manCityPlayers } from "./man-city.js";
import { liverpoolPlayers } from "./liverpool.js";
import { arsenalPlayers } from "./arsenal.js";
import { manUnitedPlayers } from "./man-united.js";
import { tottenhamPlayers } from "./tottenham.js";
import { chelseaPlayers } from "./chelsea.js";
import { otherClubPlayers } from "./other-clubs.js";

const allPlayers: Player[] = [
  ...manCityPlayers,
  ...liverpoolPlayers,
  ...arsenalPlayers,
  ...manUnitedPlayers,
  ...tottenhamPlayers,
  ...chelseaPlayers,
  ...otherClubPlayers,
];

const ids = new Set<string>();
for (const player of allPlayers) {
  if (ids.has(player.id)) {
    throw new Error(`Duplicate player id: ${player.id}`);
  }
  ids.add(player.id);
}

export const players = allPlayers;

export const playerLookup = new Map<string, Player>(
  allPlayers.map((p) => [p.id, p])
);
