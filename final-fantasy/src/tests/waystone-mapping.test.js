// Validation tests for Task #182: the `W` waystone glyphs on the six town
// maps — present at the waystone coordinates, walkable (non-solid), and no
// map row was broken by the edit.

import { MAPS } from "../data/maps.js";
import { WAYSTONES } from "../data/waystones.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const mapById = new Map(MAPS.map((m) => [m.id, m]));

  for (const m of MAPS) {
    const widths = new Set(m.rows.map((r) => r.length));
    check("rows square: " + m.id, widths.size === 1, [...widths].join(","));
    const h = m.rows.length;
    for (let y = 0; y < h; y++) {
      check(m.id + " row " + y + " is a string", typeof m.rows[y] === "string" && m.rows[y].length === m.rows[0].length);
    }
  }

  for (const w of WAYSTONES) {
    const m = mapById.get(w.mapId);
    check("glyph row exists: " + w.id, !!m && !!m.rows[w.y], w.mapId + ":" + w.x + "," + w.y);
    if (!m || !m.rows[w.y]) continue;
    check("W glyph at coords: " + w.id, m.rows[w.y][w.x] === "W", "char: " + m.rows[w.y][w.x]);
    check("W not solid: " + w.id, !m.solid?.["W"]);
    check("W in tiles spec: " + w.id, typeof m.tiles?.["W"] === "number");
  }

  return out;
}
