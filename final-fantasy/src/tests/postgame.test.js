// Validation tests for Task #163: Post-game content triggers — secret bosses
// and item hunts that unlock after the main story, with completion flags,
// rewards, hunt progress, and data audit.

import { PostGameSystem } from "../engine/postgame.js";
import { POSTGAME } from "../data/postgame.js";
import { ITEMS } from "../data/items.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";

function enemySystem() {
  return {
    template: (id) => ({ id, name: id, hp: 100 }) || null,
    exists: (id) => true,
    createEnemy: (id) => ({ id, name: id, hp: 100, maxHp: 100, str: 5, atk: 5, int: 3, agi: 5, def: 3, mdef: 3, xp: 10, gold: 10 }),
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const party = new PartyManager({ gold: 100 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const inventory = new Inventory();
  const pg = new PostGameSystem(POSTGAME, { state, party, inventory, enemySystem: enemySystem() });

  check("postgame data has content", POSTGAME.length >= 3);

  // Locked until the main story completes.
  check("locked before completion", pg.available().length === 0);
  check("encounter refused while locked", pg.encounter("echo_doppelganger").error === "locked");

  state.setFlag("game_completed", true);
  const unlocked = pg.available();
  check("echo + hunt unlock", unlocked.length === 2 && unlocked.some((d) => d.id === "echo_doppelganger") && unlocked.some((d) => d.id === "crystal_shard_hunt"));
  check("chained bosses stay locked", pg.available().every((d) => d.id !== "shadow_garland"));

  // check() reports newly available exactly once.
  const first = pg.check();
  const second = pg.check();
  check("check reports once", first.length === 2 && second.length === 0);

  // Secret boss encounter + defeat.
  const enc = pg.encounter("echo_doppelganger");
  check("encounter built", enc.ok === true && enc.enemies.length === 1 && enc.enemies[0].id === "echoOfCreation");
  const comp = pg.complete("echo_doppelganger");
  check("defeat grants reward", comp.ok === true && comp.reward.some((r) => r.xp === 3000));
  check("defeat sets flag", state.getFlag("postgame_echo_slain") === true);
  check("defeat idempotent", pg.complete("echo_doppelganger").error === "already complete");

  // Chained boss now unlocks.
  check("chained boss unlocks", pg.available().some((d) => d.id === "shadow_garland"));
  pg.complete("shadow_garland");
  check("chaos reborn unlocks", pg.available().some((d) => d.id === "chaos_reborn"));
  pg.complete("chaos_reborn");
  check("reward item granted", inventory.count("oathRing") === 1);

  // Item hunt progress.
  inventory.add("goblinFang", 2);
  const prog = pg.progress(pg.def("crystal_shard_hunt"));
  check("hunt partial progress", prog.targets[0].have === 2 && prog.targets[0].want === 5 && prog.done === false);
  check("hunt not ready", pg.huntReady(pg.def("crystal_shard_hunt")) === false);
  inventory.add("goblinFang", 3);
  inventory.add("runeShard", 3);
  inventory.add("voidShard", 2);
  check("hunt complete", pg.huntReady(pg.def("crystal_shard_hunt")) === true);
  const hunt = pg.complete("crystal_shard_hunt");
  check("hunt reward granted", hunt.ok === true && inventory.count("masamune") === 1);
  check("hunt flag set", state.getFlag("postgame_hunt_done") === true);

  // The chained ledger hunt unlocks after the first hunt.
  check("ledger hunt unlocks", pg.available().some((d) => d.id === "shadow_master_hunt"));
  for (const gem of ["fireGem", "iceGem", "thunderGem", "holyGem", "voidGem"]) inventory.add(gem, 1);
  check("ledger hunt ready", pg.huntReady(pg.def("shadow_master_hunt")) === true);
  const ledger = pg.complete("shadow_master_hunt");
  check("ledger reward granted", ledger.ok === true && inventory.count("shatteredBlade") === 1);

  // All content eventually done.
  check("everything eventually available+done", pg.available().length === 0);

  // Audit: valid references.
  check("audit clean", pg.audit(ITEMS).length === 0);
  const strictEnemies = { template: (id) => (id === "echoOfCreation" ? { id } : null), exists: () => false, createEnemy: (id) => null };
  const bad = new PostGameSystem([{ id: "x", type: "secret_boss", enemy: "nope" }, { id: "y", type: "item_hunt", targets: [{ itemId: "doesNotExist", count: 1 }] }, { id: "z", type: "bogus" }], { enemySystem: strictEnemies });
  const errs = bad.audit(ITEMS);
  check("audit catches bad refs", errs.length === 3);

  return out;
}
