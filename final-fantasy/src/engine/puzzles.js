// Task #55: Dungeon Puzzle Trigger System — switches/pressure plates that,
// when pressed enough times, open linked door tiles. Movement systems can be
// wired to the puzzle via a walkability hook so closed doors block travel.

export class PuzzleSystem {
  constructor(defs = [], opts = {}) {
    this.puzzles = defs;
    this.state = opts.state ?? null;
    this.pressed = new Map(); // puzzleId -> Set of pressed switch ids
    this.solved = new Set(); // in-memory solved puzzle ids
  }

  all() {
    return [...this.puzzles];
  }

  puzzleById(id) {
    return this.puzzles.find((p) => p.id === id) ?? null;
  }

  puzzlesFor(mapId) {
    return this.puzzles.filter((p) => p.mapId === mapId);
  }

  switchAt(mapId, x, y) {
    for (const p of this.puzzlesFor(mapId)) {
      const s = p.switches.find((sw) => sw.x === x && sw.y === y);
      if (s) return { puzzle: p, ...s };
    }
    return null;
  }

  doorAt(mapId, x, y) {
    for (const p of this.puzzlesFor(mapId)) {
      const d = p.doors.find((door) => door.x === x && door.y === y);
      if (d) return { puzzle: p, ...d };
    }
    return null;
  }

  requiredPresses(puzzle) {
    return puzzle.required ?? puzzle.switches.length;
  }

  pressedCount(puzzleId) {
    return this.pressed.get(puzzleId)?.size ?? 0;
  }

  isSolved(puzzle) {
    if (this.solved.has(puzzle.id)) return true;
    if (puzzle.flag && this.state && this.state.getFlag(puzzle.flag)) {
      this.solved.add(puzzle.id);
      return true;
    }
    return false;
  }

  isOpen(puzzle, door) {
    if (this.isSolved(puzzle)) return true;
    // Per-door override: a door may require its own flag.
    if (door.flag && this.state && this.state.getFlag(door.flag)) return true;
    return false;
  }

  isDoorOpen(puzzleId, doorIndex) {
    const p = this.puzzleById(puzzleId);
    if (!p || !p.doors[doorIndex]) return false;
    return this.isOpen(p, p.doors[doorIndex]);
  }

  // Walkability hook: return true (blocked) when the cell holds a closed door.
  blockedAt(mapId, x, y) {
    const door = this.doorAt(mapId, x, y);
    if (!door) return false;
    return !this.isOpen(door.puzzle, door);
  }

  // Build a closure suitable for MovementSystem.setWalkabilityHook.
  hookFor(mapId) {
    return (x, y) => this.blockedAt(mapId, x, y);
  }

  // Press a switch tile. When the required press count is reached the
  // puzzle's doors open (and the solved flag is persisted once).
  press(mapId, x, y) {
    const sw = this.switchAt(mapId, x, y);
    if (!sw) return { ok: false, error: "no switch here" };
    const puzzle = sw.puzzle;
    if (this.isSolved(puzzle)) return { ok: false, error: "already solved" };
    if (!this.pressed.has(puzzle.id)) this.pressed.set(puzzle.id, new Set());
    const set = this.pressed.get(puzzle.id);
    set.add(sw.id);
    const required = this.requiredPresses(puzzle);
    const count = set.size;
    const solved = count >= required;
    if (solved) {
      this.solved.add(puzzle.id);
      if (puzzle.flag && this.state) this.state.setFlag(puzzle.flag, true);
    }
    return {
      ok: true,
      puzzleId: puzzle.id,
      switchId: sw.id,
      pressed: count,
      required,
      solved,
      doorsOpened: solved ? puzzle.doors.length : 0,
    };
  }

  reset() {
    this.pressed.clear();
    this.solved.clear();
    return this;
  }
}
