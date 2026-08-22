// Validation tests for Task #109: the hint system.

import { HintSystem } from "../engine/hints.js";
import { HINTS } from "../data/hints.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("HINTS keyed for every main-story milestone id", !!HINTS.meet_the_king && !!HINTS.restore_the_crystals);
  check("hint data has objective + text", HINTS.meet_the_king.objective.length > 0 && HINTS.meet_the_king.text.length > 0);

  const director = {
    currentMilestone: null,
    nextMilestone: () => ({ id: "meet_the_king", name: "Meet the King of Cornelia" }),
    milestoneState: () => ({ done: false }),
  };
  const hints = new HintSystem({ director });
  const o = hints.objective();
  check("objective from milestone", o.id === "meet_the_king" && o.name === "Meet the King of Cornelia");
  check("hint text pulled from HINTS", o.hint === HINTS.meet_the_king.text);
  check("hintText returns directed hint", hints.hintText() === HINTS.meet_the_king.text);

  const done = {
    currentMilestone: null,
    nextMilestone: () => ({ id: "meet_the_king", name: "Meet the King of Cornelia" }),
    milestoneState: () => ({ done: true }),
  };
  const h2 = new HintSystem({ director: done });
  check("done milestone skipped", h2.objective().id === null);
  check("no plot fallback -> generic text", h2.hintText().length > 0);

  const plot = { nextChapter: () => ({ id: "arrival", name: "Arrival at Cornelia" }) };
  const h3 = new HintSystem({ director: done, plot });
  const o3 = h3.objective();
  check("plot chapter fallback objective", o3.id === "arrival" && o3.name === "Arrival at Cornelia");
  check("plot fallback hint null (no ch_ key)", o3.hint === null);

  const help = hints.helpFor("cornelia_elder", "Village Elder");
  check("helpFor prefixes speaker", help.text.startsWith("Village Elder: "));
  check("helpFor carries objective", help.objective === "Meet the King of Cornelia");
  check("helpFor carries npc id", help.npcId === "cornelia_elder");

  const d = hints.describe();
  check("describe reports objective + hint", d.objective === "Meet the King of Cornelia" && d.hint === HINTS.meet_the_king.text && d.fallback === false);

  const noObj = new HintSystem({});
  check("empty system objective null", noObj.objective().id === null);
  check("empty system hintText generic", noObj.hintText().length > 0);

  return out;
}
