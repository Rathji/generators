// Task #134: Overworld Shortcut System — once a story flag is set (or a key
// item is held), standing on a shortcut tile instantly skips the redundant
// path to its destination (a town entrance, a lower dungeon floor, etc).
// Requirements: `flag` (state flag) or `item` (inventory item).

export const SHORTCUTS = [
  {
    id: "elfheim_pass_shortcut",
    name: "Mountain Pass Shortcut",
    mapId: "overworld",
    x: 14,
    y: 9,
    require: { item: "crystalKey" },
    to: { mapId: "elfheim", x: 7, y: 7, facing: "N" },
    flavor: "The mountain gate yields to the Crystal Key — Elfheim is a single stride away.",
  },
  {
    id: "gulg_boss_shortcut",
    name: "Gulg Heart Passage",
    mapId: "overworld",
    x: 5,
    y: 5,
    require: { flag: "story_gulg_guardian_defeated" },
    to: { mapId: "mount_gulg_b2", x: 7, y: 7, facing: "N" },
    flavor: "The warriors of Gulg keep the upper halls clear — you descend straight to the mountain's heart.",
  },
  {
    id: "chaos_rift_shortcut",
    name: "Chaos Shrine Lower Halls",
    mapId: "overworld",
    x: 13,
    y: 2,
    require: { flag: "story_chaos_defeated" },
    to: { mapId: "chaos_shrine_b2", x: 7, y: 5, facing: "N" },
    flavor: "The temple's rites are broken — its lower halls lie open before you.",
  },
  {
    id: "dwarfholm_road",
    name: "Dwarven Tunnel Road",
    mapId: "overworld",
    x: 14,
    y: 13,
    require: { flag: "story_forge_colossus_defeated" },
    to: { mapId: "dwarfholm", x: 7, y: 6, facing: "N" },
    flavor: "The Dwarves have cleared the tunnel-road — Dwarfholm lies just beyond the pass.",
  },
];
