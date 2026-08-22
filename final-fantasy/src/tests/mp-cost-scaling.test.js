// Validation tests for Task #131: MP Cost Scaling Logic.

import { SpellCastingSystem } from "../engine/spellcasting.js";
import { SpellLevelingSystem } from "../engine/spell-levels.js";
import { Character } from "../engine/character.js";
import { SPELLS } from "../data/spells.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sc = new SpellCastingSystem({ random: () => 0.5 });
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });
  const es = new EnemyTemplateSystem();
  const goblin = es.createEnemy("goblin");

  check("effectiveCost defaults to spell mp", sc.effectiveCost(mage, "fire") === SPELLS.fire.mp);

  const okV = sc.validate(mage, "fire");
  check("validate ok", okV.ok === true && okV.cost === SPELLS.fire.mp && okV.shortfall === 0);

  check("unknown spell invalid", sc.validate(mage, "nope").ok === false && sc.validate(mage, "nope").error === "unknown spell");

  // Insufficient MP prevents the action entirely — no partial cast.
  mage.mp = 2;
  const poor = sc.validate(mage, "fire");
  check("validate catches insufficient MP", poor.ok === false && poor.error === "insufficient MP" && poor.shortfall === 2);
  const before = mage.mp;
  const blocked = sc.cast(mage, "fire", [mage], [goblin], goblin);
  check("cast blocked on low MP", blocked.ok === false && blocked.error === "insufficient MP");
  check("no MP deducted on failure", mage.mp === before);
  check("canCast false on low MP", sc.canCast(mage, "fire") === false);

  // Sufficient MP deducts exactly the effective cost.
  mage.mp = 10;
  const cast = sc.cast(mage, "fire", [mage], [goblin], goblin);
  check("cast ok and charges cost", cast.ok === true && cast.mpCost === SPELLS.fire.mp && mage.mp === 6);

  // Level gates are still validated before MP is touched.
  const spellLevels = new SpellLevelingSystem();
  const sc2 = new SpellCastingSystem({ random: () => 0.5, levelSystem: spellLevels });
  const lowMage = new Character({ id: "lm", name: "LowMage", classId: "blackMage" });
  lowMage.learnSpell("thunder");
  const lv = sc2.validate(lowMage, "thunder");
  check("level gate invalid at level 1", lv.ok === false && lv.error === "level too low");
  const lvCast = sc2.cast(lowMage, "thunder", [lowMage], [goblin], goblin);
  check("level gate blocks cast", lvCast.ok === false && lvCast.error === "level too low");
  check("no MP deducted on level block", lowMage.mp === lowMage.getStats().maxMp);
  lowMage.level = 4;
  check("level ok at 4", sc2.validate(lowMage, "thunder").ok === true);

  // The costScale hook is the scaling hook point.
  const sc3 = new SpellCastingSystem({ random: () => 0.5 });
  sc3.costScale = () => 2;
  check("costScale doubles cost", sc3.effectiveCost(mage, "fire") === SPELLS.fire.mp * 2);
  check("validate uses scaled cost", sc3.validate(mage, "fire").cost === SPELLS.fire.mp * 2);

  return out;
}
