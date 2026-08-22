// Validation tests for Task #112: rare chest item rolls.

import { ChestSystem } from "../engine/chests.js";
import { CHESTS } from "../data/chests.js";
import { GameState } from "../engine/state.js";

const SHOWN = (name, ok, extra) => ({ name, ok: !!ok, extra: String(extra) });

function make(chests, random) {
  const state = new GameState();
  const granted = [];
  const overflow = [];
  const inventory = {
    add(item, count) {
      if (item === "overflowTest") return false;
      granted.push({ itemId: item, count });
      return true;
    },
  };
  const party = { gold: 0, xp: 0, addGold(n) { this.gold += n; }, grantXp(n) { this.xp += n; } };
  const sys = new ChestSystem(chests, { state, inventory, party, random: random ?? Math.random });
  return { state, inventory, party, granted, overflow, sys };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push(SHOWN(name, ok, extra));
    if (ok) out.passed++;
    else out.failed++;
  };

  const guaranteed = [{
    id: "test_rare", mapId: "cornelia", x: 1, y: 1,
    contents: { items: [{ itemId: "potion", count: 1 }], gold: 5 },
    rare: { itemId: "phoenixDown", count: 2, chance: 1 },
    flag: "chest_test_rare_opened",
  }];
  const r = make(guaranteed, () => 0.999);
  const res = r.sys.open("cornelia", 1, 1);
  check("chance 1 rare always granted", res.rare?.itemId === "phoenixDown" && res.rare?.count === 2);
  check("rare added to inventory", r.granted.some((g) => g.itemId === "phoenixDown"));
  check("chest flagged opened", r.state.getFlag("chest_test_rare_opened") === true);

  const never = [{
    id: "test_norare", mapId: "cornelia", x: 2, y: 2,
    contents: { items: [{ itemId: "potion", count: 1 }] },
    rare: { itemId: "phoenixDown", count: 1, chance: 0 },
    flag: "chest_test_norare_opened",
  }];
  const n = make(never, () => 0.5);
  check("chance 0 rare never rolls", n.sys.rollRare(never[0].rare) === null);
  const nres = n.sys.open("cornelia", 2, 2);
  check("chance 0 rare absent from open result", nres.rare === null);
  check("no rare granted to inventory", n.granted.every((g) => g.itemId !== "phoenixDown"));

  const partial = [{
    id: "test_partial", mapId: "cornelia", x: 3, y: 3,
    contents: { items: [{ itemId: "potion", count: 1 }] },
    rare: { itemId: "phoenixDown", count: 1, chance: 0.5 },
    flag: "chest_test_partial_opened",
  }];
  const pWin = make(partial, () => 0.2);
  check("below chance grants", pWin.sys.open("cornelia", 3, 3).rare !== null);
  const pLose = make(partial, () => 0.9);
  check("above chance skips", pLose.sys.open("cornelia", 3, 3).rare === null);

  const twice = make(guaranteed, () => 0.999);
  twice.sys.open("cornelia", 1, 1);
  const again = twice.sys.open("cornelia", 1, 1);
  check("already-opened chest not re-rolled", again.ok === false && again.error === "already opened");

  const overflowChest = [{
    id: "test_overflow", mapId: "cornelia", x: 4, y: 4,
    contents: { items: [{ itemId: "overflowTest", count: 1 }] },
    rare: { itemId: "overflowTest", count: 1, chance: 1 },
    flag: "chest_test_overflow_opened",
  }];
  const ov = make(overflowChest, () => 0.999);
  const ores = ov.sys.open("cornelia", 4, 4);
  check("overflow rare goes to overflow list", ores.overflow.some((g) => g.itemId === "overflowTest"));
  check("overflow rare not granted", ores.rare === null);

  check("rollRare(null) returns null", make([], () => 0.1).sys.rollRare(null) === null);

  check("real CHESTS have rare chests", CHESTS.some((c) => c.rare));
  for (const c of CHESTS) {
    if (c.rare) {
      check("rare chest " + c.id + " item+c chance sane", typeof c.rare.itemId === "string" && c.rare.chance > 0 && c.rare.chance <= 1);
    }
  }

  return out;
}
