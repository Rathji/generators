// Validation tests for Task #99: Final Boss Encounter Logic (Chaos).

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

  // Boss event in the dark altar.
  const ev = WORLD_EVENTS.find((e) => e.id === "chaos_boss");
  check("chaos event defined", !!ev);
  check("event in dark altar", ev?.mapId === "chaos_shrine_b2");
  check("event uses chaos_guard group", ev?.event.group === "chaos_guard");
  check("event requires chaos awaited", ev?.require.flag === "chaos_awaited");
  check("event has intro", typeof ev?.event.intro === "string");
  check("event sets flag on win", ev?.event.onWinFlag === "story_chaos_defeated");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);

  // The boss template.
  const boss = ENEMIES.chaos;
  check("chaos template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("is tougher than forge golem", boss.hp > ENEMIES.forgeGolem.hp);
  check("weak to holy", boss.elements.weak.includes("holy"));
  check("immune to statuses", ["poison", "sleep", "paralysis", "stone"].every((s) => boss.elements.immune.includes(s)));
  check("chaos_guard group exists", Array.isArray(ENEMY_GROUPS.chaos_guard));
  check("chaos_guard group uses the boss", ENEMY_GROUPS.chaos_guard[0]?.id === "chaos");

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
  check("boss gated until chaos awaited", sys.pending("chaos_shrine_b2", 3, 5, "step") === null);
  flags.chaos_awaited = true;
  const pending = sys.pending("chaos_shrine_b2", 3, 5, "step");
  check("boss pending after chaos awaited", pending?.id === "chaos_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "chaos_guard");
  check("done flag set", flags.story_chaos_defeated === true);
  check("one-shot", sys.pending("chaos_shrine_b2", 3, 5, "step") === null);

  // The dungeon containing the boss exists (chaos_shrine).
  check("chaos shrine dungeon defined", !!DUNGEONS.chaos_shrine);

  // Chaos drops an accessory (ribbon).
  const lootIds = (boss.loot ?? []).map((l) => l.itemId);
  check("boss drops accessory loot", lootIds.includes("ribbon"));

  return out;
}
