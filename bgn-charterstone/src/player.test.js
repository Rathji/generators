// src/player.test.js — Task 3 validation suite for src/player.js.
// Run in-page via ?test=player, or programmatically via window.__loadPlayerTests().

import { createPlayer, CHARTER_COLORS, MAX_INFLUENCE, STARTING_WORKERS, GAME1_STARTING_COINS } from "./player.js";
import { createEconomy } from "./economy.js";

export function runPlayerTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };
  const sumItems = items => Object.values(items).reduce((a, b) => a + b, 0);

  // ── fresh Game-1 player state ──
  const eco = createEconomy();
  const p0 = createPlayer({ id: "p0", charterId: 2, economy: eco, startingCoins: GAME1_STARTING_COINS });
  ok("fresh Game-1 player starts with 2 workers", p0.workers === STARTING_WORKERS && p0.workers === 2);
  ok("fresh player starts with 12 influence tokens", p0.influence === MAX_INFLUENCE && p0.influence === 12);
  ok("fresh Game-1 player starts with $4", p0.coins() === GAME1_STARTING_COINS && p0.coins() === 4);
  ok("fresh player starts with 0 VP", p0.vp === 0);
  ok("fresh player starts with 0 capacity", p0.capacity === 0);
  ok("fresh player holds no cards", p0.cards.length === 0);

  // ── charter & identity ──
  ok("charterId is stored", p0.charterId === 2);
  ok("color defaults from the charter palette", p0.color === CHARTER_COLORS[2]);
  const colored = createPlayer({ id: "c1", color: "#123456" });
  ok("explicit color override is respected", colored.color === "#123456");
  ok("default charterId is 0", createPlayer({ id: "c2" }).charterId === 0);
  ok("charterId out of range is rejected", throws(() => createPlayer({ id: "c3", charterId: 6 })) && throws(() => createPlayer({ id: "c4", charterId: -1 })));
  ok("missing id is rejected", throws(() => createPlayer({})) && throws(() => createPlayer({ id: "" })));
  ok("personaId is stored when provided", createPlayer({ id: "c5", personaId: "scholar" }).personaId === "scholar");

  // ── workers ──
  const w = createPlayer({ id: "w1" });
  ok("spendWorkers decrements", w.spendWorkers(1) === 1 && w.workers === 1);
  ok("overspending workers throws", throws(() => w.spendWorkers(2)));
  ok("addWorkers increments", w.addWorkers(3) === 4 && w.workers === 4);

  // ── influence ──
  const inf = createPlayer({ id: "inf" });
  ok("spendInfluence decrements", inf.spendInfluence(3) === 9 && inf.influence === 9);
  ok("overspending influence throws", throws(() => inf.spendInfluence(10)));
  ok("gainInfluence restores", inf.gainInfluence(3) === 12 && inf.influence === 12);
  ok("gainInfluence never exceeds 12", inf.gainInfluence(50) === 12 && inf.influence === MAX_INFLUENCE);
  ok("influence above 12 at creation is rejected", throws(() => createPlayer({ id: "inf2", influence: 13 })));

  // ── VP & capacity ──
  const v = createPlayer({ id: "vp" });
  ok("addVp increments", v.addVp(5) === 5 && v.vp === 5);
  ok("negative VP is rejected", throws(() => v.addVp(-1)));
  ok("addCapacity increments", v.addCapacity(2) === 2 && v.capacity === 2);

  // ── cards ──
  const card = createPlayer({ id: "cards" });
  ok("gainCard adds and reports count", card.gainCard("b1") === 1 && card.hasCard("b1"));
  ok("duplicate card is rejected", throws(() => card.gainCard("b1")));
  ok("removeCard removes", card.removeCard("b1") === 0 && !card.hasCard("b1"));
  ok("removing an unheld card throws", throws(() => card.removeCard("nope")));
  ok("empty card id is rejected", throws(() => card.gainCard("")));

  // ── economy integration ──
  ok("player is registered in the linked economy", eco.hasPlayer("p0") && eco.balance("p0").coins === 4);
  eco.gain("p0", { wood: 3, coins: 2 });
  ok("economy gains appear in player.coins() and resources()", p0.coins() === 6 && p0.resources().wood === 3);
  ok("resources() excludes coins", !("coins" in p0.resources()));
  const noEco = createPlayer({ id: "noeco" });
  ok("player without an economy reports zero coins and empty resources", noEco.coins() === 0 && sumItems(noEco.resources()) === 0);

  // ── isolation & snapshots ──
  const eco2 = createEconomy();
  const pa = createPlayer({ id: "pa", charterId: 0, economy: eco2, startingCoins: GAME1_STARTING_COINS });
  const pb = createPlayer({ id: "pb", charterId: 3, economy: eco2, startingCoins: GAME1_STARTING_COINS });
  eco2.gain("pa", { metal: 2 });
  ok("players share the economy but keep independent supplies", pa.coins() === 4 && pb.coins() === 4 && pa.resources().metal === 2 && pb.resources().metal === 0);
  const snap = p0.snapshot();
  snap.workers = 99;
  snap.cards.push("hack");
  ok("snapshot is a detached copy", p0.workers === 2 && p0.cards.length === 0);
  ok("snapshot includes the core fields", snap.id === "p0" && snap.charterId === 2 && snap.color === CHARTER_COLORS[2] && snap.vp === 0);

  // ── validation ──
  ok("negative workers at creation is rejected", throws(() => createPlayer({ id: "x1", workers: -1 })));
  ok("negative influence at creation is rejected", throws(() => createPlayer({ id: "x2", influence: -1 })));
  ok("non-integer counts at creation are rejected", throws(() => createPlayer({ id: "x3", vp: 1.5 })));
  ok("non-integer method args are rejected", throws(() => p0.addVp(1.5)) && throws(() => p0.spendWorkers(0.5)));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "player", pass, fail, results };
}
