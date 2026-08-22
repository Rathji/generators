// Validation tests for Task #121: boundary (invisible-wall) collision mapping.

import { BoundarySystem } from "../engine/boundaries.js";
import { BOUNDARIES } from "../data/boundaries.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";

function make() {
  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  return { sys: new BoundarySystem(BOUNDARIES, { maps }), maps };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const { sys } = make();

  check("boundaries defined for overworld", sys.defsFor("overworld").length > 0);
  check("no boundaries for cornelia", sys.defsFor("cornelia").length === 0);

  check("north wall blocks (25,5)", sys.isBlocked("overworld", 25, 5) === true);
  check("north wall blocks (24,9)", sys.isBlocked("overworld", 24, 9) === true);
  check("north wall frees (23,5)", sys.isBlocked("overworld", 23, 5) === false);
  check("glacier void blocks (26,12)", sys.isBlocked("overworld", 26, 12) === true);
  check("glacier isle walkable (25,11)", sys.isBlocked("overworld", 25, 11) === false);
  check("overworld land free (7,7)", sys.isBlocked("overworld", 7, 7) === false);
  check("town map unaffected", sys.isBlocked("cornelia", 5, 5) === false);
  check("unknown map free", sys.isBlocked("nope", 0, 0) === false);

  const wall = sys.blockedBy("overworld", 25, 5);
  check("blockedBy returns rect", wall?.id === "ow_north_mountain_wall" && wall.label.length > 0);
  check("blockedBy none null", sys.blockedBy("overworld", 7, 7) === null);

  const audit = sys.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);

  const bad = new BoundarySystem(
    { overworld: [{ id: "b1", x0: 0, y0: 0, x1: -5, y1: 10, label: "x" }, { id: "b2", x0: 30, y0: 0, x1: 40, y1: 5, label: "y" }] },
    { maps: make().maps }
  );
  const ba = bad.audit();
  check("inverted rect flagged", ba.errors.some((e) => e.error === "inverted rect"));
  check("out-of-map rect flagged", ba.errors.some((e) => e.error.includes("out of map bounds")));

  check("data rects all within map", BOUNDARIES.overworld.every((b) => b.x0 <= b.x1 && b.y0 <= b.y1));

  return out;
}
