// Task #163: Post-game content triggers — optional secret bosses and item
// hunts that unlock once the main story is complete. Pure logic over state/
// party/inventory: availability, completion flags, rewards, and progress for
// hunt-style goals. `audit()` verifies every referenced enemy template and
// item exists.

export class PostGameSystem {
  constructor(defs = [], opts = {}) {
    this.defs = defs;
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
    this.enemySystem = opts.enemySystem ?? null;
    this.rewards = opts.rewards ?? null; // CombatRewardResolver (optional)
  }

  def(id) {
    return this.defs.find((d) => d.id === id) ?? null;
  }

  requiresMet(d) {
    return (d.require?.flags ?? []).every((f) => !!this.state && this.state.getFlag(f));
  }

  isComplete(d) {
    if (!d) return false;
    return !!(this.state && this.state.getFlag(d.completeFlag ?? "postgame_" + d.id));
  }

  // All post-game content, with locked/unlocked/done status.
  all() {
    return this.defs.map((d) => ({
      ...d,
      locked: !this.requiresMet(d),
      done: this.isComplete(d),
      progress: d.type === "item_hunt" ? this.progress(d) : null,
    }));
  }

  // Content the player can engage with right now.
  available() {
    return this.all().filter((d) => !d.locked && !d.done);
  }

  // Newly unlocked content since the last check (fires once per item).
  check() {
    const fresh = this.available();
    const seen = new Set(this._seen ?? []);
    const out = fresh.filter((d) => !seen.has(d.id));
    this._seen = new Set(fresh.map((d) => d.id));
    return out;
  }

  // Secret-boss battles: build the encounter for a def (or return an error).
  encounter(id) {
    const d = this.def(id);
    if (!d) return { ok: false, error: "unknown" };
    if (d.type !== "secret_boss") return { ok: false, error: "not a boss" };
    if (!this.requiresMet(d)) return { ok: false, error: "locked" };
    if (this.isComplete(d)) return { ok: false, error: "already defeated" };
    if (!this.enemySystem || !this.enemySystem.template(d.enemy)) {
      return { ok: false, error: "unknown enemy" };
    }
    const enemies = [this.enemySystem.createEnemy(d.enemy)];
    return { ok: true, groupId: d.groupId ?? d.id, enemies, def: d };
  }

  // Mark a post-game boss/hunt complete and grant its reward.
  complete(id) {
    const d = this.def(id);
    if (!d) return { ok: false, error: "unknown" };
    if (!this.requiresMet(d)) return { ok: false, error: "locked" };
    if (this.isComplete(d)) return { ok: false, error: "already complete" };
    this.state?.setFlag(d.completeFlag ?? "postgame_" + d.id, true);
    for (const f of d.onDefeat?.flags ?? []) this.state?.setFlag(f, true);
    const reward = this._grant(d.reward);
    return { ok: true, id: d.id, name: d.name, reward };
  }

  // Item-hunt progress: [{itemId, have, want, label}] + summary.
  progress(d) {
    const out = (d.targets ?? []).map((t) => ({
      itemId: t.itemId,
      have: this.inventory ? this.inventory.count(t.itemId) : 0,
      want: t.count,
      label: t.label ?? t.itemId,
    }));
    const done = out.length > 0 && out.every((t) => t.have >= t.want);
    return { targets: out, done };
  }

  // Can the hunt be turned in now?
  huntReady(d) {
    if (d.type !== "item_hunt") return false;
    return this.progress(d).done;
  }

  _grant(reward) {
    if (!reward) return null;
    const got = [];
    if (reward.item && this.inventory) {
      const ok = this.inventory.add(reward.item, reward.count ?? 1);
      got.push({ item: reward.item, count: reward.count ?? 1, ok });
    }
    if (reward.gold && this.party) {
      this.party.addGold(reward.gold);
      got.push({ gold: reward.gold });
    }
    if (reward.xp && this.party) {
      this.party.grantXp(reward.xp);
      got.push({ xp: reward.xp });
    }
    return got;
  }

  // Every boss references an existing template and every hunt references
  // real items with positive counts.
  audit(items = null) {
    const errors = [];
    for (const d of this.defs) {
      if (d.type === "secret_boss") {
        if (!this.enemySystem?.template?.(d.enemy)) {
          errors.push({ id: d.id, error: "no such enemy template: " + d.enemy });
        }
      } else if (d.type === "item_hunt") {
        for (const t of d.targets ?? []) {
          if (items && !items[t.itemId]) errors.push({ id: d.id, error: "no such item: " + t.itemId });
          if (!t.count || t.count < 1) errors.push({ id: d.id, error: "hunt target count invalid: " + t.itemId });
        }
      } else {
        errors.push({ id: d.id, error: "unknown type: " + d.type });
      }
    }
    return errors;
  }

  // One-line status listing for logs/UI.
  describe() {
    const avail = this.available();
    if (!avail.length) return "No post-game content available yet — finish the main story!";
    return (
      "Post-game: " +
      avail.map((d) => d.name + (d.type === "item_hunt" ? " (" + this.progress(d).targets.filter((t) => t.have >= t.want).length + "/" + d.targets.length + ")" : "")).join(", ")
    );
  }
}
