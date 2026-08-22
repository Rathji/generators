// Validation tests for Task #201: the New Game data config — every id it
// references must exist in the game's data, and the starting cell must be a
// real, walkable tile on a real map.

import { NEW_GAME } from "../data/new-game.js";
import { CLASSES } from "../data/classes.js";
import { ITEMS } from "../data/items.js";
import { MAPS } from "../data/maps.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("config exists", !!NEW_GAME && typeof NEW_GAME === "object");
  check("start location set", !!NEW_GAME.start?.mapId);
  check("gold is a positive number", typeof NEW_GAME.gold === "number" && NEW_GAME.gold >= 0);
  check("party has members", Array.isArray(NEW_GAME.party) && NEW_GAME.party.length >= 3);

  const seen = new Set();
  for (const p of NEW_GAME.party) {
    check("party member class valid: " + p.id, !!CLASSES[p.classId]);
    check("party member id unique: " + p.id, !seen.has(p.id));
    seen.add(p.id);
  }

  for (const [itemId, count] of NEW_GAME.items) {
    check("item exists: " + itemId, !!ITEMS[itemId]);
    check("item count positive: " + itemId, typeof count === "number" && count >= 1);
  }

  check("intro flag set", NEW_GAME.flags?.intro_seen === true);
  check("prologue non-empty", Array.isArray(NEW_GAME.prologue) && NEW_GAME.prologue.length >= 3 && NEW_GAME.prologue.every((l) => typeof l === "string" && l.length > 0));

  const mapDef = MAPS.find((m) => m.id === NEW_GAME.start.mapId);
  check("start map exists", !!mapDef, String(NEW_GAME.start.mapId));
  if (mapDef) {
    const rows = mapDef.rows;
    const x = NEW_GAME.start.x;
    const y = NEW_GAME.start.y;
    check("start row in bounds", y >= 0 && y < rows.length);
    check("start col in bounds", y >= 0 && y < rows.length && x >= 0 && x < rows[y].length);
    const tile = y >= 0 && y < rows.length && x >= 0 && x < rows[y].length ? rows[y][x] : "?";
    check("start tile is walkable", y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && !(mapDef.solid ?? {})[tile], "tile=" + tile);
  }

  check("checkpoint mirrors start", NEW_GAME.checkpoint?.mapId === NEW_GAME.start.mapId && NEW_GAME.checkpoint?.name);
  return out;
}
