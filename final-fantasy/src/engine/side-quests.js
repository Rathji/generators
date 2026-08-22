// Task #39: Side Quest Event Chain — optional NPC quests that track progress
// through world flags and grant unique rewards once every step is done.

export class SideQuestSystem {
  constructor(defs, ctx = {}) {
    this.quests = defs;
    this.state = ctx.state ?? null;
    this.party = ctx.party ?? null;
    this.inventory = ctx.inventory ?? null;
    this.handlers = ctx.handlers ?? {};
  }

  def(id) {
    return this.quests[id] ?? null;
  }

  all() {
    return Object.keys(this.quests);
  }

  isStarted(id) {
    return !!this.state?.getFlag("sq_" + id + "_started");
  }

  isComplete(id) {
    return !!this.state?.getFlag("sq_" + id + "_done");
  }

  canStart(id) {
    const q = this.def(id);
    if (!q || this.isStarted(id) || this.isComplete(id)) return false;
    return (q.requiredFlags ?? []).every((f) => this.state?.getFlag(f));
  }

  start(id) {
    if (!this.canStart(id)) return { ok: false, error: "cannot start" };
    this.state?.setFlag("sq_" + id + "_started", true);
    return { ok: true, id, name: this.def(id).name };
  }

  stepsTotal(id) {
    return this.def(id)?.steps?.length ?? 0;
  }

  stepDone(id, i) {
    const step = this.def(id)?.steps?.[i];
    return !!step && !!this.state?.getFlag(step.flag);
  }

  stepProgress(id) {
    return (this.def(id)?.steps ?? []).filter((s) => this.state?.getFlag(s.flag)).length;
  }

  active() {
    return this.all().filter((id) => this.isStarted(id) && !this.isComplete(id));
  }

  // A quest step is "complete" once its flag is set; this helper is what an
  // event/NPC interaction calls when a step is finished.
  completeStep(id, stepFlag) {
    if (!this.isStarted(id)) return { ok: false, error: "not started" };
    if (this.isComplete(id)) return { ok: false, error: "already complete" };
    this.state?.setFlag(stepFlag, true);
    const progress = this.stepProgress(id);
    const total = this.stepsTotal(id);
    return { ok: true, id, progress, total, done: progress >= total };
  }

  // All steps done -> mark complete and hand out the reward once.
  checkComplete(id) {
    const q = this.def(id);
    if (!q || !this.isStarted(id) || this.isComplete(id)) {
      return { ok: false, error: "not completable" };
    }
    const progress = this.stepProgress(id);
    const total = this.stepsTotal(id);
    if (progress < total) {
      return { ok: false, error: "steps incomplete", progress, total };
    }
    const reward = q.reward ?? {};
    if (typeof reward.gold === "number" && this.party) this.party.addGold(reward.gold);
    if (typeof reward.xp === "number" && this.party) this.party.grantXp(reward.xp);
    if (reward.item && this.inventory) {
      const added = this.inventory.add(reward.item, reward.count ?? 1);
      if (!added && this.handlers.onRewardFailed) this.handlers.onRewardFailed(q, reward);
    }
    this.state?.setFlag("sq_" + id + "_done", true);
    return { ok: true, id, reward, name: q.name };
  }

  progressReport(id) {
    return {
      id,
      started: this.isStarted(id),
      complete: this.isComplete(id),
      progress: this.stepProgress(id),
      total: this.stepsTotal(id),
      steps: (this.def(id)?.steps ?? []).map((s) => ({ ...s, done: !!this.state?.getFlag(s.flag) })),
    };
  }
}
