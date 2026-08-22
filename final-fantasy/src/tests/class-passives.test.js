// Validation tests for Task #132: Class-Specific Passive Ability System.

import { ClassPassiveSystem } from "../engine/class-passives.js";
import { CLASS_IDS, CLASSES } from "../data/classes.js";
import { getBaseStats } from "../engine/stats.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new ClassPassiveSystem();

  check("every class has a passive", CLASS_IDS.every((id) => sys.hasPassive(id)));

  const w = sys.passive("warrior");
  check("warrior Fortitude +20% HP", w?.name === "Fortitude" && w.statMods.maxHp === 1.2);
  check("thief Treasure Hunter item-find", sys.passive("thief")?.itemFind === 0.15);
  check("blackMage arcane MP", sys.passive("blackMage")?.statMods.maxMp === 1.15);
  check("monk iron body STR", sys.passive("monk")?.statMods.str === 1.1);

  // adjustStats applies percentage multipliers to effective stats.
  const adj = sys.adjustStats({ classId: "warrior" }, { maxHp: 40, str: 12 });
  check("warrior HP multiplied", adj.maxHp === 48 && adj.str === 12);
  const adjB = sys.adjustStats({ classId: "blackMage" }, { maxHp: 24, maxMp: 16 });
  check("blackMage MP multiplied", adjB.maxMp === 18 && adjB.maxHp === 24);
  const adjT = sys.adjustStats({ classId: "thief" }, { maxHp: 32, str: 8 });
  check("thief unchanged (no stat mods)", adjT.str === 8 && adjT.maxHp === 32);
  const adjNone = sys.adjustStats({ classId: "unknown" }, { maxHp: 10 });
  check("unknown class unchanged", adjNone.maxHp === 10);

  // Party-wide item-find sum (two thieves = 0.30).
  const party = { members: [{ classId: "thief" }, { classId: "warrior" }, { classId: "thief" }] };
  check("itemFindForParty sums", Math.abs(sys.itemFindForParty(party) - 0.3) < 1e-9);
  check("single thief item find", sys.itemFind("thief") === 0.15);

  check("describe", sys.describe("warrior")?.className === "Warrior" && sys.describe("warrior").name === "Fortitude");

  // Against the real class base stats: warrior 40 HP -> 48 with the passive.
  const base = getBaseStats(CLASSES.warrior, 1);
  check("warrior base hp is 40", base.maxHp === 40);
  check("passive applied to base stats", sys.adjustStats({ classId: "warrior" }, base).maxHp === 48);

  const audit = sys.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);

  const bad = new ClassPassiveSystem({ classes: CLASSES, passives: { unknown: { name: "x", statMods: { bogus: 2 } } } });
  const ba = bad.audit();
  check("audit flags unknown class + stat", ba.ok === false && ba.errors.length === 2);

  return out;
}
