// Dungeon data (Task #53) — multi-level dungeons: ordered levels (each a map
// id), stairs linking levels, and exit tiles back to the outside.

export const DUNGEONS = {
  caves_of_cornelia: {
    id: "caves_of_cornelia",
    name: "Caves of Cornelia",
    entry: { mapId: "caves_of_cornelia", x: 9, y: 4, facing: "N" },
    levels: [
      { mapId: "caves_of_cornelia", name: "Caves — Upper Level", number: 1 },
      { mapId: "caves_of_cornelia_b2", name: "Caves — Lower Level", number: 2 },
    ],
    stairs: [
      { id: "cave_l2_down", fromMap: "caves_of_cornelia", x: 14, y: 10, toMap: "caves_of_cornelia_b2", toX: 7, toY: 1, facing: "S", level: 2 },
      { id: "cave_l2_up", fromMap: "caves_of_cornelia_b2", x: 13, y: 3, toMap: "caves_of_cornelia", toX: 12, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "caves_of_cornelia", x: 9, y: 5, toMap: "overworld", toX: 10, toY: 4, facing: "S" },
    ],
  },
  marsh_cave: {
    id: "marsh_cave",
    name: "Marsh Cave",
    entry: { mapId: "marsh_cave", x: 7, y: 7, facing: "N" },
    levels: [
      { mapId: "marsh_cave", name: "Marsh Cave", number: 1 },
      { mapId: "marsh_cave_b2", name: "Marsh Cave — Depths", number: 2 },
    ],
    stairs: [
      { id: "marsh_l2_down", fromMap: "marsh_cave", x: 14, y: 9, toMap: "marsh_cave_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "marsh_l2_up", fromMap: "marsh_cave_b2", x: 14, y: 4, toMap: "marsh_cave", toX: 14, toY: 9, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "marsh_cave", x: 7, y: 1, toMap: "overworld", toX: 1, toY: 6, facing: "S" },
    ],
  },
  mount_gulg: {
    id: "mount_gulg",
    name: "Mount Gulg",
    entry: { mapId: "mount_gulg", x: 7, y: 7, facing: "N" },
    levels: [
      { mapId: "mount_gulg", name: "Mount Gulg — Mine", number: 1 },
      { mapId: "mount_gulg_b2", name: "Mount Gulg — Forge Depths", number: 2 },
    ],
    stairs: [
      { id: "gulg_l2_down", fromMap: "mount_gulg", x: 14, y: 9, toMap: "mount_gulg_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "gulg_l2_up", fromMap: "mount_gulg_b2", x: 14, y: 4, toMap: "mount_gulg", toX: 14, toY: 9, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "mount_gulg", x: 7, y: 1, toMap: "overworld", toX: 5, toY: 5, facing: "S" },
    ],
  },
  chaos_shrine: {
    id: "chaos_shrine",
    name: "Chaos Shrine",
    entry: { mapId: "chaos_shrine", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "chaos_shrine", name: "Chaos Shrine", number: 1 },
      { mapId: "chaos_shrine_b2", name: "Chaos Shrine — Dark Altar", number: 2 },
    ],
    stairs: [
      { id: "chaos_l2_down", fromMap: "chaos_shrine", x: 14, y: 10, toMap: "chaos_shrine_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "chaos_l2_up", fromMap: "chaos_shrine_b2", x: 14, y: 4, toMap: "chaos_shrine", toX: 14, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "chaos_shrine", x: 7, y: 1, toMap: "overworld", toX: 13, toY: 2, facing: "S" },
    ],
  },
  gnome_tunnels: {
    id: "gnome_tunnels",
    name: "The Gnome Tunnels",
    entry: { mapId: "gnome_tunnels", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "gnome_tunnels", name: "Gnome Tunnels — Gearworks", number: 1 },
      { mapId: "gnome_tunnels_b2", name: "Gnome Tunnels — Engine Vault", number: 2 },
    ],
    stairs: [
      { id: "gnome_l2_down", fromMap: "gnome_tunnels", x: 14, y: 10, toMap: "gnome_tunnels_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "gnome_l2_up", fromMap: "gnome_tunnels_b2", x: 14, y: 4, toMap: "gnome_tunnels", toX: 14, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "gnome_tunnels", x: 7, y: 1, toMap: "overworld", toX: 14, toY: 13, facing: "S" },
    ],
  },
  wind_shrine: {
    id: "wind_shrine",
    name: "The Wind Shrine",
    entry: { mapId: "wind_shrine", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "wind_shrine", name: "Wind Shrine", number: 1 },
      { mapId: "wind_shrine_b2", name: "Wind Shrine — Sky Altar", number: 2 },
    ],
    stairs: [
      { id: "wind_l2_down", fromMap: "wind_shrine", x: 14, y: 10, toMap: "wind_shrine_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "wind_l2_up", fromMap: "wind_shrine_b2", x: 14, y: 4, toMap: "wind_shrine", toX: 14, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "wind_shrine", x: 7, y: 1, toMap: "overworld", toX: 6, toY: 2, facing: "S" },
    ],
  },
  sea_shrine: {
    id: "sea_shrine",
    name: "The Sea Shrine",
    entry: { mapId: "sea_shrine", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "sea_shrine", name: "Sea Shrine — Tidal Halls", number: 1 },
      { mapId: "sea_shrine_b2", name: "Sea Shrine — Sunken Sanctum", number: 2 },
      { mapId: "sea_vault", name: "Sea Shrine — Drowned Vault", number: 3 },
    ],
    stairs: [
      { id: "sea_l2_down", fromMap: "sea_shrine", x: 14, y: 10, toMap: "sea_shrine_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "sea_l2_up", fromMap: "sea_shrine_b2", x: 14, y: 4, toMap: "sea_shrine", toX: 14, toY: 10, facing: "N", level: 1 },
      { id: "sea_vault_in", fromMap: "sea_shrine_b2", x: 1, y: 5, toMap: "sea_vault", toX: 7, toY: 5, facing: "N", level: 3 },
      { id: "sea_vault_out", fromMap: "sea_vault", x: 7, y: 1, toMap: "sea_shrine_b2", toX: 1, toY: 5, facing: "S", level: 2 },
    ],
    exits: [
      { mapId: "sea_shrine", x: 7, y: 1, toMap: "windfall", toX: 10, toY: 1, facing: "S" },
    ],
  },
  pravo_lighthouse: {
    id: "pravo_lighthouse",
    name: "Pravo Lighthouse",
    entry: { mapId: "lighthouse", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "lighthouse", name: "Pravo Lighthouse", number: 1 },
      { mapId: "lighthouse_top", name: "Lighthouse — Lamp Room", number: 2 },
    ],
    stairs: [
      { id: "lamp_up", fromMap: "lighthouse", x: 14, y: 10, toMap: "lighthouse_top", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "lamp_down", fromMap: "lighthouse_top", x: 14, y: 4, toMap: "lighthouse", toX: 14, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "lighthouse", x: 7, y: 1, toMap: "overworld", toX: 2, toY: 10, facing: "S" },
    ],
  },
  // Task #122: Ember Sanctum — a three-level volcanic shrine in the
  // north-east peaks. Only the airship can reach the peak; the Ember Fiend
  // coils in the molten core.
  ember_sanctum: {
    id: "ember_sanctum",
    name: "The Ember Sanctum",
    entry: { mapId: "ember_sanctum", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "ember_sanctum", name: "Ember Sanctum", number: 1 },
      { mapId: "ember_sanctum_b2", name: "Ember Sanctum — Magma Halls", number: 2 },
      { mapId: "ember_sanctum_core", name: "Ember Sanctum — Molten Core", number: 3 },
    ],
    stairs: [
      { id: "ember_l2_down", fromMap: "ember_sanctum", x: 14, y: 10, toMap: "ember_sanctum_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "ember_l2_up", fromMap: "ember_sanctum_b2", x: 14, y: 4, toMap: "ember_sanctum", toX: 14, toY: 10, facing: "N", level: 1 },
      { id: "ember_l3_down", fromMap: "ember_sanctum_b2", x: 1, y: 5, toMap: "ember_sanctum_core", toX: 7, toY: 5, facing: "N", level: 3 },
      { id: "ember_l3_up", fromMap: "ember_sanctum_core", x: 7, y: 1, toMap: "ember_sanctum_b2", toX: 1, toY: 5, facing: "S", level: 2 },
    ],
    exits: [
      { mapId: "ember_sanctum", x: 7, y: 1, toMap: "overworld", toX: 18, toY: 2, facing: "S" },
    ],
  },
  // Task #132: the Dwarven Forge — the sacred smithy beneath Dwarfholm,
  // entered from the town's Forge front.
  dwarven_forge: {
    id: "dwarven_forge",
    name: "The Dwarven Forge",
    entry: { mapId: "forge_upper", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "forge_upper", name: "The Dwarven Forge", number: 1 },
      { mapId: "forge_core", name: "Forge — Heart of the Halls", number: 2 },
    ],
    stairs: [
      { id: "forge_l2_down", fromMap: "forge_upper", x: 14, y: 10, toMap: "forge_core", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "forge_l2_up", fromMap: "forge_core", x: 14, y: 4, toMap: "forge_upper", toX: 14, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "forge_upper", x: 7, y: 1, toMap: "dwarfholm", toX: 10, toY: 1, facing: "S" },
    ],
  },
  // Task #143: the Frozen Caverns — the ice-choked depths beneath the
  // Glacier Isle, entered from Glacierport's cavern door.
  frozen_caverns: {
    id: "frozen_caverns",
    name: "The Frozen Caverns",
    entry: { mapId: "frozen_upper", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "frozen_upper", name: "Frozen Caverns", number: 1 },
      { mapId: "frozen_core", name: "Caverns — Heart of the Ice", number: 2 },
    ],
    stairs: [
      { id: "frozen_l2_down", fromMap: "frozen_upper", x: 14, y: 10, toMap: "frozen_core", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "frozen_l2_up", fromMap: "frozen_core", x: 14, y: 4, toMap: "frozen_upper", toX: 14, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "frozen_upper", x: 7, y: 1, toMap: "glacierport", toX: 10, toY: 1, facing: "S" },
    ],
  },
  // Task #152: the Labyrinth of Time — the rift-warped depths beneath the
  // Chaos Shrine's Dark Altar. Chrono, the Keeper of Time, waits in the
  // Throne of Eternity at the bottom.
  time_labyrinth: {
    id: "time_labyrinth",
    name: "The Labyrinth of Time",
    entry: { mapId: "time_rift", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "time_rift", name: "The Time Rift", number: 1 },
      { mapId: "time_labyrinth", name: "Labyrinth of Time", number: 2 },
      { mapId: "chrono_throne", name: "The Throne of Eternity", number: 3 },
    ],
    stairs: [
      { id: "time_l2_down", fromMap: "time_rift", x: 14, y: 10, toMap: "time_labyrinth", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "time_l2_up", fromMap: "time_labyrinth", x: 14, y: 4, toMap: "time_rift", toX: 14, toY: 10, facing: "N", level: 1 },
      { id: "time_l3_down", fromMap: "time_labyrinth", x: 1, y: 5, toMap: "chrono_throne", toX: 7, toY: 5, facing: "N", level: 3 },
      { id: "time_l3_up", fromMap: "chrono_throne", x: 7, y: 1, toMap: "time_labyrinth", toX: 1, toY: 5, facing: "S", level: 2 },
    ],
    exits: [
      { mapId: "time_rift", x: 7, y: 1, toMap: "chaos_shrine_b2", toX: 1, toY: 5, facing: "S" },
    ],
  },
  // Task #174: the Ice Cave — the frozen depths beneath the Northern Wastes,
  // entered from the wastes' cave mouth. Slippery "+" ice floors slow the
  // party; the descent to the Crystal Chamber is barred by a wall of living
  // crystal until the Frost Crystal is held.
  ice_cave: {
    id: "ice_cave",
    name: "The Ice Cave",
    entry: { mapId: "ice_cave_upper", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "ice_cave_upper", name: "The Ice Cave", number: 1 },
      { mapId: "ice_cave_b2", name: "Cave — Crystal Chamber", number: 2 },
    ],
    stairs: [
      { id: "ice_l2_down", fromMap: "ice_cave_upper", x: 14, y: 10, toMap: "ice_cave_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "ice_l2_up", fromMap: "ice_cave_b2", x: 14, y: 4, toMap: "ice_cave_upper", toX: 14, toY: 10, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "ice_cave_upper", x: 7, y: 1, toMap: "north_wastes", toX: 18, toY: 9, facing: "S" },
    ],
  },
  // Task #177: the Ancient Ruins — the moss-choked relic vaults of the
  // Southern Jungles. The Sun-Moss Relic found on the upper floor parts the
  // Sunken Hall's sealed door; the hall reeks with spore-vents and the moss
  // dead.
  ancient_ruins: {
    id: "ancient_ruins",
    name: "The Ancient Ruins",
    entry: { mapId: "ancient_ruins", x: 7, y: 5, facing: "N" },
    levels: [
      { mapId: "ancient_ruins", name: "The Ancient Ruins", number: 1 },
      { mapId: "ancient_ruins_b2", name: "Ruins — Sunken Hall", number: 2 },
    ],
    stairs: [
      { id: "ruins_l2_down", fromMap: "ancient_ruins", x: 15, y: 9, toMap: "ancient_ruins_b2", toX: 8, toY: 3, facing: "S", level: 2 },
      { id: "ruins_l2_up", fromMap: "ancient_ruins_b2", x: 14, y: 4, toMap: "ancient_ruins", toX: 15, toY: 9, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "ancient_ruins", x: 1, y: 4, toMap: "south_jungle", toX: 17, toY: 8, facing: "S" },
    ],
  },
  // Task #184: the Highland Peak — the storm-wracked summit behind the
  // Western Highlands' pass. Gale gusts claw at climbers without the Gale
  // Cloak; the Storm Summit's tempest rings the crest.
  highland_peak: {
    id: "highland_peak",
    name: "The Highland Peak",
    entry: { mapId: "highland_peak", x: 7, y: 13, facing: "N" },
    levels: [
      { mapId: "highland_peak", name: "Highland Peak", number: 1 },
      { mapId: "highland_peak_b2", name: "Peak — Storm Summit", number: 2 },
    ],
    stairs: [
      { id: "peak_l2_up", fromMap: "highland_peak", x: 8, y: 1, toMap: "highland_peak_b2", toX: 7, toY: 5, facing: "S", level: 2 },
      { id: "peak_l2_down", fromMap: "highland_peak_b2", x: 13, y: 1, toMap: "highland_peak", toX: 8, toY: 1, facing: "N", level: 1 },
    ],
    exits: [
      { mapId: "highland_peak", x: 13, y: 13, toMap: "west_highlands", toX: 14, toY: 1, facing: "S" },
    ],
  },
};
