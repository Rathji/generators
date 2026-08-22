// Validation tests for Task #5: Stat & Experience Calculator.

import { Character } from "../engine/character.js";
import { CLASSES } from "../data/classes.js";
import { ITEMS } from "../data/items.js";
import {
  xpToReach,
  levelForXp,
  getBaseStats,
  getEffectiveStats,
  canLevelUp,
  applyLevelUp,
  levelUpAll,
} from "../engine/stats.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("xpToReach(1) = 0", xpToReach(1) === 0);
  check("xpToReach(2) = 100", xpToReach(2) === 100);
  check("xpToReach(5) = 1000", xpToReach(5) === 1000);
  check("xpToReach monotonic", xpToReach(6) === 1500 && xpToReach(99) > xpToReach(50));
  check("levelForXp(0) = 1", levelForXp(0) === 1);
  check("levelForXp(100) = 2", levelForXp(100) === 2);
  check("levelForXp(150) = 2", levelForXp(150) === 2);
  check("levelForXp(300) = 3", levelForXp(300) === 3);

  const warrior = CLASSES.warrior;
  const base1 = getBaseStats(warrior, 1);
  const base5 = getBaseStats(warrior, 5);
  check("warrior L1 matches base", base1.maxHp === warrior.baseHp && base1.str === warrior.baseStr);
  check("warrior L5 growth", base5.maxHp === warrior.baseHp + warrior.hpPerLevel * 4);
  check("warrior has no MP", base5.maxMp === 0);
  check("getBaseStats clamps level", getBaseStats(warrior, 0).maxHp === warrior.baseHp);

  const char = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  check("character starts at level 1", char.level === 1);
  char.xp = 1200;
  check("canLevelUp detects earned level", canLevelUp(char, char.class) === true);
  const ups = levelUpAll(char, char.class);
  const wEffMax = (lvl) => new Character({ id: "e" + lvl, name: "E", classId: "warrior", level: lvl }).getStats().maxHp;
  check("levels raised to xp threshold", char.level === levelForXp(1200));
  check("levelUps applied for every level", ups.length === char.level - 1);
  check("hp raised to new max", char.hp === char.getStats().maxHp);
  check("level-up reports per-level gains", ups[0].gained.hp === wEffMax(2) - wEffMax(1));
  check("no more level-ups after cap", levelUpAll(char, char.class).length === 0);

  const hero = new Character({ id: "h", name: "Hero", classId: "warrior" });
  const noGear = getEffectiveStats(hero, hero.class, ITEMS);
  hero.equipment.weapon = "ironSword";
  hero.equipment.armor = "chain";
  const geared = getEffectiveStats(hero, hero.class, ITEMS);
  check("weapon adds atk", geared.atk === noGear.atk + 8);
  // The Iron Set (ironSword + chain) bonus +1 DEF is composed in by the page
  // wiring, so the exact value includes it.
  check("armor adds def", geared.def === noGear.def + 7 + 1);
  check("gear does not change base str", geared.str === noGear.str);

  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });
  const hpBefore = mage.hp;
  const mpBefore = mage.mp;
  const bmEffMax = (lvl) => new Character({ id: "e" + lvl, name: "E", classId: "blackMage", level: lvl }).getStats().maxHp;
  const bmEffMp = (lvl) => new Character({ id: "em" + lvl, name: "EM", classId: "blackMage", level: lvl }).getStats().maxMp;
  const r = applyLevelUp(mage, mage.class);
  check("single applyLevelUp", mage.level === 2 && r.level === 2);
  check("hp delta applied", mage.hp === hpBefore + (bmEffMax(2) - bmEffMax(1)));
  check("mp delta applied", mage.mp === mpBefore + (bmEffMp(2) - bmEffMp(1)));

  const dead = new Character({ id: "d", name: "D", classId: "warrior" });
  dead.damage(9999);
  applyLevelUp(dead, dead.class);
  check("level up adds hp delta to low hp", dead.hp === wEffMax(2) - wEffMax(1) && dead.hp < dead.getStats().maxHp);

  return out;
}
