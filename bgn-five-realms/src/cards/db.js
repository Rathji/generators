// The Alpha card database injected into the five-realms-plugin engine (roadmap Phase 6,
// task 22: spell resolution & fizzle). The plugin's engine resolves card ids against
// window.FIVE_REALMS_CARDDB, which frGameNew builds by merging a `cards` map (passed as
// newGame's config.cards) over the fixture frCardDb. Injecting the full 295-card Alpha
// projection makes Alpha cards first-class to the engine: spells resolve their declared
// effects, permanents enter correctly, and the SBA loop can run while Alpha cards are on
// the battlefield (the plugin previously "choked" on unknown ids — the caveat that used
// to forbid running the reducer with Alpha cards in play).
//
// Each record is a deep clone of the projection with effects attached (see effects.js),
// so the shared ALPHA_TO_PLUGIN / PLUGIN_CARD_MAP records — the source the local query
// layers read — stay pristine and their integrity checks keep passing.

import { ALPHA_TO_PLUGIN } from "./plugin.js";
import { attachEffects } from "./effects.js";
import { attachTriggers } from "./triggers.js";
import { attachContinuous } from "./continuous.js";
import { attachAbilities } from "./abilities.js";

let cache = null;

// alphaDb() -> { id: cardRecord } for all 295 Alpha cards, effects + triggers +
// continuous + activated-abilities attached. Built once and cached; pass it to
// engine.newGame as the config.cards map (the plugin merges it over its own fixtures, so
// both fixture and Alpha ids resolve).
export function alphaDb() {
  if (cache) return cache;
  const map = {};
  for (const rec of ALPHA_TO_PLUGIN) {
    map[rec.id] = attachAbilities(attachContinuous(attachTriggers(attachEffects(JSON.parse(JSON.stringify(rec))))));
  }
  cache = map;
  return cache;
}
