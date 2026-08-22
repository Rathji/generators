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
  ],
  pravog_inn: [
    { id: "pravog_innkeeper", name: "Innkeeper", x: 4, y: 3, facing: "S", dialogueId: "inn.innkeeper", sprite: "i" },
  ],
  pravog_house: [
    { id: "pravog_housewife", name: "Housewife", x: 3, y: 3, facing: "E", dialogueId: "pravo.housewife", sprite: "w" },
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
};
