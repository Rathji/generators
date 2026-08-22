// Validation tests for Task #189: the full Waystone arc — light all six
// stones through their world events, finish the pilgrim quest, claim the
// Wayfarer's Charm, and travel the complete network.

import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { WaystoneSystem } from "../engine/waystones.js";
import { WAYSTONES } from "../data/waystones.js";
import { SideQuestSystem } from "../engine/side-quests.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";
import { ITEMS } from "../data/items.js";

function mkWorld(flags = {}) {
  const state = new GameState();
  for (const [k, v] of Object.entries(flags)) state.setFlag(k, v);
  return { state, getFlag: (n) => state.getFlag(n), hasItem: (n) => false };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  state.setFlag("intro_seen", true);
  const party = new PartyManager({ gold: 100 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const inv = new Inventory();
  const world = { getFlag: (n) => state.getFlag(n), hasItem: (n) => inv.has(n) };

  const ws = new WaystoneSystem(WAYSTONES, { state });
  const wev = new WorldEventSystem(WORLD_EVENTS, { state, world });
  const sq = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });

  check("quest startable after intro", sq.canStart("the_waystone_pilgrim") === true);
  sq.start("the_waystone_pilgrim");
  check("quest started", sq.isStarted("the_waystone_pilgrim"));

  // Walk every stone the way the world-events fire them.
  const lit = [];
  const handlers = {
    waystone: (act) => {
      const w = ws.byId(act.waystoneId);
      ws.activateAt(w.mapId, w.x, w.y);
      lit.push(act.waystoneId);
    },
  };
  for (const w of WAYSTONES) {
    const ev = wev.eventAt(w.mapId, w.x, w.y, "step");
    check("event fires at " + w.id, !!ev);
    if (ev) wev.trigger(ev, handlers);
  }
  check("all six lit through events", ws.countLit() === 6 && lit.length === 6);

  // The demo's completion hook: step flag then reward.
  sq.completeStep("the_waystone_pilgrim", "sq_waystone_pilgrim_all");
  const reward = sq.checkComplete("the_waystone_pilgrim");
  check("quest complete", reward.ok === true);
  check("charm awarded", inv.count("wayfarerCharm") === 1);
  check("gold rewarded (100+300)", party.gold === 400);
  check("item exists in db", !!ITEMS.wayfarerCharm);

  // Travel across the whole network once lit (self excluded by design).
  for (const w of WAYSTONES) {
    if (w.id === "cornelia") continue;
    const t = ws.travel("cornelia", w.id);
    check("travel to " + w.id, t.ok === true && t.to.mapId === w.mapId);
  }
  check("self-travel excluded", ws.travel("cornelia", "cornelia").ok === false);
  check("round trip", ws.travel("glacierport", "cornelia").to.mapId === "cornelia");

  return out;
}
