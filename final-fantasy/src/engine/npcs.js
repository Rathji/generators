// Task #49: NpcPlacementSystem — resolves town NPC spawns against map
// geometry (bounds + solid tiles) and supports moving NPCs between cells.
// Task #106: quest-driven state changes — an NPC may define `states` (flag
// -gated overrides of x/y/facing/sprite/name) resolved from live world flags.
// Task #108: secret NPCs — an NPC with a `secret` discovery tile stays hidden
// until the party steps on that tile (a flag flips) and then appears.

export class NpcPlacementSystem {
  constructor(placements = {}, registry = null, opts = {}) {
    this.placements = placements;
    this.registry = registry;
    this.state = opts.state ?? null;
    this.scheduleSystem = opts.schedules ?? null; // Task #138
    this.clock = opts.clock ?? null; // Task #138
    this.invalid = [];
    this._validate();
  }

  bindRegistry(registry) {
    this.registry = registry;
    this.invalid = [];
    this._validate();
    return this;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  // Task #138: bind the schedule system (and its clock) so resolveState
  // can place NPCs by the time of day.
  bindSchedules(scheduleSystem) {
    this.scheduleSystem = scheduleSystem;
    return this;
  }

  bindClock(clock) {
    this.clock = clock;
    return this;
  }

  _charAt(def, x, y) {
    return def?.rows?.[y]?.[x];
  }

  _validate() {
    this.invalid = [];
    for (const [mapId, npcs] of Object.entries(this.placements)) {
      const def = this.registry?.get?.(mapId);
      if (!def) {
        this.invalid.push({ mapId, npcId: null, reason: "no such map" });
        continue;
      }
      const h = def.rows?.length ?? 0;
      const w = def.rows?.[0]?.length ?? 0;
      const bad = (n, x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) {
          this.invalid.push({ mapId, npcId: n.id, reason: "out of bounds" });
        } else if (def.solid?.[this._charAt(def, x, y)]) {
          this.invalid.push({ mapId, npcId: n.id, reason: "solid tile" });
        }
      };
      for (const n of npcs) {
        bad(n, n.x, n.y);
        // Task #106: state overrides are static data — validate them too.
        for (const s of n.states ?? []) {
          if (s.x != null && s.y != null) bad(n, s.x, s.y);
        }
        const sec = n.secret;
        if (sec && sec.mapId !== mapId) {
          const sdef = this.registry?.get?.(sec.mapId);
          if (sdef) {
            const sh = sdef.rows?.length ?? 0;
            const sw = sdef.rows?.[0]?.length ?? 0;
            if (sec.x < 0 || sec.y < 0 || sec.x >= sw || sec.y >= sh) {
              this.invalid.push({ mapId, npcId: n.id, reason: "secret tile out of bounds" });
            }
          }
        }
      }
    }
    return this;
  }

  get invalidPlacements() {
    return [...this.invalid];
  }

  isValid() {
    return this.invalid.length === 0;
  }

  npcsFor(mapId) {
    return [...(this.placements[mapId] ?? [])];
  }

  npcAt(mapId, x, y) {
    return this.npcsFor(mapId).find((n) => n.x === x && n.y === y) ?? null;
  }

  npcById(npcId) {
    for (const list of Object.values(this.placements)) {
      const n = list.find((x) => x.id === npcId);
      if (n) return n;
    }
    return null;
  }

  // Move an NPC to a new cell (respecting map bounds + solid tiles).
  moveNpc(mapId, npcId, x, y) {
    const n = this.npcById(npcId);
    if (!n) return { ok: false, error: "unknown npc" };
    const def = this.registry?.get?.(mapId);
    if (def) {
      const ch = this._charAt(def, x, y);
      if (ch === undefined) return { ok: false, error: "out of bounds" };
      if (def.solid?.[ch]) return { ok: false, error: "solid tile" };
    }
    n.x = x;
    n.y = y;
    return { ok: true, npc: n };
  }

  // --- Task #106: quest-driven NPC state changes ---
  // An NPC may define `states`: [{ require: {flag}, x, y, facing, sprite, name }].
  // The first state whose flag is met overrides the base placement. The base
  // def is never mutated — a resolved copy is returned.
  // Task #138: NPCs WITHOUT a pinned quest state follow the game clock via
  // the schedule system (their `schedule` array, or a def in the schedule
  // data keyed by npc id). A resolved state always pins the NPC in place.
  resolveState(npc) {
    if (!npc) return npc;
    // Task #106: quest-driven state changes — the first met state pins the
    // NPC in place (schedules never override it).
    if (Array.isArray(npc.states) && npc.states.length) {
      for (const s of npc.states) {
        if (s.require?.flag && !(this.state && this.state.getFlag(s.require.flag))) continue;
        return {
          ...npc,
          x: s.x ?? npc.x,
          y: s.y ?? npc.y,
          facing: s.facing ?? npc.facing,
          sprite: s.sprite ?? npc.sprite,
          name: s.name ?? npc.name,
          stateId: s.id ?? s.require?.flag ?? null,
        };
      }
      // No state is active — fall through so the clock schedule still plays.
    }
    // Task #138: NPCs without a pinned quest state follow the game clock via
    // the schedule system (their `schedule` array, or a def keyed by npc id).
    if (this.scheduleSystem) {
      const list = npc.schedule ?? this.scheduleSystem.def(npc.id);
      const sched = this.scheduleSystem.positionFor(npc.id, this.clock?.hour ?? 8, list);
      if (sched) {
        return {
          ...npc,
          x: sched.x,
          y: sched.y,
          facing: sched.facing ?? npc.facing,
          scheduled: true,
        };
      }
    }
    return npc;
  }

  // --- Task #108: secret NPC discovery ---
  // A hidden NPC carries `secret: { mapId, x, y, flag }` — the tile that
  // reveals it and the flag that records the discovery. Hidden until found.
  secretDef(npc) {
    return npc?.secret ?? null;
  }

  isRevealed(npc) {
    const s = this.secretDef(npc);
    if (!s) return true;
    return !!(this.state && this.state.getFlag(s.flag));
  }

  secretNpcs() {
    return this.allNpcs().filter((n) => !!n.secret);
  }

  secretAt(mapId, x, y) {
    const hit = this.allNpcs().find(
      (n) => n.secret && n.secret.mapId === mapId && n.secret.x === x && n.secret.y === y
    );
    return hit?.secret ?? null;
  }

  // Stepping on the discovery tile reveals a hidden NPC (sets its flag).
  tryDiscover(mapId, x, y) {
    const s = this.secretAt(mapId, x, y);
    if (!s) return { ok: false, error: "nothing hidden here" };
    const npc = this.allNpcs().find((n) => n.secret === s);
    if (this.isRevealed(npc)) return { ok: false, error: "already revealed", npc: this.resolveState(npc) };
    if (this.state) this.state.setFlag(s.flag, true);
    const revealed = this.resolveState(npc);
    return { ok: true, npc: revealed, id: npc.id, mapId: npc.mapId };
  }

  // NPCs actually present right now: hidden secrets excluded, states applied.
  activeNpcsFor(mapId) {
    return this.npcsFor(mapId)
      .filter((n) => this.isRevealed(n))
      .map((n) => this.resolveState(n));
  }

  activeNpcAt(mapId, x, y) {
    return this.activeNpcsFor(mapId).find((n) => n.x === x && n.y === y) ?? null;
  }

  setFacing(npcId, facing) {
    const n = this.npcById(npcId);
    if (!n) return false;
    n.facing = facing;
    return true;
  }

  allNpcs() {
    return Object.entries(this.placements).flatMap(([mapId, list]) =>
      list.map((n) => ({ mapId, ...n }))
    );
  }

  // NPCs who share a tile with the given position (for interaction checks).
  npcsAtAny(town, coords) {
    return coords
      .map(([x, y]) => this.npcAt(town, x, y))
      .filter(Boolean);
  }
}
