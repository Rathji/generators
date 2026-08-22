// Validation tests for Task #164: Final Score Calculation — an S/A/B/C/D
// rank derived from party stats, gold, crystals, story beats, bestiary, and
// completion time.

import { FinalScoreSystem, GRADE_THRESHOLDS } from "../engine/final-score.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

function build() {
  const state = new GameState();
  const party = new PartyManager({ gold: 5000 });
  for (const id of ["hero", "mage", "healer"]) {
    party.add(new Character({ id, name: id, classId: id === "hero" ? "warrior" : id === "mage" ? "blackMage" : "whiteMage" }));
  }
  party.members.forEach((m) => { m.level = 30; });
  const playtime = { totalSec: () => 2 * 3600 };
  const bestiary = { knownCount: () => 10, total: () => 10 };
  return { state, party, playtime, bestiary };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("grades ordered S..D", GRADE_THRESHOLDS[0].grade === "S" && GRADE_THRESHOLDS[4].grade === "D");

  // Fully maxed -> S.
  const maxed = build();
  for (const f of ["crystal_fire", "crystal_water", "crystal_earth", "crystal_wind"]) maxed.state.setFlag(f, true);
  const storyFlags = new FinalScoreSystem({ state: maxed.state }).storyFlags;
  for (const f of storyFlags) maxed.state.setFlag(f, true);
  const evMax = new FinalScoreSystem({ state: maxed.state, party: maxed.party, bestiary: maxed.bestiary, playtime: maxed.playtime }).evaluate();
  check("maxed scores 100", evMax.score === 100 && evMax.grade === "S" && evMax.gradeLabel === "Legend of Light");
  check("components present", evMax.components.length >= 6);

  // Fresh save -> D.
  const fresh = build();
  fresh.party.members.forEach((m) => { m.level = 1; });
  fresh.party.gold = 0;
  const evLow = new FinalScoreSystem({ state: fresh.state, party: fresh.party, bestiary: { knownCount: () => 0, total: () => 10 }, playtime: { totalSec: () => 0 } }).evaluate();
  check("fresh save ranks D", evLow.score < 40 && evLow.grade === "D");

  // Story component counts milestone flags.
  const mid = build();
  mid.state.setFlag("story_garland_defeated", true);
  mid.state.setFlag("story_chaos_defeated", true);
  const sys = new FinalScoreSystem({ state: mid.state, party: mid.party });
  const storyComp = sys.components().find((c) => c.key === "story");
  check("story beats counted", storyComp.points === Math.round((2 / 8) * 100) && storyComp.note === "2/8");

  // Crystals component.
  mid.state.setFlag("crystal_fire", true);
  mid.state.setFlag("crystal_water", true);
  const crystalComp = sys.components().find((c) => c.key === "crystals");
  check("crystals counted", crystalComp.points === 50 && crystalComp.note === "2/4");

  // Time component: faster is better.
  const fast = new FinalScoreSystem({ playtime: { totalSec: () => 60 } });
  const slow = new FinalScoreSystem({ playtime: { totalSec: () => 20 * 3600 } });
  check("time rewards speed", fast.components().find((c) => c.key === "time").points === 100);
  check("time penalizes slowness", slow.components().find((c) => c.key === "time").points === 40);

  // Bestiary component is null when no bestiary system.
  const noBest = new FinalScoreSystem({ state: build().state, party: build().party });
  check("bestiary omitted without system", noBest.components().some((c) => c.key === "bestiary") === false);

  // Summary includes the grade.
  check("summary mentions rank", evMax.summary.startsWith("S-rank"));

  return out;
}
