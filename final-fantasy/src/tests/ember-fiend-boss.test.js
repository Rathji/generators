// Validation tests for Task #128: Ember Fiend Boss (final super boss).

import { WORLD_EVENTS } from "../data/world-events.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { BossPhaseController } from "../engine/boss.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { DIALOGUE } from "../data/dialogue.js";
import { DUNGEONS } from "../data/dungeons.js";
import { ITEMS } from "../data/items.js";

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

  // Boss event in the Molten Core.
  const ev = WORLD_EVENTS.find((e) => e.id === "ember_fiend_boss");
  check("ember fiend event defined", !!ev);
  check("event in molten core", ev?.mapId === "ember_sanctum_core");
  check("event tile is boss lair (3,5)", ev?.x === 3 && ev?.y === 5);
  check("event uses ember_fiend_guard group", ev?.event.group === "ember_fiend_guard");
  check("event requires airship + wind fiend", !!ev?.require.all);
  check("event multi-gate has both flags", ev?.require.all?.length === 2);
  check("event has intro", typeof ev?.event.intro === "string");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);
  check("event done flag set", ev?.doneFlag === "story_ember_fiend_defeated");

  // The boss template.
  const boss = ENEMIES.emberFiend;
  check("ember fiend template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 3);
  check("tougher than wind fiend", boss.hp > ENEMIES.windFiend.hp, `ember=${boss.hp} wind=${ENEMIES.windFiend.hp}`);
  check("ember_fiend_guard group exists", Array.isArray(ENEMY_GROUPS.ember_fiend_guard));
  check("ember_fiend_guard uses the boss", ENEMY_GROUPS.ember_fiend_guard[0]?.id === "emberFiend");
  check("boss drops the inferno brand", (boss.loot ?? []).some((l) => l.itemId === "infernoBrand" && l.chance === 1));
  check("boss drops elixir", (boss.loot ?? []).some((l) => l.itemId === "elixir"));
  check("infernoBrand item exists", !!ITEMS.infernoBrand);
  check("magmaHeart item exists", !!ITEMS.magmaHeart);
  check("weak to holy and ice", ["holy", "ice"].every((e) => (boss.elements.weak ?? []).includes(e)));
  check("resists the other elements", ["fire", "earth", "water"].every((e) => (boss.elements.resist ?? []).includes(e)));
  check("immune to all statuses", ["poison", "sleep", "paralysis", "stone"].every((s) => (boss.elements.immune ?? []).includes(s)));

  // Phase transitions fire.
  const ph = new BossPhaseController({ random: () => 0 });
  const e = { ...boss, hp: boss.hp, maxHp: boss.hp };
  ph.reset(e);
  e.hp = Math.floor(e.maxHp * 0.6);
  const t1 = ph.checkPhase(e);
  check("phase 1 triggers at 60%", t1 !== null && t1.transitions.length >= 1);
  e.hp = Math.floor(e.maxHp * 0.3);
  const t2 = ph.checkPhase(e);
  check("phase 2 triggers at 30%", t2 !== null && t2.transitions.length >= 1);

  // World event flow: gated until BOTH conditions met.
  const flags = {};
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });
  flags.airship_obtained = true;
  check("gated without wind fiend", sys.pending("ember_sanctum_core", 3, 5, "step") === null);
  flags.story_wind_fiend_defeated = true;
  const pending = sys.pending("ember_sanctum_core", 3, 5, "step");
  check("boss pending after both flags", pending?.id === "ember_fiend_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "ember_fiend_guard");
  check("done flag set", flags.story_ember_fiend_defeated === true);
  flags[pending.event.onWinFlag] = true;
  check("onWinFlag marks fiend defeated", flags.story_ember_fiend_defeated === true);
  check("one-shot", sys.pending("ember_sanctum_core", 3, 5, "step") === null);

  // The dungeon containing the boss exists.
  check("ember sanctum dungeon defined", !!DUNGEONS.ember_sanctum);

  return out;
}
