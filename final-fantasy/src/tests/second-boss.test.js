// Validation tests for Task #91: Second Boss Encounter Logic (Marsh Guardian).

import { WORLD_EVENTS } from "../data/world-events.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { BossPhaseController } from "../engine/boss.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { DIALOGUE } from "../data/dialogue.js";
import { DUNGEONS } from "../data/dungeons.js";

function fakeWorld(flags = {}, items = []) {
  return {
    getFlag: (n) => !!flags[n],
    hasItem: (n) => items.includes(n),
  };
}

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // Boss event in the marsh depths.
  const ev = WORLD_EVENTS.find((e) => e.id === "marsh_guardian_boss");
  check("marsh guardian event defined", !!ev);
  check("event in marsh depths", ev?.mapId === "marsh_cave_b2");
  check("event uses marsh_guardian group", ev?.event.group === "marsh_guardian");
  check("event requires garland defeated", ev?.require.flag === "story_garland_defeated");
  check("event has intro", typeof ev?.event.intro === "string");
  check("event sets flag on win", ev?.event.onWinFlag === "story_marsh_guardian_defeated");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);

  // The boss template.
  const boss = ENEMIES.marshGuardian;
  check("marsh guardian template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("is tougher than garland", boss.hp > ENEMIES.garland.hp);
  check("marsh_guardian group exists", Array.isArray(ENEMY_GROUPS.marsh_guardian));

  // Phase transitions fire.
  const ph = new BossPhaseController({ random: () => 0 });
  const e = { ...boss, hp: boss.hp, maxHp: boss.hp };
  ph.reset(e);
  e.hp = Math.floor(e.maxHp * 0.5);
  const t1 = ph.checkPhase(e);
  check("phase 1 triggers at 50%", t1 !== null && t1.transitions.length >= 1);
  e.hp = Math.floor(e.maxHp * 0.2);
  const t2 = ph.checkPhase(e);
  check("phase 2 triggers at 20%", t2 !== null && t2.transitions.length >= 1);

  // World event flow.
  const flags = {};
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });
  check("boss gated until garland defeated", sys.pending("marsh_cave_b2", 3, 5, "step") === null);
  flags.story_garland_defeated = true;
  const pending = sys.pending("marsh_cave_b2", 3, 5, "step");
  check("boss pending after garland defeated", pending?.id === "marsh_guardian_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "marsh_guardian");
  check("done flag set", flags.story_marsh_guardian_defeated === true);
  check("one-shot", sys.pending("marsh_cave_b2", 3, 5, "step") === null);

  // The dungeon containing the boss exists (marsh_cave).
  check("marsh dungeon defined", !!DUNGEONS.marsh_cave);

  // Marsh guardian drops an accessory (crystal charm).
  const lootIds = (boss.loot ?? []).map((l) => l.itemId);
  check("boss drops accessory loot", lootIds.includes("crystalCharm"));

  return out;
}
