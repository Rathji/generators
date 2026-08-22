// src/board.js — Charterstone hex-grid board model (Task 1).
// Axial coordinates (q, r). Ring distance: max(|q|,|r|,|q+r|).
// Layout: (0,0) commons centre · ring 1 = The Commons (six fixed, immutable
// buildings) · rings 2..3 = destination spaces · six charter anchors on ring 3
// cardinal cells (3,0),(3,-3),(0,-3),(-3,0),(-3,3),(0,3), each adjacent to
// exactly 3 destinations. Geometry contract: src/roadmap.pjs appendix.

export const COMMONS_BUILDINGS = ["zeppelin", "charterstone", "grandstand", "treasury", "market", "cloudport"];
export const CHARTER_RING = 3;

const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function hexRingDistance(q, r) {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

export function hexKey(q, r) {
  return q + "," + r;
}

function hexRingCells(r) {
  if (r === 0) return [{ q: 0, r: 0 }];
  const cells = [];
  let q = -r, rr = r;
  for (let d = 0; d < 6; d++) {
    for (let step = 0; step < r; step++) {
      cells.push({ q, r: rr });
      q += HEX_DIRS[d][0];
      rr += HEX_DIRS[d][1];
    }
  }
  return cells;
}

function charterAnchorCells(ring) {
  return HEX_DIRS.map(([dq, dr]) => ({ q: dq * ring, r: dr * ring }));
}

export function createBoard(config = {}) {
  const destinationRings = [...new Set(config.destinationRings ?? [2, 3])];
  if (!destinationRings.includes(CHARTER_RING)) {
    throw new Error("board: destinationRings must include ring " + CHARTER_RING);
  }
  for (const ring of destinationRings) {
    if (!Number.isInteger(ring) || ring < 2) {
      throw new Error("board: destinationRings must be integers >= 2");
    }
  }

  const cells = new Map();
  const anchorCells = charterAnchorCells(CHARTER_RING);
  const anchorKeys = new Set(anchorCells.map(a => hexKey(a.q, a.r)));

  function addCell(q, r, type) {
    const k = hexKey(q, r);
    const cell = { key: k, q, r, type, buildingId: null, ownerId: null, charterId: null, workerId: null };
    cells.set(k, cell);
    return cell;
  }

  addCell(0, 0, "commons");
  hexRingCells(1).forEach((c, i) => {
    const cell = addCell(c.q, c.r, "commonsBuilding");
    cell.buildingId = COMMONS_BUILDINGS[i];
  });
  for (const ring of destinationRings) {
    for (const c of hexRingCells(ring)) {
      if (anchorKeys.has(hexKey(c.q, c.r))) continue;
      addCell(c.q, c.r, "destination");
    }
  }
  const charters = anchorCells.map((a, i) => {
    const cell = addCell(a.q, a.r, "charter");
    cell.charterId = i;
    return { id: i, cell };
  });

  function resolveCell(ref) {
    if (typeof ref === "string") return cells.get(ref);
    return ref;
  }

  const board = {
    cells,
    destinationRings: [...destinationRings],
    charters,

    cell(a, b) {
      return b === undefined ? cells.get(a) : cells.get(hexKey(a, b));
    },
    cellAt(q, r) {
      return cells.get(hexKey(q, r));
    },
    charterCell(id) {
      const ch = board.charters[id];
      return ch ? ch.cell : null;
    },
    neighborsOf(cell) {
      const out = [];
      for (const [dq, dr] of HEX_DIRS) {
        const n = cells.get(hexKey(cell.q + dq, cell.r + dr));
        if (n) out.push(n);
      }
      return out;
    },
    isAdjacent(a, b) {
      const ca = resolveCell(a);
      const cb = resolveCell(b);
      if (!ca || !cb) return false;
      return board.neighborsOf(ca).some(n => n.key === cb.key);
    },
    adjacentDestinations(cellRef) {
      const cell = resolveCell(cellRef);
      if (!cell) return [];
      return board.neighborsOf(cell).filter(n => n.type === "destination");
    },
    adjacentDestinationsOfCharter(id) {
      const cell = board.charterCell(id);
      return cell ? board.adjacentDestinations(cell) : [];
    },
    buildingsAdjacentTo(cellRef) {
      const cell = resolveCell(cellRef);
      if (!cell) return [];
      return board.neighborsOf(cell)
        .filter(n => n.buildingId)
        .map(n => ({ cell: n, buildingId: n.buildingId, ownerId: n.ownerId, commons: n.type === "commonsBuilding" }));
    },
    legalConstructionCells(cellRef) {
      return board.adjacentDestinations(cellRef).filter(d => !d.buildingId);
    },
    legalConstructionCellsForCharter(id) {
      return board.legalConstructionCells(board.charterCell(id));
    },
    legalConstructionCellsForOwner(ownerId, charterId) {
      const keys = new Set();
      for (const d of board.legalConstructionCellsForCharter(charterId)) keys.add(d.key);
      for (const b of board.buildingsByOwner(ownerId)) {
        for (const d of board.legalConstructionCells(b.cell)) keys.add(d.key);
      }
      return [...keys].map(k => cells.get(k)).filter(Boolean);
    },
    isLegalConstructionCellForOwner(ownerId, charterId, cellRef) {
      const cell = resolveCell(cellRef);
      if (!cell || !board.isConstructable(cell)) return false;
      return board.legalConstructionCellsForOwner(ownerId, charterId).some(c => c.key === cell.key);
    },
    isConstructable(cellRef) {
      const cell = resolveCell(cellRef);
      return !!cell && cell.type === "destination" && !cell.buildingId;
    },
    placeBuilding(cellRef, buildingId, ownerId = null) {
      const cell = resolveCell(cellRef);
      if (!cell) throw new Error("board: no such cell " + cellRef);
      if (cell.type !== "destination") {
        throw new Error("board: cell " + cell.key + " (" + cell.type + ") is not constructable");
      }
      if (cell.buildingId) throw new Error("board: cell " + cell.key + " is already occupied");
      cell.buildingId = buildingId;
      cell.ownerId = ownerId;
      return cell;
    },
    removeBuilding(cellRef) {
      const cell = resolveCell(cellRef);
      if (!cell || !cell.buildingId) throw new Error("board: no building to remove at " + (cell ? cell.key : cellRef));
      if (cell.type === "commonsBuilding") {
        throw new Error("board: The Commons building at " + cell.key + " cannot be removed");
      }
      cell.buildingId = null;
      cell.ownerId = null;
      return cell;
    },
    buildingAt(cellRef) {
      const cell = resolveCell(cellRef);
      return cell ? cell.buildingId : null;
    },
    ownerAt(cellRef) {
      const cell = resolveCell(cellRef);
      return cell ? cell.ownerId : null;
    },
    destinationCells() {
      return [...cells.values()].filter(c => c.type === "destination");
    },
    commonsBuildings() {
      return [...cells.values()]
        .filter(c => c.type === "commonsBuilding")
        .sort((a, b) => COMMONS_BUILDINGS.indexOf(a.buildingId) - COMMONS_BUILDINGS.indexOf(b.buildingId))
        .map(c => ({ cell: c, buildingId: c.buildingId }));
    },
    commonsCenter() {
      return cells.get("0,0");
    },
    constructedBuildings() {
      return [...cells.values()]
        .filter(c => c.type === "destination" && c.buildingId)
        .map(c => ({ cell: c, buildingId: c.buildingId, ownerId: c.ownerId }));
    },
    buildingsByOwner(ownerId) {
      return board.constructedBuildings().filter(b => b.ownerId === ownerId);
    },

    workerAt(cellRef) {
      const cell = resolveCell(cellRef);
      return cell ? cell.workerId : null;
    },
    placeWorker(cellRef, playerId) {
      const cell = resolveCell(cellRef);
      if (!cell) throw new Error("board: no such cell " + cellRef);
      if (!cell.buildingId) throw new Error("board: cell " + cell.key + " has no building to place a worker on");
      cell.workerId = playerId;
      return cell;
    },
    removeWorker(cellRef) {
      const cell = resolveCell(cellRef);
      if (!cell) throw new Error("board: no such cell " + cellRef);
      cell.workerId = null;
      return cell;
    },
    workerCells() {
      return [...cells.values()].filter(c => c.workerId !== null);
    },
    workerCellsOf(playerId) {
      return [...cells.values()].filter(c => c.workerId === playerId);
    },

    toJSON() {
      const cellsData = {};
      for (const [key, cell] of cells.entries()) {
        cellsData[key] = { q: cell.q, r: cell.r, type: cell.type, buildingId: cell.buildingId, ownerId: cell.ownerId, charterId: cell.charterId, workerId: cell.workerId };
      }
      return { kind: "board", destinationRings: [...destinationRings], cells: cellsData };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("board: bad fromJSON payload");
      for (const [key, saved] of Object.entries(data.cells ?? {})) {
        const cell = cells.get(key);
        if (!cell) throw new Error("board: saved state references unknown cell '" + key + "'");
        cell.buildingId = saved.buildingId ?? null;
        cell.ownerId = saved.ownerId ?? null;
        cell.charterId = saved.charterId ?? null;
        cell.workerId = saved.workerId ?? null;
      }
      return board;
    },
  };
  return board;
}
