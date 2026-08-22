// Validation tests for Task #20: Save/Load Serialization.

import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { serializeGame, deserializeGame, SaveManager } from "../engine/save.js";

function buildGame() {
  const inventory = new Inventory();
  inventory.add("potion", 3);
  inventory.add("crystalKey", 1);
  const party = new PartyManager({ gold: 500 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  party.add(hero);
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }), true);
  party.grantXp(1200);
  hero.equipment.weapon = "ironSword";
  hero.equipment.armor = "chain";
  hero.damage(15);
  hero.addStatus("poison");
  const state = new GameState();
  state.setParty(party);
  state.setInventory(inventory);
  state.setLocation("cornelia", 5, 5, "N");
  state.setStoryPhase(3);
  state.setFlag("king_met");
  state.setFlag("earth_crystal_quest");
  return { state, party, inventory };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const game = buildGame();
  const json = serializeGame(game);
  check("serializes to a JSON string", typeof json === "string" && json.length > 50);
  const parsed = JSON.parse(json);
  check("version stamped", parsed.version === 2);
  check("party members serialized", parsed.party.length === 2);
  check("reserve serialized", parsed.reserve.length === 1);
  check("inventory serialized", parsed.inventory.length === 2);

  const loaded = deserializeGame(json);
  check("flags restored", loaded.state.getFlag("king_met") === true && loaded.state.getFlag("earth_crystal_quest") === true);
  check("location restored", loaded.state.location.mapId === "cornelia" && loaded.state.location.facing === "N" && loaded.state.location.x === 5);
  check("story phase restored", loaded.state.getStoryPhase() === 3);
  check("gold restored", loaded.party.gold === 500);

  const hero = loaded.party.members[0];
  check("class restored", hero.classId === "warrior");
  check("level restored", hero.level === 5);
  check("xp restored", hero.xp === 1200);
  check("hp preserved", hero.hp === hero.getStats().maxHp - 15);
  check("statuses restored", hero.hasStatus("poison") === true);
  check("equipment restored", hero.equipment.weapon === "ironSword" && hero.equipment.armor === "chain");
  // The Iron Set (ironSword + chain) bonus +1 DEF is composed in by the page
  // wiring, so the exact value includes it.
  check("equipment stats re-derived", hero.getStats().atk === 8 && hero.getStats().def === 8 + 3 * 4 + 7 + 1);
  check("reserve restored", loaded.party.reserve.length === 1 && loaded.party.reserve[0].classId === "whiteMage");
  check("inventory restored", loaded.inventory.has("potion", 3) && loaded.inventory.has("crystalKey"));

  const loaded2 = deserializeGame(serializeGame(loaded));
  check("round-trip stable", loaded2.state.getFlag("king_met") && loaded2.party.gold === 500 && loaded2.party.members[0].level === 5 && loaded2.party.members[0].equipment.weapon === "ironSword");

  // SaveManager with fake storage
  const fakeStorage = {
    setItem(k, v) {
      fakeStorage[k] = v;
    },
    getItem(k) {
      return k in fakeStorage ? fakeStorage[k] : null;
    },
    removeItem(k) {
      delete fakeStorage[k];
    },
  };
  const sm = new SaveManager({ storage: fakeStorage });
  sm.save("1", game);
  check("storage-backed save", sm.has("1") === true);
  check("slots listed", sm.slots().includes("1"));
  const loadedSave = sm.load("1");
  check("storage-backed load", loadedSave.state.getFlag("king_met") === true && loadedSave.party.gold === 500);
  sm.delete("1");
  check("storage-backed delete", sm.has("1") === false);

  const mem = new SaveManager();
  mem.save("a", game);
  check("memory save", mem.slots().length === 1);
  check("memory load", mem.load("a").party.gold === 500);
  check("missing slot null", mem.load("zzz") === null);
  check("loadJson works", mem.loadJson(mem.save("b", game)).party.members.length === 2);

  let threw = false;
  try {
    deserializeGame("{not valid json");
  } catch (e) {
    threw = true;
  }
  check("invalid json throws", threw === true);

  return out;
}
