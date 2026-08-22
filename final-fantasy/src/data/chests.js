// Chest data (Task #54) — treasure chests placed by map coordinates with
// loot tables, gold, and a flag marking them opened.

export const CHESTS = [
  {
    id: "cave_chest_upper",
    mapId: "caves_of_cornelia",
    x: 10,
    y: 9,
    contents: {
      loot: [
        { itemId: "potion", chance: 1, count: 2 },
        { itemId: "phoenixDown", chance: 0.5, count: 1 },
      ],
      gold: 40,
    },
    flag: "chest_cave_upper_opened",
  },
  {
    id: "cave_chest_lower",
    mapId: "caves_of_cornelia_b2",
    x: 4,
    y: 5,
    contents: {
      items: [{ itemId: "ironSword", count: 1 }],
      xp: 30,
    },
    flag: "chest_cave_lower_opened",
  },
  {
    id: "house_chest",
    mapId: "cornelia_house",
    x: 1,
    y: 3,
    contents: {
      loot: [{ itemId: "ether", chance: 1, count: 1 }],
      gold: 20,
    },
    flag: "chest_house_opened",
  },
  {
    id: "cave_chest_west",
    mapId: "caves_of_cornelia",
    x: 3,
    y: 8,
    contents: {
      loot: [{ itemId: "antidote", chance: 1, count: 1 }, { itemId: "ribbon", chance: 0.1, count: 1 }],
      gold: 25,
    },
    rare: { itemId: "phoenixDown", chance: 0.08 },
    flag: "chest_cave_west_opened",
  },
  {
    id: "marsh_chest_ruin",
    mapId: "marsh_cave",
    x: 13,
    y: 5,
    contents: {
      loot: [{ itemId: "eyeDrops", chance: 1, count: 1 }, { itemId: "crystalCharm", chance: 0.2, count: 1 }],
      gold: 60,
    },
    flag: "chest_marsh_ruin_opened",
  },
  {
    id: "marsh_chest_altar",
    mapId: "marsh_cave_b2",
    x: 12,
    y: 6,
    contents: {
      items: [{ itemId: "silverRing", count: 1 }],
      xp: 120,
    },
    flag: "chest_marsh_altar_opened",
  },
  {
    id: "gulg_chest_ore",
    mapId: "mount_gulg",
    x: 13,
    y: 5,
    contents: {
      loot: [{ itemId: "goldNeedle", chance: 1, count: 1 }, { itemId: "soft", chance: 0.3, count: 1 }],
      gold: 90,
    },
    flag: "chest_gulg_ore_opened",
  },
  {
    id: "gulg_chest_forge",
    mapId: "mount_gulg_b2",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "plate", count: 1 }],
      xp: 200,
    },
    flag: "chest_gulg_forge_opened",
  },
  {
    id: "shrine_chest_holy",
    mapId: "chaos_shrine",
    x: 13,
    y: 4,
    contents: {
      loot: [{ itemId: "ribbon", chance: 1, count: 1 }, { itemId: "elixir", chance: 0.25, count: 1 }],
      gold: 150,
    },
    rare: { itemId: "megalixir", chance: 0.05 },
    flag: "chest_shrine_holy_opened",
  },
  {
    id: "shrine_chest_depths",
    mapId: "chaos_shrine_b2",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "elixir", count: 2 }],
      xp: 300,
    },
    flag: "chest_shrine_depths_opened",
  },
  {
    id: "tunnel_chest_gears",
    mapId: "gnome_tunnels",
    x: 12,
    y: 5,
    contents: {
      loot: [{ itemId: "goldNeedle", chance: 1 }, { itemId: "powerGauntlet", chance: 0.15 }],
      gold: 120,
    },
    flag: "chest_tunnel_gears_opened",
  },
  {
    id: "tunnel_chest_vault",
    mapId: "gnome_tunnels_b2",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "powerGauntlet", count: 1 }],
      gold: 150,
      xp: 160,
    },
    flag: "chest_tunnel_vault_opened",
  },
  {
    id: "wind_chest_sky",
    mapId: "wind_shrine",
    x: 13,
    y: 4,
    contents: {
      loot: [{ itemId: "phoenixDown", chance: 1 }, { itemId: "aeroScroll", chance: 0.25 }],
      gold: 180,
    },
    flag: "chest_wind_sky_opened",
  },
  {
    id: "wind_chest_altar",
    mapId: "wind_shrine_b2",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "elixir", count: 2 }, { itemId: "aeroScroll", count: 1 }],
      xp: 400,
    },
    flag: "chest_wind_altar_opened",
  },
  {
    id: "sea_chest_kelp",
    mapId: "sea_shrine",
    x: 12,
    y: 5,
    contents: {
      loot: [{ itemId: "soft", chance: 1 }, { itemId: "silverRing", chance: 0.2 }],
      gold: 140,
    },
    flag: "chest_sea_kelp_opened",
  },
  {
    id: "sea_chest_depths",
    mapId: "sea_shrine_b2",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "cottage", count: 1 }],
      xp: 220,
    },
    rare: { itemId: "tritonCrown", chance: 0.1 },
    flag: "chest_sea_depths_opened",
  },
  {
    id: "vault_chest_crown",
    mapId: "sea_vault",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "tritonCrown", count: 1 }],
      gold: 400,
      xp: 300,
    },
    flag: "chest_vault_crown_opened",
  },
  {
    id: "lighthouse_chest_beacon",
    mapId: "lighthouse",
    x: 12,
    y: 5,
    contents: {
      loot: [{ itemId: "phoenixDown", chance: 1 }, { itemId: "starlightCrest", chance: 0.1 }],
      gold: 130,
    },
    flag: "chest_lighthouse_beacon_opened",
  },
  {
    id: "sea_chest_idol",
    mapId: "sea_shrine",
    x: 5,
    y: 3,
    contents: {
      items: [{ itemId: "sunkenIdol", count: 1 }],
      gold: 60,
    },
    flag: "chest_sea_idol_opened",
  },
  // Task #125: Ember Sanctum chests — provisions for the climb, and the
  // Molten Core holds the Magma Heart and the Ember Core the blacksmith
  // covets.
  {
    id: "ember_chest_lower",
    mapId: "ember_sanctum",
    x: 12,
    y: 5,
    contents: {
      loot: [{ itemId: "phoenixDown", chance: 1 }, { itemId: "elixir", chance: 0.15 }],
      gold: 150,
    },
    flag: "chest_ember_lower_opened",
  },
  {
    id: "ember_chest_halls",
    mapId: "ember_sanctum_b2",
    x: 5,
    y: 3,
    contents: {
      items: [{ itemId: "hiPotion", count: 2 }],
      gold: 120,
    },
    flag: "chest_ember_halls_opened",
  },
  {
    id: "ember_chest_core",
    mapId: "ember_sanctum_core",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "magmaHeart", count: 1 }, { itemId: "emberCore", count: 1 }],
      gold: 200,
    },
    flag: "chest_ember_core_opened",
  },
  // Task #135: Dwarven Forge chests — the Hearthstone in the upper forge,
  // and the Rune Plate in the forge's heart.
  {
    id: "forge_chest_hearth",
    mapId: "forge_upper",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "hearthstone", count: 1 }],
      gold: 180,
    },
    flag: "chest_forge_hearth_opened",
  },
  {
    id: "forge_chest_halls",
    mapId: "forge_core",
    x: 5,
    y: 3,
    contents: {
      items: [{ itemId: "hiPotion", count: 2 }],
      gold: 140,
    },
    flag: "chest_forge_halls_opened",
  },
  {
    id: "forge_chest_rune",
    mapId: "forge_core",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "runePlate", count: 1 }],
      gold: 260,
    },
    flag: "chest_forge_rune_opened",
  },
  // Task #146: Frozen Caverns chests — the Sunstone in the upper ice, and
  // the Frost Wyrm's hoard (the Rime Mail) in the cavern's heart.
  {
    id: "frozen_chest_snow",
    mapId: "frozen_upper",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "sunstone", count: 1 }],
      gold: 120,
    },
    flag: "chest_frozen_snow_opened",
  },
  {
    id: "frozen_chest_halls",
    mapId: "frozen_core",
    x: 5,
    y: 3,
    contents: {
      items: [{ itemId: "hiPotion", count: 2 }],
      gold: 140,
    },
    flag: "chest_frozen_halls_opened",
  },
  {
    id: "frozen_chest_hoard",
    mapId: "frozen_core",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "rimeMail", count: 1 }],
      gold: 300,
    },
    flag: "chest_frozen_hoard_opened",
  },
  // Task #155: Labyrinth of Time chests — the Void Relic in the rift, and
  // the Chrono Mail in the throne at the bottom of time.
  {
    id: "time_chest_rift",
    mapId: "time_rift",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "voidRelic", count: 1 }],
      gold: 200,
    },
    flag: "chest_time_rift_opened",
  },
  {
    id: "time_chest_halls",
    mapId: "time_labyrinth",
    x: 5,
    y: 3,
    contents: {
      items: [{ itemId: "hiPotion", count: 2 }],
      gold: 160,
    },
    flag: "chest_time_halls_opened",
  },
  {
    id: "time_chest_throne",
    mapId: "chrono_throne",
    x: 12,
    y: 5,
    contents: {
      items: [{ itemId: "chronoMail", count: 1 }, { itemId: "elixir", count: 1 }],
      gold: 250,
    },
    flag: "chest_time_throne_opened",
  },
  // Task #174: Ice Cave chests — the Frost Crystal that parts the crystal
  // wall rests in a hoard by the upper cave's mouth.
  {
    id: "ice_chest_crystal",
    mapId: "ice_cave_upper",
    x: 13,
    y: 8,
    contents: {
      items: [{ itemId: "frostCrystal", count: 1 }],
      loot: [{ itemId: "frostShard", chance: 1, count: 2 }, { itemId: "iceGem", chance: 0.4, count: 1 }],
      gold: 100,
    },
    flag: "chest_ice_crystal_opened",
  },
  {
    id: "ice_chest_west",
    mapId: "ice_cave_upper",
    x: 2,
    y: 7,
    contents: {
      loot: [{ itemId: "hiPotion", chance: 1, count: 2 }, { itemId: "frostCloak", chance: 0.5, count: 1 }],
      gold: 80,
    },
    flag: "chest_ice_west_opened",
  },
  {
    id: "ice_chest_chamber",
    mapId: "ice_cave_b2",
    x: 9,
    y: 1,
    contents: {
      loot: [{ itemId: "rimeMail", chance: 0.5, count: 1 }],
      items: [{ itemId: "iceGem", count: 1 }, { itemId: "elixir", count: 1 }],
      gold: 200,
    },
    flag: "chest_ice_chamber_opened",
  },
  // Task #176-#185: Southern Jungles & Western Highlands chests. The Sun-Moss
  // Relic that parts the Sunken Hall's gate rests in the ruins' east hoard;
  // the peak's windward ledges hide the storm-touched loot.
  {
    id: "ruins_relic_hoard",
    mapId: "ancient_ruins",
    x: 3,
    y: 5,
    contents: {
      items: [{ itemId: "ruinsRelic", count: 1 }],
      loot: [{ itemId: "mossSpore", chance: 1, count: 2 }, { itemId: "beetleShell", chance: 0.5, count: 1 }],
      gold: 120,
    },
    flag: "chest_ruins_relic_opened",
  },
  {
    id: "ruins_loot_west",
    mapId: "ancient_ruins",
    x: 14,
    y: 5,
    contents: {
      loot: [{ itemId: "hiPotion", chance: 1, count: 2 }, { itemId: "soft", chance: 0.5, count: 1 }],
      gold: 90,
    },
    flag: "chest_ruins_west_opened",
  },
  {
    id: "ruins_loot_chamber",
    mapId: "ancient_ruins_b2",
    x: 11,
    y: 1,
    contents: {
      items: [{ itemId: "elixir", count: 1 }],
      gold: 150,
    },
    flag: "chest_ruins_chamber_opened",
  },
  {
    id: "peak_loot_ledge",
    mapId: "highland_peak",
    x: 11,
    y: 7,
    contents: {
      loot: [{ itemId: "hiPotion", chance: 1, count: 2 }, { itemId: "galeEssence", chance: 0.5, count: 1 }],
      gold: 100,
    },
    flag: "chest_peak_ledge_opened",
  },
  {
    id: "peak_hoard",
    mapId: "highland_peak_b2",
    x: 7,
    y: 7,
    contents: {
      loot: [{ itemId: "stormFeather", chance: 1, count: 2 }, { itemId: "thunderGem", chance: 0.5, count: 1 }],
      gold: 250,
    },
    flag: "chest_peak_hoard_opened",
  },
];
