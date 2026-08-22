// Validation tests for Task #86: First Boss Encounter Logic (Garland).

import { WORLD_EVENTS } from "../data/world-events.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { BossPhaseController } from "../engine/boss.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { DIALOGUE } from "../data/dialogue.js";

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

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // The boss event exists and triggers a garland ambush battle.
  const ev = WORLD_EVENTS.find((e) => e.id === "chaos_shrine_boss");
  check("chaos shrine boss event defined", !!ev);
  check("boss event uses garland_ambush group", ev?.event.group === "garland_ambush");
  check("boss event has an intro", typeof ev?.event.intro === "string");
  check("boss event sets story flag on win", ev?.event.onWinFlag === "story_garland_defeated");
  check("boss event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);

  // Garland exists with boss phases.
  const garland = ENEMIES.garland;
  check("garland template exists", !!garland);
  check("garland is a boss", garland.boss === true);
  check("garland has phases", Array.isArray(garland.phases) && garland.phases.length >= 2);
  check("garland group exists", Array.isArray(ENEMY_GROUPS.garland_ambush));

  // Boss phase transitions fire as HP drops.
  const boss = new BossPhaseController({ random: () => 0 });
  const enemy = { ...garland, hp: garland.hp, maxHp: garland.hp };
  boss.reset(enemy);
  enemy.hp = Math.floor(enemy.maxHp * 0.5);
  const ph = boss.checkPhase(enemy);
  check("phase triggers below 66%", ph !== null && ph.transitions.length >= 1);
  check("enemy stat boosted in phase", enemy.atk > garland.atk);
  enemy.hp = Math.floor(enemy.maxHp * 0.2);
  const ph2 = boss.checkPhase(enemy);
  check("second phase triggers below 33%", ph2 !== null && ph2.transitions.length >= 1);

  // World event flow: gated until the crystal key is found, then fires once.
  const flags = {};
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });
  check("boss gated before key found", sys.pending("overworld", 13, 2, "step") === null);
  flags.crystal_key_found = true;
  const pending = sys.pending("overworld", 13, 2, "step");
  check("boss pending after key found", pending?.id === "chaos_shrine_boss");

  let bossBattle = null;
  sys.trigger(pending, {
    bossBattle: (act) => {
      bossBattle = act;
    },
  });
  check("boss battle routed", bossBattle?.group === "garland_ambush");
  check("done flag set after trigger", flags.story_garland_defeated === true);
  check("event is one-shot", sys.pending("overworld", 13, 2, "step") === null);

  // The overworld tile the boss occupies is reachable in the real map.
  const { MAPS } = await import("../data/maps.js");
  const { TileMap } = await import("../engine/grid.js");
  const overworld = MAPS.find((m) => m.id === "overworld");
  const tm = TileMap.fromAscii(overworld.rows, { tiles: overworld.tiles, solid: overworld.solid });
  check("chaos shrine tile walkable", tm.inBounds(13, 2) && tm.canStand(13, 2));

  return out;
}
