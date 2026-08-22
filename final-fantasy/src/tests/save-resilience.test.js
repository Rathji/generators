// Validation tests for Task #205: save resilience — corrupt saves fall back
// to the previous write's backup, future versions are refused cleanly, and
// the boot layer never throws on bad slot data.

import { SaveSlotSystem } from "../engine/save-slots.js";
import { GameBootSystem } from "../engine/boot.js";
import { SAVE_VERSION } from "../engine/save.js";
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
  inventory.add("potion", 2);
  const party = new PartyManager({ gold: 300 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const state = new GameState();
  state.setParty(party);
  state.setInventory(inventory);
  state.setLocation("cornelia", 5, 5, "S");
  return { state, party, inventory };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // Corrupt main save + valid backup -> recovered from backup.
  const storage = fakeStorage();
  const slots = new SaveSlotSystem({ storage });
  slots.write("A", buildGame());
  slots.write("A", buildGame());
  storage.setItem("ff_save_A", "{this is not json at all");
  const rec = slots.read("A");
  check("corrupt main recovers from backup", rec && !rec.error && rec.fromBackup === true);
  check("recovered data intact", rec.party.gold === 300 && rec.state.location.mapId === "cornelia");
  check("meta still readable after corruption", slots.meta("A")?.gold === 300);

  // Corrupt with no backup -> clean error, no throw.
  const storage2 = fakeStorage();
  const slots2 = new SaveSlotSystem({ storage: storage2 });
  storage2.setItem("ff_save_B", "garbage!");
  const bad = slots2.read("B");
  check("corrupt with no backup errors cleanly", bad && bad.error === "corrupt");
  check("corrupt meta is null", slots2.meta("B") === null);
  check("corrupt slot still has() (present on disk)", slots2.has("B") === true);

  // Missing version -> version error.
  const storage3 = fakeStorage();
  const slots3 = new SaveSlotSystem({ storage: storage3 });
  storage3.setItem("ff_save_C", JSON.stringify({ savedAt: 1, gold: 5 }));
  check("unversioned save refused", slots3.read("C")?.error === "version");

  // Future version -> version error, not corrupt.
  const storage4 = fakeStorage();
  const slots4 = new SaveSlotSystem({ storage: storage4 });
  const future = { ...JSON.parse(JSON.stringify(buildGame())), version: SAVE_VERSION + 50 };
  storage4.setItem("ff_save_A", JSON.stringify(future));
  check("future version refused", slots4.read("A")?.error === "version");

  // Boot layer: continue() returns a reason, never throws.
  const state = new GameState();
  const party = new PartyManager({ gold: 0 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const inv = new Inventory();
  state.setParty(party);
  state.setInventory(inv);
  const boot = new GameBootSystem({ state, party, inventory: inv, slots: slots2 });
  const r = boot.continue("B");
  check("boot continue corrupt -> reason, no throw", r.ok === false && r.reason === "corrupt");
  const boot3 = new GameBootSystem({ state, party, inventory: inv, slots: slots3 });
  const r2 = boot3.continue("C");
  check("boot continue unversioned -> version reason", r2.ok === false && r2.reason === "version");
  check("live game untouched by failed continue", party.gold === 0 && party.members.length === 1);

  // Erase also clears the backup; write-after-erase starts clean.
  const storage5 = fakeStorage();
  const slots5 = new SaveSlotSystem({ storage: storage5 });
  slots5.write("A", buildGame());
  slots5.erase("A");
  storage5.setItem("ff_save_A", "stale");
  check("erase removed backup", storage5.dump()["ff_save_A_bak"] == null);

  return out;
}
