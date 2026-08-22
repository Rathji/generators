// Task #41: Quest Objective Log — aggregates the active main-story milestone,
// side quests, and tracked quests into a prioritized objective list for UI.

export class QuestLogSystem {
  constructor(opts = {}) {
    this.quests = opts.quests ?? null; // QuestTracker
    this.director = opts.director ?? null; // StoryDirector (milestones)
    this.sideQuests = opts.sideQuests ?? null; // SideQuestSystem
    this.maxEntries = opts.maxEntries ?? 20;
  }

  // Ordered log entries: current story milestone first, then side quests,
  // then tracked quests — all with per-objective done state.
  entries() {
    const out = [];
    if (this.director) {
      const ms = this.director.currentMilestone ?? this.director.nextMilestone();
      if (ms) {
        const st = this.director.milestoneState(ms.id);
        out.push({
          kind: "story",
          id: ms.id,
          name: ms.name ?? ms.id,
          description: ms.description ?? "",
          status: st.done ? "completed" : "active",
          primary: true,
          objectives: [],
        });
      }
    }
    if (this.sideQuests) {
      for (const id of this.sideQuests.active()) {
        const report = this.sideQuests.progressReport(id);
        out.push({
          kind: "side",
          id,
          name: report.name ?? id,
          status: "active",
          progress: report.progress,
          total: report.total,
          objectives: report.steps.map((s) => ({ text: s.description ?? s.text ?? s.flag, done: s.done })),
        });
      }
    }
    if (this.quests) {
      for (const q of this.quests.active()) {
        out.push({
          kind: "quest",
          id: q.id,
          name: q.name,
          description: q.description ?? "",
          status: "active",
          objectives: this.quests.objectives(q.id),
        });
      }
    }
    return out.slice(0, this.maxEntries);
  }

  isEmpty() {
    return this.entries().length === 0;
  }

  // The single headline objective ("Quest Objective Log" summary line).
  activeGoal() {
    const e = this.entries();
    const story = e.find((x) => x.primary);
    if (story) return story.name;
    return e[0]?.name ?? "No active objectives";
  }

  // Plain-text rendering suitable for a HUD panel or log.
  render() {
    const e = this.entries();
    if (!e.length) return "No active objectives.";
    const lines = [];
    for (const en of e) {
      const tag = en.kind === "story" ? "Main" : en.kind === "side" ? "Side" : "Quest";
      const head =
        "[" + tag + "] " + en.name +
        (en.status === "completed" ? " (done)" : "") +
        (typeof en.progress === "number" && typeof en.total === "number" && en.total > 0
          ? " (" + en.progress + "/" + en.total + ")"
          : "");
      lines.push(head);
      for (const o of en.objectives ?? []) {
        lines.push("  " + (o.done ? "[x]" : "[ ]") + " " + o.text);
      }
    }
    return lines.join("\n");
  }

  // HTML-safe view model for UI renderers (kept free of markup by default).
  view() {
    return this.entries().map((e) => ({
      ...e,
      objectives: (e.objectives ?? []).map((o) => ({ ...o })),
    }));
  }
}
