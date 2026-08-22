// Validation tests for Task #117: global monster XP/gold value table.

import { MonsterRewardTable } from "../engine/monster-rewards.js";
import { MONSTER_REWARDS, REWARD_TOTALS } from "../data/monster-rewards.js";
import { ENEMIES } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const table = new MonsterRewardTable();

  check("table covers every enemy", table.monsters() === Object.keys(ENEMIES).length);
  check("all enemy ids present", Object.keys(ENEMIES).every((id) => table.entry(id)));

  const goblin = table.entry("goblin");
  check("goblin rewards correct", goblin.xp === 12 && goblin.gold === 18);
  check("entry unknown null", table.entry("nope") === null);
  check("describe mentions xp+gold", table.describe("goblin").includes("12 XP") && table.describe("goblin").includes("18 gold"));
  check("describe unknown null", table.describe("nope") === null);

  const totals = table.totals();
  check("totals match data export", totals.xp === REWARD_TOTALS.xp && totals.gold === REWARD_TOTALS.gold);
  check("totals positive", totals.xp > 0 && totals.gold > 0);

  const s = table.summary();
  check("summary has regular + bosses", s.regular > 0 && s.bosses > 0);
  check("bosses out-value regular monsters", s.avgBossXp > s.avgXp && s.avgBossGold > s.avgGold);

  const garland = table.entry("garland");
  check("garland flagged boss", garland.boss === true);

  check("all rewards sorted by xp", MONSTER_REWARDS.every((r, i) => i === 0 || r.xp >= MONSTER_REWARDS[i - 1].xp));

  const audit = table.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);

  return out;
}
