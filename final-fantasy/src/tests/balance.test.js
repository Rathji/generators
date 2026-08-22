// Validation tests for Task #122: combat math balancing pass.

import { BalanceSystem } from "../engine/balance.js";
import { BALANCE } from "../data/balance.js";
import { CombatResolver } from "../engine/combat.js";
import { EncounterGenerator } from "../engine/encounters.js";
import { CombatRewardResolver } from "../engine/rewards.js";

const ATK = { id: "g", name: "Golem", hp: 100, maxHp: 100, str: 10, atk: 8, int: 2, agi: 4, def: 5, mdef: 2, elements: {} };
const TGT = { id: "w", name: "Wolf", hp: 60, maxHp: 60, str: 6, atk: 4, int: 1, agi: 8, def: 3, mdef: 1, elements: {} };

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const b = new BalanceSystem();
  check("identity damage multiplier", b.damageMultiplier === 1);
  check("identity scaleDamage", b.scaleDamage(50) === 50);
  check("identity encounter rate", b.encounterRate(0.1) === 0.1);
  check("identity gold/xp", b.gold(10) === 10 && b.xp(10) === 10);
  check("audit ok default", b.audit().ok === true);

  const half = new BalanceSystem({ damageMultiplier: 2, encounterRateMultiplier: 0.5, goldMultiplier: 1.5, xpMultiplier: 0 });
  check("damage scaled 2x", half.scaleDamage(50) === 100);
  check("encounter rate halved", half.encounterRate(0.1) === 0.05);
  check("gold scaled 1.5x", half.gold(10) === 15);
  check("xp scaled 0x", half.xp(10) === 0);
  check("report reflects config", half.report().damageMultiplier === 2);

  const bad = new BalanceSystem({ damageMultiplier: -1 });
  check("audit flags negative modifier", bad.audit().ok === false);

  // CombatResolver integration.
  const base = new CombatResolver({ random: () => 0.5, crits: false });
  base.begin([ATK], [TGT]);
  const d1 = base.attack(ATK, TGT);
  const buffed = new CombatResolver({ random: () => 0.5, crits: false, balance: half });
  buffed.begin([{ ...ATK }], [{ ...TGT }]);
  const d2 = buffed.attack(buffed.party[0], buffed.enemies[0]);
  check("balance boosts attack damage", d2.damage > d1.damage);
  check("balanced damage is ~2x", Math.abs(d2.damage - d1.damage * 2) <= 2);

  // EncounterGenerator integration.
  const tables = { test_map: { rate: 0.9, minGap: 0, table: [{ group: "goblins", weight: 1 }] } };
  const enc = new EncounterGenerator({ tables, enemySystem: null, random: () => 0.4 });
  const never = new EncounterGenerator({ tables, balance: new BalanceSystem({ encounterRateMultiplier: 0 }), enemySystem: null, random: () => 0.1 });
  check("default encounters on low roll", (() => { enc.totalSteps = 0; enc.sinceLast = 5; return enc.onStep("test_map", 1) !== null; })());
  check("zero multiplier never encounters", (() => { never.totalSteps = 0; never.sinceLast = 5; return never.onStep("test_map", 1) === null; })());

  // Reward integration.
  const rewarder = new CombatRewardResolver({ balance: half });
  const totals = rewarder.totals([{ id: "goblin", xp: 12, gold: 18 }]);
  check("reward gold scaled", totals.gold === 27 && totals.xp === 0);

  check("default balance constants sane", BALANCE.damageMultiplier >= 0 && BALANCE.encounterRateMultiplier >= 0);

  return out;
}
