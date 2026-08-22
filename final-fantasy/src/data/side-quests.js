// Side quest definitions (Task #39) — optional NPC quest chains with step
// flags and unique rewards.

export const SIDE_QUESTS = {
  herbalists_request: {
    id: "herbalists_request",
    name: "The Herbalist's Request",
    requiredFlags: ["intro_seen"],
    steps: [
      { flag: "sq_herbalists_request_herb", description: "Bring the rare Herb to the Herbalist" },
    ],
    reward: { item: "hiPotion", count: 2, gold: 50, xp: 30 },
    dialogue: {
      start: "The Herbalist asks you to fetch a rare Herb from the caves.",
      complete: "The Herbalist thanks you and hands over two Hi-Potions!",
    },
  },
  lost_crystal_shard: {
    id: "lost_crystal_shard",
    name: "The Lost Crystal Shard",
    requiredFlags: ["intro_seen", "story_garland_defeated"],
    steps: [
      { flag: "sq_lost_crystal_shard_found", description: "Find the shard in the eastern caves" },
      { flag: "sq_lost_crystal_shard_returned", description: "Return the shard to the Scholar" },
    ],
    reward: { item: "ether", count: 1, gold: 120, xp: 60 },
    dialogue: {
      start: "The Scholar lost a crystal shard in the eastern caves.",
      complete: "The Scholar is overjoyed and rewards you with an Ether!",
    },
  },
  // Task #101: the airship engine — recovered from the Gnome Tunnels below
  // Elfheim, and returned so the inventor can re-fit the airship.
  the_missing_engine: {
    id: "the_missing_engine",
    name: "The Missing Engine",
    requiredFlags: ["story_marsh_guardian_defeated"],
    steps: [
      { flag: "sq_missing_engine_hint", description: "Find the lost airship engine in the Gnome Tunnels" },
      { flag: "sq_missing_engine_recovered", description: "Recover the airship engine from the tunnel depths" },
      { flag: "sq_missing_engine_returned", description: "Return the engine to the Gnome Inventor in Elfheim" },
    ],
    reward: { item: "ether", count: 2, gold: 200, xp: 80 },
    dialogue: {
      start: "The Gnome Inventor lost the airship engine in the tunnels beneath Elfheim.",
      complete: "The Gnome Inventor re-fits the airship engine and thanks you with a gift!",
    },
  },
  // Task #118: the sunken offering — the Windfall elder wants the tide-worn
  // idol from the Sea Shrine's oldest altar returned to its shrine.
  the_sunken_offering: {
    id: "the_sunken_offering",
    name: "The Sunken Offering",
    requiredFlags: ["ship_obtained"],
    steps: [
      { flag: "sq_sunken_offering_found", description: "Recover the Sunken Idol from the Sea Shrine" },
      { flag: "sq_sunken_offering_returned", description: "Return the idol to the Windfall Elder" },
    ],
    reward: { item: "ether", count: 3, gold: 300, xp: 120 },
    dialogue: {
      start: "The Windfall Elder asks you to recover the Sunken Idol from the Sea Shrine's oldest altar.",
      complete: "The Elder blesses the idol's return and rewards you richly!",
    },
  },
  // Task #118: the lighthouse flame — after the Phantom Light falls, the
  // Pravog mayor asks the party to relight the keeper's beacon.
  the_lighthouse_flame: {
    id: "the_lighthouse_flame",
    name: "The Lighthouse Flame",
    requiredFlags: ["story_marsh_guardian_defeated"],
    steps: [
      { flag: "sq_lighthouse_flame_cleared", description: "Quench the Phantom Light in the lamp room" },
      { flag: "sq_lighthouse_flame_reported", description: "Report to the Mayor of Pravog" },
    ],
    reward: { item: "cottage", count: 2, gold: 250, xp: 90 },
    dialogue: {
      start: "The Mayor of Pravog fears the Phantom Light will lure ships onto the rocks.",
      complete: "The Mayor proclaims the beacon restored and honors your party!",
    },
  },
  // Task #126: the ember core — the Cornelia blacksmith wants a live Ember
  // Core from the Sanctum's Molten Core to re-light the town forge.
  the_ember_core: {
    id: "the_ember_core",
    name: "The Ember Core",
    requiredFlags: ["story_wind_fiend_defeated"],
    steps: [
      { flag: "sq_ember_core_found", description: "Recover the Ember Core from the Molten Core" },
      { flag: "sq_ember_core_returned", description: "Return the Ember Core to the Cornelia Blacksmith" },
    ],
    reward: { item: "elixir", count: 2, gold: 400, xp: 150 },
    dialogue: {
      start: "The Cornelia Blacksmith asks you to bring back a live Ember Core from the Sanctum.",
      complete: "The Blacksmith re-lights the forge and thanks you with elixirs!",
    },
  },
  // Task #126: the fiend slayer — the Cornelia mayor wants word that the
  // Ember Fiend is truly dead before the town sleeps easy.
  the_fiend_slayer: {
    id: "the_fiend_slayer",
    name: "The Fiend Slayer",
    requiredFlags: ["story_wind_fiend_defeated"],
    steps: [
      { flag: "sq_fiend_slayer_defeated", description: "Slay the Ember Fiend in the Molten Core" },
      { flag: "sq_fiend_slayer_reported", description: "Report the victory to the Mayor of Cornelia" },
    ],
    reward: { item: "cottage", count: 2, gold: 500, xp: 200 },
    dialogue: {
      start: "The Mayor of Cornelia asks you to prove the Ember Fiend is gone for good.",
      complete: "The Mayor declares the realm's fiends vanquished and honors your party!",
    },
  },
  // Task #136: the hearthstone — the Dwarf King needs the Forge's ancient
  // Hearthstone returned so Dwarfholm's fires can never go out again.
  the_hearthstone: {
    id: "the_hearthstone",
    name: "The Hearthstone",
    requiredFlags: ["story_gulg_guardian_defeated"],
    steps: [
      { flag: "sq_hearthstone_found", description: "Recover the Hearthstone from the Dwarven Forge" },
      { flag: "sq_hearthstone_returned", description: "Return the Hearthstone to the Dwarf King" },
    ],
    reward: { item: "elixir", count: 2, gold: 350, xp: 140 },
    dialogue: {
      start: "The Dwarf King asks you to recover the Forge's Hearthstone from the upper halls.",
      complete: "The King sets the Hearthstone on the great anvil, and Dwarfholm's fires blaze anew!",
    },
  },
  // Task #136: the legendary blade — the Cornelia blacksmith, its forge
  // re-lit by the Ember Core, needs adamantite from the Forge Colossus to
  // cast the blade of legend.
  the_legendary_blade: {
    id: "the_legendary_blade",
    name: "The Legendary Blade",
    requiredFlags: ["sq_the_ember_core_done"],
    steps: [
      { flag: "sq_legendary_blade_ore", description: "Take Adamantite Ore from the Forge Colossus" },
      { flag: "sq_legendary_blade_forged", description: "Bring the ore to the Cornelia Blacksmith" },
    ],
    reward: { item: "luminary", count: 1, gold: 0, xp: 200 },
    dialogue: {
      start: "The Blacksmith's forge burns on your ember — now only adamantite is missing for the blade of legend.",
      complete: "The Blacksmith forges the Luminary — the legendary blade is yours!",
    },
  },
  // Task #147: the sunstone — the Glacierport Elder wants the shard of dawn
  // back in the great brazier so the isle's fires never gutter again.
  the_sunstone: {
    id: "the_sunstone",
    name: "The Sunstone",
    requiredFlags: ["ship_obtained"],
    steps: [
      { flag: "sq_sunstone_found", description: "Recover the Sunstone from the Frozen Caverns" },
      { flag: "sq_sunstone_returned", description: "Return the Sunstone to the Glacierport Elder" },
    ],
    reward: { item: "elixir", count: 2, gold: 350, xp: 140 },
    dialogue: {
      start: "The Glacierport Elder asks you to recover the Sunstone from the Frozen Caverns' upper ice.",
      complete: "The Elder sets the Sunstone in the great brazier — the whole isle warms to the dawn!",
    },
  },
  // Task #147: the frozen blade — the Harbor Captain wants the Frost Wyrm
  // slain and its saga-blade claimed from the hoard it guards.
  the_frozen_blade: {
    id: "the_frozen_blade",
    name: "The Frozen Blade",
    requiredFlags: ["story_forge_colossus_defeated"],
    steps: [
      { flag: "sq_frozen_blade_scale", description: "Take the Frost Scale from the Frost Wyrm" },
      { flag: "sq_frozen_blade_claimed", description: "Claim the Frost Blade from the Harbor Captain" },
    ],
    reward: { item: "frozenBlade", count: 1, gold: 0, xp: 220 },
    dialogue: {
      start: "The Harbor Captain asks you to slay the Frost Wyrm and bring back proof of the deed.",
      complete: "The Captain hands you the Frost Blade — the saga of living ice is yours!",
    },
  },
  // Task #156: the temporal master — the King of Cornelia wants word that
  // the Keeper of Time is truly dead and the rift sealed for good.
  the_temporal_master: {
    id: "the_temporal_master",
    name: "The Temporal Master",
    requiredFlags: ["story_ember_fiend_defeated"],
    steps: [
      { flag: "sq_temporal_master_defeated", description: "Slay Chrono in the Throne of Eternity" },
      { flag: "sq_temporal_master_reported", description: "Report the victory to the King of Cornelia" },
    ],
    reward: { item: "elixir", count: 3, gold: 600, xp: 250 },
    dialogue: {
      start: "The King of Cornelia asks you to face the Keeper of Time and seal the rift beneath the Dark Altar.",
      complete: "The King proclaims the age of darkness ended and honors your party above all heroes!",
    },
  },
  // Task #156: the shattered hourglass — the Timekeeper wants the Void
  // Relic back from the rift so the shrine's clock can run true again.
  the_shattered_hourglass: {
    id: "the_shattered_hourglass",
    name: "The Shattered Hourglass",
    requiredFlags: ["story_ember_fiend_defeated"],
    steps: [
      { flag: "sq_shattered_hourglass_found", description: "Recover the Void Relic from the Time Rift" },
      { flag: "sq_shattered_hourglass_returned", description: "Return the Void Relic to the Timekeeper" },
    ],
    reward: { item: "chronoCore", count: 1, gold: 0, xp: 240 },
    dialogue: {
      start: "The Timekeeper asks you to recover the Void Relic from the rift and bring it back to the shrine.",
      complete: "The Timekeeper winds the great clock — it ticks true for the first time in ages, and gifts you the Chrono Core!",
    },
  },
  // Task #177: the Artificer's Whetstone — the forge-master's old whetstone
  // broke in the Colossus's fall; he needs wyrm-scale and rune-shard to
  // cut a new one. Three Wyrm Scales and two Rune Shards.
  the_artificers_whetstone: {
    id: "the_artificers_whetstone",
    name: "The Artificer's Whetstone",
    requiredFlags: ["story_forge_colossus_defeated"],
    steps: [
      { flag: "sq_artificers_whetstone_materials", description: "Gather three Wyrm Scales and two Rune Shards" },
      { flag: "sq_artificers_whetstone_delivered", description: "Deliver the materials to the Artificer" },
    ],
    reward: { item: "elixir", count: 2, gold: 500, xp: 200 },
    dialogue: {
      start: "The Artificer's old whetstone shattered in the Colossus's fall — three Wyrm Scales and two Rune Shards will cut a new one.",
      complete: "The Artificer sets the new whetstone beside the anvil, sharpens every blade in the hall, and gifts you elixirs!",
    },
  },
  // Task #185: the Waystone Pilgrim — the Waystone Keeper of Cornelia sends
  // the party to light every stone in the realm. The step flag is set by the
  // WaystoneSystem when all six stones burn.
  the_waystone_pilgrim: {
    id: "the_waystone_pilgrim",
    name: "The Waystone Pilgrim",
    requiredFlags: ["intro_seen"],
    steps: [
      { flag: "sq_waystone_pilgrim_all", description: "Activate all six waystones of the realm" },
    ],
    reward: { item: "wayfarerCharm", count: 1, gold: 300, xp: 150 },
    dialogue: {
      start: "The Waystone Keeper asks you to light every waystone in the realm.",
      complete: "All six stones burn as one — the Keeper gifts you the Wayfarer's Charm!",
    },
  },
};
