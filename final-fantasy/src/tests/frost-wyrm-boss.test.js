// Validation tests for Task #149: Frost Wyrm Boss.

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

  // Boss event in the cavern's heart.
  const ev = WORLD_EVENTS.find((e) => e.id === "frost_wyrm_boss");
  check("frost wyrm event defined", !!ev);
  check("event in frozen core", ev?.mapId === "frozen_core");
  check("event tile is boss lair (3,5)", ev?.x === 3 && ev?.y === 5);
  check("event uses frost_wyrm_guard group", ev?.event.group === "frost_wyrm_guard");
  check("event requires forge colossus", ev?.require?.flag === "story_forge_colossus_defeated");
  check("event has intro", typeof ev?.event.intro === "string");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);
  check("event done flag set", ev?.doneFlag === "story_frost_wyrm_defeated");

  // The boss template.
  const boss = ENEMIES.frostWyrm;
  check("frost wyrm template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("tougher than the forge colossus", boss.hp > ENEMIES.forgeColossus.hp, `wyrm=${boss.hp} colossus=${ENEMIES.forgeColossus.hp}`);
  check("weaker than the ember fiend", boss.hp < ENEMIES.emberFiend.hp, `wyrm=${boss.hp} ember=${ENEMIES.emberFiend.hp}`);
  check("frost_wyrm_guard group exists", Array.isArray(ENEMY_GROUPS.frost_wyrm_guard));
  check("guard uses the boss", ENEMY_GROUPS.frost_wyrm_guard[0]?.id === "frostWyrm");
  check("boss drops frost scale", (boss.loot ?? []).some((l) => l.itemId === "frostScale" && l.chance === 1));
  check("frostScale item exists", !!ITEMS.frostScale);
  check("weak to fire and holy", ["fire", "holy"].every((e) => (boss.elements.weak ?? []).includes(e)));
  check("resists ice, water and earth", ["ice", "water", "earth"].every((e) => (boss.elements.resist ?? []).includes(e)));
  check("immune to all statuses", ["poison", "sleep", "paralysis", "stone"].every((s) => (boss.elements.immune ?? []).includes(s)));

  // Phase transitions fire.
  const ph = new BossPhaseController({ random: () => 0 });
  const e = { ...boss, hp: boss.hp, maxHp: boss.hp };
  ph.reset(e);
  e.hp = Math.floor(e.maxHp * 0.5);
  const t1 = ph.checkPhase(e);
  check("phase 1 triggers at 50%", t1 !== null && t1.transitions.length >= 1);

  // World event flow: gated until the Forge Colossus falls.
  const flags = {};
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });
  check("gated without forge colossus", sys.pending("frozen_core", 3, 5, "step") === null);
  flags.story_forge_colossus_defeated = true;
  const pending = sys.pending("frozen_core", 3, 5, "step");
  check("boss pending after forge colossus", pending?.id === "frost_wyrm_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "frost_wyrm_guard");
  check("done flag set", flags.story_frost_wyrm_defeated === true);
  flags[pending.event.onWinFlag] = true;
  check("onWinFlag marks wyrm defeated", flags.story_frost_wyrm_defeated === true);
  check("one-shot", sys.pending("frozen_core", 3, 5, "step") === null);

  // The dungeon containing the boss exists.
  check("frozen caverns dungeon defined", !!DUNGEONS.frozen_caverns);

  return out;
}
