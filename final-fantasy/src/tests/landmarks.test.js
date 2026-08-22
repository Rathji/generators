// Validation tests for Task #73: Overworld Landmark Markers.

import { LandmarkMarkerSystem } from "../engine/landmarks.js";
import { LANDMARKS } from "../data/landmarks.js";

class FakeState {
  constructor(flags = {}) {
    this.flags = flags;
  }
  getFlag(n) {
    return !!this.flags[n];
  }
}

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new LandmarkMarkerSystem(LANDMARKS, { state: new FakeState() });

  check("landmark database populated", LANDMARKS.length >= 5);
  check("all landmarks on overworld", LANDMARKS.every((m) => m.mapId === "overworld"));

  const cornelia = sys.landmarkById("cornelia");
  check("cornelia landmark exists", cornelia !== null && cornelia.name === "Cornelia");
  check("markersFor returns overworld markers", sys.markersFor("overworld").length === LANDMARKS.length);
  check("markerAt finds exact tile", sys.markerAt("overworld", cornelia.x, cornelia.y)?.id === "cornelia");

  // Reveal gating: chaos_shrine hidden until crystal_key_found.
  check("chaos shrine hidden by default", !sys.isRevealed(sys.landmarkById("chaos_shrine")));
  check("cornelia visible by default", sys.isRevealed(cornelia));
  const revealedDefault = sys.revealed("overworld").map((m) => m.id);
  check("chaos shrine excluded when unrevealed", !revealedDefault.includes("chaos_shrine"));

  sys.state = new FakeState({ crystal_key_found: true, story_started: true, elfheim_unlocked: true, airship_obtained: true, ship_obtained: true });
  const revealedAll = sys.revealed("overworld").map((m) => m.id);
  check("chaos shrine appears after reveal flag", revealedAll.includes("chaos_shrine"));
  check("elfheim appears after unlock flag", revealedAll.includes("elfheim"));
  check("all landmarks revealed now", revealedAll.length === LANDMARKS.length);

  // Proximity / compass hints.
  const near = sys.markersNear("overworld", cornelia.x, cornelia.y, 2);
  check("markersNear includes adjacent landmark", near.some((m) => m.id === "cornelia"));
  const hint = sys.nearestHint("overworld", cornelia.x, cornelia.y);
  check("nearestHint returns a label", typeof hint === "string" && hint.includes("Cornelia"));
  const at = sys.hint(cornelia, cornelia.x, cornelia.y);
  check("hint at own tile says you are here", at.includes("you are here"));

  const summary = sys.summary("overworld", 0, 0);
  check("summary lists landmarks with distance", summary.length > 0 && typeof summary[0].distance === "number");

  // Landmark coordinates must be walkable in the real map.
  const { MAPS } = await import("../data/maps.js");
  const { TileMap } = await import("../engine/grid.js");
  const tm = TileMap.fromAscii(MAPS.find((m) => m.id === "overworld").rows, {
    tiles: MAPS.find((m) => m.id === "overworld").tiles,
    solid: MAPS.find((m) => m.id === "overworld").solid,
  });
  const bad = sys.all().filter((m) => !tm.inBounds(m.x, m.y) || !tm.canStand(m.x, m.y));
  check("all landmark tiles walkable", bad.length === 0, bad.map((b) => b.id + "@" + b.x + "," + b.y).join(","));

  return out;
}
