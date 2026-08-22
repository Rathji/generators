// Task #50: Residential Interior Mapping — links each town building's door
// tile to its interior map ID, spawn point, and return exit.

export const BUILDINGS = {
  cornelia: [
    {
      id: "cornelia_house",
      name: "House",
      town: "cornelia",
      door: { x: 2, y: 1 },
      interior: { mapId: "cornelia_house", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "cornelia_house2",
      name: "House",
      town: "cornelia",
      door: { x: 9, y: 1 },
      interior: { mapId: "cornelia_house2", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "cornelia_shop",
      name: "General Store",
      town: "cornelia",
      door: { x: 10, y: 1 },
      interior: { mapId: "cornelia_shop", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "cornelia_castle",
      name: "Castle Cornelia",
      town: "cornelia",
      door: { x: 11, y: 1 },
      interior: { mapId: "cornelia_castle", x: 6, y: 4, facing: "N" },
      exit: { x: 6, y: 5, facing: "S" },
    },
    // Task #161: the Hall of Trials beneath the castle — the post-game arena
    // where the realm's vanquished fiends are called back to the circle.
    // Its door (13,1) is sealed by the trial_hall_gate until Chrono falls.
    {
      id: "trial_hall",
      name: "Hall of Trials",
      town: "cornelia",
      door: { x: 13, y: 1 },
      interior: { mapId: "trial_hall", x: 7, y: 5, facing: "N" },
      exit: { x: 7, y: 6, facing: "S" },
    },
  ],
  pravog: [
    {
      id: "pravog_house",
      name: "House",
      town: "pravog",
      door: { x: 3, y: 1 },
      interior: { mapId: "pravog_house", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "pravog_shop",
      name: "Merchant",
      town: "pravog",
      door: { x: 9, y: 2 },
      interior: { mapId: "pravog_shop", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "pravog_inn",
      name: "Pravog Inn",
      town: "pravog",
      door: { x: 5, y: 3 },
      interior: { mapId: "pravog_inn", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "pravog_church",
      name: "Pravog Chapel",
      town: "pravog",
      door: { x: 10, y: 5 },
      interior: { mapId: "pravog_shop", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
  ],
  elfheim: [
    {
      id: "elfheim_house",
      name: "House",
      town: "elfheim",
      door: { x: 3, y: 1 },
      interior: { mapId: "elfheim_house", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "elfheim_shop",
      name: "Merchant",
      town: "elfheim",
      door: { x: 10, y: 2 },
      interior: { mapId: "elfheim_shop", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "elfheim_inn",
      name: "Elfheim Inn",
      town: "elfheim",
      door: { x: 5, y: 3 },
      interior: { mapId: "elfheim_inn", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "elfheim_royal",
      name: "Elf Prince's Hall",
      town: "elfheim",
      door: { x: 10, y: 3 },
      interior: { mapId: "elfheim_royal", x: 3, y: 5, facing: "N" },
      exit: { x: 3, y: 6, facing: "S" },
    },
  ],
  // Task #112: Windfall Isle — house, inn, and merchant; the Sea Shrine is a
  // manual transition (its door tile is handled in main.js).
  windfall: [
    {
      id: "windfall_house",
      name: "House",
      town: "windfall",
      door: { x: 3, y: 1 },
      interior: { mapId: "windfall_house", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "windfall_inn",
      name: "Windfall Inn",
      town: "windfall",
      door: { x: 9, y: 3 },
      interior: { mapId: "windfall_inn", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "windfall_shop",
      name: "Windfall Merchant",
      town: "windfall",
      door: { x: 4, y: 3 },
      interior: { mapId: "windfall_shop", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
  ],
  // Task #131: Dwarfholm — the underground dwarven capital; the Forge front
  // (10,1) is a manual transition into the Dwarven Forge (handled in main.js).
  dwarfholm: [
    {
      id: "dwarfholm_house",
      name: "House",
      town: "dwarfholm",
      door: { x: 3, y: 1 },
      interior: { mapId: "dwarfholm_house", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "dwarfholm_inn",
      name: "Dwarfholm Inn",
      town: "dwarfholm",
      door: { x: 9, y: 3 },
      interior: { mapId: "dwarfholm_inn", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "dwarfholm_shop",
      name: "Dwarven Smithy",
      town: "dwarfholm",
      door: { x: 4, y: 3 },
      interior: { mapId: "dwarfholm_shop", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
  ],
  // Task #142: Glacierport — the frozen port town; the cavern door (10,1) is
  // a manual transition into the Frozen Caverns (handled in main.js).
  glacierport: [
    {
      id: "glacierport_house",
      name: "House",
      town: "glacierport",
      door: { x: 3, y: 1 },
      interior: { mapId: "glacierport_house", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "glacierport_inn",
      name: "Glacierport Inn",
      town: "glacierport",
      door: { x: 9, y: 3 },
      interior: { mapId: "glacierport_inn", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
    {
      id: "glacierport_shop",
      name: "Glacierport Provisions",
      town: "glacierport",
      door: { x: 4, y: 3 },
      interior: { mapId: "glacierport_shop", x: 3, y: 4, facing: "N" },
      exit: { x: 3, y: 5, facing: "S" },
    },
  ],
};
