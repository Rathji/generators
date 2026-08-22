// Validation tests for Task #195: the Echo of Creation — its world event
// (gated by the NG+ cycle), the echoBattle action, and the cycle-scaled boss.

import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { NgPlusSystem } from "../engine/ngplus.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { ENEMIES } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const world = { getFlag: (n) => state.getFlag(n), hasItem: () => false };
  const sys = new WorldEventSystem(WORLD_EVENTS, { state, world });

  const ev = sys.eventAt("trial_hall", 7, 8, "step");
  check("echo event at the hollow", !!ev && ev.event.type === "echoBattle" && ev.id === "echo_creation_boss");
  check("echo event gated by cycle flag", ev?.require?.flag === "ngplus_echo_unlocked");
  check("echo event retryable", ev?.once !== true);
  check("not pending on cycle 1", sys.pending("trial_hall", 7, 8, "step") === null);

  // Cycle 2 unlocks it.
  const party = new PartyManager({ gold: 0 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior", level: 20 }));
  const inv = new Inventory();
  const es = new EnemyTemplateSystem();
  const ng = new NgPlusSystem({ state, party, inventory: inv, enemySystem: es });

  state.setFlag("story_chrono_defeated", true);
  ng.startCycle();
  check("cycle now 2", ng.cycle() === 2);
  check("echo event pending on cycle 2", sys.pending("trial_hall", 7, 8, "step") !== null);

  let battleRes = null;
  const handled = sys.trigger(ev, {
    echoBattle: () => {
      const boss = ng.echoBoss();
      battleRes = { ok: true, id: boss.id, hp: boss.hp };
      return battleRes;
    },
  });
  check("trigger fires echo", handled.started === true && handled.event.type === "echoBattle");
  check("boss is scaled echo", battleRes.id === "echoOfCreation" && battleRes.hp === Math.round(ENEMIES.echoOfCreation.hp * 1.5), "hp=" + battleRes?.hp);

  // Retryable: a defeat (no victory recorded) leaves the gate open.
  check("still pending after a loss", sys.pending("trial_hall", 7, 8, "step") !== null);
  const win = ng.recordEchoDefeat();
  check("victory recorded", win.ok === true);
  check("echo defeat flag set", state.getFlag("ngplus_echo_defeated") === true);

  return out;
}
