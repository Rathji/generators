// Validation tests for Task #168: the Codex of Fiends.

import { BESTIARY } from "../data/bestiary.js";
import { BestiarySystem } from "../engine/bestiary.js";
import { ENEMIES } from "../data/enemies.js";
import { TRIALS } from "../data/trials.js";

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

  check("thirteen codex pages", BESTIARY.length === 13);
  check("one apex page", BESTIARY.filter((e) => e.apex).length === 1);
  check("every boss exists", BESTIARY.every((e) => !!ENEMIES[e.bossId]));
  check("every entry maps to a trial", BESTIARY.every((e) => TRIALS.some((t) => t.id === e.trialId)));
  check("every entry has lore", BESTIARY.every((e) => typeof e.lore === "string" && e.lore.length > 0));
  check("every entry has weakness", BESTIARY.every((e) => typeof e.weakness === "string"));

  // Empty slate: nothing known.
  const sys = new BestiarySystem(BESTIARY, { state: fakeState({}) });
  check("nothing known at start", sys.knownCount() === 0);
  check("not complete at start", sys.complete() === false);

  // Full story flags: all 12 base pages known, apex page still sealed.
  const flags = {
    story_garland_defeated: true, story_marsh_guardian_defeated: true, story_gulg_guardian_defeated: true,
    story_chaos_defeated: true, story_iron_sentinel_defeated: true, story_tide_serpent_defeated: true,
    story_phantom_light_defeated: true, story_wind_fiend_defeated: true, story_forge_colossus_defeated: true,
    story_frost_wyrm_defeated: true, story_ember_fiend_defeated: true, story_chrono_defeated: true,
  };
  const sys2 = new BestiarySystem(BESTIARY, { state: fakeState(flags) });
  check("twelve known after story", sys2.knownCount() === 12);
  check("codex not complete without apex", sys2.complete() === false);
  check("apex page sealed", sys2.report().find((r) => r.apex).known === false);

  // Slain-again tracking via trial clears.
  flags.trial_garland_cleared = true;
  const g = sys2.entry("garland");
  check("garland slain again", sys2.isSlainAgain(g) === true);
  check("slainAgainCount counts echoes", sys2.slainAgainCount() >= 1);

  // Completing the Apex closes the Codex.
  flags.trial_apex_cleared = true;
  check("all thirteen known", sys2.knownCount() === 13);
  check("codex complete", sys2.complete() === true);
  check("apex page open", sys2.report().find((r) => r.apex).known === true);

  // entry() resolves base pages only.
  check("entry resolves chrono base page", sys2.entry("chrono")?.name === "Chrono");

  return out;
}
