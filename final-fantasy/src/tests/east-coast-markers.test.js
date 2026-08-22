// Validation tests for Task #169: Eastern Coast Landmark Markers — the new
// overworld landmarks along Pravog's shore road and the frozen north.

import { LANDMARKS } from "../data/landmarks.js";
import { MAPS } from "../data/maps.js";
import { LandmarkMarkerSystem } from "../engine/landmarks.js";

const COAST = ["pravog_docks", "coastal_road", "eastwatch_cliffs", "sea_caves"];
const NEW_IDS = [...COAST, "north_wastes"];
const VALID_FLAGS = new Set([null, "story_started", "ship_obtained"]);

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const overworld = MAPS.find((m) => m.id === "overworld");
  check("overworld map exists", !!overworld);

  const ids = new Set(LANDMARKS.map((m) => m.id));
  check("landmark ids unique", ids.size === LANDMARKS.length);

  const newOnes = LANDMARKS.filter((m) => NEW_IDS.includes(m.id));
  check("new landmarks present", newOnes.length === NEW_IDS.length);

  for (const id of NEW_IDS) {
    const m = LANDMARKS.find((l) => l.id === id);
    check("landmark on overworld: " + id, !!m && m.mapId === "overworld");
    check("landmark reveal flag valid: " + id, !!m && VALID_FLAGS.has(m.revealFlag));
    check("landmark in-bounds: " + id, !!overworld && !!m && m.y >= 0 && m.y < overworld.rows.length && m.x >= 0 && m.x < overworld.rows[0].length);
  }

  // The markers sit on the terrain they represent: the coastal road on open
  // land, the cliffs on the mountain wall, the caves in the treeline, and
  // the wastes across the '^' sea band (like the Ember Sanctum isle).
  const charAt = (x, y) => overworld.rows[y][x];
  check("pravog docks on open shore", charAt(3, 8) === ".");
  check("coastal road on open land", charAt(6, 8) === ".");
  check("eastwatch cliffs beside the mountain wall", charAt(5, 7) === "." && charAt(4, 7) === "#");
  check("sea caves in the treeline", charAt(1, 10) === "*");
  check("north wastes on the sea band", charAt(17, 4) === "^");
  check("ember sanctum shares the sea band", charAt(18, 2) === "^");

  // Reveal behavior: the road shows immediately; the coast markers wait for
  // the story to start; the wastes only after the Dawnbreaker sails.
  const state = {
    getFlag: (n) => n === "story_started" || n === "ship_obtained",
  };
  const sys = new LandmarkMarkerSystem(LANDMARKS, { state });
  const revealed = new Set(sys.revealed("overworld").map((m) => m.id));
  check("coastal road revealed without flags", revealed.has("coastal_road"));
  check("pravog docks revealed after story start", revealed.has("pravog_docks"));
  check("eastwatch cliffs revealed after story start", revealed.has("eastwatch_cliffs"));
  check("sea caves revealed after story start", revealed.has("sea_caves"));
  check("north wastes revealed after ship", revealed.has("north_wastes"));

  const bare = new LandmarkMarkerSystem(LANDMARKS, { state: { getFlag: () => false } });
  const bareRevealed = new Set(bare.revealed("overworld").map((m) => m.id));
  check("coast markers hidden before story", NEW_IDS.filter((i) => i !== "coastal_road").every((i) => !bareRevealed.has(i)));
  check("coastal road always visible", bareRevealed.has("coastal_road"));

  // The marker API exposes the labels for UI.
  const docks = sys.landmarkById("pravog_docks");
  check("pravog docks has a label", !!docks && typeof docks.label === "string" && docks.label.length > 0);
  const hint = sys.hint(docks, 3, 8);
  check("docks hint says you are here", hint.includes("you are here"));

  return out;
}
