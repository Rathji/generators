// src/framework/store/records.js — cache record shapes shared by the store and
// the sync engine.
//
// The store and the sync engine share ONE cache (the kv folder for the KB's
// namespace). These key prefixes + factories keep the record shapes identical
// on both sides, so a draft/conflict that the STORE stages during a write
// (offline write, concurrent-write detection) is immediately visible to the
// ENGINE, and vice-versa.

export const KEYS = {
  syncBase: (id) => "sync-base::" + id,
  draft: (id) => "draft::" + id,
  conflict: (id) => "conflict::" + id,
  resolution: (id) => "resolution::" + id,
  lastReconciled: "sync-last",
};

// A local change staged because it couldn't reach the canonical cloud copy yet.
// `base*` is the canonical state the change was based on; `baseData` is that
// state's content (captured when cheaply available) so a later field-level
// merge can be a proper 3-way merge instead of a lossy 2-way one.
export function makeDraft({
  data,
  base = null,
  baseData = null,
  at,
  updatedBy = "system",
  reason = "manual",
  attempts = 0,
}) {
  return {
    data,
    baseVersion: base ? base.version : null,
    baseHash: base ? base.hash : null,
    baseData: baseData ?? null,
    at: at ?? Date.now(),
    updatedBy,
    reason,
    attempts,
  };
}

// A conflict record preserves BOTH sides of a divergent document: `mine` (the
// local change) and `theirs` (the canonical cloud copy at detection), plus the
// common ancestor (`base`) when known. `theirs` always stays canonical until
// the user resolves — nothing is overwritten without consent.
export function makeConflict({ mine, theirs, base = null, at, resolved = false }) {
  return {
    mine: {
      baseVersion: mine.baseVersion ?? null,
      baseHash: mine.baseHash ?? null,
      baseData: mine.baseData ?? null,
      data: mine.data,
      at: mine.at ?? Date.now(),
      updatedBy: mine.updatedBy ?? "system",
    },
    theirs: {
      version: theirs.version ?? null,
      hash: theirs.hash ?? null,
      data: theirs.data,
      at: theirs.at ?? Date.now(),
    },
    base: base
      ? {
          version: base.version ?? null,
          hash: base.hash ?? null,
          data: base.data ?? null,
        }
      : null,
    detectedAt: at ?? Date.now(),
    resolved,
  };
}
