// World-state visual data (Task #152) — permanent tile/texture changes that
// take effect once a major plot flag is set (a forge door standing open, a
// castle gate unbarred, braziers relit). Patches may change only the
// rendered appearance (`solid: null`) or also the tile's collision
// (`solid: true|false`, honored through the passability-override hook).
// NPC position changes for the same plot beats live on the NPC placement
// `states` (see data/npcs.js) — the two systems compose.

export const WORLD_VISUALS = [
  {
    id: "dwarfholm_forge_open",
    mapId: "dwarfholm",
    x: 10,
    y: 1,
    require: { flag: "story_forge_colossus_defeated" },
    char: "D",
    cls: "door",
    label: "The great forge door stands open, its ember-glow spilling into the street.",
  },
  {
    id: "dwarfholm_braziers_lit",
    mapId: "dwarfholm",
    x: 3,
    y: 6,
    require: { flag: "story_forge_colossus_defeated" },
    char: "*",
    cls: "lit",
    label: "The street braziers flare back to life.",
  },
  {
    id: "windfall_shrine_door",
    mapId: "windfall",
    x: 10,
    y: 1,
    require: { flag: "crystal_water" },
    char: "D",
    cls: "door",
    label: "The Sea Shrine's tide-gate hangs open to the light.",
  },
  {
    id: "glacierport_cavern_open",
    mapId: "glacierport",
    x: 10,
    y: 1,
    require: { flag: "story_forge_colossus_defeated" },
    char: "D",
    cls: "door",
    label: "The permafrost thaws — the cavern mouth gapes open.",
  },
  {
    id: "cornelia_gate_open",
    mapId: "cornelia",
    x: 13,
    y: 4,
    require: { flag: "story_chaos_defeated" },
    solid: false,
    char: "D",
    cls: "door",
    label: "The castle gate is thrown wide — Cornelia celebrates the dawn.",
  },
];
