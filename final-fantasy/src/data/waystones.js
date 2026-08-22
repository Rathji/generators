// Task #181: The Waystone Network — ancient teleport stones at the heart of
// every town. Touching a waystone activates it; once lit, the network can
// carry the party between any two lit stones in a single breath. Each stone
// sits on its town's map as a `W` glyph and fires a `waystone` world event
// on step.

export const WAYSTONES = [
  {
    id: "cornelia",
    name: "Cornelia",
    region: "the Kingdom of Cornelia",
    mapId: "cornelia",
    x: 12,
    y: 3,
    facing: "S",
    flavor: "The Cornelia waystone hums with the warm light of ten thousand home hearths.",
  },
  {
    id: "pravog",
    name: "Pravog",
    region: "the western coast",
    mapId: "pravog",
    x: 10,
    y: 3,
    facing: "S",
    flavor: "The Pravog waystone smells of salt spray and ringing harbor bells.",
  },
  {
    id: "elfheim",
    name: "Elfheim",
    region: "the south-east peninsula",
    mapId: "elfheim",
    x: 12,
    y: 3,
    facing: "S",
    flavor: "The Elfheim waystone shimmers green — it hums in tune with the forest itself.",
  },
  {
    id: "windfall",
    name: "Windfall",
    region: "the Windfall Isle",
    mapId: "windfall",
    x: 12,
    y: 3,
    facing: "S",
    flavor: "The Windfall waystone carries the far cry of gulls and the beat of rolling surf.",
  },
  {
    id: "dwarfholm",
    name: "Dwarfholm",
    region: "the halls beneath Mount Gulg",
    mapId: "dwarfholm",
    x: 12,
    y: 3,
    facing: "S",
    flavor: "The Dwarfholm waystone thrums with deep hammers — it was carved by the first smiths.",
  },
  {
    id: "glacierport",
    name: "Glacierport",
    region: "the Glacier Isle",
    mapId: "glacierport",
    x: 12,
    y: 3,
    facing: "S",
    flavor: "The Glacierport waystone is cold to the touch, yet it kindles like a banked ember.",
  },
];
