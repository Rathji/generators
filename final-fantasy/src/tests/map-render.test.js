// Validation tests for Task #2: Tile-Based Map Renderer.

import { TileMap } from "../engine/grid.js";
import { MapRenderer } from "../engine/renderer.js";

function stubCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: null,
    fillRect(x, y, w, h) {
      calls.push({ op: "fillRect", style: this.fillStyle, x, y, w, h });
    },
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const map = TileMap.fromAscii(
    ["abc", "def"],
    {
      tiles: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
      overhead: ["...", ".T."],
      overheadTiles: { T: 9 },
    }
  );
  check("ground tile via getTile", map.getTile(0, 0) === 1);
  check("overhead layer populated", map.getOverhead(1, 1) === 9);
  check("overhead empty is 0", map.getOverhead(0, 0) === 0);
  check("tiles alias = ground layer", map.tiles === map.ground);

  const renderer = new MapRenderer({ tileSize: 16, palette: { 1: "red", 2: "blue", 9: "green" } });

  const ctx = stubCtx();
  renderer.render(ctx, map);
  check("ground layer draws every tile", ctx.calls.length === 6);
  check("first tile drawn at 0,0 in red", ctx.calls[0].style === "red" && ctx.calls[0].x === 0 && ctx.calls[0].y === 0);
  check("second tile drawn in blue at x=16", ctx.calls[1].style === "blue" && ctx.calls[1].x === 16);
  check("tile size applied", ctx.calls[0].w === 16 && ctx.calls[0].h === 16);

  const ctx2 = stubCtx();
  renderer.renderOverhead(ctx2, map);
  check("overhead draws only non-zero tiles", ctx2.calls.length === 1);
  check("overhead tile drawn at 16,16", ctx2.calls[0].style === "green" && ctx2.calls[0].x === 16 && ctx2.calls[0].y === 16);

  const ctx3 = stubCtx();
  renderer.render(ctx3, map, { x: 1, y: 0, w: 2, h: 2 });
  check("camera culls to visible tiles", ctx3.calls.length === 4);

  const ctx4 = stubCtx();
  let entitiesDrawn = false;
  renderer.renderAll(ctx4, map, null, () => {
    entitiesDrawn = true;
  });
  check("renderAll runs entity callback", entitiesDrawn === true);
  check("renderAll draws ground + overhead", ctx4.calls.length === 7);

  const small = TileMap.fromAscii([".#"], { tiles: { ".": 1, "#": 2 } });
  const camCtx = stubCtx();
  renderer.render(camCtx, small);
  check("default camera is full map", camCtx.calls.length === 2);

  const px = stubCtx();
  renderer.paintTile(px, 1, 10.6, 3.2, 32);
  check("paintTile rounds pixels", px.calls[0].x === 11 && px.calls[0].y === 3 && px.calls[0].w === 32);

  return out;
}
