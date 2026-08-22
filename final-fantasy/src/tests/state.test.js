// Validation tests for Task #3: Global Game State Manager.

import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const s = new GameState();
  check("default location", s.location.mapId === "overworld" && s.location.facing === "S");
  check("flags default off", s.getFlag("any") === false);

  s.setFlag("boss1_defeated");
  check("setFlag defaults true", s.getFlag("boss1_defeated") === true);
  s.setFlag("crystal1", 1);
  check("truthy flag values read true", s.getFlag("crystal1") === true);
  check("hasFlag alias", s.hasFlag("boss1_defeated") === true);
  s.clearFlag("boss1_defeated");
  check("clearFlag", s.getFlag("boss1_defeated") === false);
  check("toggle flag", s.toggleFlag("t") === true && s.toggleFlag("t") === false);

  s.setLocation("cornelia", 3, 7, "N");
  const loc = s.getLocation();
  check("setLocation", loc.mapId === "cornelia" && loc.x === 3 && loc.y === 7 && loc.facing === "N");
  s.setStoryPhase(2);
  check("story phase", s.getStoryPhase() === 2);

  const snap = s.snapshot();
  check("snapshot carries version", snap.version === 1);
  s.setFlag("later", true);
  s.setStoryPhase(9);
  s.gold = 500;
  s.restore(snap);
  check("restore reverts flags", s.getFlag("later") === false && s.getFlag("crystal1") === true);
  check("restore reverts phase", s.getStoryPhase() === 2);
  check("restore reverts gold", s.gold === 0);
  check("restore reverts location", s.getLocation().mapId === "cornelia");
  check("restore returns this", s.restore(snap) === s);

  const fakeParty = { id: "party" };
  const fakeInv = { id: "inv" };
  s.setParty(fakeParty);
  s.setInventory(fakeInv);
  check("party wired", s.party === fakeParty);
  check("inventory wired", s.inventory === fakeInv);

  check("restore tolerates null", s.restore(null) === s);
  check("empty state snapshot ok", new GameState().snapshot().version === 1);

  return out;
}
