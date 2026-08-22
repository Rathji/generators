// src/economy.test.js — Task 2 validation suite for src/economy.js.
// Run in-page via ?test=economy, or programmatically via window.__loadEconomyTests().

import { createEconomy, RESOURCE_TYPES, CURRENCY, ITEMS } from "./economy.js";

export function runEconomyTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };
  const sumItems = items => Object.values(items).reduce((a, b) => a + b, 0);
  const resourceSum = items => sumItems(Object.fromEntries(Object.entries(items).filter(([k]) => k !== CURRENCY)));

  const eco = createEconomy();

  // ── structure ──
  ok("six resource types", eco.resourceTypes.length === 6);
  ok("resource types are the canonical six", eco.resourceTypes.join(",") === "metal,coal,pumpkin,grain,clay,wood");
  ok("resource types are exported and frozen", RESOURCE_TYPES.length === 6 && eco.items.length === 7);
  ok("coins is the currency", CURRENCY === "coins" && eco.items[0] === "coins");
  ok("items list is coins + resources", eco.items.join(",") === ITEMS.join(","));
  ok("general supply starts with 36 coins", eco.generalItems().coins === 36);
  ok("general supply holds 72 resource tokens", resourceSum(eco.generalItems()) === 72);
  ok("each resource type starts with 12", Object.values(eco.resourceTypes).every(r => eco.generalItems()[r] === 12));
  ok("initial totals sum to 108 tokens", sumItems(eco.initialTotals()) === 108);

  // ── players ──
  eco.addPlayer("p0");
  eco.addPlayer("p1");
  ok("new player starts with an empty supply", sumItems(eco.balance("p0")) === 0 && eco.balance("p0").coins === 0);
  ok("duplicate player is rejected", throws(() => eco.addPlayer("p0")));
  ok("unknown player operations throw", throws(() => eco.gain("ghost", { coins: 1 })) && throws(() => eco.pay("ghost", { coins: 1 })) && throws(() => eco.balance("ghost")));
  ok("hasPlayer and playerIds reflect registered players", eco.hasPlayer("p0") && !eco.hasPlayer("ghost") && eco.playerIds().length === 2);

  // ── gain ──
  let r = eco.gain("p0", { coins: 5 });
  ok("simple gain succeeds without shortfall", r.ok && r.granted.coins === 5 && !r.hasShortfall);
  ok("general supply decreases by the granted amount", eco.generalItems().coins === 31);
  ok("player balance increases by the granted amount", eco.balance("p0").coins === 5);

  r = eco.gain("p0", { metal: 12 });
  ok("gaining the full pool of a resource succeeds", r.ok && r.granted.metal === 12 && !r.hasShortfall);
  r = eco.gain("p0", { metal: 5 });
  ok("gaining from an exhausted resource grants 0 with a shortfall flag", r.ok && r.granted.metal === 0 && r.shortfall.metal === 5 && r.hasShortfall);
  ok("exhausted general supply stays at 0, never negative", eco.generalItems().metal === 0);

  r = eco.gain("p0", { coins: 40 });
  ok("partial gain grants only what remains and flags the shortfall", r.granted.coins === 31 && r.shortfall.coins === 9 && r.hasShortfall && eco.generalItems().coins === 0 && eco.balance("p0").coins === 36);

  r = eco.gain("p1", { coal: 5, clay: 100 });
  ok("mixed gain handles per-item shortfall", r.granted.coal === 5 && r.granted.clay === 12 && r.shortfall.clay === 88 && r.shortfall.coal === 0 && r.hasShortfall);

  // ── never negative ──
  const allSupplies = [eco.generalItems(), eco.balance("p0"), eco.balance("p1")];
  ok("no supply ever goes negative", allSupplies.every(s => Object.values(s).every(v => v >= 0)));

  // ── pay ──
  r = eco.pay("p1", { coal: 3 });
  ok("simple pay moves tokens to the general supply", r.ok && eco.balance("p1").coal === 2 && eco.generalItems().coal === 10);
  r = eco.pay("p1", { coal: 99 });
  ok("insufficient pay is rejected without partial state change", !r.ok && r.reason === "insufficient" && r.missing.coal === 97 && eco.balance("p1").coal === 2 && eco.generalItems().coal === 10);
  r = eco.pay("p1", { wood: 1, grain: 1 });
  ok("multi-item insufficient pay reports every missing item", !r.ok && r.missing.wood === 1 && r.missing.grain === 1);
  ok("canPay reflects affordability", eco.canPay("p1", { coal: 2 }) && !eco.canPay("p1", { coal: 3 }));

  // ── validation ──
  ok("unknown item on gain throws", throws(() => eco.gain("p0", { gems: 1 })));
  ok("unknown item on pay throws", throws(() => eco.pay("p0", { gems: 1 })));
  ok("negative quantity throws", throws(() => eco.gain("p0", { coins: -1 })));
  ok("non-integer quantity throws", throws(() => eco.gain("p0", { coins: 1.5 })));
  ok("null items throw", throws(() => eco.gain("p0", null)));

  // ── conservation ──
  ok("totals conserve exactly across all operations", JSON.stringify(eco.totals()) === JSON.stringify(eco.initialTotals()));
  ok("total token count is conserved", sumItems(eco.totals()) === 108);

  // ── isolation & copies ──
  eco.gain("p1", { grain: 2 });
  ok("players' supplies are independent", eco.balance("p0").grain === 0 && eco.balance("p1").grain === 2);
  const snap = eco.balance("p0");
  snap.metal = -999;
  ok("balance returns a copy, not internal state", eco.balance("p0").metal === 12);

  // ── custom config ──
  const custom = createEconomy({ coins: 10, resourceCounts: { metal: 4, coal: 4, pumpkin: 4, grain: 4, clay: 4, wood: 4 } });
  ok("custom config respected", custom.generalItems().coins === 10 && custom.generalItems().metal === 4 && resourceSum(custom.generalItems()) === 24);
  const numeric = createEconomy({ resourceCounts: 8 });
  ok("numeric resourceCounts applies to every resource type", numeric.generalItems().metal === 8 && numeric.generalItems().wood === 8);
  ok("bad coin config rejected", throws(() => createEconomy({ coins: -5 })));
  ok("bad resource config rejected", throws(() => createEconomy({ resourceCounts: { metal: -1 } })));
  const customTypes = createEconomy({ resourceTypes: ["metal", "wood"] });
  ok("custom resource types respected", customTypes.items.join(",") === "coins,metal,wood" && customTypes.generalItems().wood === 12);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "economy", pass, fail, results };
}
