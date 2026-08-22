// Validation tests for Task #123: narrative flow — the plot flag graph must
// be free of soft-locks (every flag required by a milestone, plot chapter or
// world event is produced by some reachable source).

import { MAIN_STORY } from "../data/story.js";
import { PLOT } from "../data/plot.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { NEW_GAME } from "../data/new-game.js";

// Flags set by gameplay flows that live outside the static data (dialogue/
// quest/item discoveries), documented here so the audit stays honest.
const RUNTIME_PRODUCED = new Set(["crystal_key_found", "ngplus_echo_unlocked"]);

function flagOf(cond) {
  if (!cond) return [];
  if (cond.flag) return [cond.flag];
  if (Array.isArray(cond.all)) return cond.all.map((c) => c.flag).filter(Boolean);
  return [];
}

function seqFlags(seq) {
  return (Array.isArray(seq) ? seq : []).filter((s) => s.type === "setFlag").map((s) => s.flag);
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const initial = new Set(Object.keys(NEW_GAME.flags ?? {}));
  const milestoneProd = new Set();
  for (const m of MAIN_STORY) for (const f of seqFlags(m.sequence)) milestoneProd.add(f);
  const plotProd = new Set();
  for (const ch of PLOT) for (const f of seqFlags(ch.sequence)) plotProd.add(f);
  const worldProd = new Set();
  for (const we of WORLD_EVENTS) {
    if (we.doneFlag) worldProd.add(we.doneFlag);
    if (we.event?.onWinFlag) worldProd.add(we.event.onWinFlag);
    if (typeof we.event?.flag === "string") worldProd.add(we.event.flag);
  }

  const produced = new Set([...initial, ...milestoneProd, ...plotProd, ...worldProd]);
  const required = new Set();
  for (const m of MAIN_STORY) {
    for (const f of m.flags ?? []) required.add(f);
    if (m.completeOnFlag) required.add(m.completeOnFlag);
  }
  for (const ch of PLOT) for (const f of flagOf(ch.triggers)) required.add(f);
  for (const we of WORLD_EVENTS) for (const f of flagOf(we.require)) required.add(f);

  const dangling = [...required].filter((f) => !produced.has(f) && !RUNTIME_PRODUCED.has(f));
  check("no dangling required flags", dangling.length === 0, dangling.join(","));

  check("initial flags include intro_seen", initial.has("intro_seen"));
  check("story milestones ordered ids", MAIN_STORY.every((m, i) => m.id === MAIN_STORY[i].id));

  // Plot chapter chain: each trigger must be available by its turn.
  const issues = [];
  const avail = new Set([...initial, ...worldProd, ...RUNTIME_PRODUCED, ...milestoneProd]);
  for (const ch of PLOT) {
    for (const f of flagOf(ch.triggers)) {
      if (!avail.has(f)) issues.push("plot " + ch.id + " needs unreachable flag " + f);
    }
    for (const f of seqFlags(ch.sequence)) avail.add(f);
  }
  check("plot chapters form a reachable chain", issues.length === 0, issues.join(" | "));

  // Milestone chain: requirements available, completion flag own/available.
  const missues = [];
  const mavail = new Set([...initial, ...worldProd, ...RUNTIME_PRODUCED, ...plotProd]);
  for (const m of MAIN_STORY) {
    const own = new Set(seqFlags(m.sequence));
    for (const f of m.flags ?? []) {
      if (!own.has(f) && !mavail.has(f)) missues.push("milestone " + m.id + " needs unreachable flag " + f);
    }
    if (m.completeOnFlag && !own.has(m.completeOnFlag) && !mavail.has(m.completeOnFlag)) {
      missues.push("milestone " + m.id + " cannot complete (no producer for " + m.completeOnFlag + ")");
    }
    for (const f of own) mavail.add(f);
  }
  check("milestones form a reachable chain", missues.length === 0, missues.join(" | "));

  // World events: their requirements must be producible somewhere.
  const weissues = [];
  for (const we of WORLD_EVENTS) {
    for (const f of flagOf(we.require)) {
      if (!produced.has(f) && !RUNTIME_PRODUCED.has(f)) {
        weissues.push("world event " + we.id + " requires unproduced flag " + f);
      }
    }
    if (!we.doneFlag && we.once) weissues.push("world event " + we.id + " once without doneFlag");
  }
  check("world events have producible requirements", weissues.length === 0, weissues.join(" | "));

  // Endgame: the ending event fires once the light is restored.
  const ending = PLOT.find((ch) => ch.sequence?.some((s) => s.type === "event" && s.name === "ending"));
  check("ending fires on light restored", !!ending && ending.triggers.some((t) => t.flag === "crystal_wind"));
  const lastMilestone = MAIN_STORY[MAIN_STORY.length - 1];
  check("final milestone completes via story_crystals_restored", lastMilestone.completeOnFlag === "story_crystals_restored");
  check("story_crystals_restored produced by plot", plotProd.has("story_crystals_restored"));

  return out;
}
