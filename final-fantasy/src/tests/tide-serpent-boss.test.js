// Validation tests for Task #115: Tide Serpent Boss (Sea Shrine).

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

  // Boss event in the sunken sanctum.
  const ev = WORLD_EVENTS.find((e) => e.id === "tide_serpent_boss");
  check("tide serpent event defined", !!ev);
  check("event in sunken sanctum", ev?.mapId === "sea_shrine_b2");
  check("event tile is boss lair (3,5)", ev?.x === 3 && ev?.y === 5);
  check("event uses tide_serpent_guard group", ev?.event.group === "tide_serpent_guard");
  check("event requires ship + garland", !!ev?.require.all && ev?.require.all?.length === 2);
  check("event has intro", typeof ev?.event.intro === "string");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);
  check("event done flag set", ev?.doneFlag === "story_tide_serpent_defeated");

  // The boss template.
  const boss = ENEMIES.tideSerpent;
  check("tide serpent template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("tougher than iron sentinel", boss.hp > ENEMIES.ironSentinel.hp);
  check("tide_serpent_guard group exists", Array.isArray(ENEMY_GROUPS.tide_serpent_guard));
  check("tide_serpent_guard uses the boss", ENEMY_GROUPS.tide_serpent_guard[0]?.id === "tideSerpent");
  check("boss drops triton harpoon", (boss.loot ?? []).some((l) => l.itemId === "tritonHarpoon" && l.chance === 1));
  check("boss drops tide key", (boss.loot ?? []).some((l) => l.itemId === "tideKey" && l.chance === 1));
  check("tritonHarpoon item exists", !!ITEMS.tritonHarpoon);
  check("tideKey item exists", !!ITEMS.tideKey);
  check("boss immune to poison", (boss.elements.immune ?? []).includes("poison"));
  check("boss weak to lightning", (boss.elements.weak ?? []).includes("lightning"));

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
  flags.ship_obtained = true;
  check("boss gated until garland defeated", sys.pending("sea_shrine_b2", 3, 5, "step") === null);
  flags.story_garland_defeated = true;
  const pending = sys.pending("sea_shrine_b2", 3, 5, "step");
  check("boss pending after ship + garland", pending?.id === "tide_serpent_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "tide_serpent_guard");
  check("done flag set", flags.story_tide_serpent_defeated === true);
  flags[pending.event.onWinFlag] = true;
  check("onWinFlag marks serpent defeated", flags.story_tide_serpent_defeated === true);
  check("one-shot", sys.pending("sea_shrine_b2", 3, 5, "step") === null);

  // The dungeon containing the boss exists.
  check("sea shrine dungeon defined", !!DUNGEONS.sea_shrine);

  return out;
}
