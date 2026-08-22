// Task #119: Map-Specific BGM Triggers — explicit per-map song assignments
// that override the region default (overworld/town/dungeon). Maps absent
// from this table keep their region song. Song ids must exist in songs.js.

export const MAP_SONGS = {
  overworld: "overworld",
  cornelia: "town",
  pravog: "town",
  elfheim: "town",
  windfall: "town",
  dwarfholm: "town",
  glacierport: "town",
  cornelia_castle: "town",
  elfheim_royal: "town",
  dwarfholm_royal: "town",
  sea_vault: "dungeon",
  chaos_shrine_b2: "boss",
  chrono_throne: "boss",
  trial_hall: "boss",
};
