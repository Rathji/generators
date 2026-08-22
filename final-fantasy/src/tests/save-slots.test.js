// Validation tests for Task #203: the three-slot save system — metadata,
// write/read/erase round-trips, overwrite semantics, and slot enumeration.

import { SaveSlotSystem, SAVE_SLOT_IDS, SAVE_SLOT_NAMES } from "../engine/save-slots.js";
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

function buildGame(gold = 500) {
  const inventory = new Inventory();
  inventory.add("potion", 3);
  inventory.add("crystalKey", 1);
  const party = new PartyManager({ gold });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  party.add(hero);
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  party.grantXp(1500);
  const state = new GameState();
  state.setParty(party);
  state.setInventory(inventory);
  state.setLocation("elfheim", 3, 4, "N");
  state.setFlag("elfheim_unlocked", true);
  state.setFlag("ngplus_cycle", 2);
  state.playTimeSec = 3661;
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
  const slots = new SaveSlotSystem({ storage });

  check("three slot ids", SAVE_SLOT_IDS.length === 3 && SAVE_SLOT_IDS.join("") === "ABC");
  check("slot names defined", SAVE_SLOT_NAMES.A === "Slot A");

  check("no saves initially", slots.any() === false);
  check("has() false for empty", slots.has("A") === false);

  const game = buildGame();
  const w = slots.write("B", game);
  check("write ok with meta", w.ok === true && !!w.meta && w.meta.slot === "B");
  check("meta level", w.meta.level >= 3);
  check("meta gold", w.meta.gold === 500);
  check("meta location", w.meta.mapId === "elfheim" && w.meta.location === "elfheim (3,4)");
  check("meta playtime", w.meta.playTimeSec === 3661);
  check("meta cycle from flag", w.meta.cycle === 2);
  check("meta members", w.meta.partyCount === 2);

  check("any() true after write", slots.any() === true);
  check("has() true", slots.has("B") === true);
  check("has() false for untouched", slots.has("A") === false);

  const meta = slots.meta("B");
  check("meta() round-trips", meta?.slot === "B" && meta?.gold === 500);

  const read = slots.read("B");
  check("read returns data", read && !read.error);
  check("read restores party", read.party.members.length === 2 && read.party.gold === 500);
  check("read restores inventory", read.inventory.count("potion") === 3);
  check("read restores flags", read.state.getFlag("elfheim_unlocked") === true);
  check("read restores location", read.state.location.mapId === "elfheim" && read.state.location.facing === "N");
  check("read carries meta", read.meta?.slot === "B");
  check("read version 2", read.version === 2);

  // Overwrite updates in place, preserves the previous as a backup.
  const game2 = buildGame(999);
  game2.state.setLocation("pravog", 1, 2, "E");
  const w2 = slots.write("B", game2);
  check("overwrite ok", w2.ok === true && w2.meta.gold === 999);
  check("meta reflects newest write", slots.meta("B").gold === 999);
  check("backup written", storage.dump()["ff_save_B_bak"] != null);
  const prev = slots.parse(storage.dump()["ff_save_B_bak"]);
  check("backup holds previous data", prev && !prev.error && prev.meta.gold === 500);

  // Erase clears both main and backup.
  const e = slots.erase("B");
  check("erase ok", e.ok === true);
  check("slot gone", slots.has("B") === false && slots.any() === false);
  check("backup gone too", storage.dump()["ff_save_B_bak"] == null);

  check("invalid slot rejected", slots.write("Z", game).reason === "invalid_slot" && slots.read("Z") === null);
  check("empty slot read null", slots.read("A") === null);

  // Memory storage fallback.
  const mem = new SaveSlotSystem();
  mem.write("A", game);
  check("memory slots work", mem.has("A") === true && mem.any() === true);
  check("memory meta", mem.meta("A")?.slot === "A");
  mem.erase("A");
  check("memory erase", mem.has("A") === false);

  // Task #159: slot listing + most-recent-save helper.
  const origNow = Date.now;
  const ls = new SaveSlotSystem({ storage });
  try {
    Date.now = () => 1000;
    ls.write("A", game);
    Date.now = () => 2000;
    ls.write("C", game);
  } finally {
    Date.now = origNow;
  }
  const list = ls.list();
  check("list has all slots", list.length === 3 && list.filter((s) => s.has).length === 2);
  check("list carries meta", list.find((s) => s.slot === "C").meta?.slot === "C");
  const mr = ls.mostRecent();
  check("mostRecent is latest write", mr?.slot === "C" && mr?.meta?.gold === 500);
  const only = new SaveSlotSystem({ storage: fakeStorage() });
  only.write("B", game);
  check("mostRecent falls back to only save", only.mostRecent()?.slot === "B");
  const none = new SaveSlotSystem({ storage: fakeStorage() });
  check("mostRecent empty", none.mostRecent() === null);

  return out;
}
