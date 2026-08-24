// Validation tests for Task #237: the World Map — region catalog, visited tracking,
// grid rendering, and progress derived from the Codex.

import { WorldMapSystem } from "../engine/world-map.js";
import { WORLD_REGIONS, WORLD_MAP, regionById, regionForMap, mapCount } from "../data/world-map.js";
import { MAPS } from "../data/maps.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const allMapIds = new Set(MAPS.map((m) => m.id));
  check("regions defined", WORLD_REGIONS.length >= 20);
  check("map count covers all non-overworld maps", mapCount() === allMapIds.size - 1, mapCount() + " vs " + allMapIds.size);
  const letters = WORLD_REGIONS.map((r) => r.letter);
  check("unique letters", new Set(letters).size === letters.length);
  check("coordinates in bounds", WORLD_REGIONS.every((r) => r.x >= 0 && r.x < WORLD_MAP.width && r.y >= 0 && r.y < WORLD_MAP.height));
  check("every region map id exists", WORLD_REGIONS.every((r) => r.maps.every((m) => allMapIds.has(m))));

  const wm = new WorldMapSystem({ codex: null });
  check("no-codex shows nothing visited", wm.progress().visited === 0 && wm.progress().total === WORLD_REGIONS.length);
  const grid = wm.grid();
  check("grid dimensions", grid.length === WORLD_MAP.height && grid.every((row) => row.length === WORLD_MAP.width));
  const hasLetter = grid.some((row) => row.some((c) => letters.includes(c)));
  check("grid contains region markers", hasLetter);

  // visited tracking via a fake codex
  const fake = { isKnown: (sec, id) => id === "cornelia" || id === "elfheim" };
  const wm2 = new WorldMapSystem({ codex: fake });
  check("legend flags visited", wm2.legend().filter((r) => r.visited).length === 2);
  check("progress reflects visits", wm2.progress().visited === 2 && wm2.progress().total === WORLD_REGIONS.length);
  check("visited render marks letters", wm2.renderVisited().length > 0);

  return out;
}
