// Validation tests for Task #160: Auto-Save Trigger Logic — a temporary
// quick-save written on every map-ID transition, separate from the manual
// slots, restorable like a normal save.

import { AutoSaveSystem, QUICKSAVE_KEY } from "../engine/autosave.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";

function fakeStorage() {
  const map = {};
  return {
    setItem(k, v) { map[k] = v; },
    getItem(k) { return k in map ? map[k] : null; },
    removeItem(k) { delete map[k]; },
    dump: () => map,
  };
}

function buildGame() {
  const inventory = new Inventory();
  inventory.add("potion", 3);
  const party = new PartyManager({ gold: 220 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior", level: 4 }));
  const state = new GameState();
  state.setParty(party);
  state.setInventory(inventory);
  state.setLocation("cornelia", 7, 5, "S");
  state.setFlag("intro_seen", true);
  state.flags["playtime_steps"] = 12;
  return { state, party, inventory };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const storage = fakeStorage();
  const au = new AutoSaveSystem({ storage });
  const game = buildGame();

  check("no quick-save initially", au.has() === false && au.read() === null);

  // The demo calls onTransition AFTER the state has moved to the new map, so
  // the quick-save reflects the destination.
  game.state.setLocation("caves_of_cornelia", 9, 4, "N");
  const r = au.onTransition("cornelia", "caves_of_cornelia", game, { extra: "x" });
  check("transition saves", r.ok === true && r.from === "cornelia" && r.to === "caves_of_cornelia");
  check("quick-save key used", storage.dump()[`ff_save_${QUICKSAVE_KEY}`] != null);
  check("quick-save tracked", au.has() === true && au.last.to === "caves_of_cornelia");

  const read = au.read();
  check("read restores location", read.state.location.mapId === "caves_of_cornelia" && read.state.location.x === 9);
  check("read restores gold + inventory", read.party.gold === 220 && read.inventory.count("potion") === 3);
  check("meta marks quicksave", read.meta?.quicksave === true && read.meta.from === "cornelia");

  check("meta() helper", au.meta()?.to === "caves_of_cornelia");
  check("note() mentions transition", au.note().includes("cornelia"));

  // Same-map steps never trigger.
  const before = storage.dump()[`ff_save_${QUICKSAVE_KEY}`];
  au.onTransition("caves_of_cornelia", "caves_of_cornelia", game);
  check("same-map ignored", storage.dump()[`ff_save_${QUICKSAVE_KEY}`] === before);

  // Second transition overwrites the temp save.
  au.onTransition("caves_of_cornelia", "dwarfholm", game);
  check("second transition overwrites", au.meta()?.to === "dwarfholm");

  // Disabled system refuses.
  const off = new AutoSaveSystem({ storage: fakeStorage(), enabled: false });
  check("disabled refuses", off.onTransition("a", "b", game).reason === "disabled" && off.has() === false);

  // Erase clears it.
  au.erase();
  check("erase clears", au.has() === false && au.last === null);

  return out;
}
