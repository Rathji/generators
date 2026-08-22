// Task #49: Town NPC Placement Map — data-driven layouts defining the exact
// coordinates/spawns of resident NPCs per map.

export const NPC_PLACEMENTS = {
  cornelia: [
    { id: "cornelia_guard", name: "Guard", x: 8, y: 3, facing: "S", dialogueId: "cornelia.guard", sprite: "g" },
    { id: "cornelia_elder", name: "Village Elder", x: 2, y: 3, facing: "E", dialogueId: "cornelia.elder", sprite: "e" },
    { id: "cornelia_woman", name: "Townswoman", x: 10, y: 5, facing: "N", dialogueId: "cornelia.woman", sprite: "w" },
    { id: "cornelia_child", name: "Child", x: 9, y: 5, facing: "N", dialogueId: "cornelia.child", sprite: "k" },
    { id: "cornelia_innkeeper", name: "Innkeeper", x: 4, y: 3, facing: "S", dialogueId: "cornelia.innkeeper", sprite: "i" },
    { id: "cornelia_blacksmith", name: "Blacksmith", x: 3, y: 5, facing: "W", dialogueId: "cornelia.blacksmith", sprite: "b",
      // Task #106: once Garland falls, the smith works the anvil by the gate.
      states: [{ require: { flag: "story_garland_defeated" }, x: 2, y: 1, facing: "E", sprite: "b" }] },
    { id: "cornelia_mayor", name: "Mayor", x: 11, y: 4, facing: "W", dialogueId: "cornelia.mayor", sprite: "m" },
    { id: "cornelia_townsman", name: "Townsman", x: 2, y: 5, facing: "E", dialogueId: "cornelia.townsman", sprite: "t" },
    // Task #185: the Waystone Keeper, who tends the town's glowing stone.
    { id: "cornelia_waystone_keeper", name: "Waystone Keeper", x: 13, y: 3, facing: "W", dialogueId: "cornelia.waystone_keeper", sprite: "e" },
    // Task #108: the Mysterious Traveler — hidden until the party steps on
    // the well-trodden tile by the fountain, then appears on the castle road.
    { id: "cornelia_traveler", name: "Mysterious Traveler", x: 12, y: 2, facing: "S", dialogueId: "cornelia.traveler", sprite: "t",
      secret: { mapId: "cornelia", x: 11, y: 6, flag: "secret_traveler_found" } },
  ],
  cornelia_inn: [
    { id: "inn_innkeeper", name: "Innkeeper", x: 4, y: 3, facing: "S", dialogueId: "inn.innkeeper", sprite: "i" },
  ],
  cornelia_castle: [
    { id: "castle_guard1", name: "Castle Guard", x: 4, y: 3, facing: "S", dialogueId: "cornelia.castle_guard", sprite: "g" },
    { id: "castle_guard2", name: "Castle Guard", x: 9, y: 3, facing: "S", dialogueId: "cornelia.castle_guard", sprite: "g" },
    // Task #197: the Remembrance Sage, keeper of the broken age's turning.
    { id: "cornelia_sage", name: "Remembrance Sage", x: 7, y: 4, facing: "W", dialogueId: "cornelia.sage", sprite: "e" },
  ],
  caves_of_cornelia: [
    { id: "cave_hermit", name: "Hermit", x: 4, y: 4, facing: "E", dialogueId: "caves.hermit", sprite: "h" },
  ],
  // Task #151: the Timekeeper, who tends the Chaos Shrine's stopped clock.
  chaos_shrine: [
    { id: "shrine_timekeeper", name: "Timekeeper", x: 7, y: 7, facing: "W", dialogueId: "timekeeper", sprite: "e" },
  ],
  // Task #162: the Hall of Trials — the arena's keeper and its chronicler of
  // every fiend the realm has faced.
  trial_hall: [
    { id: "trial_master", name: "Trial Master", x: 5, y: 5, facing: "E", dialogueId: "trial_master", sprite: "e" },
    { id: "trial_chronicler", name: "Chronicler", x: 9, y: 5, facing: "W", dialogueId: "trial_chronicler", sprite: "w" },
  ],
  pravog: [
    { id: "pravog_harbormaster", name: "Harbor Master", x: 12, y: 6, facing: "W", dialogueId: "pravo.harbormaster", sprite: "h" },
    { id: "pravog_sailor", name: "Sailor", x: 11, y: 7, facing: "N", dialogueId: "pravo.sailor", sprite: "s" },
    { id: "pravog_merchant", name: "Merchant", x: 10, y: 2, facing: "S", dialogueId: "pravo.merchant", sprite: "m" },
    { id: "pravog_mayor", name: "Mayor", x: 8, y: 3, facing: "S", dialogueId: "pravo.mayor", sprite: "m" },
    // Task #168: the expanded harbor — dock hands, fishers, and their kin.
    { id: "pravog_dockworker", name: "Dockworker", x: 13, y: 6, facing: "S", dialogueId: "pravo.dockworker", sprite: "t" },
    { id: "pravog_fisherman", name: "Fisherman", x: 8, y: 6, facing: "E", dialogueId: "pravo.fisherman", sprite: "t" },
    { id: "pravog_fisherwife", name: "Fisher's Wife", x: 8, y: 7, facing: "W", dialogueId: "pravo.fisherwife", sprite: "w" },
    { id: "pravog_dockchild", name: "Dock Boy", x: 11, y: 6, facing: "S", dialogueId: "pravo.dockchild", sprite: "k" },
  ],
  pravog_inn: [
    { id: "pravog_innkeeper", name: "Innkeeper", x: 4, y: 3, facing: "S", dialogueId: "inn.innkeeper", sprite: "i" },
  ],
  pravog_house: [
    { id: "pravog_housewife", name: "Housewife", x: 3, y: 3, facing: "E", dialogueId: "pravo.housewife", sprite: "w" },
  ],
  pravog_house2: [
    { id: "pravog_resident", name: "Resident", x: 3, y: 3, facing: "E", dialogueId: "pravo.resident", sprite: "t" },
  ],
  pravog_armory: [
    { id: "pravog_armorer", name: "Armorer", x: 3, y: 3, facing: "E", dialogueId: "pravo.armorer", sprite: "b" },
  ],
  pravog_church: [
    { id: "pravog_priest", name: "Priest", x: 3, y: 3, facing: "E", dialogueId: "pravo.priest", sprite: "e" },
  ],
  marsh_cave: [
    { id: "marsh_trapper", name: "Trapper", x: 9, y: 7, facing: "W", dialogueId: "marsh.trapper", sprite: "t" },
  ],
  elfheim: [
    { id: "elfheim_guard", name: "Elf Guard", x: 8, y: 1, facing: "S", dialogueId: "elfheim.guard", sprite: "g" },
    { id: "elfheim_merchant", name: "Merchant", x: 11, y: 3, facing: "S", dialogueId: "elfheim.merchant", sprite: "m" },
    { id: "elfheim_elder", name: "Elf Elder", x: 2, y: 6, facing: "E", dialogueId: "elfheim.elder", sprite: "e" },
    { id: "elfheim_child", name: "Elf Child", x: 12, y: 6, facing: "W", dialogueId: "elfheim.child", sprite: "k" },
    { id: "elfheim_innkeeper", name: "Innkeeper", x: 6, y: 3, facing: "S", dialogueId: "inn.innkeeper", sprite: "i" },
    { id: "elfheim_villager", name: "Elf", x: 4, y: 6, facing: "N", dialogueId: "elfheim.villager", sprite: "t" },
    { id: "elfheim_inventor", name: "Gnome Inventor", x: 13, y: 6, facing: "W", dialogueId: "elfheim.inventor", sprite: "g" },
  ],
  elfheim_royal: [
    { id: "elfheim_prince", name: "Elf Prince", x: 2, y: 2, facing: "S", dialogueId: "elfheim.prince", sprite: "p" },
    { id: "elfheim_palace_guard", name: "Royal Guard", x: 1, y: 4, facing: "E", dialogueId: "elfheim.palace_guard", sprite: "g" },
  ],
  // Task #108: Wind Shrine — the post-game sky shrine's attendants.
  wind_shrine: [
    { id: "wind_shrine_keeper", name: "Shrine Keeper", x: 6, y: 6, facing: "E", dialogueId: "wind_shrine.keeper", sprite: "e" },
    { id: "wind_shrine_pilgrim", name: "Pilgrim", x: 9, y: 6, facing: "W", dialogueId: "wind_shrine.pilgrim", sprite: "t" },
    { id: "wind_shrine_acolyte", name: "Acolyte", x: 7, y: 7, facing: "N", dialogueId: "wind_shrine.acolyte", sprite: "m" },
    { id: "wind_shrine_chorister", name: "Chorister", x: 5, y: 8, facing: "E", dialogueId: "wind_shrine.chorister", sprite: "w" },
  ],
  // Task #112: Windfall — the ship-only fishing village.
  windfall: [
    { id: "windfall_elder", name: "Village Elder", x: 7, y: 7, facing: "W", dialogueId: "windfall.elder", sprite: "e" },
    { id: "windfall_fisher", name: "Fisher", x: 12, y: 5, facing: "N", dialogueId: "windfall.fisher", sprite: "t" },
    { id: "windfall_shipwright", name: "Shipwright", x: 2, y: 7, facing: "E", dialogueId: "windfall.shipwright", sprite: "b" },
    { id: "windfall_innkeeper", name: "Innkeeper", x: 11, y: 7, facing: "N", dialogueId: "inn.innkeeper", sprite: "i" },
    { id: "windfall_child", name: "Child", x: 5, y: 7, facing: "N", dialogueId: "windfall.child", sprite: "k" },
    { id: "windfall_merchant", name: "Merchant", x: 2, y: 3, facing: "E", dialogueId: "windfall.merchant", sprite: "m" },
  ],
  // Task #131: Dwarfholm — the underground dwarven capital beneath Mount Gulg.
  dwarfholm: [
    { id: "dwarfholm_king", name: "Dwarf King", x: 7, y: 7, facing: "W", dialogueId: "dwarfholm.king", sprite: "e" },
    { id: "dwarfholm_smith", name: "Dwarven Smith", x: 2, y: 5, facing: "E", dialogueId: "dwarfholm.smith", sprite: "b" },
    { id: "dwarfholm_elder", name: "Elder", x: 12, y: 5, facing: "N", dialogueId: "dwarfholm.elder", sprite: "e" },
    { id: "dwarfholm_innkeeper", name: "Innkeeper", x: 11, y: 7, facing: "N", dialogueId: "inn.innkeeper", sprite: "i" },
    { id: "dwarfholm_child", name: "Child", x: 5, y: 7, facing: "N", dialogueId: "dwarfholm.child", sprite: "k" },
    { id: "dwarfholm_miner", name: "Miner", x: 2, y: 3, facing: "E", dialogueId: "dwarfholm.miner", sprite: "t" },
    // Task #174: the forge-masters — the Artificer smiths materials into
    // gear; the Gem Cutter sets enchanted gems into that gear.
    { id: "dwarfholm_artificer", name: "Artificer", x: 6, y: 6, facing: "N", dialogueId: "dwarfholm.artificer", sprite: "b" },
    { id: "dwarfholm_gemcutter", name: "Gem Cutter", x: 10, y: 3, facing: "S", dialogueId: "dwarfholm.gemcutter", sprite: "m" },
  ],
  // Task #142: Glacierport — the frozen port town on the Glacier Isle.
  glacierport: [
    { id: "glacierport_elder", name: "Village Elder", x: 7, y: 7, facing: "W", dialogueId: "glacierport.elder", sprite: "e" },
    { id: "glacierport_captain", name: "Harbor Captain", x: 12, y: 5, facing: "N", dialogueId: "glacierport.captain", sprite: "b" },
    { id: "glacierport_innkeeper", name: "Innkeeper", x: 11, y: 7, facing: "N", dialogueId: "inn.innkeeper", sprite: "i" },
    { id: "glacierport_child", name: "Child", x: 5, y: 7, facing: "N", dialogueId: "glacierport.child", sprite: "k" },
    { id: "glacierport_fisher", name: "Fisher", x: 2, y: 3, facing: "E", dialogueId: "glacierport.fisher", sprite: "t" },
    { id: "glacierport_merchant", name: "Merchant", x: 2, y: 5, facing: "E", dialogueId: "glacierport.merchant", sprite: "m" },
  ],
  // Task #171/#173: the Northern Wastes — scouts who braved the snow and
  // trade tales of the pass at the wastes' edge.
  north_wastes: [
    { id: "north_scout", name: "Wastes Scout", x: 9, y: 4, facing: "E", dialogueId: "northwastes.scout", sprite: "t" },
    { id: "north_hunter", name: "Snow Hunter", x: 17, y: 10, facing: "N", dialogueId: "northwastes.hunter", sprite: "h" },
  ],
  // Task #172/#173: Northwind Village — the wastes' only settlement.
  north_village: [
    { id: "north_elder", name: "Village Elder", x: 7, y: 7, facing: "W", dialogueId: "northwind.elder", sprite: "e" },
    { id: "north_huntress", name: "Huntress", x: 12, y: 5, facing: "N", dialogueId: "northwind.huntress", sprite: "t" },
    { id: "north_trapper", name: "Trapper", x: 2, y: 5, facing: "E", dialogueId: "northwind.trapper", sprite: "t" },
    { id: "north_child", name: "Child", x: 5, y: 7, facing: "N", dialogueId: "northwind.child", sprite: "k" },
    { id: "north_innkeeper", name: "Innkeeper", x: 11, y: 7, facing: "N", dialogueId: "inn.innkeeper", sprite: "i" },
  ],
  north_village_house: [
    { id: "north_villager", name: "Villager", x: 3, y: 3, facing: "E", dialogueId: "northwind.villager", sprite: "t" },
  ],
  north_village_shop: [
    { id: "north_shopkeep", name: "Shopkeeper", x: 3, y: 3, facing: "E", dialogueId: "northwind.shopkeep", sprite: "m" },
  ],
  north_village_inn: [
    { id: "north_innkeeper2", name: "Innkeeper", x: 4, y: 3, facing: "S", dialogueId: "inn.innkeeper", sprite: "i" },
  ],
  // Task #176/#178: the Southern Jungles — a guide meets the ship at the
  // river dock, and a hunter keeps watch by the village lane.
  south_jungle: [
    { id: "jungle_guide", name: "Jungle Guide", x: 16, y: 11, facing: "W", dialogueId: "jungleguide.greeting", sprite: "t" },
    { id: "jungle_hunter", name: "Jungle Hunter", x: 2, y: 8, facing: "E", dialogueId: "jungle.hunter", sprite: "h" },
  ],
  // Task #177/#178: Jungle Village — the clearing's residents and the shaman
  // who keeps the Old Ways (and the ruins' secret).
  jungle_village: [
    { id: "jungle_elder", name: "Village Elder", x: 8, y: 4, facing: "S", dialogueId: "jungle.elder", sprite: "e" },
    { id: "jungle_shaman", name: "Shaman", x: 7, y: 6, facing: "N", dialogueId: "jungle.shaman", sprite: "m" },
    { id: "jungle_herbalist", name: "Herbalist", x: 2, y: 5, facing: "E", dialogueId: "jungle.herbalist", sprite: "w" },
    { id: "jungle_child", name: "Child", x: 11, y: 5, facing: "N", dialogueId: "jungle.child", sprite: "k" },
    { id: "jungle_villager", name: "Villager", x: 6, y: 8, facing: "W", dialogueId: "jungle.villager", sprite: "t" },
  ],
  jungle_village_house: [
    { id: "jungle_housewife", name: "Housewife", x: 3, y: 3, facing: "E", dialogueId: "jungle.housewife", sprite: "w" },
  ],
  jungle_village_shop: [
    { id: "jungle_shopkeep", name: "Trader", x: 3, y: 3, facing: "E", dialogueId: "jungle.shopkeep", sprite: "m" },
  ],
  jungle_village_inn: [
    { id: "jungle_innkeeper", name: "Innkeeper", x: 4, y: 3, facing: "S", dialogueId: "inn.innkeeper", sprite: "i" },
  ],
  // Task #181/#183: the Western Highlands — Stormhold's patrol guards on the
  // windy roads below the castle.
  west_highlands: [
    { id: "highlands_scout", name: "Highlands Scout", x: 6, y: 9, facing: "N", dialogueId: "highlands.scout", sprite: "t" },
    { id: "highlands_patrol", name: "Castle Patrol", x: 12, y: 5, facing: "W", dialogueId: "highlands.guard", sprite: "s" },
  ],
  // Task #182/#183: Stormhold Castle — its herald and keep-guard, with the
  // duke and duchess enthroned within.
  highlands_castle: [
    { id: "highlands_herald", name: "Herald", x: 6, y: 3, facing: "S", dialogueId: "highlands.herald", sprite: "h" },
    { id: "highlands_guard", name: "Keep Guard", x: 10, y: 6, facing: "N", dialogueId: "highlands.guard", sprite: "s" },
  ],
  highlands_castle_throne: [
    { id: "highlands_duke", name: "Duke Aldric", x: 5, y: 3, facing: "S", dialogueId: "highlands.duke", sprite: "n" },
    { id: "highlands_duchess", name: "Duchess Seraphine", x: 7, y: 3, facing: "S", dialogueId: "highlands.duchess", sprite: "q" },
  ],
  highlands_castle_barracks: [
    { id: "highlands_captain", name: "Captain Voss", x: 4, y: 3, facing: "S", dialogueId: "highlands.captain", sprite: "s" },
  ],
};
