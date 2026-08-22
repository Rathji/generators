// Validation tests for Task #102: Four Crystal Trigger System — data
// integrity, flag-driven restoration, visual/HUD output, and the
// newly-restored notification diff.

import { CRYSTALS } from "../data/crystals.js";
import { CrystalSystem } from "../engine/crystals.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("four crystals defined", CRYSTALS.length === 4);
  const ids = CRYSTALS.map((c) => c.id);
  check(
    "elemental set complete",
    ["fire", "water", "earth", "wind"].every((e) => ids.includes(e))
  );
  check(
    "distinct flags",
    new Set(CRYSTALS.map((c) => c.flag)).size === 4
  );
  check(
    "colors and lore present",
    CRYSTALS.every((c) => /^#[0-9a-f]{6}$/i.test(c.color) && typeof c.line === "string" && c.line.length > 0)
  );

  const state = fakeState();
  const sys = new CrystalSystem(CRYSTALS, { state });

  check("none restored initially", sys.count() === 0 && sys.restored().length === 0);
  check("all missing", sys.missing().length === 4);
  check("hud shows 0/4", sys.hudLine() === "\u25c7\u25c7\u25c7\u25c7 0/4");

  const fired = [];
  sys.onRestored((d) => fired.push(d.id));

  state.setFlag("crystal_fire", true);
  const fresh = sys.check();
  check("check detects fire", fresh.length === 1 && fresh[0].id === "fire");
  check("fire restored", sys.isRestored("fire") && sys.count() === 1);
  check("hud shows 1/4", sys.hudLine() === "\u25c6\u25c7\u25c7\u25c7 1/4");
  const v1 = sys.visuals();
  check("visual tint between bare and full", v1.worldTint > 0.15 && v1.worldTint < 1);
  check("visual glow only on restored", v1.crystals.find((c) => c.id === "fire").glow === 1 && v1.crystals.find((c) => c.id === "water").glow === 0);
  check("listener fired for fire only", fired.join(",") === "fire");

  state.setFlag("crystal_water", true);
  const fresh2 = sys.check();
  check("second check detects water", fresh2.length === 1 && fresh2[0].id === "water");
  check("listener does not refire fire", fired.join(",") === "fire,water");

  const again = sys.check();
  check("no-op check fires nothing", again.length === 0 && fired.length === 2);

  state.setFlag("crystal_earth", true);
  state.setFlag("crystal_wind", true);
  check("all restored", sys.allRestored() && sys.count() === 4 && sys.missing().length === 0);
  const v4 = sys.visuals();
  check("full tint", v4.worldTint === 1 && v4.allRestored === true);
  check("hud full", sys.hudLine() === "\u25c6\u25c6\u25c6\u25c6 4/4");
  check("byId unknown null", sys.byId("void") === null);

  // The demo/listener path calls check() after every battle; a fresh system
  // with already-set flags reports them on the first check without refiring.
  const pre = new CrystalSystem(CRYSTALS, { state: fakeState({ crystal_fire: true }) });
  const preFired = [];
  pre.onRestored((d) => preFired.push(d.id));
  const preFresh = pre.check();
  check("pre-set flag restored", preFresh.length === 1 && preFresh[0].id === "fire");
  check("pre-set diff fires once", preFired.join(",") === "fire");

  return out;
}
