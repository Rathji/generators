// src/archive.js — the Archive tuckbox (Tasks 20-21, full contract Task 36).
// The Archive is a depository for components that are no longer needed:
// crateless constructed building cards after a building is constructed, and
// constructed building cards after their crate is unlocked. Archived cards
// never re-enter the game (Task 36 excludes them from all decks and hands).

export function createArchive(config = {}) {
  const cardIds = new Set(config.cardIds ?? []);

  const archive = {
    add(cardId) {
      if (typeof cardId !== "string" || !cardId) {
        throw new Error("archive: cardId must be a non-empty string");
      }
      cardIds.add(cardId);
      return cardIds.size;
    },
    has(cardId) {
      return cardIds.has(cardId);
    },
    count() {
      return cardIds.size;
    },
    all() {
      return [...cardIds];
    },

    toJSON() {
      return { kind: "archive", cardIds: archive.all() };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("archive: bad fromJSON payload");
      cardIds.clear();
      for (const id of data.cardIds ?? []) cardIds.add(id);
      return archive;
    },
  };
  return archive;
}
