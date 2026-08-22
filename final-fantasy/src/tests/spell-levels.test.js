// Validation tests for Task #66: Spell Leveling Requirements.

import { SpellLevelingSystem } from "../engine/spell-levels.js";
import { SpellCastingSystem } from "../engine/spellcasting.js";
import { Character } from "../engine/character.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const lv = new SpellLevelingSystem();
  const mage1 = new Character({ id: "m1", name: "Mage1", classId: "blackMage", level: 1 });
  const mage6 = new Character({ id: "m6", name: "Mage6", classId: "blackMage", level: 6 });
  const healer = new Character({ id: "h", name: "Healer", classId: "whiteMage", level: 1 });

  check("fira requires level 6", lv.requiredLevel(mage1, "fira") === 6);
  check("fire level 1", lv.requiredLevel(mage1, "fire") === 1);
  check("esuna gated for white mage", lv.requiredLevel(healer, "esuna") === 5);
  check("scroll spell ungated", lv.requiredLevel(mage1, "firaga") === 1);
  check("unknown spell infinity", lv.requiredLevel(mage1, "bogus") === Infinity);

  check("canUse gated", lv.canUse(mage1, "fira") === false && lv.canUse(mage6, "fira") === true);
  check("isGated", lv.isGated(mage1, "fira") === true && lv.isGated(mage1, "fire") === false);

  // A spell learned early (scroll) is locked until the level threshold.
  mage1.learnSpell("fira");
  check("scroll-learned spell known", mage1.knowsSpell("fira"));
  check("locked by level", lv.lockedByLevel(mage1, "fira") === true);
  check("lockedSpells lists it", lv.lockedSpells(mage1).includes("fira"));
  check("unlocked at level 6", lv.lockedByLevel(mage6, "fira") === false);

  const d = lv.describe(mage1, "fira");
  check("describe", d.requiredLevel === 6 && d.canUse === false && d.name === "Fira");

  // --- SpellCastingSystem gates casts by level ---
  const es = new EnemyTemplateSystem();
  const sc = new SpellCastingSystem({ random: () => 0.5, levelSystem: lv });
  const goblin = es.createEnemy("goblin");
  mage1.mp = 40;
  const blocked = sc.cast(mage1, "fira", [mage1], [goblin], goblin);
  check("cast blocked by level", blocked.ok === false && blocked.error === "level too low" && blocked.requiredLevel === 6);
  check("canCast also gated", sc.canCast(mage1, "fira") === false);

  mage6.mp = 40;
  const ok = sc.cast(mage6, "fira", [mage6], [goblin], goblin);
  check("cast works at level", ok.ok === true && ok.results[0].damage > 0);

  return out;
}
