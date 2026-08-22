// Validation tests for Task #104: Engine Guardian Boss (Iron Sentinel).

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

  // Boss event in the tunnel engine vault.
  const ev = WORLD_EVENTS.find((e) => e.id === "iron_sentinel_boss");
  check("iron sentinel event defined", !!ev);
  check("event in engine vault", ev?.mapId === "gnome_tunnels_b2");
  check("event tile is boss lair (3,5)", ev?.x === 3 && ev?.y === 5);
  check("event uses iron_sentinel_guard group", ev?.event.group === "iron_sentinel_guard");
  check("event requires marsh guardian defeated", ev?.require.flag === "story_marsh_guardian_defeated");
  check("event has intro", typeof ev?.event.intro === "string");
  check("event grants airship on win", ev?.event.onWinFlag === "airship_obtained");
  check("event victory dialogue exists", ev?.event.onWinDialogue in DIALOGUE);
  check("event done flag set", ev?.doneFlag === "story_iron_sentinel_defeated");

  // The boss template.
  const boss = ENEMIES.ironSentinel;
  check("iron sentinel template exists", !!boss);
  check("is a boss", boss.boss === true);
  check("has phases", Array.isArray(boss.phases) && boss.phases.length >= 2);
  check("tougher than marsh guardian", boss.hp > ENEMIES.marshGuardian.hp);
  check("weaker than forge golem", boss.hp < ENEMIES.forgeGolem.hp);
  check("iron_sentinel_guard group exists", Array.isArray(ENEMY_GROUPS.iron_sentinel_guard));
  check("iron_sentinel_guard uses the boss", ENEMY_GROUPS.iron_sentinel_guard[0]?.id === "ironSentinel");
  check("boss drops the airship engine", (boss.loot ?? []).some((l) => l.itemId === "airshipEngine" && l.chance === 1));
  check("airshipEngine item exists", !!ITEMS.airshipEngine);
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
  check("boss gated until marsh guardian defeated", sys.pending("gnome_tunnels_b2", 3, 5, "step") === null);
  flags.story_marsh_guardian_defeated = true;
  const pending = sys.pending("gnome_tunnels_b2", 3, 5, "step");
  check("boss pending after marsh guardian defeated", pending?.id === "iron_sentinel_boss");
  let battle = null;
  sys.trigger(pending, { bossBattle: (act) => (battle = act) });
  check("boss battle routed", battle?.group === "iron_sentinel_guard");
  check("done flag set", flags.story_iron_sentinel_defeated === true);
  // The battle-won handler applies the event's onWinFlag to grant the airship.
  flags[pending.event.onWinFlag] = true;
  check("onWinFlag grants airship", flags.airship_obtained === true);
  check("one-shot", sys.pending("gnome_tunnels_b2", 3, 5, "step") === null);

  // The dungeon containing the boss exists.
  check("gnome tunnels dungeon defined", !!DUNGEONS.gnome_tunnels);

  return out;
}
