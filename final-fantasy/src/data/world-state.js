// Task #103: Crystal Bridge world-state data — as each crystal is restored,
// a bridge of light spans the sea toward Windfall and the Glacier Isle, and
// the sealed gates of the eastern channel swing open. Tiles are relative to
// the overworld map (src/data/maps.js): each bridge only spans water ("~"),
// landing on land at both ends, so the party can cross on foot once the
// bridge's crystal is restored.

export const WORLD_BRIDGES = [
  {
    id: "fire_bridge",
    name: "Fire Bridge",
    require: { flag: "crystal_fire" },
    mapId: "overworld",
    // The north causeway (row 10): from the continent at (14,10) across the
    // sea (x15-19) onto the Windfall headland at (20,10).
    tiles: [
      { x: 15, y: 10 },
      { x: 16, y: 10 },
      { x: 17, y: 10 },
      { x: 18, y: 10 },
      { x: 19, y: 10 },
    ],
    label: "The Fire Bridge burns across the northern sea, born of the Fire Crystal's light.",
  },
  {
    id: "water_bridge",
    name: "Water Bridge",
    require: { flag: "crystal_water" },
    mapId: "overworld",
    // The south crossing (row 12): from the continent at (16,12) across two
    // tiles of sea onto Windfall's southern shore at (19,12).
    tiles: [
      { x: 17, y: 12 },
      { x: 18, y: 12 },
    ],
    label: "The Water Bridge flows into being — calm water made solid by the Water Crystal.",
  },
  {
    id: "earth_bridge",
    name: "Earth Bridge",
    require: { flag: "crystal_earth" },
    mapId: "overworld",
    // The mid causeway (row 11): from the continent at (15,11) across the
    // three-tile strait onto Windfall at (19,11).
    tiles: [
      { x: 16, y: 11 },
      { x: 17, y: 11 },
      { x: 18, y: 11 },
    ],
    label: "The Earth Bridge rises from the deep, a spine of stone and root laid by the Earth Crystal.",
  },
  {
    id: "wind_bridge",
    name: "Wind Bridge",
    require: { flag: "crystal_wind" },
    mapId: "overworld",
    // The channel to the Glacier Isle (row 12, col 23): the final span,
    // bridging Windfall at (22,12) to the ice at (24,12).
    tiles: [{ x: 23, y: 12 }],
    label: "The Wind Bridge threads the channel — a ribbon of air over the deep water, guided by the Wind Crystal.",
  },
];

export const WORLD_GATES = [
  {
    id: "east_causeway_gate",
    name: "East Causeway Gate",
    mapId: "overworld",
    x: 20,
    y: 10,
    require: { crystals: 2 },
    label: "The East Causeway Gate bars the headland — the seal breaks when two crystals blaze anew.",
  },
  {
    id: "deep_channel_gate",
    name: "Deep Channel Gate",
    mapId: "overworld",
    x: 20,
    y: 12,
    require: { crystals: 3 },
    label: "The Deep Channel Gate seals the island's heart — the seal breaks when three crystals blaze anew.",
  },
];
