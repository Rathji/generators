// Line-of-sight / fog-of-war math.
// World coordinates are in grid cells: x in [0,MAP_W), y in [0,MAP_H).
// Walls are line segments with endpoints on grid corners.

export const MAP_W = 22;
export const MAP_H = 17;

function cross(px, py, qx, qy, rx, ry) {
  return (qx - px) * (ry - py) - (qy - py) * (rx - px);
}

export function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function segRect(ax, ay, bx, by, x0, y0, x1, y1) {
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
  if (x0 > maxX || x1 < minX) return false;
  const minY = Math.min(ay, by), maxY = Math.max(ay, by);
  if (y0 > maxY || y1 < minY) return false;
  return segsIntersect(ax, ay, bx, by, x0, y0, x1, y0) ||
    segsIntersect(ax, ay, bx, by, x1, y0, x1, y1) ||
    segsIntersect(ax, ay, bx, by, x0, y1, x1, y1) ||
    segsIntersect(ax, ay, bx, by, x0, y0, x0, y1);
}

// Returns a Uint8Array (cols*rows) where 1 = cell visible to at least one
// viewer token. Viewer tokens are identified by id via `viewerIds`.
export function computeVisibility(tokens, walls, viewerIds, cols, rows) {
  const vis = new Uint8Array(cols * rows);
  if (!viewerIds || !viewerIds.length) return vis;
  const viewers = [];
  for (const t of tokens) {
    if (viewerIds.includes(t.id)) viewers.push(t);
  }
  if (!viewers.length) return vis;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x + 0.5, py = y + 0.5;
      for (let vi = 0; vi < viewers.length; vi++) {
        const v = viewers[vi];
        const vcx = v.x + v.w / 2, vcy = v.y + v.h / 2;

        if (px >= v.x && px < v.x + v.w && py >= v.y && py < v.y + v.h) {
          vis[y * cols + x] = 1;
          break;
        }

        const dx = px - vcx, dy = py - vcy;
        if (dx * dx + dy * dy > v.vision * v.vision) continue;

        let blocked = false;
        for (let i = 0; i < walls.length; i++) {
          const w = walls[i];
          if (segsIntersect(vcx, vcy, px, py, w.x1, w.y1, w.x2, w.y2)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        for (let i = 0; i < tokens.length; i++) {
          const o = tokens[i];
          if (o.id === v.id) continue;
          if (px >= o.x && px < o.x + o.w && py >= o.y && py < o.y + o.h) continue;
          const inset = 0.12;
          const ox0 = o.x + inset, oy0 = o.y + inset;
          const ox1 = o.x + o.w - inset, oy1 = o.y + o.h - inset;
          if (segRect(vcx, vcy, px, py, ox0, oy0, ox1, oy1)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        vis[y * cols + x] = 1;
        break;
      }
    }
  }
  return vis;
}
