// Task #48: Game-Over & Reset State — a party wipe revives the party at the
// last save point (or falls back to the title screen with no checkpoint),
// with a gold penalty and an onGameOver hook for UI.

export class GameOverSystem {
  constructor(opts = {}) {
    this.party = opts.party ?? null;
    this.state = opts.state ?? null;
    this.saves = opts.saves ?? null;
    this.checkpoint = null;
    this.reviveFrac = opts.reviveFrac ?? 0.5;
    this.goldPenalty = opts.goldPenalty ?? 0.5;
    this.onGameOver = opts.onGameOver ?? null;
    this.onRevive = opts.onRevive ?? null;
    this.gameOverCount = 0;
  }

  get hasCheckpoint() {
    return !!this.checkpoint;
  }

  get checkpointInfo() {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  // Mark the current location as a safe respawn point.
  savepoint(mapId, x, y, facing = "S", name = "Save Point") {
    this.checkpoint = { mapId, x, y, facing, name };
    return this;
  }

  registerCheckpoint(cp) {
    this.checkpoint = { ...cp };
    return this;
  }

  // Auto-savepoint: adopt the game state's current location.
  autoCheckpoint() {
    if (!this.state) return this;
    const l = this.state.getLocation();
    return this.savepoint(l.mapId, l.x, l.y, l.facing, "Last Location");
  }

  clearCheckpoint() {
    this.checkpoint = null;
    return this;
  }

  allDown() {
    return this.party ? this.party.allDead() : false;
  }

  anyDown() {
    return this.party ? !this.party.anyAlive() : false;
  }

  // Revive every member at a fraction of max HP/MP and clear statuses.
  revive() {
    if (!this.party) return [];
    const revived = [];
    for (const m of this.party.members) {
      const s = m.getStats ? m.getStats() : {};
      m.hp = Math.max(1, Math.floor((s.maxHp ?? 1) * this.reviveFrac));
      m.mp = Math.max(0, Math.floor((s.maxMp ?? 0) * this.reviveFrac));
      if (Array.isArray(m.statuses)) m.statuses = [];
      revived.push(m.id);
    }
    return revived;
  }

  // Call after any battle/encounter resolves. Returns { status: "ok" }
  // when the party still stands, or a game-over result when wiped.
  check() {
    if (!this.allDown()) return { status: "ok", gameOver: false };
    return this.handleGameOver();
  }

  handleGameOver() {
    this.gameOverCount++;
    const result = {
      status: "game_over",
      reason: "party_wipe",
      reset: false,
      title: !this.hasCheckpoint,
      location: null,
    };
    if (this.onGameOver) this.onGameOver(result);
    if (!this.hasCheckpoint) {
      result.reset = true;
      return result;
    }
    if (this.party) {
      this.revive();
      if (this.goldPenalty > 0 && this.party.gold) {
        this.party.gold = Math.floor(this.party.gold * (1 - this.goldPenalty));
      }
    }
    if (this.state) {
      this.state.setLocation(this.checkpoint.mapId, this.checkpoint.x, this.checkpoint.y, this.checkpoint.facing);
    }
    result.status = "revived";
    result.location = { ...this.checkpoint };
    if (this.onRevive) this.onRevive(result);
    return result;
  }

  // Soft reset to the title screen: clear progress hooks, keep party data
  // for a "Continue" flow (caller may re-initialize the party).
  toTitle() {
    this.gameOverCount = 0;
    this.clearCheckpoint();
    if (this.state) {
      this.state.setLocation("title", 0, 0, "S");
      this.state.setStoryPhase(0);
    }
    return { status: "title", reset: true };
  }
}
