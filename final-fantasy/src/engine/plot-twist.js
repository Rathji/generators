// Task #150: Mid-Game Plot Twist Trigger — a global event that changes the
// party's goals (sets flags) and pushes a new headline into the quest log.
// Fires exactly once when its requirements are met; the quest log entry
// clears when the story catches up (`resolvedFlag`).

export class PlotTwistSystem {
  constructor(twists = [], opts = {}) {
    this.twists = twists;
    this.state = opts.state ?? null;
    this.questLog = opts.questLog ?? null;
    this.handlers = opts.handlers ?? {}; // { dialogue(id) }
    this.activeId = null;
  }

  all() {
    return [...this.twists];
  }

  def(id) {
    return this.twists.find((t) => t.id === id) ?? null;
  }

  isFired(id) {
    return !!(this.state && this.state.getFlag("twist_" + id + "_fired"));
  }

  isResolved(id) {
    const d = this.def(id);
    if (!d?.resolvedFlag) return false;
    return !!(this.state && this.state.getFlag(d.resolvedFlag));
  }

  active() {
    return this.activeId ? this.def(this.activeId) ?? null : null;
  }

  // Called on world steps / battle wins: fires any ready twist, and clears
  // the log headline once the story catches up with the twist.
  check() {
    const events = [];
    for (const t of this.twists) {
      if (this.isResolved(t.id)) {
        if (this.activeId === t.id) {
          this.activeId = null;
          if (this.questLog) this.questLog.setTwist(null);
          events.push({ type: "resolved", twist: t });
        }
        continue;
      }
      if (this.isFired(t.id)) continue;
      const reqs = t.require?.flags ?? [];
      if (!reqs.every((f) => this.state && this.state.getFlag(f))) continue;
      this.state?.setFlag("twist_" + t.id + "_fired", true);
      for (const [k, v] of Object.entries(t.setFlags ?? {})) this.state?.setFlag(k, v);
      this.activeId = t.id;
      if (this.questLog) {
        this.questLog.setTwist({ id: t.id, name: t.name, description: t.description ?? "", done: false });
      }
      if (this.handlers.dialogue && t.dialogueId) this.handlers.dialogue(t.dialogueId);
      events.push({ type: "fired", twist: t });
    }
    return events;
  }

  // Force-fire a twist (for tests / sequence authoring).
  fire(id) {
    const t = this.def(id);
    if (!t) return { ok: false, error: "unknown twist" };
    if (this.isFired(id)) return { ok: false, error: "already fired" };
    this.state?.setFlag("twist_" + id + "_fired", true);
    for (const [k, v] of Object.entries(t.setFlags ?? {})) this.state?.setFlag(k, v);
    this.activeId = id;
    if (this.questLog) {
      this.questLog.setTwist({ id: t.id, name: t.name, description: t.description ?? "", done: false });
    }
    return { ok: true, twist: t };
  }

  reset() {
    this.activeId = null;
    return this;
  }
}
