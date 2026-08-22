// Task #25: Random encounter tables — per-map rate (probability of an
// encounter per step, gated by a minimum gap) and weighted encounter groups.
// Task #37: `global` is the canonical overworld monster table; maps set
// `useGlobal: true` to roll from it.
// Task #56: themed dungeon tables (`dungeon_cave`/`dungeon_castle`/
// `dungeon_volcano`); a map def may set `theme` to roll from one of these.

export const ENCOUNTERS = {
  global: {
    rate: 0.1,
    minGap: 3,
    table: [
      { group: "goblins", weight: 3 },
      { group: "imp_pack", weight: 2 },
      { group: "wild_beasts", weight: 2 },
      { group: "bandits", weight: 1 },
    ],
  },
  overworld: {
    useGlobal: true,
  },
  caves_of_cornelia: {
    rate: 0.14,
    minGap: 3,
    table: [
      { group: "cave_pack", weight: 3 },
      { group: "imp_pack", weight: 2 },
      { group: "cave_dwellers", weight: 2 },
      { group: "goblin_brigade", weight: 1 },
    ],
  },
  caves_of_cornelia_b2: {
    theme: "dungeon_cave",
  },
  dungeon_cave: {
    rate: 0.14,
    minGap: 3,
    table: [
      { group: "cave_dwellers", weight: 3 },
      { group: "cave_pack", weight: 2 },
      { group: "imp_pack", weight: 2 },
      { group: "goblin_brigade", weight: 1 },
    ],
  },
  dungeon_castle: {
    rate: 0.16,
    minGap: 3,
    table: [
      { group: "castle_guard", weight: 3 },
      { group: "haunted_halls", weight: 2 },
      { group: "cave_dwellers", weight: 2 },
      { group: "goblin_brigade", weight: 1 },
    ],
  },
  dungeon_volcano: {
    rate: 0.18,
    minGap: 2,
    table: [
      { group: "fire_swarm", weight: 3 },
      { group: "volcanic_spirits", weight: 2 },
      { group: "imp_pack", weight: 2 },
      { group: "goblin_brigade", weight: 1 },
    ],
  },
  dungeon_marsh: {
    rate: 0.16,
    minGap: 3,
    table: [
      { group: "marsh_dwellers", weight: 3 },
      { group: "swamp_pack", weight: 2 },
      { group: "crab_claws", weight: 2 },
      { group: "wisp_swarm", weight: 1 },
    ],
  },
  marsh_cave: {
    rate: 0.15,
    minGap: 3,
    table: [
      { group: "swamp_pack", weight: 3 },
      { group: "marsh_dwellers", weight: 2 },
      { group: "crab_claws", weight: 2 },
      { group: "wisp_swarm", weight: 1 },
    ],
  },
  marsh_cave_b2: {
    theme: "dungeon_marsh",
  },
  // Task #95: Mount Gulg mine & forge depths — tougher than the marsh, and
  // the deeper forge level rolls from the shared `dungeon_gulg` theme.
  mount_gulg: {
    rate: 0.16,
    minGap: 3,
    table: [
      { group: "mine_pack", weight: 3 },
      { group: "forge_brigands", weight: 2 },
      { group: "lava_pack", weight: 2 },
      { group: "elemental_rustlers", weight: 1 },
    ],
  },
  mount_gulg_b2: {
    theme: "dungeon_gulg",
  },
  dungeon_gulg: {
    rate: 0.18,
    minGap: 2,
    table: [
      { group: "lava_pack", weight: 3 },
      { group: "elemental_rustlers", weight: 2 },
      { group: "mine_pack", weight: 2 },
      { group: "forge_brigands", weight: 1 },
    ],
  },
  // Task #98: Chaos Shrine — the deadliest table yet; the Dark Altar rolls
  // from the shared `dungeon_chaos` theme.
  chaos_shrine: {
    rate: 0.18,
    minGap: 3,
    table: [
      { group: "dark_minions", weight: 3 },
      { group: "shadow_pack", weight: 2 },
      { group: "dark_crusade", weight: 2 },
      { group: "fiend_cabal", weight: 1 },
    ],
  },
  chaos_shrine_b2: {
    theme: "dungeon_chaos",
  },
  dungeon_chaos: {
    rate: 0.2,
    minGap: 2,
    table: [
      { group: "shadow_pack", weight: 3 },
      { group: "fiend_cabal", weight: 2 },
      { group: "dark_crusade", weight: 2 },
      { group: "dark_minions", weight: 1 },
    ],
  },
  // Task #103: Gnome Tunnels gearworks — clockwork guardians in the upper
  // tunnels; the Engine Vault below rolls from the shared `dungeon_gnome`
  // theme.
  gnome_tunnels: {
    rate: 0.16,
    minGap: 3,
    table: [
      { group: "gear_swarm", weight: 3 },
      { group: "sentry_pack", weight: 2 },
      { group: "tunnel_trolls", weight: 2 },
      { group: "rust_brigade", weight: 1 },
    ],
  },
  gnome_tunnels_b2: {
    theme: "dungeon_gnome",
  },
  dungeon_gnome: {
    rate: 0.18,
    minGap: 2,
    table: [
      { group: "sentry_pack", weight: 3 },
      { group: "rust_brigade", weight: 2 },
      { group: "gear_swarm", weight: 2 },
      { group: "tunnel_trolls", weight: 1 },
    ],
  },
  // Task #107: Wind Shrine — the post-game sky shrine; its monsters outclass
  // even the Chaos Shrine's, and the Sky Altar rolls from `dungeon_wind`.
  wind_shrine: {
    rate: 0.18,
    minGap: 3,
    table: [
      { group: "zephyr_pack", weight: 3 },
      { group: "harpy_flight", weight: 2 },
      { group: "sky_serpents", weight: 2 },
      { group: "wind_templars", weight: 1 },
    ],
  },
  wind_shrine_b2: {
    theme: "dungeon_wind",
  },
  dungeon_wind: {
    rate: 0.2,
    minGap: 2,
    table: [
      { group: "wind_templars", weight: 3 },
      { group: "sky_serpents", weight: 2 },
      { group: "harpy_flight", weight: 2 },
      { group: "zephyr_pack", weight: 1 },
    ],
  },
  // Task #114: Sea Shrine — Windfall's tide-washed shrine. Mid-game strength;
  // the Sunken Sanctum rolls from the shared `dungeon_sea` theme.
  sea_shrine: {
    rate: 0.16,
    minGap: 3,
    table: [
      { group: "tide_pack", weight: 3 },
      { group: "reef_guard", weight: 2 },
      { group: "eel_drift", weight: 2 },
      { group: "abyss_hunters", weight: 1 },
    ],
  },
  sea_shrine_b2: {
    theme: "dungeon_sea",
  },
  dungeon_sea: {
    rate: 0.18,
    minGap: 2,
    table: [
      { group: "reef_guard", weight: 3 },
      { group: "abyss_hunters", weight: 2 },
      { group: "eel_drift", weight: 2 },
      { group: "tide_pack", weight: 1 },
    ],
  },
  // Task #116: the Drowned Vault guards its treasure with the shrine's
  // fiercest watchers.
  sea_vault: {
    rate: 0.2,
    minGap: 2,
    table: [
      { group: "abyss_hunters", weight: 3 },
      { group: "reef_guard", weight: 2 },
    ],
  },
  // Task #117: Pravo Lighthouse — the phantom light's tower; the lamp room
  // rolls from the shared `dungeon_phantom` theme.
  lighthouse: {
    rate: 0.15,
    minGap: 3,
    table: [
      { group: "phantom_swarm", weight: 3 },
      { group: "wisp_drift", weight: 2 },
      { group: "wraith_watch", weight: 2 },
      { group: "keeper_chorus", weight: 1 },
    ],
  },
  lighthouse_top: {
    theme: "dungeon_phantom",
  },
  dungeon_phantom: {
    rate: 0.17,
    minGap: 2,
    table: [
      { group: "wraith_watch", weight: 3 },
      { group: "keeper_chorus", weight: 2 },
      { group: "wisp_drift", weight: 2 },
      { group: "phantom_swarm", weight: 1 },
    ],
  },
  // Task #123: Ember Sanctum — the deepest levels roll from the shared
  // `dungeon_ember` theme; level 1 has its own lighter table.
  ember_sanctum: {
    rate: 0.17,
    minGap: 3,
    table: [
      { group: "ember_swarm", weight: 3 },
      { group: "cinder_guard", weight: 2 },
      { group: "pyre_cabal", weight: 2 },
      { group: "lava_crawlers", weight: 1 },
    ],
  },
  ember_sanctum_b2: {
    theme: "dungeon_ember",
  },
  ember_sanctum_core: {
    theme: "dungeon_ember",
  },
  dungeon_ember: {
    rate: 0.19,
    minGap: 2,
    table: [
      { group: "ember_swarm", weight: 3 },
      { group: "lava_crawlers", weight: 2 },
      { group: "cinder_guard", weight: 2 },
      { group: "pyre_cabal", weight: 1 },
    ],
  },
  // Task #133: Dwarven Forge — the core rolls from the shared `dungeon_forge`
  // theme; the upper forge has its own lighter table.
  forge_upper: {
    rate: 0.17,
    minGap: 3,
    table: [
      { group: "forge_drones", weight: 3 },
      { group: "hall_guardians", weight: 2 },
      { group: "rune_wardens", weight: 2 },
      { group: "deep_pack", weight: 1 },
    ],
  },
  forge_core: {
    theme: "dungeon_forge",
  },
  dungeon_forge: {
    rate: 0.19,
    minGap: 2,
    table: [
      { group: "hall_guardians", weight: 3 },
      { group: "deep_pack", weight: 2 },
      { group: "forge_drones", weight: 2 },
      { group: "rune_wardens", weight: 1 },
    ],
  },
  // Task #144: Frozen Caverns — the ice-choked depths roll from the shared
  // `dungeon_ice` theme; the upper caverns have their own lighter table.
  frozen_upper: {
    rate: 0.17,
    minGap: 3,
    table: [
      { group: "frost_swarm", weight: 3 },
      { group: "ice_pack", weight: 2 },
      { group: "rime_cabal", weight: 2 },
      { group: "frost_hunters", weight: 1 },
    ],
  },
  frozen_core: {
    theme: "dungeon_ice",
  },
  dungeon_ice: {
    rate: 0.19,
    minGap: 2,
    table: [
      { group: "ice_wardens", weight: 3 },
      { group: "frost_hunters", weight: 2 },
      { group: "ice_pack", weight: 2 },
      { group: "rime_cabal", weight: 1 },
    ],
  },
  // Task #153: Labyrinth of Time — the deeper levels roll from the shared
  // `dungeon_time` theme; the rift has its own lighter table.
  time_rift: {
    rate: 0.17,
    minGap: 3,
    table: [
      { group: "rift_swarm", weight: 3 },
      { group: "rift_pack", weight: 2 },
      { group: "chrono_cabal", weight: 2 },
      { group: "sand_hunters", weight: 1 },
    ],
  },
  time_labyrinth: {
    theme: "dungeon_time",
  },
  chrono_throne: {
    theme: "dungeon_time",
  },
  dungeon_time: {
    rate: 0.2,
    minGap: 2,
    table: [
      { group: "void_wardens", weight: 3 },
      { group: "sand_hunters", weight: 2 },
      { group: "chrono_cabal", weight: 2 },
      { group: "rift_pack", weight: 1 },
    ],
  },
};


