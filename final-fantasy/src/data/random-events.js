// Task #135: World Map Random Events — low-probability non-combat encounters
// that occur while stepping across the overworld: lost items, stray gold, a
// wandering merchant, or a friendly healer. Weighted pick table.

export const RANDOM_EVENTS = [
  {
    id: "lost_potion",
    kind: "item",
    weight: 30,
    itemId: "potion",
    count: 1,
    message: "You find a Potion half-buried in the grass.",
  },
  {
    id: "abandoned_pack",
    kind: "item",
    weight: 20,
    itemId: "antidote",
    count: 1,
    message: "A traveler's pack lies abandoned by the road — an Antidote is inside.",
  },
  {
    id: "coin_purse",
    kind: "gold",
    weight: 25,
    min: 10,
    max: 40,
    message: "A small purse of gold lies by the roadside.",
  },
  {
    id: "wandering_merchant",
    kind: "merchant",
    weight: 10,
    itemId: "hiPotion",
    count: 1,
    message: "A wandering merchant trades a Hi-Potion for directions.",
  },
  {
    id: "friendly_fairy",
    kind: "heal",
    weight: 15,
    frac: 0.3,
    message: "A fairy flutters by and mends your party's wounds.",
  },
];
