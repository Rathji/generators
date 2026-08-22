// Validation tests for Task #183: the WaystoneSystem engine — activation,
// reachability, and travel payloads.

import { WaystoneSystem } from "../engine/waystones.js";
import { WAYSTONES } from "../data/waystones.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const ws = new WaystoneSystem(WAYSTONES, { state });

  check("six stones in defs", ws.all().length === 6);
  check("nothing lit initially", ws.countLit() === 0);
  check("destinations blocked pre-activation", ws.destinations("cornelia").ok === false);

  const r = ws.activate("cornelia");
  check("activate cornelia", r.ok === true && r.firstTime === true && r.lit === 1);
  check("activate cornelia idempotent", ws.activate("cornelia").firstTime === false && ws.countLit() === 1);
  check("flag set", state.getFlag("waystone_cornelia") === true);
  check("unknown waystone", ws.activate("nope").ok === false && ws.destinations("nope").ok === false);

  check("activateAt by tile", ws.activateAt("pravog", 10, 3).ok === true && ws.countLit() === 2);
  check("activateAt wrong tile", ws.activateAt("pravog", 0, 0).ok === false);
  check("waystoneAt lookup", ws.waystoneAt("cornelia", 12, 3)?.id === "cornelia" && ws.waystoneAt("cornelia", 0, 0) === null);

  const d = ws.destinations("cornelia");
  check("destinations list", d.ok === true && d.to.length === 1 && d.to[0].id === "pravog");
  check("destination excludes self", !d.to.some((x) => x.id === "cornelia"));

  check("travel to unlit blocked", ws.travel("cornelia", "elfheim").ok === false);
  const t = ws.travel("cornelia", "pravog");
  check("travel payload", t.ok === true && t.to.mapId === "pravog" && t.to.x === 10 && t.to.y === 3 && t.to.facing === "S");

  for (const id of ["elfheim", "windfall", "dwarfholm", "glacierport"]) ws.activate(id);
  check("all six lit", ws.countLit() === 6);
  check("five destinations", ws.destinations("cornelia").to.length === 5);
  const back = ws.travel("dwarfholm", "glacierport");
  check("cross-region travel", back.ok === true && back.to.mapId === "glacierport");
  check("status rows", ws.status().length === 6 && ws.status().every((s) => s.activated));

  return out;
}
