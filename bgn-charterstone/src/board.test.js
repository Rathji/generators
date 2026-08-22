// src/board.test.js — Task 1 validation suite for src/board.js.
// Run in-page via ?test=board, or programmatically via window.__loadBoardTests().

import { createBoard, COMMONS_BUILDINGS, CHARTER_RING, hexRingDistance, hexKey } from "./board.js";

export function runBoardTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };
  const sortedKeys = cells => cells.map(c => c.key).sort().join(",");
  const sorted = arr => [...arr].sort();

  const board = createBoard();

  // ── structure ──
  const centre = board.cellAt(0, 0);
  ok("commons centre exists at (0,0)", !!centre && centre.type === "commons");

  const commons = board.commonsBuildings();
  ok("six commons buildings", commons.length === 6);
  ok("commons building ids are canonical", commons.map(b => b.buildingId).join(",") === COMMONS_BUILDINGS.join(","));
  ok("commons buildings sit on ring 1", commons.every(b => hexRingDistance(b.cell.q, b.cell.r) === 1));
  ok("commons positions are distinct", new Set(commons.map(b => b.cell.key)).size === 6);

  const dests = board.destinationCells();
  ok("24 destination spaces", dests.length === 24);
  ok("destinations lie on rings 2..3", dests.every(c => hexRingDistance(c.q, c.r) >= 2 && hexRingDistance(c.q, c.r) <= 3));

  ok("six charter anchors", board.charters.length === 6);
  ok("charter anchors lie on ring " + CHARTER_RING, board.charters.every(ch => hexRingDistance(ch.cell.q, ch.cell.r) === CHARTER_RING));
  ok("charter anchor cells are distinct", new Set(board.charters.map(ch => ch.cell.key)).size === 6);

  // ── adjacency queries ──
  const centreNeighbours = board.neighborsOf(centre);
  ok("neighbours of the centre are the six commons buildings",
    centreNeighbours.length === 6 && centreNeighbours.every(c => c.type === "commonsBuilding"));

  ok("destination↔destination adjacency is symmetric",
    board.isAdjacent("1,1", "2,0") && board.isAdjacent("2,0", "1,1"));

  ok("adjacentDestinations returns exactly the destination neighbours of (1,1)",
    sortedKeys(board.adjacentDestinations("1,1")) === "0,2,1,2,2,0,2,1");

  ok("charter 0 adjacency set is exactly its 3 destinations",
    sortedKeys(board.adjacentDestinationsOfCharter(0)) === "2,0,2,1,3,-1");

  ok("every charter touches exactly 3 destinations",
    board.charters.every(ch => board.adjacentDestinations(ch.cell).length === 3));

  // ── construction & immutability ──
  const placed = board.placeBuilding("1,1", "sawmill", "p0");
  ok("placeBuilding succeeds on an empty destination", placed.buildingId === "sawmill" && placed.ownerId === "p0");
  ok("buildingAt returns the placed building", board.buildingAt("1,1") === "sawmill");
  ok("ownerAt returns the placed owner", board.ownerAt("1,1") === "p0");
  ok("second placement on the same cell is rejected", throws(() => board.placeBuilding("1,1", "mill2")));

  ok("commons centre rejects construction", throws(() => board.placeBuilding("0,0", "x")));
  ok("commons building cells reject construction", throws(() => board.placeBuilding("1,0", "x")));
  ok("charter anchor cells reject construction", throws(() => board.placeBuilding("3,0", "x")));
  ok("off-board cells reject construction", throws(() => board.placeBuilding("9,9", "x")));
  ok("unknown cell key resolves to undefined", board.cell("9,9") === undefined);

  ok("destination↔building query sees a constructed building with its owner",
    board.buildingsAdjacentTo("1,0").some(b => b.buildingId === "sawmill" && b.ownerId === "p0" && !b.commons));

  ok("commons buildings appear in the adjacent-buildings query flagged as commons",
    board.buildingsAdjacentTo("1,1").some(b => b.buildingId === "grandstand" && b.commons));

  ok("legalConstructionCellsForCharter(0) returns exactly its 3 empty destinations",
    sortedKeys(board.legalConstructionCellsForCharter(0)) === "2,0,2,1,3,-1");

  ok("legalConstructionCells excludes occupied destinations",
    sortedKeys(board.legalConstructionCells("2,0")) === "2,-1,2,1,3,-1");

  board.removeBuilding("1,1");
  ok("removeBuilding clears the cell", board.buildingAt("1,1") === null && board.ownerAt("1,1") === null);
  ok("removing an already-empty cell is rejected", throws(() => board.removeBuilding("1,1")));

  board.placeBuilding("1,1", "sawmill", "p0");
  const built = board.constructedBuildings();
  ok("constructedBuildings lists placed buildings with owners",
    built.some(b => b.buildingId === "sawmill" && b.ownerId === "p0"));
  ok("buildingsByOwner returns only that owner's buildings",
    board.buildingsByOwner("p0").length === 1 && board.buildingsByOwner("nobody").length === 0);

  // ── configuration ──
  const big = createBoard({ destinationRings: [2, 3, 4] });
  ok("larger destination config is respected", big.destinationCells().length === 48);
  ok("every charter has destinations on any valid config",
    big.charters.every(ch => big.adjacentDestinations(ch.cell).length >= 1));
  ok("config missing the charter ring is rejected", throws(() => createBoard({ destinationRings: [2] })));
  ok("config with duplicate rings is harmless", createBoard({ destinationRings: [2, 3, 2, 3] }).destinationCells().length === 24);
  ok("config with a bad ring is rejected", throws(() => createBoard({ destinationRings: [1, 3] })));

  const pass = results.filter(r => r.pass).length;
  const fail = results.length - pass;
  return { suite: "board", pass, fail, results };
}

export function boardTestSummary() {
  const r = runBoardTests();
  return r.suite + ": " + r.pass + " passed, " + r.fail + " failed";
}
