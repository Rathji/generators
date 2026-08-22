// Validation tests for Task #156: Miss/Critical Hit Indicators — attack
// results classify into {kind, label, color, sfx} descriptors, rounds
// summarize into headline counts, and popup/log specs come out ready to use.

import { HitIndicatorSystem, HIT_KINDS } from "../engine/hit-indicators.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ind = new HitIndicatorSystem();

  check("miss kind defined", HIT_KINDS.miss.label === "MISS");
  check("crit kind defined", HIT_KINDS.crit.color === "#ffe14d");

  const miss = ind.classify({ missed: true });
  check("miss classified", miss.kind === "miss" && miss.label === "MISS" && miss.sfx === "miss");

  const crit = ind.classify({ critical: true, damage: 64 });
  check("crit classified", crit.kind === "crit" && crit.label === "CRITICAL!");

  const hit = ind.classify({ damage: 12 });
  check("normal hit classified", hit.kind === "hit" && hit.color === "#ff8a8a");

  const blocked = ind.classify({ blocked: true });
  check("status-blocked classified", blocked.kind === "blocked" && blocked.label === "NO EFFECT");

  const ps = ind.popupSpec({ missed: true });
  check("miss popup spec", ps.text === "MISS" && ps.kind === "miss");
  const pcrit = ind.popupSpec({ critical: true, damage: 50 });
  check("crit popup spec", pcrit.text === "-50" && pcrit.kind === "crit");
  const phit = ind.popupSpec({ damage: 7 });
  check("hit popup spec", phit.text === "-7" && phit.kind === "damage");

  const line = ind.line({ critical: true, damage: 40 }, "Hero", "Goblin");
  check("crit log line", line.includes("CRITICAL HIT") && line.includes("40"));
  check("miss log line", ind.line({ missed: true }, "Hero", "Goblin").includes("misses"));

  const sum = ind.summarize([
    { missed: true },
    { critical: true, damage: 30 },
    { damage: 5 },
    { critical: true, damage: 18 },
    { blocked: true },
  ]);
  check("round counts", sum.hits === 1 && sum.crits === 2 && sum.misses === 1 && sum.blocked === 1 && sum.total === 5);
  check("dramatic is crit", sum.dramatic === "crit" && sum.hasCrit === true && sum.hasMiss === true);
  check("dramatic line mentions crits", sum.dramaticLine.includes("2 strikes"));

  const allMiss = ind.summarize([{ missed: true }, { missed: true }]);
  check("all-miss banner", allMiss.dramatic === "miss" && allMiss.dramaticLine.includes("Every attack"));
  check("empty round is safe", ind.summarize([]).total === 0);

  return out;
}
