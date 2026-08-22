// Task #73: Overworld Landmark Markers — data-driven landmarks placed on the
// world map. `revealFlag` hides a landmark (shown only after the flag is
// set); null means always visible.

export const LANDMARKS = [
  { id: "cornelia", mapId: "overworld", x: 7, y: 9, name: "Cornelia", icon: "T", label: "Town of Cornelia", revealFlag: null },
  { id: "cornelia_caves", mapId: "overworld", x: 10, y: 4, name: "Caves of Cornelia", icon: "C", label: "The Caves of Cornelia", revealFlag: null },
  { id: "chaos_shrine", mapId: "overworld", x: 13, y: 2, name: "Chaos Shrine", icon: "!", label: "The Chaos Shrine", revealFlag: "crystal_key_found" },
  { id: "wind_shrine", mapId: "overworld", x: 6, y: 2, name: "Wind Shrine", icon: "^", label: "The Wind Shrine", revealFlag: "story_started" },
  { id: "pravog", mapId: "overworld", x: 2, y: 8, name: "Pravog", icon: "T", label: "Port of Pravog", revealFlag: null },
  { id: "marsh_cave", mapId: "overworld", x: 1, y: 6, name: "Marsh Cave", icon: "M", label: "The Marsh Cave", revealFlag: "story_started" },
  { id: "mount_gulg", mapId: "overworld", x: 5, y: 5, name: "Mount Gulg", icon: "G", label: "Mount Gulg — the Dwarven Mine", revealFlag: "story_started" },
  { id: "elfheim", mapId: "overworld", x: 15, y: 13, name: "Elfheim", icon: "T", label: "Elfheim", revealFlag: "elfheim_unlocked" },
  { id: "gnome_tunnels", mapId: "overworld", x: 14, y: 13, name: "Gnome Tunnels", icon: "G", label: "The Gnome Tunnels", revealFlag: "story_started" },
  { id: "pravo_lighthouse", mapId: "overworld", x: 2, y: 10, name: "Lighthouse", icon: "L", label: "Pravog Lighthouse", revealFlag: "story_started" },
  { id: "ember_sanctum", mapId: "overworld", x: 18, y: 2, name: "Ember Sanctum", icon: "E", label: "The Ember Sanctum", revealFlag: "airship_obtained" },
  // Task #146: the Glacier Isle's frozen port, charted once the ship sails.
  { id: "glacierport", mapId: "overworld", x: 25, y: 12, name: "Glacierport", icon: "T", label: "Glacierport — the Frozen Isle", revealFlag: "ship_obtained" },
];
