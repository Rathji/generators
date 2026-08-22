// Task #14: Quest Tracking System — quest states (active/completed/failed)
// derived from linked world flags, with objective progress.

export class QuestTracker {
  constructor(quests = [], state = null) {
    this.quests = quests;
    this.state = null;
    this.statuses = {};
    if (state) this.bind(state);
  }

  bind(state) {
    this.state = state;
    this.sync();
    return this;
  }

  // Recompute every quest's state from the current world flags.
  sync() {
    for (const q of this.quests) {
      const current = this.statuses[q.id];
      if (this.state && q.completesOnFlag && this.state.getFlag(q.completesOnFlag)) {
        this.statuses[q.id] = "completed";
      } else if (this.state && q.failsOnFlag && this.state.getFlag(q.failsOnFlag)) {
        this.statuses[q.id] = "failed";
      } else {
        const started = q.startsOnFlag ? this.state && this.state.getFlag(q.startsOnFlag) : current === "active";
        if (started && current !== "completed") this.statuses[q.id] = "active";
      }
    }
    return this;
  }

  statusOf(questId) {
    this.sync();
    return this.statuses[questId] ?? "inactive";
  }

  byStatus(status) {
    this.sync();
    return this.quests.filter((q) => this.statusOf(q.id) === status);
  }

  active() {
    return this.byStatus("active");
  }

  completed() {
    return this.byStatus("completed");
  }

  failed() {
    return this.byStatus("failed");
  }

  questById(questId) {
    return this.quests.find((q) => q.id === questId) ?? null;
  }

  objectives(questId) {
    const q = this.questById(questId);
    if (!q) return [];
    return q.objectives.map((o) => ({
      text: o.text,
      done: !!(this.state && this.state.getFlag(o.flag)),
    }));
  }

  isComplete(questId) {
    return this.statusOf(questId) === "completed";
  }

  isFailed(questId) {
    return this.statusOf(questId) === "failed";
  }
}
