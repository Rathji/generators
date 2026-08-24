// World Map (Task #237) — a stylized continent overview. Each named region owns a
// set of map ids, a position on the grid, and a single-letter marker. The engine
// renders the grid and, given a Codex (visited set), flags which regions the
// player has set foot in.

export const WORLD_MAP = {
  width: 46,
  height: 22,
};

// Land is painted first, then ocean carved over it; region letters sit on land.
export const WORLD_LAND = [
  [0, 3, 30, 20], // main western continent
  [0, 0, 14, 3], // northern wastes
  [16, 0, 30, 3], // elfheim / mount gulg peninsulas
  [34, 2, 45, 20], // eastern island chain
];

export const WORLD_OCEAN = [
  [31, 0, 33, 21], // central strait
  [12, 0, 15, 2], // inlet north
];

export const WORLD_REGIONS = [
  { id: "cornelia", name: "Cornelia", letter: "C", x: 8, y: 8, maps: ["cornelia", "cornelia_inn", "cornelia_house", "cornelia_shop", "cornelia_castle", "cornelia_house2"] },
  { id: "caves_of_cornelia", name: "Caves of Cornelia", letter: "V", x: 6, y: 7, maps: ["caves_of_cornelia", "caves_of_cornelia_b2"] },
  { id: "pravog", name: "Pravog", letter: "P", x: 14, y: 15, maps: ["pravog", "pravog_inn", "pravog_shop", "pravog_house", "pravog_house2", "pravog_armory", "pravog_church"] },
  { id: "marsh_cave", name: "Marsh Cave", letter: "M", x: 11, y: 12, maps: ["marsh_cave", "marsh_cave_b2"] },
  { id: "elfheim", name: "Elfheim", letter: "E", x: 22, y: 5, maps: ["elfheim", "elfheim_inn", "elfheim_shop", "elfheim_house", "elfheim_royal"] },
  { id: "mount_gulg", name: "Mount Gulg", letter: "G", x: 26, y: 3, maps: ["mount_gulg", "mount_gulg_b2"] },
  { id: "chaos_shrine", name: "Chaos Shrine", letter: "X", x: 29, y: 3, maps: ["chaos_shrine", "chaos_shrine_b2"] },
  { id: "gnome_tunnels", name: "Gnome Tunnels", letter: "N", x: 26, y: 14, maps: ["gnome_tunnels", "gnome_tunnels_b2"] },
  { id: "wind_shrine", name: "Wind Shrine", letter: "S", x: 37, y: 6, maps: ["wind_shrine", "wind_shrine_b2"] },
  { id: "windfall", name: "Windfall", letter: "A", x: 40, y: 14, maps: ["windfall", "windfall_inn", "windfall_shop", "windfall_house"] },
  { id: "sea_shrine", name: "Sea Shrine", letter: "Q", x: 42, y: 9, maps: ["sea_shrine", "sea_shrine_b2", "sea_vault"] },
  { id: "lighthouse", name: "Lighthouse", letter: "T", x: 38, y: 16, maps: ["lighthouse", "lighthouse_top"] },
  { id: "ember_sanctum", name: "Ember Sanctum", letter: "F", x: 4, y: 16, maps: ["ember_sanctum", "ember_sanctum_b2", "ember_sanctum_core"] },
  { id: "dwarfholm", name: "Dwarfholm", letter: "D", x: 10, y: 18, maps: ["dwarfholm", "dwarfholm_house", "dwarfholm_inn", "dwarfholm_shop"] },
  { id: "forge", name: "The Forge", letter: "R", x: 12, y: 20, maps: ["forge_upper", "forge_core"] },
  { id: "glacierport", name: "Glacierport", letter: "L", x: 6, y: 2, maps: ["glacierport", "glacierport_house", "glacierport_inn", "glacierport_shop"] },
  { id: "frozen", name: "Frozen Wastes", letter: "Z", x: 4, y: 1, maps: ["frozen_upper", "frozen_core"] },
  { id: "time_rift", name: "Time Rift", letter: "Y", x: 36, y: 18, maps: ["time_rift", "time_labyrinth", "chrono_throne"] },
  { id: "trial_hall", name: "Trial Hall", letter: "U", x: 40, y: 20, maps: ["trial_hall"] },
  { id: "north_village", name: "North Village", letter: "W", x: 10, y: 2, maps: ["north_wastes", "north_village", "north_village_house", "north_village_shop", "north_village_inn"] },
  { id: "ice_cave", name: "Ice Cave", letter: "I", x: 8, y: 1, maps: ["ice_cave_upper", "ice_cave_b2"] },
  { id: "south_jungle", name: "South Jungle", letter: "J", x: 36, y: 4, maps: ["south_jungle", "jungle_village", "jungle_village_house", "jungle_village_shop", "jungle_village_inn", "ancient_ruins", "ancient_ruins_b2"] },
  { id: "west_highlands", name: "West Highlands", letter: "H", x: 28, y: 18, maps: ["west_highlands", "highlands_castle", "highlands_castle_throne", "highlands_castle_barracks"] },
  { id: "highland_peak", name: "Highland Peak", letter: "K", x: 30, y: 17, maps: ["highland_peak", "highland_peak_b2"] },
];

export function regionById(id) {
  return WORLD_REGIONS.find((r) => r.id === id) ?? null;
}

export function regionForMap(mapId) {
  return WORLD_REGIONS.find((r) => r.maps.includes(mapId)) ?? null;
}

export function mapCount() {
  return WORLD_REGIONS.reduce((s, r) => s + r.maps.length, 0);
}
