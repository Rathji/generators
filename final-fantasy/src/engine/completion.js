// Task #105: GameCompletionSystem — the end-of-game state. When the ending
// finishes, the save is marked completed and Free Roam unlocks: the player
// may keep exploring (or start New Game+) rather than stop forever. The
// flags ride on the GameState, so they persist through save/load like every
// other story flag.

export class GameCompletionSystem {
  constructor(opts = {}) {
    this.state = opts.state ?? null;
    this.onComplete = opts.onComplete ?? null;
  }

  complete() {
    this.state?.setFlag("game_completed", true);
    this.state?.setFlag("free_roam", true);
    const cb = this.onComplete;
    this.onComplete = null;
    if (cb) cb();
    return { ok: true };
  }

  isCompleted() {
    return !!(this.state && this.state.getFlag("game_completed"));
  }

  freeRoamAvailable() {
    return !!(this.state && this.state.getFlag("free_roam"));
  }

  // From the title screen: resume a completed save in Free Roam.
  freeRoam(slot, boot = null) {
    if (!this.isCompleted()) return { ok: false, error: "not_completed" };
    if (!boot) return { ok: false, error: "no_boot" };
    const res = boot.continue(slot);
    return res.ok ? { ok: true, slot, freeRoam: true } : res;
  }

  describe() {
    if (this.isCompleted()) return "The adventure is complete — Free Roam is unlocked.";
    return "The ending has not been reached yet.";
  }
}
