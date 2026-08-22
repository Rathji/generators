// Validation tests for Task #16: Key Item Gate System.

import { GateSystem } from "../engine/gates.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const world = { getFlag: (n) => n === "bridge_open", hasItem: (n) => n === "crystalKey" };
  const gates = new GateSystem(world);
  gates.add({ id: "elfheim_gate", mapId: "overworld", x: 14, y: 9, require: { item: "crystalKey" }, deniedDialogue: "You need the Crystal Key." });
  gates.add({ id: "bridge", mapId: "overworld", x: 6, y: 6, require: { flag: "bridge_open" } });
  gates.add({ id: "no_req", mapId: "overworld", x: 2, y: 2 });

  check("item gate allows with item", gates.canPass("overworld", 14, 9).allowed === true);

  const poorWorld = { getFlag: () => false, hasItem: () => false };
  const gates2 = new GateSystem(poorWorld);
  gates2.add({ id: "elfheim_gate", mapId: "overworld", x: 14, y: 9, require: { item: "crystalKey" }, deniedDialogue: "You need the Crystal Key." });
  const denied = gates2.canPass("overworld", 14, 9);
  check("item gate denies without item", denied.allowed === false && denied.gate.id === "elfheim_gate");
  check("denial reason given", denied.reason === "You need the Crystal Key.");

  check("flag gate allows", gates.canPass("overworld", 6, 6).allowed === true);
  const gates3 = new GateSystem({ getFlag: () => false, hasItem: () => false });
  gates3.add({ id: "bridge", mapId: "overworld", x: 6, y: 6, require: { flag: "bridge_open" } });
  check("flag gate denies", gates3.canPass("overworld", 6, 6).allowed === false);

  check("ungated tile allows", gates.canPass("overworld", 3, 3).allowed === true && gates.canPass("overworld", 3, 3).gate === null);
  check("unrestricted gate allows", gates.canPass("overworld", 2, 2).allowed === true && gates.canPass("overworld", 2, 2).gate.id === "no_req");
  check("wrong map no gate", gates.canPass("cornelia", 14, 9).allowed === true);

  const unbound = new GateSystem();
  unbound.add({ id: "g", mapId: "m", x: 1, y: 1, require: { item: "crystalKey" } });
  check("unbound world denies item gate", unbound.canPass("m", 1, 1).allowed === false);
  unbound.bindWorld({ hasItem: () => true, getFlag: () => false });
  check("bindWorld enables gate", unbound.canPass("m", 1, 1).allowed === true);

  const multi = new GateSystem({ getFlag: (n) => n === "a", hasItem: () => true });
  multi.add({ id: "combo", mapId: "m", x: 2, y: 2, require: { all: [{ flag: "a" }, { item: "crystalKey" }] } });
  check("composed requirement met", multi.canPass("m", 2, 2).allowed === true);
  const multiNo = new GateSystem({ getFlag: () => false, hasItem: () => true });
  multiNo.add({ id: "combo", mapId: "m", x: 2, y: 2, require: { all: [{ flag: "a" }, { item: "crystalKey" }] } });
  check("composed requirement blocks", multiNo.canPass("m", 2, 2).allowed === false);

  return out;
}
