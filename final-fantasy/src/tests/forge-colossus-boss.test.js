// Validation tests for Task #138: Forge Colossus Boss.

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

  // Boss event in the forge heart.
  const ev = WORLD_EVENTS.find((e) => e.id === "forge_colossus_boss");
  check("forge colossus event defined", !!ev);
  check("event in forge core", ev?.mapId === "forge_core");
  check("event tile is boss lair (3,5)", ev?.x === 3 && ev?.y === 5);
  check("event uses forge_colossus_guard group", ev?.event.group === "forge_colossus_guard");
  check("event requires gulg guardian", ev?.require?.flag === "story_gulg_guardian_defeated");
  check("event has intro", typeof ev?.event.intro === "string");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);
  check("event done flag set", ev?.doneFlag === "story_forge_colossus_defeated");

  // The boss template.
  const boss = ENEMIES.forgeColossus;
  check("forge colossus template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("tougher than chaos", boss.hp > ENEMIES.chaos.hp, `colossus=${boss.hp} chaos=${ENEMIES.chaos.hp}`);
  check("weaker than the ember fiend", boss.hp < ENEMIES.emberFiend.hp, `colossus=${boss.hp} ember=${ENEMIES.emberFiend.hp}`);
  check("forge_colossus_guard group exists", Array.isArray(ENEMY_GROUPS.forge_colossus_guard));
  check("guard uses the boss", ENEMY_GROUPS.forge_colossus_guard[0]?.id === "forgeColossus");
  check("boss drops adamantite ore", (boss.loot ?? []).some((l) => l.itemId === "adamantiteOre" && l.chance === 1));
  check("adamantiteOre item exists", !!ITEMS.adamantiteOre);
  check("weak to lightning and holy", ["lightning", "holy"].every((e) => (boss.elements.weak ?? []).includes(e)));
  check("resists fire and earth", ["fire", "earth"].every((e) => (boss.elements.resist ?? []).includes(e)));
  check("immune to all statuses", ["poison", "sleep", "paralysis", "stone"].every((s) => (boss.elements.immune ?? []).includes(s)));

  // Phase transitions fire.
  const ph = new BossPhaseController({ random: () => 0 });
  const e = { ...boss, hp: boss.hp, maxHp: boss.hp };
  ph.reset(e);
  e.hp = Math.floor(e.maxHp * 0.5);
  const t1 = ph.checkPhase(e);
  check("phase 1 triggers at 50%", t1 !== null && t1.transitions.length >= 1);

  // World event flow: gated until the Forge Golem falls.
  const flags = {};
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });
  check("gated without gulg guardian", sys.pending("forge_core", 3, 5, "step") === null);
  flags.story_gulg_guardian_defeated = true;
  const pending = sys.pending("forge_core", 3, 5, "step");
  check("boss pending after gulg guardian", pending?.id === "forge_colossus_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "forge_colossus_guard");
  check("done flag set", flags.story_forge_colossus_defeated === true);
  flags[pending.event.onWinFlag] = true;
  check("onWinFlag marks colossus defeated", flags.story_forge_colossus_defeated === true);
  check("one-shot", sys.pending("forge_core", 3, 5, "step") === null);

  // The dungeon containing the boss exists.
  check("dwarven forge dungeon defined", !!DUNGEONS.dwarven_forge);

  return out;
}
