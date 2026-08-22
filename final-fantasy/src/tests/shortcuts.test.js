// Validation tests for Task #134: Overworld Shortcut System.

import { ShortcutSystem } from "../engine/shortcuts.js";
import { SHORTCUTS } from "../data/shortcuts.js";
import { MapManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

function makeMaps() {
  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  return maps;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const flags = { story_gulg_guardian_defeated: true };
  const owned = new Set(["crystalKey"]);
  const state = { hasFlag: (name) => flags[name] === true };
  const sys = new ShortcutSystem(SHORTCUTS, { state, hasItem: (id) => owned.has(id) });

  check("shortcuts defined", SHORTCUTS.length >= 3);
  check("overworld shortcuts exist", sys.defsFor("overworld").length >= 3);

  // Flag-gated shortcut.
  check("gulg shortcut active when flag set", sys.active("overworld", 5, 5)?.id === "gulg_boss_shortcut");
  flags["story_gulg_guardian_defeated"] = false;
  check("gulg shortcut inactive without flag", sys.active("overworld", 5, 5) === null);
  flags["story_gulg_guardian_defeated"] = true;

  // Item-gated shortcut.
  check("elfheim pass active with key", sys.active("overworld", 14, 9)?.id === "elfheim_pass_shortcut");
  owned.delete("crystalKey");
  check("elfheim pass inactive without key", sys.active("overworld", 14, 9) === null);
  owned.add("crystalKey");

  // use() returns the destination.
  const u = sys.use("overworld", 14, 9);
  check("use returns destination", u.ok === true && u.to.mapId === "elfheim" && u.shortcut.id === "elfheim_pass_shortcut");
  check("use fails on closed tile", sys.use("overworld", 1, 1).ok === false);

  // Chaos shrine shortcut after the temple falls.
  check("chaos shortcut gated", sys.active("overworld", 13, 2) === null);
  flags["story_chaos_defeated"] = true;
  check("chaos shortcut opens", sys.active("overworld", 13, 2)?.to.mapId === "chaos_shrine_b2");

  // describe.
  const d = sys.describe("overworld", 14, 9);
  check("describe requirement + flavor", d?.requirement === "item:crystalKey" && d?.name.length > 0 && d.flavor.length > 0);
  check("describe on empty tile", sys.describe("overworld", 1, 1) === null);

  // Every shortcut maps to real maps and has a valid destination.
  const maps = makeMaps();
  const audit = sys.audit(maps);
  check("audit ok against real maps", audit.ok === true && audit.errors.length === 0);

  // Requirement audit: a shortcut with no requirement flags an error.
  const bad = new ShortcutSystem([{ id: "x", mapId: "overworld", x: 0, y: 0, to: { mapId: "elfheim", x: 7, y: 7 } }], { state, hasItem: () => false });
  check("audit flags missing requirement", bad.audit(maps).ok === false);

  return out;
}
