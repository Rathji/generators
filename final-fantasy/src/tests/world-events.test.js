// Validation tests for Task #74: Overworld Event Triggers.

import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";

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
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const flags = { crystal_key_found: false, story_started: false };
  const sys = new WorldEventSystem(WORLD_EVENTS, { world: fakeWorld(flags), state: fakeState(flags) });

  check("world events database populated", WORLD_EVENTS.length >= 5);

  const boss = sys.eventById("chaos_shrine_boss");
  check("chaos shrine boss event exists", boss !== null);
  check("boss event requires crystal_key_found", boss.require.flag === "crystal_key_found");
  check("boss event is a step trigger", boss.on === "step");
  check("boss event gates on flag", !sys.isReady(boss));

  // Not pending until the requirement flag is set.
  check("boss not pending when gated", sys.pending("overworld", 13, 2, "step") === null);
  flags.crystal_key_found = true;
  check("boss pending once flag set", sys.pending("overworld", 13, 2, "step")?.id === "chaos_shrine_boss");
  check("boss not pending on wrong tile", sys.pending("overworld", 1, 1, "step") === null);

  // Triggering the boss battle routes to the handler and marks done.
  let battleStarted = null;
  let dialogue = null;
  const out1 = sys.trigger(sys.pending("overworld", 13, 2, "step"), {
    bossBattle: (act) => {
      battleStarted = act;
    },
    dialogue: (id) => {
      dialogue = id;
    },
  });
  check("boss battle routed to handler", battleStarted?.group === "garland_ambush");
  check("trigger returns event id", out1.eventId === "chaos_shrine_boss");
  check("done flag set after firing", flags.story_garland_defeated === true);

  // One-shot: no longer pending.
  check("boss event is one-shot", sys.pending("overworld", 13, 2, "step") === null);

  // Dialogue events.
  flags.story_garland_defeated = false;
  flags.crystal_key_found = false;
  const rumor = sys.pending("overworld", 12, 3, "step");
  check("garland rumor pending when flag absent", rumor?.event.type === "dialogue");
  sys.trigger(rumor, { dialogue: (id) => (dialogue = id) });
  check("rumor routes dialogue", dialogue === "overworld.garland_rumor");
  check("non-once events stay pending", sys.pending("overworld", 12, 3, "step") !== null);

  // Travel grant events.
  flags.story_started = true;
  let granted = null;
  sys.bindWorld(fakeWorld(flags));
  const offer = sys.pending("pravog", 4, 6, "step");
  check("ship offer pending when story started", offer?.event.type === "dialogue");
  sys.trigger(offer, { dialogue: () => {} });
  const grant = sys.pending("pravog", 4, 6, "interact");
  check("ship grant pending after offer", grant?.event.type === "grantTravel");
  sys.trigger(grant, {
    grantTravel: (act) => {
      granted = act;
    },
  });
  check("ship granted via handler", granted?.mode === "ship");
  check("ship flag set", flags.ship_obtained === true);

  // Marsh boss requires story_garland_defeated.
  const marshBoss = sys.eventById("marsh_guardian_boss");
  check("marsh boss gated on garland defeated", marshBoss.require.flag === "story_garland_defeated");
  check("marsh boss not pending pre-requirement", sys.pending("marsh_cave_b2", 3, 5, "step") === null);

  return out;
}
