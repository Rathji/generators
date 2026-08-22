// Validation tests for Task #28: Spell Learning/Acquisition System.

import { SpellLearningSystem } from "../engine/spell-learning.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });
  const war = new Character({ id: "w", name: "Warrior", classId: "warrior" });

  check("mage does not know fira at lvl1", mage.knowsSpell("fira") === false);
  check("learnSpell adds spell", mage.learnSpell("fira") === true && mage.knowsSpell("fira") === true);
  check("getSpells includes extra", mage.getSpells().includes("fira"));
  check("duplicate learn rejected", mage.learnSpell("fira") === false);
  check("unknown spell rejected", mage.learnSpell("bogus") === false);
  check("forgetSpell removes", mage.forgetSpell("fira") === true && mage.knowsSpell("fira") === false);
  check("forget unlearned false", mage.forgetSpell("fira") === false);

  const sls = new SpellLearningSystem();
  sls.registerTeacher("sagely_woman", {
    spellId: "cura",
    requiredItem: "goblinFang",
    requiredFlag: "met_sage",
    successDialogue: "The sage teaches you Cura!",
    blockedDialogue: "The sage needs a Goblin Fang.",
    knownDialogue: "You already know this spell.",
  });

  const state = new GameState();
  const inv = new Inventory();
  const visitBlocked = sls.visitTeacher("sagely_woman", mage, { inventory: inv, state });
  check("teacher blocked without item", visitBlocked.ok === false && visitBlocked.error === "item required");

  inv.add("goblinFang", 1);
  const visitFlagBlocked = sls.visitTeacher("sagely_woman", mage, { inventory: inv, state });
  check("teacher blocked without flag", visitFlagBlocked.ok === false && visitFlagBlocked.error === "flag required");

  state.setFlag("met_sage");
  const taught = sls.visitTeacher("sagely_woman", mage, { inventory: inv, state });
  check("teacher teaches spell", taught.ok === true && taught.learned === "cura" && mage.knowsSpell("cura"));
  check("success dialogue attached", taught.dialogue === "The sage teaches you Cura!");

  const again = sls.visitTeacher("sagely_woman", mage, { inventory: inv, state });
  check("already known returns known dialogue", again.ok === false && again.error === "already known");

  check("unknown teacher", sls.visitTeacher("nobody", mage, { inventory: inv, state }).error === "not a teacher");
  check("canLearn false when known", sls.canLearn(mage, "cura") === false);
  check("canLearn true for new spell", sls.canLearn(war, "cure") === true);

  const scroll = new Inventory();
  scroll.add("fireScroll", 1);
  const useRes = scroll.use("fireScroll", war);
  check("scroll teaches spell", useRes.ok === true && useRes.learned === "fira" && war.knowsSpell("fira"));
  check("scroll consumed", scroll.count("fireScroll") === 0);

  const scroll2 = new Inventory();
  scroll2.add("fireScroll", 1);
  const dup = scroll2.use("fireScroll", war);
  check("already knows blocks scroll", dup.ok === false && dup.error === "already knows spell" && scroll2.count("fireScroll") === 1);

  const aero = new Inventory();
  aero.add("aeroScroll", 1);
  const aeroRes = aero.use("aeroScroll", war);
  check("second scroll teaches aero", aeroRes.ok === true && war.knowsSpell("aero"));

  const mage6 = new Character({ id: "m6", name: "Mage6", classId: "blackMage", level: 6 });
  check("class spell auto-learned by level", mage6.knowsSpell("fira") && mage6.knowsSpell("fire") && mage6.knowsSpell("blizzard"));

  return out;
}
