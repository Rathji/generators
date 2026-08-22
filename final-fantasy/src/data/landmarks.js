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
  // Task #169: Eastern Coast markers — landmarks along Pravog's shore road.
  { id: "pravog_docks", mapId: "overworld", x: 3, y: 8, name: "Pravog Docks", icon: "D", label: "The Docks of Pravog", revealFlag: "story_started" },
  { id: "coastal_road", mapId: "overworld", x: 6, y: 8, name: "Coastal Road", icon: "R", label: "The Coastal Road East", revealFlag: null },
  { id: "eastwatch_cliffs", mapId: "overworld", x: 5, y: 7, name: "Eastwatch Cliffs", icon: "E", label: "The Eastwatch Cliffs", revealFlag: "story_started" },
  { id: "sea_caves", mapId: "overworld", x: 1, y: 10, name: "Sea Caves", icon: "C", label: "The Sea Caves", revealFlag: "story_started" },
  // Task #171: the frozen north, charted once the Dawnbreaker sails.
  { id: "north_wastes", mapId: "overworld", x: 17, y: 4, name: "Northern Wastes", icon: "N", label: "The Northern Wastes", revealFlag: "ship_obtained" },
  // Task #176-#185: the Southern Jungles, reached by boat from Pravog's inlet.
  { id: "south_jungle", mapId: "overworld", x: 2, y: 9, name: "Southern Jungles", icon: "J", label: "The Southern Jungles", revealFlag: "ship_obtained" },
];
