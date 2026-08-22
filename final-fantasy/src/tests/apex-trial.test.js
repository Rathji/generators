// Validation tests for Task #167: the Apex — Chrono at twice his power.

import { TrialSystem } from "../engine/trials.js";
import { TRIALS } from "../data/trials.js";
import { ENEMIES } from "../data/enemies.js";
import { ITEMS } from "../data/items.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { Inventory } from "../engine/inventory.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

function fullStoryFlags() {
  return {
    story_garland_defeated: true, story_marsh_guardian_defeated: true, story_gulg_guardian_defeated: true,
    story_chaos_defeated: true, story_iron_sentinel_defeated: true, story_tide_serpent_defeated: true,
    story_phantom_light_defeated: true, story_wind_fiend_defeated: true, story_forge_colossus_defeated: true,
    story_frost_wyrm_defeated: true, story_ember_fiend_defeated: true, story_chrono_defeated: true,
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const apexDef = TRIALS.find((t) => t.apex);
  const flags = fullStoryFlags();
  const state = fakeState(flags);
  const inv = new Inventory();
  const sys = new TrialSystem(TRIALS, { state, inventory: inv, enemySystem: new EnemyTemplateSystem() });

  check("apex defined", !!apexDef);
  check("apex is chrono", apexDef.bossId === "chrono");
  check("apex scale is 2.0", apexDef.scale === 2);
  check("apex is the final order", apexDef.order === 13);

  // Locked until every base trial falls.
  check("apex locked with zero clears", sys.statusReport().find((r) => r.apex).unlocked === false);
  const startBefore = sys.startTrial("apex");
  check("apex start refused early", startBefore.ok === false);

  for (const t of sys.all()) {
    if (t.apex) break;
    sys.recordWin(t.id);
  }
  check("apex unlocked after 12 clears", sys.statusReport().find((r) => r.apex).unlocked === true);
  check("currentTrial is apex", sys.currentTrial()?.id === "apex");

  const enc = sys.buildEncounter("apex");
  const a = enc.enemies[0];
  const base = ENEMIES.chrono;
  check("apex is double hp", a.maxHp === Math.round(base.hp * 2), `apex=${a.maxHp} chrono=${base.hp}`);
  check("apex is double str", a.str === Math.round(base.str * 2));
  check("apex is double def", a.def === Math.round(base.def * 2));
  check("apex xp doubled", a.xp === Math.round(base.xp * 2));
  check("apex gold doubled", a.gold === Math.round(base.gold * 2));
  check("apex has own name", a.name === "Apex Chrono, Keeper of Eternity");
  check("apex is a boss", a.boss === true);
  check("apex keeps phases", Array.isArray(a.phases) && a.phases.length === base.phases.length);
  check("apex keeps chrono resistances", ["fire", "ice", "earth", "water", "wind", "lightning"].every((e) => a.elements.resist.includes(e)));
  check("apex still weak to holy", a.elements.weak.includes("holy"));
  check("apex immune to statuses", ["poison", "sleep", "paralysis", "stone"].every((s) => a.elements.immune.includes(s)));
  check("apex hoard guaranteed masamune", a.loot.filter((l) => l.itemId === "masamune").length >= 1 && a.loot[0].chance === 1);
  check("masamune is the realm's finest blade", ITEMS.masamune.mods.atk > ITEMS.eternalBlade.mods.atk);

  // Victory: apex grants 5 tokens and completes the gauntlet.
  const w = sys.recordWin("apex");
  check("apex grants five tokens", w.ok === true && w.tokens === 5);
  check("gauntlet complete", sys.currentTrial() === null);
  check("apex flag set", state.getFlag("trial_apex_cleared") === true);

  // Apex loot delivers masamune through the loot roller.
  const es = new EnemyTemplateSystem();
  const drops = es.lootFor(a, () => 0);
  check("masamune drops from apex", drops.includes("masamune"));

  return out;
}
