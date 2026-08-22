// Validation tests for Task #124: save file compatibility / versioning.

import { SaveCompatibilitySystem } from "../engine/save-compat.js";
import { SAVE_VERSION } from "../engine/save.js";
import { serializeGame, deserializeGame } from "../engine/save.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";

function freshGame() {
  const state = new GameState();
  state.setFlag("story_started", true);
  const party = new PartyManager({ gold: 250 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior", level: 3 });
  hero.damage(5);
  party.add(hero);
  const inventory = new Inventory();
  inventory.add("potion", 3);
  state.setParty(party);
  state.setInventory(inventory);
  return { state, party, inventory };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const compat = new SaveCompatibilitySystem();

  const game = freshGame();
  const json = serializeGame(game);
  const data = JSON.parse(json);
  check("current saves carry SAVE_VERSION", data.version === SAVE_VERSION);

  const i = compat.inspect(json);
  check("inspect current save", i.ok === true && i.version === SAVE_VERSION && i.compatible === true);
  check("inspect fields", i.partyCount === 1 && i.inventoryCount === 1 && i.gold === 250);
  check("check current ok", compat.check(json).ok === true);
  check("isCurrent", compat.isCurrent(json) === true);

  check("corrupt json flagged", compat.inspect("{nope").ok === false);

  const future = JSON.stringify({ ...data, version: 99 });
  check("future version incompatible", compat.check(future).ok === false);
  const mig = compat.migrate(future);
  check("future version refuses migration", mig.ok === false);

  // v1-style save (no meta/reserve) migrates to current cleanly.
  const v1 = JSON.stringify({
    version: 1,
    savedAt: 123,
    state: data.state,
    gold: 100,
    party: data.party,
    inventory: data.inventory,
  });
  const v1i = compat.inspect(v1);
  check("v1 inspected as migratable", v1i.ok === true && v1i.version === 1 && v1i.compatible === true && v1i.migratable === true);
  const m1 = compat.migrate(v1);
  check("v1 migrates to current", m1.ok === true && m1.version === SAVE_VERSION && m1.migrated === true);
  check("migration adds meta + reserve", m1.data.meta === null && Array.isArray(m1.data.reserve));
  check("migration preserves gold", m1.data.gold === 100);
  const reloaded = deserializeGame(JSON.stringify(m1.data));
  check("migrated save loads", reloaded.party.gold === 100 && reloaded.party.members.length === 1);
  check("migrated save keeps flags", reloaded.state.getFlag("story_started") === true);

  const current = compat.migrate(json);
  check("current save migration identity", current.ok === true && current.migrated === false);

  check("unknown version 0 flagged", compat.inspect(JSON.stringify({ version: 0 })).compatible === false);

  const rt = deserializeGame(json);
  check("round-trip preserves hp + items", rt.party.members[0].hp === game.party.members[0].hp && rt.inventory.count("potion") === 3);

  return out;
}
