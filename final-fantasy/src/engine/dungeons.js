// Task #53: Dungeon Level Transition Logic — multi-level dungeons where
// stair tiles and exit tiles link different map ids through the shared
// TransitionManager (preserving the player's return point).

export class DungeonSystem {
  constructor(dungeons = {}, opts = {}) {
    this.dungeons = dungeons;
    this.transitions = opts.transitions ?? null;
    this.maps = opts.maps ?? null;
    this.current = null; // { dungeonId, levelIndex }
  }

  def(dungeonId) {
    return this.dungeons[dungeonId] ?? null;
  }

  ids() {
    return Object.keys(this.dungeons);
  }

  dungeonForMap(mapId) {
    for (const d of Object.values(this.dungeons)) {
      if (d.levels.some((l) => l.mapId === mapId)) return d;
    }
    return null;
  }

  levels(dungeonId) {
    const d = this.def(dungeonId);
    return d ? [...d.levels] : [];
  }

  levelIndex(dungeonId, mapId) {
    const d = this.def(dungeonId);
    if (!d) return -1;
    return d.levels.findIndex((l) => l.mapId === mapId);
  }

  levelOf(dungeonId, mapId) {
    const i = this.levelIndex(dungeonId, mapId);
    return i === -1 ? null : { index: i, ...this.levels(dungeonId)[i] };
  }

  totalLevels(dungeonId) {
    return this.levels(dungeonId).length;
  }

  isLowestLevel(dungeonId, mapId) {
    return this.levelIndex(dungeonId, mapId) === this.levels(dungeonId).length - 1;
  }

  isTopLevel(dungeonId, mapId) {
    return this.levelIndex(dungeonId, mapId) === 0;
  }

  stairAt(dungeonId, mapId, x, y) {
    const d = this.def(dungeonId);
    if (!d) return null;
    return d.stairs.find((s) => s.fromMap === mapId && s.x === x && s.y === y) ?? null;
  }

  exitAt(dungeonId, mapId, x, y) {
    const d = this.def(dungeonId);
    if (!d) return null;
    return d.exits.find((e) => e.mapId === mapId && e.x === x && e.y === y) ?? null;
  }

  // Use a stair tile: move to the linked level's map, tracking current level.
  useStairs(dungeonId, mapId, x, y) {
    const d = this.def(dungeonId);
    const s = this.stairAt(dungeonId, mapId, x, y);
    if (!d || !s) return null;
    const from = { mapId, x, y };
    const to = { mapId: s.toMap, x: s.toX, y: s.toY, facing: s.facing ?? "S" };
    if (this.transitions) this.transitions.transitionTo(to.mapId, to.x, to.y, to.facing);
    this.current = { dungeonId, levelIndex: this.levelIndex(dungeonId, to.mapId) };
    return { from, to, stair: s.id, level: s.level, dungeon: d.name };
  }

  // Leave the dungeon from an exit tile back to the outside map.
  exit(dungeonId, mapId, x, y) {
    const d = this.def(dungeonId);
    const e = this.exitAt(dungeonId, mapId, x, y);
    if (!d || !e) return null;
    const from = { mapId, x, y };
    const to = { mapId: e.toMap, x: e.toX, y: e.toY, facing: e.facing ?? "S" };
    if (this.transitions) this.transitions.transitionTo(to.mapId, to.x, to.y, to.facing);
    const exited = this.current;
    this.current = null;
    return { from, to, exit: true, dungeon: d.name, previousLevel: exited?.levelIndex ?? null };
  }

  // Register every stair and exit as a TransitionManager link.
  registerTransitions(transitions) {
    for (const d of Object.values(this.dungeons)) {
      for (const s of d.stairs) {
        transitions.addLink({ fromMap: s.fromMap, fromX: s.x, fromY: s.y, toMap: s.toMap, toX: s.toX, toY: s.toY, facing: s.facing ?? "S" });
      }
      for (const e of d.exits) {
        transitions.addLink({ fromMap: e.mapId, fromX: e.x, fromY: e.y, toMap: e.toMap, toX: e.toX, toY: e.toY, facing: e.facing ?? "S" });
      }
    }
    return this;
  }

  currentDungeon() {
    return this.current ? this.def(this.current.dungeonId) : null;
  }

  currentLevel() {
    if (!this.current) return null;
    const d = this.def(this.current.dungeonId);
    return d ? d.levels[this.current.levelIndex] ?? null : null;
  }

  currentLevelName() {
    return this.currentLevel()?.name ?? null;
  }

  reset() {
    this.current = null;
    return this;
  }
}
