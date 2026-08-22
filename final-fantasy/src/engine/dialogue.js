// Tasks #10 & #11: NPC Dialogue Engine — page-based dialogue that can
// branch on world flags / inventory via declarative or function conditions.

import { DIALOGUE } from "../data/dialogue.js";

export function matchCondition(cond, world) {
  if (cond == null) return true;
  if (typeof cond === "function") return !!cond(world);
  if (typeof cond === "string") return !!(world && typeof world.getFlag === "function" && world.getFlag(cond));
  if (cond.flag) return !!(world && typeof world.getFlag === "function" && world.getFlag(cond.flag));
  if (cond.notFlag) return !(world && typeof world.getFlag === "function" && world.getFlag(cond.notFlag));
  if (cond.item) return !!(world && typeof world.hasItem === "function" && world.hasItem(cond.item));
  if (cond.noItem) return !(world && typeof world.hasItem === "function" && world.hasItem(cond.noItem));
  if (cond.not) return !matchCondition(cond.not, world);
  if (cond.all) return cond.all.every((c) => matchCondition(c, world));
  if (cond.any) return cond.any.some((c) => matchCondition(c, world));
  return true;
}

export function createDialogueWorld(game) {
  return {
    getFlag: (n) => !!(game.state && game.state.getFlag(n)),
    hasItem: (n) => !!(game.inventory && game.inventory.has(n)),
    getLeaderClass: () => (game.party && game.party.members && game.party.members[0] ? game.party.members[0].classId : null),
    // Task #151: dialogue nodes can gate on NPC affinity (function
    // conditions) — the relationship system is attached to `game` after it
    // is constructed in main.js.
    getAffinity: (npcId) => (game.npcRelations ? game.npcRelations.score(npcId) : 0),
  };
}

export class DialogueEngine {
  constructor(opts = {}) {
    this.data = opts.data ?? DIALOGUE;
    this.world = opts.world ?? null;
    this.state = opts.state ?? null;
    this.current = null;
    this.pageIndex = 0;
  }

  bindWorld(world) {
    this.world = world;
    return this;
  }

  conditionMet(cond, nodeContext = null) {
    if (cond == null) return true;
    if (typeof cond === "function") return !!cond({ world: this.world, context: nodeContext });
    return matchCondition(cond, this.world);
  }

  // Returns the node id to use for `id`, following class-specific hooks
  // (Task #58), `branches`, and `condition`.
  resolveDialogueId(id) {
    const node = this.data[id];
    if (node == null) return null;
    if (node.byClass && this.world && typeof this.world.getLeaderClass === "function") {
      const cid = this.world.getLeaderClass();
      const mapped = node.byClass[cid] ?? node.byClass.default ?? null;
      if (mapped && mapped !== id) {
        const sub = this.resolveDialogueId(mapped);
        if (sub != null) return sub;
      }
    }
    if (Array.isArray(node.branches)) {
      for (const branch of node.branches) {
        if (this.conditionMet(branch.when)) return branch.id;
      }
      return node.branches.length ? node.branches[node.branches.length - 1].id : null;
    }
    if (node.condition && !this.conditionMet(node.condition)) {
      return node.fallback ?? null;
    }
    return id;
  }

  start(id, context = null) {
    const resolved = this.resolveDialogueId(id);
    if (resolved == null) return null;
    const node = this.data[resolved];
    if (node == null) return null;
    const pages = typeof node === "string" ? [node] : [...(node.pages ?? [])];
    const choices = Array.isArray(node.choices) ? node.choices.map((c) => ({ ...c })) : null;
    this.current = { id: resolved, requestedId: id, node, pages, choices, chosen: null };
    this.pageIndex = 0;
    this.context = context ?? null;
    return this.getPage();
  }

  // Task #139: pages may be plain strings OR { speaker, text } objects (a
  // multi-NPC conversation passes between speakers). `_page` normalizes.
  _page(index) {
    const raw = this.current.pages[index];
    if (raw && typeof raw === "object" && "text" in raw) return raw;
    return { text: raw };
  }

  speakerFor(index) {
    const p = this._page(index);
    return p.speaker ?? this.current.node.speaker ?? null;
  }

  // The selectable choices of the active node, or null when the current node
  // has none (Task #57).
  getChoices() {
    if (!this.current || !this.current.choices) return null;
    return this.current.choices.map((c, i) => ({
      index: i,
      text: c.text,
      flag: c.flag ?? null,
      next: c.next ?? null,
    }));
  }

  // Pick a choice (Task #57): applies its flag/action and moves to its `next`
  // node when given, otherwise ends the conversation.
  choose(index) {
    if (!this.current || !this.current.choices) return { ok: false, error: "no choices" };
    const c = this.current.choices[index];
    if (!c) return { ok: false, error: "invalid choice" };
    this.current.chosen = c;
    if (c.flag && this.state && typeof this.state.setFlag === "function") {
      this.state.setFlag(c.flag, c.value ?? true);
    }
    if (typeof c.action === "function") c.action(c, this);
    let next = null;
    if (c.next) {
      const resolved = this.resolveDialogueId(c.next);
      if (resolved != null) {
        this.start(resolved, this.context);
        next = resolved;
      } else {
        this.current = null;
      }
    } else {
      this.current = null;
    }
    return { ok: true, choice: c.text, index, next, done: next === null };
  }

  isActive() {
    return this.current !== null;
  }

  getPage() {
    if (!this.current) return null;
    const node = this.current.node;
    const p = this._page(this.pageIndex);
    return {
      id: this.current.id,
      requestedId: this.current.requestedId,
      speaker: p.speaker ?? node.speaker ?? null,
      page: this.pageIndex + 1,
      total: this.current.pages.length,
      text: p.text,
      done: false,
    };
  }

  advance() {
    if (!this.current) return null;
    if (this.pageIndex + 1 >= this.current.pages.length) {
      if (this.current.choices) {
        return {
          id: this.current.id,
          speaker: this.speakerFor(this.pageIndex),
          done: false,
          waitingForChoice: true,
          choices: this.getChoices(),
        };
      }
      const last = this.current;
      const lastSpeaker = this.speakerFor(this.pageIndex);
      this.current = null;
      return { id: last.id, speaker: lastSpeaker, done: true };
    }
    this.pageIndex += 1;
    return this.getPage();
  }

  abort() {
    this.current = null;
  }
}
