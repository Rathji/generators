// Lighting data (Task #148) — maps that lie in darkness. A party with no
// light source cannot see their surroundings there at all; with a light
// (the lantern item, the Light spell, or the Luminary blade) they see out
// to `lightRadius` tiles.

export const DARK_MAPS = [
  {
    mapId: "lighthouse",
    name: "The haunted lighthouse",
    // Task #117: the phantom light drowned the lamp — the whole tower is
    // pitch black until a light is brought.
    lightRadius: 2,
  },
  {
    mapId: "lighthouse_top",
    name: "Lamp room",
    lightRadius: 2,
  },
  {
    mapId: "time_rift",
    name: "The Time Rift",
    lightRadius: 3,
  },
  {
    mapId: "time_labyrinth",
    name: "Labyrinth of Time",
    lightRadius: 3,
  },
];

export const LIGHT_ITEMS = ["lantern"];
export const LIGHT_SPELL = "light";
export const LIGHT_WEAPONS = ["luminary"];
