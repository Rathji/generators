// Validation tests for Task #7: Class-Based Ability System.

import { CLASSES, CLASS_IDS, getSpellsForLevel } from "../data/classes.js";

const REQUIRED = [
  "id", "name", "baseHp", "baseMp", "baseStr", "baseInt", "baseAgi", "baseDef", "baseMdef",
  "hpPerLevel", "mpPerLevel", "strPerLevel", "intPerLevel", "agiPerLevel", "defPerLevel", "mdefPerLevel",
  "spells",
];

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("six classes defined", CLASS_IDS.length === 6);
  check("all canonical classes present", ["warrior", "thief", "monk", "redMage", "whiteMage", "blackMage"].every((k) => CLASSES[k]));

  for (const cid of CLASS_IDS) {
    const cls = CLASSES[cid];
    check(cid + " has all required fields", REQUIRED.every((k) => Object.prototype.hasOwnProperty.call(cls, k)));
    check(cid + " growth non-negative", cls.hpPerLevel >= 0 && cls.defPerLevel >= 0 && cls.mpPerLevel >= 0);
    const sorted = cls.spells.every((s, i) => i === 0 || cls.spells[i - 1].lvl <= s.lvl);
    check(cid + " spell table sorted", sorted);
  }

  check("warrior is pure melee", CLASSES.warrior.spells.length === 0 && CLASSES.warrior.mpPerLevel === 0);
  check("thief fastest agi growth", CLASSES.thief.agiPerLevel >= CLASSES.warrior.agiPerLevel);
  check("monk is the toughest", CLASSES.monk.hpPerLevel >= 9 && CLASSES.monk.strPerLevel >= 4);
  check("all mages have mp growth", CLASSES.whiteMage.mpPerLevel > 0 && CLASSES.blackMage.mpPerLevel > 0 && CLASSES.redMage.mpPerLevel > 0);
  check("black mage best int growth", CLASSES.blackMage.intPerLevel >= CLASSES.redMage.intPerLevel);

  check("white mage knows cure at 1", getSpellsForLevel(CLASSES.whiteMage, 1).includes("cure"));
  check("white mage learns cura by 4", getSpellsForLevel(CLASSES.whiteMage, 4).includes("cura"));
  check("white mage has curaga by 7", getSpellsForLevel(CLASSES.whiteMage, 7).includes("curaga"));
  check("black mage fire at 1", getSpellsForLevel(CLASSES.blackMage, 1).includes("fire"));
  check("black mage nuke by 8", getSpellsForLevel(CLASSES.blackMage, 8).includes("nuke"));
  check("red mage dual school", getSpellsForLevel(CLASSES.redMage, 1).includes("fire") && getSpellsForLevel(CLASSES.redMage, 1).includes("cure"));
  check("spells not known before level", getSpellsForLevel(CLASSES.blackMage, 1).includes("fira") === false);

  const names = new Set(CLASS_IDS.map((c) => CLASSES[c].name));
  check("class names unique", names.size === 6);

  return out;
}
