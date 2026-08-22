// Validation tests for Task #181: the Waystone Network data — six waystones,
// one per town, each on a valid walkable tile of a real map.

import { WAYSTONES } from "../data/waystones.js";
import { MAPS } from "../data/maps.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const mapById = new Map(MAPS.map((m) => [m.id, m]));
  const ids = new Set();
  const coords = new Set();

  check("six waystones", WAYSTONES.length === 6);

  const expected = ["cornelia", "pravog", "elfheim", "windfall", "dwarfholm", "glacierport"];
  for (const e of expected) {
    check("waystone " + e + " present", WAYSTONES.some((w) => w.id === e));
  }

  for (const w of WAYSTONES) {
    const m = mapById.get(w.mapId);
    check("waystone " + w.id + " name/region/flavor", !!(w.name && w.region && w.flavor), w.name);
    check("waystone " + w.id + " unique id", !ids.has(w.id));
    ids.add(w.id);
    check("waystone " + w.id + " on a real map", !!m, w.mapId);
    if (!m) continue;
    const key = w.mapId + ":" + w.x + "," + w.y;
    check("waystone " + w.id + " unique tile", !coords.has(key));
    coords.add(key);
    const h = m.rows.length;
    const wdt = m.rows[0].length;
    check("waystone " + w.id + " in bounds", w.x >= 0 && w.y >= 0 && w.x < wdt && w.y < h, `${w.x},${w.y} in ${wdt}x${h}`);
    if (w.x < 0 || w.y < 0 || w.x >= wdt || w.y >= h) continue;
    const ch = m.rows[w.y][w.x];
    check("waystone " + w.id + " on a walkable tile", ch === "." || ch === "W", "tile char: " + ch);
  }

  return out;
}
