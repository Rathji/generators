// Validation tests for Task #63: Combat Combo/Synergy Logic.

import { SynergySystem, SYNERGY_DEFS } from "../engine/synergy.js";
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

  check("synergy rule defined", SYNERGY_DEFS.some((r) => r.status === "soaked" && r.element === "lightning" && r.multiplier === 1.5));
  check("water inflicts soaked", SPELLS.water.inflict?.status === "soaked");

  const status = new StatusEffectSystem({ random: () => 0 });
  const syn = new SynergySystem({ status });

  const wet = { id: "w", name: "Wet", hp: 100, maxHp: 100, statuses: [] };
  status.apply(wet, "soaked");
  check("soaked boosts lightning", syn.boostFor(wet, "lightning") === 1.5);
  check("no boost without status", syn.boostFor({ id: "d", name: "Dry", hp: 50, maxHp: 50, statuses: [] }, "lightning") === 1);
  check("fire unaffected", syn.boostFor(wet, "fire") === 1);
  check("rules lookup", syn.rulesForElement("lightning").length === 1 && syn.rulesForStatus("soaked").length === 1);
  check("hint", syn.hint("lightning") && syn.hint("fire") === null);

  // --- Integration: cast water, then thunder hits harder ---
  const es = new EnemyTemplateSystem();
  const sc = new SpellCastingSystem({ random: () => 0.5, statusSystem: status, synergy: syn });

  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage", level: 4 });
  mage.mp = 60;
  mage.learnSpell("water");
  mage.learnSpell("thunder");

  const soggy = es.createEnemy("garland"); // tanky, no lightning affinity
  const fresh = es.createEnemy("garland");

  const waterRes = sc.cast(mage, "water", [mage], [soggy], soggy);
  check("water cast ok", waterRes.ok === true);
  check("water soaks target", status.has(soggy, "soaked") && waterRes.results[0].inflicted === "soaked");

  const thunderWet = sc.cast(mage, "thunder", [mage], [soggy], soggy);
  const thunderDry = sc.cast(mage, "thunder", [mage], [fresh], fresh);
  check("thunder reports synergy", thunderWet.results[0].synergy === 1.5);
  check("dry thunder no synergy", thunderDry.results[0].synergy === 1);
  check("wet target takes more", thunderWet.results[0].damage > thunderDry.results[0].damage);

  // Without a status system the synergy layer is inert.
  const bare = new SpellCastingSystem({ random: () => 0.5 });
  const mage2 = new Character({ id: "m2", name: "Mage2", classId: "blackMage", level: 4 });
  mage2.mp = 60;
  mage2.learnSpell("water");
  mage2.learnSpell("thunder");
  const plain = es.createEnemy("zombie");
  check("bare cast still works", bare.cast(mage2, "water", [mage2], [plain], plain).ok === true);

  return out;
}
