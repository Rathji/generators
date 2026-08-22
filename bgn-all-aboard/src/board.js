/* ══════════════════════════════════════════════════════════════
   ALL ABOARD! — board canvas renderer (Task 23)
   Loaded via <script src="src/board.js"> after game-core.js.
   Exposes window.Board. Draws the North America map onto a 2D
   canvas: parchment background, cities with labels, every route
   in its color with length-tick separators, and claimed routes as
   chains of player-colored train cars. The player-color legend is
   HTML (rendered by app.js). The canvas sizes responsively to its
   container (width 100%, capped) and scales all geometry from the
   map's normalized coordinates, so it looks right from ~320px up
   to full desktop width.
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var TtR = window.TtR;

  // Route/card color → display hex (gray = unpainted route band).
  var COLOR_HEX = {
    purple: "#8e5bb6",
    blue: "#2f6fd6",
    orange: "#e07b26",
    white: "#f4f0e4",
    green: "#2fae8c",
    yellow: "#eec93a",
    black: "#3d3d46",
    red: "#e23b3b",
    gray: "#c7bda5",
    locomotive: "#9a6b45"
  };

  var MAP = TtR.MAP;
  var cities = MAP.cities;
  var routes = MAP.routes;

  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var k in cities) {
    var c = cities[k];
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  var spanX = maxX - minX, spanY = maxY - minY;
  var ASPECT = spanY / spanX;   // ~0.86 → height is width * ASPECT

  function ownerOf(state, rid) {
    for (var i = 0; i < state.players.length; i++)
      if (state.players[i].claimedRoutes.indexOf(rid) !== -1) return i;
    return -1;
  }

  // Pixel transform for normalized map coords: uniform scale, centered,
  // with proportional padding so labels stay inside the canvas.
  function fit(W, H, padFrac) {
    var padX = W * padFrac, padY = H * padFrac;
    var scale = Math.min((W - 2 * padX) / spanX, (H - 2 * padY) / spanY);
    var ox = (W - spanX * scale) / 2;
    var oy = (H - spanY * scale) / 2;
    return {
      scale: scale,
      x: function (nx) { return ox + (nx - minX) * scale; },
      y: function (ny) { return oy + (ny - minY) * scale; }
    };
  }

  function roundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function bandWidth(tr) { return Math.max(4, Math.min(9, tr.scale * 0.011)); }

  // On-canvas segment for a route, sharing the exact pad/offset math the
  // drawing uses, so hit-testing matches what the user sees.
  function routeGeometry(rid, tr) {
    var r = routes[rid];
    var a = cities[r.a], b = cities[r.b];
    var x1 = tr.x(a.x), y1 = tr.y(a.y);
    var x2 = tr.x(b.x), y2 = tr.y(b.y);
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return null;
    var ux = dx / len, uy = dy / len;
    var px = -uy, py = ux;
    var off = (rid.indexOf("#2") !== -1 ? -1 : 1) * Math.max(5, len * 0.055);
    var pad = Math.max(6, len * 0.04);
    return {
      sx: x1 + ux * pad + px * off, sy: y1 + uy * pad + py * off,
      ex: x2 - ux * pad + px * off, ey: y2 - uy * pad + py * off,
      ux: ux, uy: uy, px: px, py: py, len: len,
      color: r.color, length: r.length
    };
  }

  function pointSegDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function drawBackground(ctx, W, H) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#e9dcc0");
    g.addColorStop(0.5, "#ddcd9f");
    g.addColorStop(1, "#c9b583");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // soft vignette to seat the board on the page
    var v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.78);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(58,40,14,0.30)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    var bw = Math.max(2, Math.min(5, Math.min(W, H) * 0.008));
    ctx.strokeStyle = "rgba(74,58,34,0.6)";
    ctx.lineWidth = bw;
    ctx.strokeRect(bw / 2, bw / 2, W - bw, H - bw);
  }

  // Unclaimed route: colored band with perpendicular length ticks.
  // Claimed route: chain of player-colored train cars on a dark bed.
  function drawRoute(ctx, state, rid, tr, owner) {
    var g = routeGeometry(rid, tr);
    if (!g) return;
    var bw = bandWidth(tr);
    var sx = g.sx, sy = g.sy, ex = g.ex, ey = g.ey;
    var px = g.px, py = g.py;

    if (owner < 0) {
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(74,58,34,0.35)";
      ctx.lineWidth = bw + 2.5;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = COLOR_HEX[g.color];
      ctx.lineWidth = bw;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      // length ticks (separators between the L car slots)
      var dark = g.color === "black" || g.color === "blue" || g.color === "purple" ||
                 g.color === "red" || g.color === "green";
      ctx.strokeStyle = dark ? "rgba(255,250,235,0.62)" : "rgba(58,44,22,0.5)";
      ctx.lineWidth = Math.max(1.5, bw * 0.26);
      for (var i = 1; i < g.length; i++) {
        var t = i / g.length;
        var tx = sx + (ex - sx) * t, ty = sy + (ey - sy) * t;
        var hw = bw * 0.5 + 2;
        ctx.beginPath();
        ctx.moveTo(tx - px * hw, ty - py * hw);
        ctx.lineTo(tx + px * hw, ty + py * hw);
        ctx.stroke();
      }
    } else {
      // claimed: dark roadbed + a train car per length unit
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(30,22,10,0.72)";
      ctx.lineWidth = bw + 3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      var segLen = Math.sqrt((ex - sx) * (ex - sx) + (ey - sy) * (ey - sy)) / g.length;
      var carW = Math.max(3.5, segLen * 0.78);
      var carH = Math.max(5, bw + 1.5);
      var pl = state.players[owner];
      for (var i2 = 0; i2 < g.length; i2++) {
        var t2 = (i2 + 0.5) / g.length;
        var cx = sx + (ex - sx) * t2, cy = sy + (ey - sy) * t2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(ey - sy, ex - sx));
        roundedRect(ctx, -carW / 2, -carH / 2, carW, carH, 2);
        ctx.fillStyle = TtR.PLAYER_COLORS[pl.colorIndex];
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "#1d150b";
        ctx.stroke();
        roundedRect(ctx, -carW * 0.28, -carH * 0.32, carW * 0.2, carH * 0.64, 1);
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawCity(ctx, tr, name, H) {
    var c = cities[name];
    var x = tr.x(c.x), y = tr.y(c.y);
    var r = Math.max(4, Math.min(9, tr.scale * 0.009));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#4a3b25";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = "#f4ead0";
    ctx.fill();
    var fs = Math.max(9, Math.min(15, tr.scale * 0.013));
    ctx.font = "700 " + fs + "px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var tw = ctx.measureText(name).width;
    var above = y > H * 0.66;
    var ly = above ? y - r - fs * 0.55 : y + r + fs * 0.55;
    var lx = Math.max(tw / 2 + 3, Math.min(x, ctx.canvas.width - tw / 2 - 3));
    ctx.lineWidth = Math.max(2.5, fs * 0.2);
    ctx.strokeStyle = "rgba(255,250,235,0.88)";
    ctx.strokeText(name, lx, ly);
    ctx.fillStyle = "#3c2f1a";
    ctx.fillText(name, lx, ly);
  }

  // Size the canvas to its laid-out container (responsive) and return
  // a drawing context + pixel dimensions.
  function sizeToParent(canvas) {
    var W = canvas.clientWidth || 800;
    var dpr = window.devicePixelRatio || 1;
    var H = Math.round(W * ASPECT);
    canvas.style.height = H + "px";
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: W, H: H };
  }

  function render(canvas, state, opts) {
    var s = sizeToParent(canvas);
    var ctx = s.ctx, W = s.W, H = s.H;
    drawBackground(ctx, W, H);
    var tr = fit(W, H, 0.05);
    var selected = opts && opts.selected;
    // selection highlight under the chosen route so it clearly pops
    if (selected && routes[selected] && ownerOf(state, selected) < 0) {
      var sg = routeGeometry(selected, tr);
      if (sg) {
        var gw = bandWidth(tr) + 9;
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255,232,150,0.95)";
        ctx.lineWidth = gw;
        ctx.beginPath(); ctx.moveTo(sg.sx, sg.sy); ctx.lineTo(sg.ex, sg.ey); ctx.stroke();
        ctx.strokeStyle = "rgba(90,60,10,0.85)";
        ctx.lineWidth = Math.max(1.5, bandWidth(tr) * 0.3);
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(sg.sx, sg.sy); ctx.lineTo(sg.ex, sg.ey); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    var unclaimed = [], claimed = [];
    for (var rid in routes) {
      var o = ownerOf(state, rid);
      (o >= 0 ? claimed : unclaimed).push([rid, o]);
    }
    unclaimed.forEach(function (p) { drawRoute(ctx, state, p[0], tr, p[1]); });
    claimed.forEach(function (p) { drawRoute(ctx, state, p[0], tr, p[1]); });
    // route hints (Task 40): a toggleable helper that fades in the
    // routes worth looking at — green dashed = claimable right now,
    // gold glow + dashed = on a shortest path for the player's tickets.
    var hints = opts && opts.hints;
    if (hints && (hints.claimable || hints.helpful)) {
      unclaimed.forEach(function (p) {
        var rid = p[0];
        var isClaim = hints.claimable && hints.claimable.indexOf(rid) !== -1;
        var isHelp = hints.helpful && hints.helpful.indexOf(rid) !== -1;
        if (!isClaim && !isHelp) return;
        var g = routeGeometry(rid, tr);
        if (!g) return;
        ctx.lineCap = "round";
        if (isHelp) {
          ctx.strokeStyle = "rgba(242,196,84,0.30)";
          ctx.lineWidth = bandWidth(tr) + 4;
          ctx.beginPath(); ctx.moveTo(g.sx, g.sy); ctx.lineTo(g.ex, g.ey); ctx.stroke();
        }
        if (isClaim) {
          ctx.strokeStyle = "rgba(96,225,150,0.9)";
          ctx.lineWidth = Math.max(2, bandWidth(tr) * 0.55);
          ctx.setLineDash([5, 6]);
          ctx.beginPath(); ctx.moveTo(g.sx, g.sy); ctx.lineTo(g.ex, g.ey); ctx.stroke();
        } else {
          ctx.strokeStyle = "rgba(242,196,84,0.9)";
          ctx.lineWidth = Math.max(1.5, bandWidth(tr) * 0.4);
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(g.sx, g.sy); ctx.lineTo(g.ex, g.ey); ctx.stroke();
        }
        ctx.setLineDash([]);
      });
    }
    for (var name in cities) drawCity(ctx, tr, name, H);
  }

  // Which unclaimed route (if any) is under the CSS-pixel point (x,y) on
  // the canvas. Claimed routes are skipped — they are not clickable.
  // Returns null when nothing clickable is within reach.
  function hitTest(canvas, state, x, y) {
    var s = sizeToParent(canvas);
    var tr = fit(s.W, s.H, 0.05);
    var tol = Math.max(11, bandWidth(tr) + 5);
    var best = null, bestD = Infinity;
    for (var rid in routes) {
      if (ownerOf(state, rid) >= 0) continue;
      var g = routeGeometry(rid, tr);
      if (!g) continue;
      var d = pointSegDist(x, y, g.sx, g.sy, g.ex, g.ey);
      if (d < bestD) { bestD = d; best = rid; }
    }
    return bestD <= tol ? best : null;
  }

  window.Board = {
    render: render,
    hitTest: hitTest,
    COLOR_HEX: COLOR_HEX,
    ASPECT: ASPECT,
    fit: fit,
    ownerOf: ownerOf,
    routeGeometry: routeGeometry,
    // helpers for the app layer
    cityXY: function (name, W, H) {
      var tr = fit(W, H, 0.05);
      var c = cities[name];
      return { x: tr.x(c.x), y: tr.y(c.y) };
    }
  };
})();
