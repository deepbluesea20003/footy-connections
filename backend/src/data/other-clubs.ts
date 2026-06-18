import type { Player } from "../types/player.js";

export const otherClubPlayers: Player[] = [
  // Aston Villa — bridges to Man City via Grealish
  {
    id: "ollie-watkins",
    name: "Ollie Watkins",
    nationality: "England",
    clubs: [
      { club: "Aston Villa", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },
  {
    id: "emi-martinez",
    name: "Emiliano Martínez",
    nationality: "Argentina",
    clubs: [
      { club: "Arsenal", seasons: ["2019-20"] },
      { club: "Aston Villa", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },
  {
    id: "john-mcginn",
    name: "John McGinn",
    nationality: "Scotland",
    clubs: [
      { club: "Aston Villa", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },

  // West Ham — bridges to Arsenal via Rice
  {
    id: "jarrod-bowen",
    name: "Jarrod Bowen",
    nationality: "England",
    clubs: [
      { club: "West Ham", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },
  {
    id: "michail-antonio",
    name: "Michail Antonio",
    nationality: "Jamaica",
    clubs: [
      { club: "West Ham", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24"] },
    ],
  },
  {
    id: "tomas-soucek",
    name: "Tomáš Souček",
    nationality: "Czech Republic",
    clubs: [
      { club: "West Ham", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
    ],
  },

  // Brighton — bridges to Liverpool via Mac Allister, to Tottenham via Bissouma, to Chelsea via Caicedo
  {
    id: "lewis-dunk",
    name: "Lewis Dunk",
    nationality: "England",
    clubs: [
      { club: "Brighton", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },
  {
    id: "pascal-gross",
    name: "Pascal Groß",
    nationality: "Germany",
    clubs: [
      { club: "Brighton", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24"] },
    ],
  },

  // Everton — bridges to Tottenham via Richarlison
  {
    id: "dominic-calvert-lewin",
    name: "Dominic Calvert-Lewin",
    nationality: "England",
    clubs: [
      { club: "Everton", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
    ],
  },
  {
    id: "jordan-pickford",
    name: "Jordan Pickford",
    nationality: "England",
    clubs: [
      { club: "Everton", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
    ],
  },

  // Leicester — bridges to Tottenham via Maddison, to Chelsea via Kanté/Chilwell
  {
    id: "jamie-vardy",
    name: "Jamie Vardy",
    nationality: "England",
    clubs: [
      { club: "Leicester", seasons: ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24"] },
    ],
  },
  {
    id: "youri-tielemans",
    name: "Youri Tielemans",
    nationality: "Belgium",
    clubs: [
      { club: "Leicester", seasons: ["2019-20", "2020-21", "2021-22", "2022-23"] },
      { club: "Aston Villa", seasons: ["2023-24", "2024-25", "2025-26"] },
    ],
  },

  // Crystal Palace — bridges to Chelsea via Gallagher
  {
    id: "wilfried-zaha",
    name: "Wilfried Zaha",
    nationality: "Ivory Coast",
    clubs: [
      { club: "Crystal Palace", seasons: ["2019-20", "2020-21", "2021-22", "2022-23"] },
    ],
  },
  {
    id: "eberechi-eze",
    name: "Eberechi Eze",
    nationality: "England",
    clubs: [
      { club: "Crystal Palace", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },

  // Wolves — bridges to Liverpool via Jota
  {
    id: "ruben-neves",
    name: "Rúben Neves",
    nationality: "Portugal",
    clubs: [
      { club: "Wolverhampton", seasons: ["2019-20", "2020-21", "2021-22", "2022-23"] },
    ],
  },
  {
    id: "adama-traore",
    name: "Adama Traoré",
    nationality: "Spain",
    clubs: [
      { club: "Wolverhampton", seasons: ["2019-20", "2020-21", "2021-22", "2022-23"] },
    ],
  },

  // Brentford — bridges to Arsenal via Raya
  {
    id: "ivan-toney",
    name: "Ivan Toney",
    nationality: "England",
    clubs: [
      { club: "Brentford", seasons: ["2021-22", "2022-23", "2023-24", "2024-25"] },
    ],
  },
  {
    id: "bryan-mbeumo",
    name: "Bryan Mbeumo",
    nationality: "Cameroon",
    clubs: [
      { club: "Brentford", seasons: ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },

  // Newcastle
  {
    id: "alexander-isak",
    name: "Alexander Isak",
    nationality: "Sweden",
    clubs: [
      { club: "Newcastle", seasons: ["2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },
  {
    id: "bruno-guimaraes",
    name: "Bruno Guimarães",
    nationality: "Brazil",
    clubs: [
      { club: "Newcastle", seasons: ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] },
    ],
  },
  {
    id: "kieran-trippier",
    name: "Kieran Trippier",
    nationality: "England",
    clubs: [
      { club: "Newcastle", seasons: ["2021-22", "2022-23", "2023-24", "2024-25"] },
    ],
  },
  {
    id: "allan-saint-maximin",
    name: "Allan Saint-Maximin",
    nationality: "France",
    clubs: [
      { club: "Newcastle", seasons: ["2019-20", "2020-21", "2021-22", "2022-23"] },
    ],
  },

  // Southampton — bridges to Arsenal via Ramsdale... but let's add more connections
  {
    id: "james-ward-prowse",
    name: "James Ward-Prowse",
    nationality: "England",
    clubs: [
      { club: "Southampton", seasons: ["2019-20", "2020-21", "2021-22", "2022-23"] },
      { club: "West Ham", seasons: ["2023-24", "2024-25"] },
    ],
  },
];
