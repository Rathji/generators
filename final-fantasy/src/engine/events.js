// Task #15: Narrative Event Sequence — a sequenced director that runs
// scripted story beats (dialogue, transitions, flags, items) in order,
// pausing on blocking steps (e.g. dialogue) until told to resume.

export class StoryDirector {
  constructor(ctx = {}, handlers = {}) {
    this.ctx = ctx;
    this.handlers = handlers;
    this.sequence = null;
    this.index = 0;
    this.waiting = null;
    this.milestones = [];
    this.milestoneIndex = 0;
    this.currentMilestone = null;
  }

  // --- Main-story milestone chain (Task #38) ---
  registerMilestones(list) {
    this.milestones = (list || []).map((m, i) => ({ ...m, index: i }));
    this.milestoneIndex = 0;
    this.currentMilestone = null;
    return this;
  }

  milestoneList() {
    return [...this.milestones];
  }

  nextMilestone() {
    return this.milestones[this.milestoneIndex] ?? null;
  }

  milestoneDef(id) {
    return this.milestones.find((m) => m.id === id) ?? null;
  }

  milestoneState(id) {
    const def = this.milestoneDef(id);
    const st = this.ctx.state;
    return {
      ready: (def?.flags ?? []).every((f) => (st ? st.getFlag(f) : true)),
      started: st ? st.getFlag("ms_" + id + "_started") : false,
      done: st ? (def?.completeOnFlag ? st.getFlag(def.completeOnFlag) : st.getFlag("ms_" + id + "_done")) : false,
    };
  }

  isMilestoneReady(id) {
    return this.milestoneState(id).ready;
  }

  isMilestoneStarted(id) {
    return this.milestoneState(id).started;
  }

  isMilestoneDone(id) {
    return this.milestoneState(id).done;
  }

  // First not-yet-started, not-done milestone whose flags are all met.
  nextReadyMilestone() {
    const m = this.nextMilestone();
    if (!m) return null;
    if (this.isMilestoneDone(m.id)) {
      this.milestoneIndex++;
      return this.nextReadyMilestone();
    }
    if (this.isMilestoneReady(m.id) && !this.isMilestoneStarted(m.id)) return m;
    return null;
  }

  // Trigger a milestone: mark started, queue its sequence, remember it.
  startMilestone(id) {
    const m = this.milestoneDef(id);
    if (!m) return null;
    if (this.isMilestoneDone(id)) return null;
    this.ctx.state?.setFlag("ms_" + id + "_started", true);
    this.currentMilestone = m;
    if (m.sequence) this.queue(m.sequence);
    return m;
  }

  completeMilestone(id) {
    const m = this.milestoneDef(id);
    if (!m) return null;
    this.ctx.state?.setFlag("ms_" + id + "_done", true);
    if (this.currentMilestone && this.currentMilestone.id === id) this.currentMilestone = null;
    this.milestoneIndex = Math.max(this.milestoneIndex, m.index + 1);
    return m;
  }

  // Convenience: if the next milestone's flags are met, start it.
  advanceMilestones() {
    const m = this.nextReadyMilestone();
    if (!m) return null;
    return this.startMilestone(m.id);
  }

  queue(sequence) {
    this.sequence = [...sequence];
    this.index = 0;
    this.waiting = null;
    return this;
  }

  isRunning() {
    return this.sequence !== null;
  }

  isWaiting() {
    return this.waiting !== null;
  }

  peek() {
    if (!this.sequence) return null;
    return this.sequence[this.index] ?? null;
  }

  // Run steps until a blocking step or the sequence ends.
  advance() {
    const out = { steps: [], done: false, waiting: null };
    while (this.sequence && this.index < this.sequence.length) {
      const step = this.sequence[this.index];
      this.index += 1;
      const result = this._runStep(step);
      out.steps.push(result);
      if (result.blocking) {
        this.waiting = result;
        out.waiting = result;
        return out;
      }
    }
    if (this.sequence && this.index >= this.sequence.length) {
      this.sequence = null;
      out.done = true;
      if (this.currentMilestone) {
        const m = this.currentMilestone;
        this.currentMilestone = null;
        out.milestoneCompleted = m.id;
        this.completeMilestone(m.id);
      }
    }
    return out;
  }

  // Resume after a blocking step (e.g. dialogue closed).
  resume() {
    this.waiting = null;
    return this.advance();
  }

  _runStep(step) {
    switch (step.type) {
      case "dialogue": {
        if (this.handlers.dialogue) this.handlers.dialogue(step.dialogueId, this.ctx);
        return { type: "dialogue", dialogueId: step.dialogueId, blocking: true };
      }
      case "setFlag": {
        if (this.ctx.state && typeof this.ctx.state.setFlag === "function") {
          this.ctx.state.setFlag(step.flag, step.value ?? true);
        } else if (this.handlers.setFlag) {
          this.handlers.setFlag(step.flag, step.value ?? true);
        }
        return { type: "setFlag", flag: step.flag, blocking: false };
      }
      case "giveItem": {
        if (this.ctx.inventory && typeof this.ctx.inventory.add === "function") {
          this.ctx.inventory.add(step.itemId, step.count ?? 1);
        } else if (this.handlers.giveItem) {
          this.handlers.giveItem(step.itemId, step.count ?? 1);
        }
        return { type: "giveItem", itemId: step.itemId, blocking: false };
      }
      case "transition": {
        if (this.handlers.transition) this.handlers.transition(step, this.ctx);
        return { type: "transition", blocking: false, to: { mapId: step.mapId, x: step.x, y: step.y, facing: step.facing } };
      }
      case "event": {
        if (this.handlers.event) this.handlers.event(step.name, step.payload, this.ctx);
        return { type: "event", name: step.name, blocking: !!step.blocking };
      }
      case "wait": {
        return { type: "wait", ticks: step.ticks ?? 1, blocking: true };
      }
      default:
        return { type: step.type ?? "unknown", blocking: false };
    }
  }
}
