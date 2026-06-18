import type { Player } from "../../src/types/player.js";

export const testPlayers: Player[] = [
  {
    id: "alice",
    name: "Alice Smith",
    clubs: [
      { club: "Club A", seasons: ["2023-24", "2024-25"] },
    ],
  },
  {
    id: "bob",
    name: "Bob Jones",
    clubs: [
      { club: "Club A", seasons: ["2023-24"] },
      { club: "Club B", seasons: ["2024-25"] },
    ],
  },
  {
    id: "carol",
    name: "Carol García",
    clubs: [
      { club: "Club B", seasons: ["2024-25"] },
    ],
  },
  {
    id: "dave",
    name: "Dave Wilson",
    clubs: [
      { club: "Club B", seasons: ["2023-24"] },
      { club: "Club C", seasons: ["2024-25"] },
    ],
  },
  {
    id: "eve",
    name: "Eve Brown",
    clubs: [
      { club: "Club C", seasons: ["2024-25"] },
    ],
  },
  {
    id: "frank",
    name: "Frank Isolated",
    clubs: [
      { club: "Club D", seasons: ["2023-24"] },
    ],
  },
];
