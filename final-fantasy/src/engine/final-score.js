// Task #164: Final Score Calculation — a rank (S/A/B/C/D) from final stats,
// gold, crystals, story progress, and completion time. Each component scores
// 0-100; the total is the rounded mean, and the grade thresholds follow.

import { fmtDuration } from "./playtime.js";

export const MAIN_STORY_FLAGS = [
  "story_garland_defeated",
  "story_marsh_guardian_defeated",
  "story_gulg_guardian_defeated",
  "story_ember_fiend_defeated",
  "story_forge_colossus_defeated",
  "story_chrono_defeated",
  "story_chaos_defeated",
  "story_crystals_restored",
];

export const GRADE_THRESHOLDS = [
  { grade: "S", min: 90, label: "Legend of Light" },
  { grade: "A", min: 75, label: "Hero of the Realm" },
  { grade: "B", min: 60, label: "Champion" },
  { grade: "C", min: 40, label: "Adventurer" },
  { grade: "D", min: 0, label: "Wanderer" },
];

export class FinalScoreSystem {
  constructor(opts = {}) {
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.bestiary = opts.bestiary ?? null;
    this.crystals = opts.crystals ?? null;
    this.playtime = opts.playtime ?? null; // PlaytimeTracker or {totalSec}
    this.storyFlags = opts.storyFlags ?? MAIN_STORY_FLAGS;
    this.random = opts.random ?? Math.random;
  }

  avgLevel() {
    const members = this.party?.members ?? [];
    if (!members.length) return 0;
    return members.reduce((s, m) => s + (m.level ?? 1), 0) / members.length;
  }

  gold() {
    return this.party?.gold ?? 0;
  }

  crystalCount() {
    const names = ["crystal_fire", "crystal_water", "crystal_earth", "crystal_wind"];
    return names.filter((f) => this.state?.getFlag(f)).length;
  }

  storyDone() {
    return this.storyFlags.filter((f) => this.state?.getFlag(f)).length;
  }

  bestiaryPct() {
    if (!this.bestiary || !this.bestiary.total()) return null;
    return this.bestiary.knownCount() / this.bestiary.total();
  }

  // Each component: {key, label, points (0-100), note}.
  components() {
    const out = [];
    const lvl = this.avgLevel();
    out.push({
      key: "level",
      label: "Average Level",
      points: Math.round(Math.min(1, lvl / 30) * 100),
      note: lvl.toFixed(1),
    });
    const gold = this.gold();
    out.push({
      key: "gold",
      label: "Gold Hoarded",
      points: Math.round(Math.min(1, gold / 5000) * 100),
      note: gold + "g",
    });
    const crystals = this.crystalCount();
    out.push({
      key: "crystals",
      label: "Crystals Restored",
      points: Math.round((crystals / 4) * 100),
      note: crystals + "/4",
    });
    const story = this.storyDone();
    out.push({
      key: "story",
      label: "Story Beats",
      points: Math.round((story / this.storyFlags.length) * 100),
      note: story + "/" + this.storyFlags.length,
    });
    const bp = this.bestiaryPct();
    if (bp != null) {
      out.push({
        key: "bestiary",
        label: "Bestiary",
        points: Math.round(bp * 100),
        note: (this.bestiary?.knownCount() ?? 0) + "/" + (this.bestiary?.total() ?? 0),
      });
    }
    const totalSec = this.playtime?.totalSec?.() ?? (this.playtime?.totalSec ?? 0);
    const time = totalSec;
    const timePoints = time <= 3 * 3600 ? 100 : time <= 6 * 3600 ? 80 : time <= 10 * 3600 ? 60 : 40;
    out.push({
      key: "time",
      label: "Completion Time",
      points: timePoints,
      note: fmtDuration(time),
    });
    return out;
  }

  evaluate() {
    const components = this.components();
    const score = Math.round(components.reduce((s, c) => s + c.points, 0) / components.length);
    const grade = GRADE_THRESHOLDS.find((g) => score >= g.min) ?? GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
    return {
      score,
      grade: grade.grade,
      gradeLabel: grade.label,
      components,
      summary:
        grade.grade +
        "-rank: " +
        grade.label +
        " — " +
        score +
        "/100 (" +
        components.map((c) => c.label + " " + c.points).join(", ") +
        ")",
    };
  }

  describe() {
    return this.evaluate().summary;
  }
}
