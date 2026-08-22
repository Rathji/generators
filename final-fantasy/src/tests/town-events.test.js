// Validation tests for Task #51: Town-Specific Event Triggers.

import { TownEventSystem } from "../engine/town-events.js";
import { TOWN_EVENTS } from "../data/town-events.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const inventory = new Inventory();
  const dialogues = [];
  const battles = [];
  const given = [];
  const sys = new TownEventSystem(TOWN_EVENTS, {
    state,
    world: { getFlag: (n) => state.getFlag(n) },
    handlers: {
      dialogue: (id) => dialogues.push(id),
      battle: (group) => battles.push(group),
      giveItem: (itemId, count) => given.push([itemId, count]),
    },
  });

  check("events listed per town", sys.eventsFor("cornelia").length === 3);
  check("unknown town empty", sys.eventsFor("nowhere").length === 0);
  check("eventById", sys.eventById("cornelia_festival")?.name === "Festival of Light");

  check("festival not ready before flag", sys.pending("cornelia").every((e) => e.id !== "cornelia_festival"));

  state.setFlag("crystal_fire", true);
  const ready = sys.pending("cornelia").map((e) => e.id);
  check("festival ready after flag", ready.includes("cornelia_festival"));

  const fired = sys.fireById("cornelia_festival");
  check("dialogue handler fired", fired.ok === true && dialogues.includes("cornelia.festival"));
  check("onDoneFlag set", state.getFlag("cornelia_festival_done") === true);
  check("once event no longer pending", sys.pending("cornelia").every((e) => e.id !== "cornelia_festival"));

  check("not-ready event blocked", sys.fireById("cornelia_guard_warn").ok === false);

  state.setFlag("story_started", true);
  const next = sys.check("cornelia");
  check("check fires next pending", next && next.eventId === "cornelia_guard_warn");

  check("bandit raid pending while garland alive", sys.pending("cornelia").some((e) => e.id === "cornelia_bandit_raid"));
  state.setFlag("story_garland_defeated", true);
  check("bandit raid gone after defeat", sys.pending("cornelia").every((e) => e.id !== "cornelia_bandit_raid"));

  state.setFlag("prologue_seen", true);
  const inn = new TownEventSystem(TOWN_EVENTS, { state });
  const innFire = inn.fireById("inn_free_night");
  check("inn event sets flag", innFire.ok === true && state.getFlag("inn_free_night") === true);

  const caves = new TownEventSystem(TOWN_EVENTS, { state, world: null, handlers: { giveItem: (i, c) => given.push([i, c]) } });
  state.setFlag("crystal_key_found", true);
  const gift = caves.fireById("cave_hermit_gift");
  check("giveItem without inventory routes to handler", given.length >= 1 && gift.ok === true);

  const structured = new TownEventSystem(TOWN_EVENTS, { state });
  const res = structured.fire(structured.eventById("cave_hermit_gift"));
  check("no handlers -> structured result", res.ok === true && res.result === "potion");

  check("complete() manual", (() => {
    const sys2 = new TownEventSystem(TOWN_EVENTS, { state: new GameState() });
    return sys2.complete("cornelia_festival") === true;
  })());

  return out;
}
