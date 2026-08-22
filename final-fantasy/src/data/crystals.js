// Task #102: the four crystals — their flags, colors, and lore. Each is
// restored when its guardian falls (see the plot chapters in plot.js).

export const CRYSTALS = [
  {
    id: "fire",
    name: "Fire Crystal",
    element: "fire",
    color: "#ff5a3c",
    flag: "crystal_fire",
    guardian: "Garland",
    dungeon: "Chaos Shrine",
    line: "The Fire Crystal blazes in the ruined altar — Garland's shadow is gone from it.",
  },
  {
    id: "water",
    name: "Water Crystal",
    element: "water",
    color: "#4aa3ff",
    flag: "crystal_water",
    guardian: "Marsh Guardian",
    dungeon: "Marsh Cave",
    line: "The Water Crystal sings through the murk — the Marsh Guardian's reign is over.",
  },
  {
    id: "earth",
    name: "Earth Crystal",
    element: "earth",
    color: "#7ec850",
    flag: "crystal_earth",
    guardian: "Forge Golem",
    dungeon: "Mount Gulg",
    line: "The Earth Crystal rumbles awake in the forges — the Golem's flame is quenched.",
  },
  {
    id: "wind",
    name: "Wind Crystal",
    element: "wind",
    color: "#e8e0c0",
    flag: "crystal_wind",
    guardian: "Chaos",
    dungeon: "Chaos Shrine",
    line: "The Wind Crystal howls free of the altar — Chaos's grip on the sky is broken.",
  },
];
