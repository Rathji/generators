// Validation tests for Task #191: New Game+ data — cycle config, the cycle
// treasures, the Echo of Creation, and the Echo Gate glyph.

import { NGPLUS } from "../data/ngplus.js";
import { ITEMS } from "../data/items.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { MAPS } from "../data/maps.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("three cycles max", NGPLUS.maxCycles === 3);
  check("enemy growth 0.35", NGPLUS.enemyGrowth === 0.35);
  check("boss growth 0.5", NGPLUS.bossGrowth === 0.5);
  check("loot multipliers set", NGPLUS.xpMultiplier === 1.25 && NGPLUS.goldMultiplier === 1.25);
  check("cycle start in cornelia", NGPLUS.cycleStart.mapId === "cornelia");
  check("strip key items", NGPLUS.stripItemTypes.includes("key"));

  for (const r of NGPLUS.loyaltyRewards) {
    check("loyalty reward cycle " + r.cycle + " item exists", !!ITEMS[r.item], r.item);
  }
  check("echo reward item exists", !!ITEMS[NGPLUS.echoReward.item], NGPLUS.echoReward.item);
  check("echo boss id defined", !!ENEMIES.echoOfCreation);
  check("echo is a boss", ENEMIES.echoOfCreation?.boss === true);
  check("echo stronger than chrono", ENEMIES.echoOfCreation?.hp > ENEMIES.chrono?.hp, `echo=${ENEMIES.echoOfCreation?.hp} chrono=${ENEMIES.chrono?.hp}`);
  check("echo group exists", !!ENEMY_GROUPS[NGPLUS.echo.group]);
  check("echo unlock cycle 2", NGPLUS.echo.unlockCycle === 2);

  const hall = MAPS.find((m) => m.id === "trial_hall");
  const row8 = hall?.rows?.[8];
  check("trial_hall rows square", hall?.rows?.every((r) => r.length === hall.rows[0].length) === true);
  check("echo gate glyph at (7,8)", row8?.[7] === "E", row8?.[7]);
  check("echo gate not solid", !!hall && !hall.solid?.["E"]);
  check("echo gate in tiles spec", typeof hall?.tiles?.["E"] === "number");

  return out;
}
