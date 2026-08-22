// Task #224: Area-music region mapping — every map in the game resolves to a
// region (overworld / town / dungeon), and each region has a song from
// Task #221's soundtrack. Data-driven so tests can prove full coverage.

import { MAPS } from "./maps.js";

// Town maps: the five hub towns plus their buildings.
const TOWN_PREFIXES = ["cornelia", "pravog", "elfheim", "windfall", "dwarfholm", "glacierport"];
const TOWN_SUFFIXES = ["_inn", "_shop", "_house", "_house2", "_castle", "_royal"];

export function classifyMap(mapId) {
  if (mapId === "overworld") return "overworld";
  if (TOWN_PREFIXES.includes(mapId)) return "town";
  if (TOWN_PREFIXES.some((p) => TOWN_SUFFIXES.some((s) => mapId === p + s))) return "town";
  return "dungeon";
}

export const REGION_SONGS = {
  overworld: "overworld",
  town: "town",
  dungeon: "dungeon",
};

export function songForMap(mapId) {
  return REGION_SONGS[classifyMap(mapId)] ?? null;
}

export function allMapIds() {
  return MAPS.map((m) => m.id);
}

export function regionSummary() {
  const out = {};
  for (const id of allMapIds()) out[id] = classifyMap(id);
  return out;
}
