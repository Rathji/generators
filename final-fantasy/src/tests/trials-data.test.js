// Validation tests for Task #163: Trial of the Keeper — data definitions.

import { TRIALS, TRIAL_REWARDS } from "../data/trials.js";
import { ENEMIES } from "../data/enemies.js";
import { ITEMS } from "../data/items.js";
import { WORLD_EVENTS } from "../data/world-events.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("trial list populated", TRIALS.length === 13);
  const ids = TRIALS.map((t) => t.id);
  check("ids unique", new Set(ids).size === TRIALS.length);
  check("orders unique & 1..13", ids.length === 13 && TRIALS.map((t) => t.order).every((o, i) => o === i + 1));

  // Every trial targets a real boss and gates on a real story flag.
  const storyFlags = WORLD_EVENTS.map((e) => e.doneFlag).filter(Boolean);
  for (const t of TRIALS) {
    check("trial " + t.id + " boss exists", !!ENEMIES[t.bossId]);
    check("trial " + t.id + " boss is a boss", ENEMIES[t.bossId]?.boss === true);
    if (!t.apex) {
      check("trial " + t.id + " unlock flag real", storyFlags.includes(t.unlockFlag));
    }
  }
  check("base trials have unlock flags", TRIALS.filter((t) => !t.apex).every((t) => !!t.unlockFlag));
  check("apex has no story unlock flag", TRIALS.find((t) => t.apex)?.unlockFlag === undefined);

  // Difficulty ramps up through the gauntlet.
  const scaled = TRIALS.map((t) => t.scale);
  check("scales non-decreasing", scaled.every((s, i) => i === 0 || s >= scaled[i - 1]));
  check("apex strongest", TRIALS.find((t) => t.apex)?.scale >= TRIALS.find((t) => t.id === "chrono")?.scale);

  // Token rewards.
  const chrono = TRIALS.find((t) => t.id === "chrono");
  const apex = TRIALS.find((t) => t.apex);
  check("chrono grants two tokens", chrono.tokens === 2);
  check("apex grants five tokens", apex.tokens === 5);
  check("base trials grant tokens", TRIALS.filter((t) => !t.apex).every((t) => (t.tokens ?? 0) >= 1));
  const totalBaseTokens = TRIALS.filter((t) => !t.apex).reduce((a, t) => a + t.tokens, 0);
  check("twelve base trials + chrono = 13 tokens", totalBaseTokens === 13);

  // Every trial has intro + victory lines.
  check("intros present", TRIALS.every((t) => typeof t.intro === "string" && t.intro.length > 0));
  check("victory lines present", TRIALS.every((t) => typeof t.victoryLine === "string"));

  // The Apex is a super-scaled Chrono with its own hoard.
  check("apex reuses chrono template", apex.bossId === "chrono");
  check("apex has unique name", typeof apex.bossName === "string");
  check("apex hoard has masamune", (apex.loot ?? []).some((l) => l.itemId === "masamune" && l.chance === 1));
  check("masamune item exists", !!ITEMS.masamune);

  // Reward vault: unique, affordable, real items.
  const rids = TRIAL_REWARDS.map((r) => r.id);
  check("rewards unique", new Set(rids).size === TRIAL_REWARDS.length);
  check("rewards cost tokens", TRIAL_REWARDS.every((r) => r.cost >= 1));
  for (const r of TRIAL_REWARDS) {
    check("reward item exists: " + r.id, !!ITEMS[r.item]);
    check("reward count positive: " + r.id, (r.count ?? 1) >= 1);
  }

  return out;
}
