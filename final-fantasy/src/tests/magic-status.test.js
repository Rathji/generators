// Validation tests for Task #133: Magic-Based Status Infliction.

import { MagicStatusInflictionSystem } from "../engine/magic-status.js";
import { StatusEffectSystem } from "../engine/status.js";
import { SpellCastingSystem } from "../engine/spellcasting.js";
import { Character } from "../engine/character.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { SPELLS } from "../data/spells.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ms = new MagicStatusInflictionSystem();

  const sleep = ms.statusOf("sleep");
  check("sleep -> sleep, 2 turns, 85%", sleep?.status === "sleep" && sleep.turns === 2 && sleep.chance === 0.85);
  check("poison -> 4 turns", ms.statusOf("poison")?.turns === 4);
  check("hold -> paralysis 2 turns", ms.statusOf("hold")?.turns === 2 && ms.statusOf("hold").status === "paralysis");
  check("water soak -> 2 turns", ms.statusOf("water")?.turns === 2);
  check("fire has no status", ms.statusOf("fire") === null);
  check("describe summary", ms.describe("sleep")?.summary.includes("2 turn") === true);

  // Every status spell is fully specified (id, chance, turns).
  const audit = ms.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);
  const statusKinds = Object.entries(SPELLS).filter(([, s]) => s.kind === "status");
  check("all status spells audited", statusKinds.length === 3 && statusKinds.every(([id]) => SPELLS[id].inflict?.turns > 0));

  // Direct application through a StatusEffectSystem.
  const status = new StatusEffectSystem({ random: () => 0 });
  const goblin = { id: "g", name: "Goblin", hp: 20, maxHp: 20, agi: 4, str: 3, def: 1 };
  const r = ms.apply("sleep", goblin, { status });
  check("sleep applied", r.ok === true && status.has(goblin, "sleep"));
  check("sleep lasts 2 turns", status.turnsLeft(goblin, "sleep") === 2);

  // Spellcasting integration: Black Mage lvl 3 casts Sleep on a goblin.
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage", level: 3 });
  const sc = new SpellCastingSystem({ random: () => 0, statusSystem: status, magicStatus: ms });
  const victim = new EnemyTemplateSystem().createEnemy("goblin");
  const cast = sc.cast(mage, "sleep", [mage], [victim], victim);
  check("sleep spell inflicts sleep", cast.ok === true && cast.results[0].inflicted === "sleep");
  check("victim asleep 2 turns", status.turnsLeft(victim, "sleep") === 2);
  check("victim is blocked while asleep", status.blocked(victim) === "sleep");

  // Poison spell: 4 turns. (A sturdier target survives the spell's impact so
  // the status can land — weak targets die to the blow instead.)
  const mage5 = new Character({ id: "m5", name: "Mage5", classId: "blackMage", level: 5 });
  const victim2 = new EnemyTemplateSystem().createEnemy("goblin");
  victim2.maxHp = victim2.hp = 500;
  const poisonCast = sc.cast(mage5, "poison", [mage5], [victim2], victim2);
  check("poison spell inflicts poison", poisonCast.ok === true && poisonCast.results[0].inflicted === "poison");
  check("poison lasts 4 turns", status.turnsLeft(victim2, "poison") === 4);

  // Status ticking: sleep wears off after its 2 turns.
  status.tick(victim);
  status.tick(victim);
  check("sleep wears off after 2 turns", !status.has(victim, "sleep"));

  return out;
}
