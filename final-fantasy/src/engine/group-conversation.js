// Task #139: Group Conversation Logic — interacting with one NPC initiates
// a multi-NPC dialogue. A dialogue node may carry a `with` array of
// participating NPC ids, and its pages may be per-page objects
// `{ speaker, text }` so the conversation visibly passes between speakers.
// This system wraps the DialogueEngine, reports who participates, and can
// find the NPCs standing near a tile (so a dialogue can require that the
// other participants actually be present).

export class GroupConversationSystem {
  constructor(opts = {}) {
    this.engine = opts.engine ?? null;
    this.placements = opts.placements ?? null;
  }

  bindEngine(engine) {
    this.engine = engine;
    return this;
  }

  bindPlacements(placements) {
    this.placements = placements;
    return this;
  }

  // The participant NPC ids declared by a dialogue node.
  participants(node) {
    return [...(node?.with ?? [])];
  }

  // NPCs currently standing within a Chebyshev radius of a tile — uses the
  // live placement system, so schedules/states are respected.
  nearby(mapId, x, y, radius = 3) {
    if (!this.placements) return [];
    return this.placements.activeNpcsFor(mapId).filter((n) => {
      const dx = Math.abs(n.x - x);
      const dy = Math.abs(n.y - y);
      return Math.max(dx, dy) <= radius;
    });
  }

  // Start a dialogue id and report the participants in this conversation.
  // Falls back to the plain engine when the node is not a group node.
  start(dialogueId) {
    if (!this.engine) return null;
    const res = this.engine.start(dialogueId);
    if (!res) return null;
    const node = this.engine.current?.node ?? null;
    return { ...res, with: this.participants(node), participants: this.participants(node) };
  }
}
