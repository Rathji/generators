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
  // Task #171/#172/#174: the northern lands — snowy wastes, a frontier town,
  // and the ice-choked cave beneath it.
  north_wastes: "overworld",
  north_village: "town",
  ice_cave_upper: "dungeon",
  ice_cave_b2: "dungeon",
  // Task #176-#185: the Southern Jungles & Western Highlands — jungle trails
  // and highland passes keep the overworld air; villages and the castle are
  // town music; the ruins and the storm-peak are dungeon music.
  south_jungle: "overworld",
  west_highlands: "overworld",
  jungle_village: "town",
  highlands_castle: "town",
  ancient_ruins: "dungeon",
  ancient_ruins_b2: "dungeon",
  highland_peak: "dungeon",
  highland_peak_b2: "dungeon",
  sea_vault: "dungeon",
  chaos_shrine_b2: "boss",
  chrono_throne: "boss",
  trial_hall: "boss",
};
