// Validation tests for Task #158: Chrono Boss.

import { WORLD_EVENTS } from "../data/world-events.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { BossPhaseController } from "../engine/boss.js";
import { WorldEventSystem } from "../engine/world-events.js";
import { GateSystem } from "../engine/gates.js";
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

  // Boss event in the Throne of Eternity.
  const ev = WORLD_EVENTS.find((e) => e.id === "chrono_boss");
  check("chrono event defined", !!ev);
  check("event in chrono throne", ev?.mapId === "chrono_throne");
  check("event tile is boss lair (3,5)", ev?.x === 3 && ev?.y === 5);
  check("event uses chrono_guard group", ev?.event.group === "chrono_guard");
  check("event requires ember fiend", ev?.require?.flag === "story_ember_fiend_defeated");
  check("event has intro", typeof ev?.event.intro === "string");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);
  check("event done flag set", ev?.doneFlag === "story_chrono_defeated");

  // The rift gate seals the Dark Altar until every fiend falls.
  const gates = new GateSystem({ getFlag: () => false });
  gates.add({ id: "chrono_rift_gate", mapId: "chaos_shrine_b2", x: 1, y: 5, require: { flag: "story_ember_fiend_defeated" }, deniedDialogue: "sealed" });
  check("rift sealed before ember fiend", gates.canPass("chaos_shrine_b2", 1, 5).allowed === false);
  const openGates = new GateSystem({ getFlag: (n) => n === "story_ember_fiend_defeated" });
  openGates.add({ id: "chrono_rift_gate", mapId: "chaos_shrine_b2", x: 1, y: 5, require: { flag: "story_ember_fiend_defeated" }, deniedDialogue: "sealed" });
  check("rift opens after ember fiend", openGates.canPass("chaos_shrine_b2", 1, 5).allowed === true);

  // The boss template.
  const boss = ENEMIES.chrono;
  check("chrono template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("tougher than the ember fiend", boss.hp > ENEMIES.emberFiend.hp, `chrono=${boss.hp} ember=${ENEMIES.emberFiend.hp}`);
  check("chrono_guard group exists", Array.isArray(ENEMY_GROUPS.chrono_guard));
  check("guard uses the boss", ENEMY_GROUPS.chrono_guard[0]?.id === "chrono");
  check("boss drops eternal blade", (boss.loot ?? []).some((l) => l.itemId === "eternalBlade" && l.chance === 1));
  check("eternalBlade item exists", !!ITEMS.eternalBlade);
  check("weak only to holy", (boss.elements.weak ?? []).length === 1 && boss.elements.weak[0] === "holy");
  check("resists every element", ["fire", "ice", "earth", "water", "wind", "lightning"].every((e) => (boss.elements.resist ?? []).includes(e)));
  check("immune to all statuses", ["poison", "sleep", "paralysis", "stone"].every((s) => (boss.elements.immune ?? []).includes(s)));

  // Phase transitions fire.
  const ph = new BossPhaseController({ random: () => 0 });
  const e = { ...boss, hp: boss.hp, maxHp: boss.hp };
  ph.reset(e);
  e.hp = Math.floor(e.maxHp * 0.5);
  const t1 = ph.checkPhase(e);
  check("phase 1 triggers at 50%", t1 !== null && t1.transitions.length >= 1);

  // World event flow: gated until the Ember Fiend falls.
  const flags = {};
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });
  check("gated without ember fiend", sys.pending("chrono_throne", 3, 5, "step") === null);
  flags.story_ember_fiend_defeated = true;
  const pending = sys.pending("chrono_throne", 3, 5, "step");
  check("boss pending after ember fiend", pending?.id === "chrono_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "chrono_guard");
  check("done flag set", flags.story_chrono_defeated === true);
  flags[pending.event.onWinFlag] = true;
  check("onWinFlag marks chrono defeated", flags.story_chrono_defeated === true);
  check("one-shot", sys.pending("chrono_throne", 3, 5, "step") === null);

  // The dungeon containing the boss exists.
  check("time labyrinth dungeon defined", !!DUNGEONS.time_labyrinth);

  return out;
}
