// Inn definitions (Task #23) — per-inn stay cost. `freeIfFlag` lets a
// story event make a stay free once a world flag is set.

export const INNS = {
  cornelia_inn: { id: "cornelia_inn", name: "Cornelia Inn", cost: 40, freeIfFlag: null },
  pravog_inn: { id: "pravog_inn", name: "Pravog Inn", cost: 60, freeIfFlag: null },
  north_village_inn: { id: "north_village_inn", name: "Northwind Inn", cost: 70, freeIfFlag: null },
  // Task #176-#185: the jungle village's lodge among the canopy.
  jungle_village_inn: { id: "jungle_village_inn", name: "Canopy Lodge", cost: 65, freeIfFlag: null },
};
