// Validation tests for Task #188: waystone travel — every payload lands on a
// real map's walkable, waystone-marked tile; routes only exist between lit
// stones.

import { WaystoneSystem } from "../engine/waystones.js";
import { WAYSTONES } from "../data/waystones.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const maps = new MapManager();
  for (const m of MAPS) maps.register(m);

  const state = new GameState();
  const ws = new WaystoneSystem(WAYSTONES, { state });
  for (const w of WAYSTONES) ws.activate(w.id);

  const ids = WAYSTONES.map((w) => w.id);
  for (const from of ids) {
    const d = ws.destinations(from);
    check("route from " + from + " to all others", d.ok === true && d.to.length === ids.length - 1);
    for (const to of d.to) {
      const t = ws.travel(from, to.id);
      const map = maps.get(t.to.mapId);
      check("payload " + from + "->" + to.id + " on real map", t.ok === true && !!map, t.to.mapId);
      if (!map) continue;
      const row = map.rows?.[t.to.y];
      check("payload " + from + "->" + to.id + " in bounds", !!row && t.to.x >= 0 && t.to.x < row.length);
      if (!row) continue;
      const ch = row[t.to.x];
      check("payload " + from + "->" + to.id + " walkable", !map.solid?.[ch], "char: " + ch);
      check("payload " + from + "->" + to.id + " on the glyph", ch === "W");
      check("payload " + from + "->" + to.id + " has facing", ["N", "S", "E", "W"].includes(t.to.facing));
    }
  }

  // Re-activation guard: lights persist.
  const c2 = new GameState();
  const ws2 = new WaystoneSystem(WAYSTONES, { state: c2 });
  ws2.activate("cornelia");
  check("lights persist per state", ws2.isActivated("cornelia") && !ws2.isActivated("elfheim"));

  return out;
}
