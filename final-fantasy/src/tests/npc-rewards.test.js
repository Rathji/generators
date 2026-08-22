// Validation tests for Task #107: one-time NPC rewards.

import { NpcRewardSystem } from "../engine/npc-rewards.js";
import { NPC_REWARDS } from "../data/npc-rewards.js";
import { ITEMS } from "../data/items.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  for (const r of Object.values(NPC_REWARDS)) {
    check("reward " + r.id + " item exists", !r.item || !!ITEMS[r.item]);
    check("reward " + r.id + " has npc + name", typeof r.npc === "string" && typeof r.name === "string");
  }

  const state = new GameState();
  const party = {
    gold: 0,
    xp: 0,
    addGold(n) { this.gold += n; },
    grantXp(n) { this.xp += n; },
  };
  let added = true;
  const inventory = {
    add(item, count) { if (!added) return false; return true; },
  };
  let onFailedCalls = 0;
  const rewards = new NpcRewardSystem(NPC_REWARDS, {
    state,
    party,
    inventory,
    handlers: { onFailed: () => { onFailedCalls++; } },
  });

  const def = rewards.def("herbalists_gift");
  check("def lookup works", def?.name === "The Herbalist's Gift");
  check("unknown def null", rewards.def("nope") === null);
  check("canGrant true initially", rewards.canGrant("herbalists_gift") === true);

  const res = rewards.grant("herbalists_gift");
  check("grant ok", res.ok === true);
  check("gold granted once", party.gold === 20);
  check("xp granted once", party.xp === 10);
  check("item reported", res.item?.itemId === "potion" && res.item?.count === 3);
  check("flag set", state.getFlag("npc_reward_herbalists_gift_granted") === true);
  check("canGrant now false", rewards.canGrant("herbalists_gift") === false);

  const second = rewards.grant("herbalists_gift");
  check("second grant rejected", second.ok === false && second.error === "already granted");
  check("no double gold", party.gold === 20);

  check("describe non-empty", rewards.describe("herbalists_gift").length > 0);
  check("describe unknown empty", rewards.describe("nope") === "");
  check("describe includes item", rewards.describe("herbalists_gift").includes("potion"));

  const status = rewards.status();
  check("status lists all rewards", status.length === Object.keys(NPC_REWARDS).length);
  check("status marks granted", status.find((s) => s.id === "herbalists_gift")?.granted === true);

  added = false;
  const overflow = rewards.grant("smiths_tempering");
  check("overflow still reports ok (flag set)", overflow.ok === true);
  check("overflow item not granted", overflow.item === null);
  check("onFailed handler called", onFailedCalls === 1);

  const unknown = new NpcRewardSystem(NPC_REWARDS, { state, party });
  check("no inventory: grant skips item safely", unknown.grant("captains_cheer").ok === true);

  const stale = new NpcRewardSystem(NPC_REWARDS, {});
  check("no state: isGranted false", stale.isGranted("captains_cheer") === false);
  check("no state: grant still ok (flag skipped)", stale.grant("captains_cheer").ok === true);

  return out;
}
