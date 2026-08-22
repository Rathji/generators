// Validation tests for Task #96: Third Boss Encounter Logic (Forge Golem).

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

  // Boss event in the forge depths.
  const ev = WORLD_EVENTS.find((e) => e.id === "forge_golem_boss");
  check("forge golem event defined", !!ev);
  check("event in forge depths", ev?.mapId === "mount_gulg_b2");
  check("event uses gulg_guardian group", ev?.event.group === "gulg_guardian");
  check("event requires marsh guardian defeated", ev?.require.flag === "story_marsh_guardian_defeated");
  check("event has intro", typeof ev?.event.intro === "string");
  check("event sets flag on win", ev?.event.onWinFlag === "story_gulg_guardian_defeated");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);

  // The boss template.
  const boss = ENEMIES.forgeGolem;
  check("forge golem template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("is tougher than marsh guardian", boss.hp > ENEMIES.marshGuardian.hp);
  check("gulg_guardian group exists", Array.isArray(ENEMY_GROUPS.gulg_guardian));
  check("gulg_guardian group uses the boss", ENEMY_GROUPS.gulg_guardian[0]?.id === "forgeGolem");

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
  check("boss gated until marsh guardian defeated", sys.pending("mount_gulg_b2", 3, 5, "step") === null);
  flags.story_marsh_guardian_defeated = true;
  const pending = sys.pending("mount_gulg_b2", 3, 5, "step");
  check("boss pending after marsh guardian defeated", pending?.id === "forge_golem_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "gulg_guardian");
  check("done flag set", flags.story_gulg_guardian_defeated === true);
  check("one-shot", sys.pending("mount_gulg_b2", 3, 5, "step") === null);

  // The dungeon containing the boss exists (mount_gulg).
  check("mount gulg dungeon defined", !!DUNGEONS.mount_gulg);

  // Forge golem drops an accessory (power gauntlet).
  const lootIds = (boss.loot ?? []).map((l) => l.itemId);
  check("boss drops accessory loot", lootIds.includes("powerGauntlet"));

  return out;
}
