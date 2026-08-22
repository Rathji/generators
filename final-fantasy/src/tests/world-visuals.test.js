// Validation tests for Task #152: World-State Visual Updates — permanent
// town-texture/tile patches driven by major plot flags.

import { WorldVisualSystem } from "../engine/world-visuals.js";
import { WORLD_VISUALS } from "../data/world-visuals.js";
import { GameState } from "../engine/state.js";
import { MapManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

function registry() {
  const m = new MapManager();
  for (const d of MAPS) m.register(d);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const wv = new WorldVisualSystem(WORLD_VISUALS, { state });

  check("visual data present", WORLD_VISUALS.length >= 4);
  check("forge door patch exists", wv.all().some((p) => p.id === "dwarfholm_forge_open"));

  // No flags set yet -> nothing visible, nothing opens.
  check("patches inactive before the plot", wv.activePatchesFor("dwarfholm").length === 0);
  check("no override before the plot", wv.passabilityOverride("cornelia", 13, 4) === null);

  // The Forge Colossus falls -> the Dwarfholm forge door shows open.
  state.setFlag("story_forge_colossus_defeated", true);
  const dwarfPatches = wv.activePatchesFor("dwarfholm");
  check("forge + brazier patches activate", dwarfPatches.some((p) => p.id === "dwarfholm_forge_open") && dwarfPatches.some((p) => p.id === "dwarfholm_braziers_lit"));
  const door = wv.activePatchAt("dwarfholm", 10, 1);
  check("forge door renders as an open door", door && door.char === "D" && door.cls === "door" && door.label.length > 0);
  check("glacierport cavern thaws too", wv.activePatchAt("glacierport", 10, 1)?.char === "D");

  // The castle gate only opens once Chaos falls.
  check("castle gate still sealed", wv.passabilityOverride("cornelia", 13, 4) === null);
  state.setFlag("story_chaos_defeated", true);
  const gate = wv.activePatchAt("cornelia", 13, 4);
  check("castle gate patch activates", gate && gate.solid === false);
  check("opened gate override", wv.passabilityOverride("cornelia", 13, 4) === "open");

  // Windfall's Sea Shrine door opens with the water crystal.
  check("windfall shrine door opens with crystal_water", wv.activePatchAt("windfall", 10, 1) === null);
  state.setFlag("crystal_water", true);
  check("windfall shrine door now open", wv.activePatchAt("windfall", 10, 1)?.char === "D");

  check("every patch tile is in bounds", wv.audit(registry()).length === 0);

  return out;
}
