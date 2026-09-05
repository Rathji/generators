window.Render = (function () {
  "use strict";
  var HW = 24, HH = 12, TW = 48, TH = 24;
  var cv = null, ctx = null, dpr = 1, cssW = 300, cssH = 150;
  var ground = null;

  var GRASS = ["#4a6240", "#4e6744", "#47603c", "#526c48", "#455c3a"];
  var ROAD = "#3b4049";
  var ROAD_EDGE = "#5c6270";
  var LANE = "#c9a94f";

  function h2(x, y) {
    var n = (x * 374761393 + y * 668265263) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  function diamond(ctx, px, py, s) {
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + HW * s, py + HH * s);
    ctx.lineTo(px, py + TH * s);
    ctx.lineTo(px - HW * s, py + HH * s);
    ctx.closePath();
  }

  function fillDiamond(ctx, px, py, col, s) {
    s = s == null ? 1 : s;
    ctx.fillStyle = col;
    diamond(ctx, px, py, s);
    ctx.fill();
  }

  function strokeDiamond(ctx, px, py, col, s, lw) {
    s = s == null ? 1 : s;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw == null ? 1.5 : lw;
    diamond(ctx, px, py, s);
    ctx.stroke();
  }

  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function buildGround(st) {
    var W = st.W, H = st.H;
    var gw = (W + H) * HW, gh = (W + H) * HH;
    ground = document.createElement("canvas");
    ground.width = Math.max(2, Math.round(gw * dpr));
    ground.height = Math.max(2, Math.round(gh * dpr));
    var g = ground.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var ox = (H - 1) * HW;
    for (var x = 0; x < W; x++) {
      for (var y = 0; y < H; y++) {
        var px = (x - y) * HW + ox, py = (x + y) * HH;
        var i = y * W + x;
        if (st.land[i] === 1) {
          g.fillStyle = "#0c2433";
          diamond(g, px, py, 1); g.fill();
          g.fillStyle = "#0f2c40";
          diamond(g, px, py, 0.84); g.fill();
          g.fillStyle = "#123348";
          diamond(g, px, py, 0.6); g.fill();
          var r = h2(x * 3, y * 7);
          if (r > 0.55) {
            g.strokeStyle = "rgba(110,180,210,0.16)";
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(px - HW * 0.3, py + HH * 0.5);
            g.quadraticCurveTo(px, py + HH * 0.75, px + HW * 0.25, py + HH * 0.6);
            g.stroke();
          }
        } else {
          var c = GRASS[Math.floor(h2(x * 11, y * 3) * GRASS.length)];
          g.fillStyle = c;
          diamond(g, px, py, 1); g.fill();
          var speck = Math.floor(h2(x * 5, y * 13) * 4);
          g.fillStyle = "rgba(8,12,8,0.28)";
          for (var k = 0; k < speck; k++) {
            var sx = px + (h2(x + k * 7, y + k * 13) - 0.5) * HW * 1.2;
            var sy = py + HH + (h2(x + k * 3, y + k * 5) - 0.5) * TH * 0.7;
            g.fillRect(sx, sy, 2, 2);
          }
          if (h2(x * 31, y * 17) > 0.85) {
            g.fillStyle = "rgba(140,160,90,0.12)";
            g.beginPath();
            g.ellipse(px + (h2(x, y) - 0.5) * 12, py + HH + (h2(y, x) - 0.5) * 8, 6, 3, 0, 0, 7);
            g.fill();
          }
        }
      }
    }
  }

  function shade(hex, f) {
    var r, g, b;
    if (hex[0] === "#") {
      var n = parseInt(hex.slice(1), 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else {
      var m = hex.match(/\d+/g);
      r = +m[0]; g = +m[1]; b = +m[2];
    }
    if (f < 0) { r = Math.round(r * (1 + f)); g = Math.round(g * (1 + f)); b = Math.round(b * (1 + f)); }
    else { r = Math.round(r + (255 - r) * f); g = Math.round(g + (255 - g) * f); b = Math.round(b + (255 - b) * f); }
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  var nightDark = 0;
  var glowSprite = null;
  function getGlow() {
    if (glowSprite) return glowSprite;
    glowSprite = document.createElement("canvas");
    glowSprite.width = glowSprite.height = 28;
    var gc = glowSprite.getContext("2d");
    var rg = gc.createRadialGradient(14, 14, 1, 14, 14, 14);
    rg.addColorStop(0, "rgba(255,196,110,0.8)");
    rg.addColorStop(0.5, "rgba(255,170,80,0.3)");
    rg.addColorStop(1, "rgba(255,170,80,0)");
    gc.fillStyle = rg;
    gc.fillRect(0, 0, 28, 28);
    return glowSprite;
  }

  function drawBox(ctx, px, py, h, wall, roof, inset) {
    var s = inset == null ? 0.85 : inset;
    var cx = px, cy = py + HH;
    function C(rx, ry) { return [cx + (rx - cx) * s, cy + (ry - cy) * s]; }
    var T = C(px, py), R = C(px + HW, py + HH), B = C(px, py + TH), L = C(px - HW, py + HH);
    var T2 = [T[0], T[1] - h], R2 = [R[0], R[1] - h], B2 = [B[0], B[1] - h], L2 = [L[0], L[1] - h];
    poly(ctx, [L, B, B2, L2]);
    ctx.fillStyle = shade(shade(wall, -0.14), -0.38 * nightDark);
    ctx.fill();
    if (nightDark < 0.4) {
      ctx.fillStyle = "rgba(160,190,225," + (0.15 - nightDark * 0.32).toFixed(3) + ")";
      ctx.fill();
    }
    poly(ctx, [B, R, R2, B2]);
    ctx.fillStyle = shade(shade(wall, 0), -0.28 * nightDark);
    ctx.fill();
    if (nightDark < 0.4) {
      ctx.fillStyle = "rgba(255,240,205," + (0.13 - nightDark * 0.26).toFixed(3) + ")";
      ctx.fill();
    }
    poly(ctx, [T2, R2, B2, L2]);
    ctx.fillStyle = roof;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    poly(ctx, [T2, R2, B2, L2]);
    ctx.stroke();
    return {
      base: { T: T, R: R, B: B, L: L, h: h },
      roof: { T: T2, R: R2, B: B2, L: L2 }
    };
  }

  function windowsOnFace(ctx, box, face, cols, rows, night, lit) {
    var A = box.base[face[0]], Bp = box.base[face[1]];
    var h = box.base.h;
    for (var c = 1; c <= cols; c++) {
      var u = c / (cols + 1);
      for (var r2 = 1; r2 <= rows; r2++) {
        var v = r2 / (rows + 1);
        var x = A[0] + (Bp[0] - A[0]) * u;
        var yb = A[1] + (Bp[1] - A[1]) * u - v * h;
        if (night && lit) {
          var on = h2(c * 7 + (face[0].charCodeAt(0) | 0), r2 * 13 + (face[1].charCodeAt(0) | 0)) > 0.4;
          if (on) {
            ctx.fillStyle = "rgba(255,190,95,0.32)";
            ctx.fillRect(x - 2.4, yb - 5.2, 4.8, 6);
            ctx.fillStyle = "rgba(255,238,185,0.98)";
            ctx.fillRect(x - 1.3, yb - 3.6, 2.6, 3.6);
          }
        } else {
          ctx.fillStyle = "rgba(8,12,20,0.5)";
          ctx.fillRect(x - 1.3, yb - 3.6, 2.6, 3.6);
        }
      }
    }
  }

  function windows(ctx, box, cols, rows, night, lit) {
    windowsOnFace(ctx, box, ["R", "B"], cols, rows, night, lit);
    if (cols > 3) windowsOnFace(ctx, box, ["B", "L"], 3, Math.floor(rows * 0.8), night, lit);
  }

  function drawZoneBase(ctx, st, x, y, i) {
    var px = (x - y) * HW, py = (x + y) * HH;
    var z = st.zone[i];
    var cols = z === 1 ? "rgba(180,115,160,0.5)" : z === 2 ? "rgba(100,135,200,0.5)" : "rgba(160,150,85,0.5)";
    fillDiamond(ctx, px, py + 2, "rgba(46,36,26,0.6)", 0.9);
    strokeDiamond(ctx, px, py, cols, 0.9, 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(px - 4, py + HH - 1, 8, 2);
  }

  function drawTree(ctx, px, py, dark) {
    var b = py + HH;
    ctx.fillStyle = "rgba(34,22,12,0.9)";
    ctx.fillRect(px - 1.4, b - 9, 2.8, 9);
    var c1 = dark ? "#1d3222" : "#2a4a2d", c2 = dark ? "#152418" : "#1e3522";
    ctx.fillStyle = c1;
    ctx.beginPath();
    ctx.arc(px, b - 15, 7.5, 0, 7);
    ctx.fill();
    ctx.fillStyle = c2;
    ctx.beginPath();
    ctx.arc(px - 3, b - 11, 5, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,220,0.12)";
    ctx.beginPath();
    ctx.arc(px + 2, b - 17, 2.6, 0, 7);
    ctx.fill();
  }

  function drawRoad(ctx, st, x, y) {
    var px = (x - y) * HW, py = (x + y) * HH;
    fillDiamond(ctx, px, py, ROAD, 1);
    var cx = px, cy = py + HH;
    ctx.strokeStyle = LANE;
    ctx.lineWidth = 1.8;
    var seg = function (dx, dy) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx, cy + dy);
      ctx.stroke();
    };
    if (x + 1 < st.W && st.road[y * st.W + x + 1]) seg(HW / 2, HH / 2);
    if (x - 1 >= 0 && st.road[y * st.W + x - 1]) seg(-HW / 2, -HH / 2);
    if (y + 1 < st.H && st.road[(y + 1) * st.W + x]) seg(-HW / 2, HH / 2);
    if (y - 1 >= 0 && st.road[(y - 1) * st.W + x]) seg(HW / 2, -HH / 2);
    strokeDiamond(ctx, px, py, ROAD_EDGE, 0.9, 1.6);
  }

  function drawRes(ctx, px, py, dev, hh, night, powered) {
    var walls = ["#7a5660", "#6e4a55", "#845e66", "#63464f", "#77515a"];
    var roofs = ["#45303a", "#4a3540", "#3d2c35"];
    var wcol = walls[Math.floor(hh * walls.length) % walls.length];
    var rcol = roofs[Math.floor(hh * roofs.length) % roofs.length];
    var h = dev === 1 ? 12 : dev === 2 ? 18 : dev === 3 ? 28 : 42;
    var inset = dev === 4 ? 0.62 : 0.78;
    var box = drawBox(ctx, px, py, h, wcol, rcol, inset);
    if (dev >= 3) {
      windows(ctx, box, dev === 4 ? 3 : 2, Math.max(2, Math.floor(h / 11)), night, powered);
    } else {
      ctx.fillStyle = "rgba(20,12,8,0.7)";
      ctx.fillRect(box.base.B[0] - 3.5, box.base.B[1] - 6, 7, 6);
      windowsOnFace(ctx, box, ["R", "B"], 2, 1, night, powered);
    }
    if (dev === 1) {
      ctx.strokeStyle = "rgba(60,40,30,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(box.roof.T[0] + 5, box.roof.T[1] - 2);
      ctx.lineTo(box.roof.T[0] + 5, box.roof.T[1] - 11);
      ctx.stroke();
    }
    if (dev === 4 && night && powered) {
      ctx.fillStyle = "rgba(255,70,70,0.8)";
      ctx.beginPath();
      ctx.arc(px, py - 4, 1.7, 0, 7);
      ctx.fill();
    }
  }

  function drawCom(ctx, px, py, dev, hh, night, powered) {
    var walls = ["#4d5f7a", "#43546e", "#566a87", "#3c4c63"];
    var roofs = ["#38445c", "#333f55"];
    var wcol = walls[Math.floor(hh * 3) % walls.length];
    var rcol = roofs[Math.floor(hh * 2) % roofs.length];
    var h = dev === 1 ? 13 : dev === 2 ? 20 : dev === 3 ? 30 : 48;
    var inset = dev === 4 ? 0.6 : 0.78;
    var box = drawBox(ctx, px, py, h, wcol, rcol, inset);
    if (dev === 1) {
      var acc = ["#c9a94f", "#c96a4f", "#4fc9a0"][Math.floor(hh * 3) % 3];
      ctx.fillStyle = acc;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(box.base.B[0] - 11, box.base.B[1] - 2, 22, 2.6);
      ctx.globalAlpha = 1;
    }
    if (dev >= 2) {
      windows(ctx, box, dev === 4 ? 4 : 3, Math.max(2, Math.floor(h / 10)), night, powered);
    }
    if (dev >= 3) {
      ctx.fillStyle = night && powered ? "rgba(255,230,150,0.95)" : "rgba(150,160,180,0.6)";
      ctx.fillRect(box.roof.T[0] - 1.4, box.roof.T[1] - 9, 2.8, 9);
    }
    if (dev === 4) {
      var bx2 = drawBox(ctx, px, py, h - 16, shade(wcol, 0.14), shade(rcol, 0.1), 0.42);
      windowsOnFace(ctx, bx2, ["R", "B"], 3, 2, night, powered);
      if (night && powered) {
        ctx.fillStyle = "rgba(255,70,70,0.9)";
        ctx.beginPath();
        ctx.arc(px, py - 6, 1.8, 0, 7);
        ctx.fill();
      }
    }
  }

  function drawInd(ctx, px, py, dev, hh, night, powered, time) {
    var walls = ["#6d6553", "#766c57", "#635c4c", "#7d7260"];
    var roofs = ["#4a4436", "#55503f"];
    var wcol = walls[Math.floor(hh * 3) % walls.length];
    var rcol = roofs[Math.floor(hh * 2) % roofs.length];
    var h = dev === 1 ? 11 : dev === 2 ? 17 : dev === 3 ? 26 : 34;
    var inset = dev === 4 ? 0.66 : 0.8;
    var box = drawBox(ctx, px, py, h, wcol, rcol, inset);
    if (dev >= 2) {
      ctx.fillStyle = "rgba(12,10,8,0.85)";
      ctx.fillRect(box.base.B[0] - 8, box.base.B[1] - 13, 16, 13);
      ctx.fillStyle = "rgba(120,110,90,0.5)";
      ctx.fillRect(box.base.B[0] - 8, box.base.B[1] - 13, 16, 2);
    }
    if (dev >= 3) {
      ctx.fillStyle = night && powered ? "rgba(255,214,120,0.8)" : "rgba(8,10,14,0.7)";
      ctx.fillRect(box.roof.R[0] - 2.4, box.roof.R[1] + 1, 2.4, 6);
    }
    if (dev === 4 && powered) {
      for (var s = 0; s < 2; s++) {
        var ph = (time * 9 + s * 11 + hh * 40) % 15;
        ctx.fillStyle = "rgba(70,70,66," + Math.max(0, 0.26 - ph / 70) + ")";
        ctx.beginPath();
        ctx.arc(px + (s - 0.5) * 8, py - 4 - ph, 2.4 + ph * 0.16, 0, 7);
        ctx.fill();
      }
    }
  }

  function drawPark(ctx, px, py, hh, night) {
    fillDiamond(ctx, px, py + 2, "rgba(34,54,32,0.95)", 0.82);
    var n = hh > 0.5 ? 3 : 2;
    for (var k = 0; k < n; k++) {
      var tx = px + (h2(k * 9, hh * 40) - 0.5) * 26;
      var ty = py + HH * 0.5 + (h2(k * 5, hh * 21) - 0.5) * 12;
      drawTree(ctx, tx, ty + 3, hh < 0.5);
    }
    if (hh > 0.6) {
      ctx.fillStyle = "rgba(150,140,110,0.6)";
      ctx.fillRect(px - 6, py + HH - 1.6, 12, 3);
      ctx.fillStyle = "rgba(70,80,110,0.8)";
      ctx.fillRect(px - 3, py + HH - 8, 6, 7);
    }
  }

  function drawPower(ctx, px, py, hh, powered, time) {
    var box = drawBox(ctx, px, py, 15, "#6d6a62", "#54514a", 0.92);
    ctx.fillStyle = "#5c5951";
    poly(ctx, [box.base.L, box.base.B, [box.base.B[0], box.base.B[1] - 9], [box.base.L[0], box.base.L[1] - 9]]);
    ctx.fill();
    ctx.fillStyle = "#7d7a70";
    ctx.fillRect(px - 3, py - 20, 6, 5);
    ctx.fillStyle = "#403e39";
    ctx.fillRect(px - 2.4, py - 58, 4.8, 40);
    ctx.fillStyle = "#8a8780";
    ctx.fillRect(px - 3.6, py - 60, 7.2, 4);
    if (powered) {
      for (var s = 0; s < 4; s++) {
        var ph = (time * 7 + s * 9 + hh * 40) % 18;
        ctx.fillStyle = "rgba(110,110,108," + Math.max(0, 0.3 - ph / 60) + ")";
        ctx.beginPath();
        ctx.arc(px + (s - 1.5) * 3, py - 66 - ph, 2.4 + ph * 0.2, 0, 7);
        ctx.fill();
      }
    }
    ctx.fillStyle = "rgba(20,16,12,0.75)";
    ctx.fillRect(px - 9, py + HH - 3, 18, 3);
  }

  function drawTower(ctx, px, py, hh, night) {
    var baseY = py + HH;
    ctx.fillStyle = "#77746e";
    ctx.fillRect(px - 13, baseY - 2.5, 8, 2.5);
    ctx.fillRect(px + 5, baseY - 2.5, 8, 2.5);
    ctx.fillStyle = "#9b9790";
    ctx.fillRect(px - 12, baseY - 21, 2, 19);
    ctx.fillRect(px + 10, baseY - 21, 2, 19);
    ctx.fillRect(px - 1.6, baseY - 27, 3.2, 27);
    ctx.fillStyle = "#5d5a55";
    ctx.beginPath();
    ctx.ellipse(px - 1.6, baseY - 34, 8, 4.6, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#78756f";
    ctx.beginPath();
    ctx.ellipse(px - 3.2, baseY - 38, 6.6, 3.8, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#3f3f3b";
    ctx.beginPath();
    ctx.ellipse(px - 4.6, baseY - 41.6, 5.4, 3, 0, 0, 7);
    ctx.fill();
    if (night) {
      ctx.fillStyle = "rgba(160,220,255,0.14)";
      ctx.beginPath();
      ctx.arc(px - 1.6, baseY - 30, 10, 0, 7);
      ctx.fill();
    }
  }

  function drawPolice(ctx, px, py, hh, big, night) {
    var wcol = big ? "#2b3f5e" : "#34517a";
    var h = big ? 32 : 21;
    var inset = big ? 0.8 : 0.66;
    var box = drawBox(ctx, px, py, h, wcol, big ? "#22314a" : "#27405e", inset);
    ctx.fillStyle = "rgba(10,14,22,0.75)";
    ctx.fillRect(box.base.B[0] - 7, box.base.B[1] - 7, 14, 7);
    ctx.fillStyle = "#c9a94f";
    ctx.beginPath();
    ctx.arc(box.base.B[0], box.base.B[1] - 8, 3, 0, 7);
    ctx.fill();
    ctx.fillStyle = big ? "#d8dde6" : "#b8c4d4";
    ctx.beginPath();
    ctx.arc(box.base.B[0], box.base.B[1] - 8, 1.4, 0, 7);
    ctx.fill();
    if (night) {
      var on = Math.floor(Date.now() / 600) % 2 === 0;
      ctx.fillStyle = on ? "rgba(255,120,120,0.95)" : "rgba(130,150,255,0.95)";
      ctx.beginPath();
      ctx.arc(box.roof.T[0], box.roof.T[1] - 2, 2, 0, 7);
      ctx.fill();
    }
    windows(ctx, box, big ? 3 : 2, 2, night, true);
  }

  function drawArkham(ctx, px, py, hh, night) {
    var stone = "#4a4f58", dark = "#31353d";
    drawBox(ctx, px, py, 24, stone, dark, 0.86);
    var sideL = drawBox(ctx, px - HW * 0.42, py - 2, 16, shade(stone, 0.06), dark, 0.2);
    var sideR = drawBox(ctx, px + HW * 0.42, py + 2, 18, shade(stone, -0.08), dark, 0.2);
    ctx.fillStyle = "#23262c";
    poly(ctx, [sideL.roof.T, [sideL.roof.T[0] + 2, sideL.roof.T[1] - 16], [sideL.roof.B[0] + 2, sideL.roof.B[1] - 16], sideL.roof.B]);
    ctx.fill();
    ctx.fillStyle = night ? "rgba(150,255,180,0.8)" : "rgba(26,50,36,0.85)";
    ctx.fillRect(sideR.base.R[0] - 2, sideR.base.R[1] - 8, 2, 8);
    if (night) {
      ctx.fillStyle = "rgba(150,255,180,0.16)";
      ctx.beginPath();
      ctx.arc(px, py - 8, 14, 0, 7);
      ctx.fill();
    }
  }

  function drawBatcave(ctx, px, py, hh) {
    ctx.fillStyle = "rgba(12,14,18,0.92)";
    ctx.beginPath();
    ctx.moveTo(px, py + HH);
    ctx.quadraticCurveTo(px - HW * 0.75, py - 6, px - HW * 0.95, py + HH * 0.5);
    ctx.quadraticCurveTo(px - HW * 0.5, py - 2, px, py - 4);
    ctx.quadraticCurveTo(px + HW * 0.55, py - 6, px + HW * 1.05, py + HH * 0.6);
    ctx.quadraticCurveTo(px + HW * 0.55, py + 2, px, py + HH);
    ctx.fill();
    ctx.fillStyle = "#10131b";
    ctx.beginPath();
    ctx.arc(px, py + HH - 2, 8, Math.PI * 0.1, Math.PI * 0.95);
    ctx.fill();
    ctx.fillStyle = "#262c3a";
    ctx.beginPath();
    ctx.arc(px, py + HH - 4, 5, Math.PI * 0.15, Math.PI * 0.9);
    ctx.fill();
    ctx.strokeStyle = "rgba(180,200,240,0.3)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px - 8, py + HH - 2);
    ctx.lineTo(px + 8, py + HH - 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(220,230,255,0.35)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("\u22C2", px + 9, py + HH);
  }

  function drawWayne(ctx, px, py, hh, night) {
    var base = drawBox(ctx, px, py, 32, "#39424e", "#2b323c", 0.94);
    var mid = drawBox(ctx, px, py, 58, "#47525f", "#343b45", 0.66);
    var top = drawBox(ctx, px, py, 82, "#5a6672", "#454e58", 0.4);
    ctx.fillStyle = "#c9a94f";
    ctx.fillRect(px - 1, py - 94, 2, 14);
    ctx.fillStyle = night ? "rgba(255,230,150,0.95)" : "rgba(220,190,110,0.95)";
    ctx.beginPath();
    ctx.arc(px, py - 96, 1.8, 0, 7);
    ctx.fill();
    windowsOnFace(ctx, base, ["R", "B"], 3, 2, night, true);
    windowsOnFace(ctx, mid, ["R", "B"], 3, 4, night, true);
    ctx.strokeStyle = "rgba(210,225,255,0.14)";
    ctx.lineWidth = 2;
    for (var k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.moveTo(px - 10 + k * 5, py - 2);
      ctx.lineTo(px - 10 + k * 5, py - 56);
      ctx.stroke();
    }
  }

  function drawBeacon(ctx, px, py, hh, night, powered, time) {
    drawBox(ctx, px, py, 34, "#20242c", "#171a20", 0.74);
    var mid = drawBox(ctx, px, py, 52, "#2b303b", "#20242c", 0.46);
    ctx.fillStyle = night && powered ? "rgba(255,242,190,1)" : "rgba(235,235,230,0.95)";
    ctx.beginPath();
    ctx.arc(px, py - 8, 3, 0, 7);
    ctx.fill();
  }

  function drawNightLights(ctx, st) {
    if (st.light >= 0.35) return;
    var W = st.W, H = st.H, z = st.cam.z, ox = st.cam.ox, oy = st.cam.oy;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var zz = st.zone[i], dd = st.dev[i];
        if (zz === 0 || dd < 3 || st.power[i] === 0) continue;
        var px = (x - y) * HW, py = (x + y) * HH;
        var h, inset, cols, rows;
        if (zz === 1) { h = dd === 4 ? 42 : 28; inset = dd === 4 ? 0.62 : 0.78; cols = dd === 4 ? 3 : 2; rows = Math.max(2, Math.floor(h / 11)); }
        else if (zz === 2) { h = dd === 4 ? 48 : 30; inset = dd === 4 ? 0.6 : 0.78; cols = dd === 4 ? 4 : 3; rows = Math.max(2, Math.floor(h / 10)); }
        else continue;
        var cx = px, cy = py + HH, s = inset;
        var T = [cx + (px - cx) * s, cy + (py - cy) * s];
        var R = [cx + (px + HW - cx) * s, cy + (py + HH - cy) * s];
        var Bp = [cx + (px - cx) * s, cy + (py + TH - cy) * s];
        var A = R, B2 = Bp;
        var tw = cols + 1, rw = rows + 1;
        for (var c = 1; c <= cols; c++) {
          var u = c / tw;
          for (var r = 1; r <= rows; r++) {
            var v = r / rw;
            if (h2(c * 7 + 82, r * 13 + 66) <= 0.4) continue;
            var wx = A[0] + (B2[0] - A[0]) * u;
            var wy = A[1] + (B2[1] - A[1]) * u - v * h;
            var sx = wx * z + ox, sy = wy * z + oy;
            if (sx < -12 || sx > cssW + 12 || sy < -12 || sy > cssH + 12) continue;
            ctx.drawImage(getGlow(), sx - 8, sy - 8, 16, 16);
            ctx.fillStyle = "rgba(255,184,100,0.4)";
            ctx.fillRect(sx - 2.4, sy - 2.6, 4.8, 5.4);
            ctx.fillStyle = "rgba(255,236,180,0.95)";
            ctx.fillRect(sx - 1.2, sy - 1.3, 2.4, 3);
          }
        }
      }
    }
    ctx.restore();
  }

  function drawBeaconLight(ctx, px, py, powered, time) {
    if (!powered) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(px, py - 8);
    ctx.rotate(Math.sin(time * 0.8) * 0.6);
    var g = ctx.createLinearGradient(0, 0, 0, -300);
    g.addColorStop(0, "rgba(255,244,190," + (0.5 + 0.08 * Math.sin(time * 2.6)).toFixed(3) + ")");
    g.addColorStop(1, "rgba(255,244,190,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-60, -300);
    ctx.lineTo(60, -300);
    ctx.lineTo(5, 0);
    ctx.fill();
    var core = ctx.createLinearGradient(0, 0, 0, -300);
    core.addColorStop(0, "rgba(255,250,220,0.55)");
    core.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(-2.5, 0);
    ctx.lineTo(-16, -300);
    ctx.lineTo(16, -300);
    ctx.lineTo(2.5, 0);
    ctx.fill();
    ctx.restore();
    var rg = ctx.createRadialGradient(px, py - 8, 1, px, py - 8, 40);
    rg.addColorStop(0, "rgba(255,250,215,0.95)");
    rg.addColorStop(0.25, "rgba(255,240,175,0.4)");
    rg.addColorStop(1, "rgba(255,240,175,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = rg;
    ctx.fillRect(px - 40, py - 48, 80, 80);
    ctx.restore();
  }

  function drawMuseum(ctx, px, py, hh) {
    var b = drawBox(ctx, px, py, 20, "#d8d2c4", "#b5ae9e", 0.8);
    ctx.fillStyle = "#ece6d6";
    poly(ctx, [b.base.L, b.base.B, [b.base.B[0] + 8, b.base.B[1] - 9], [b.base.L[0] + 8, b.base.L[1] - 9]]);
    ctx.fill();
    for (var c = 0; c < 4; c++) {
      ctx.fillStyle = "#8d8677";
      var fx = b.base.B[0] - 10 + c * 5;
      ctx.fillRect(fx, b.base.B[1] - 8, 2.4, 8);
    }
    ctx.fillStyle = "#7a7366";
    ctx.fillRect(b.roof.T[0] - 1, b.roof.T[1], 2, -7);
    ctx.fillStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.arc(b.roof.T[0], b.roof.T[1] - 7, 2.2, 0, 7);
    ctx.fill();
  }

  function drawUni(ctx, px, py, hh) {
    var brick = "#7d4a3a", roof = "#5a3428";
    var b = drawBox(ctx, px, py, 20, brick, roof, 0.84);
    var cw = drawBox(ctx, px + 2, py - 4, 36, "#8a5442", "#6b3d2f", 0.24);
    ctx.fillStyle = "#d8c48a";
    ctx.beginPath();
    ctx.arc(cw.roof.T[0] + 2, cw.roof.T[1] - 2, 2.8, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#4a2c20";
    ctx.fillRect(cw.roof.T[0] - 1.4, cw.roof.T[1] - 10, 2.8, 6);
    ctx.fillStyle = "rgba(18,12,10,0.7)";
    ctx.fillRect(b.base.B[0] - 7, b.base.B[1] - 6, 14, 6);
  }

  function drawStadium(ctx, px, py, hh, night, time) {
    drawBox(ctx, px, py, 14, "#4a4f5e", "#3a3e4a", 1);
    var cx = px, cy = py + HH;
    ctx.fillStyle = "#2c2f38";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 13, HW * 1.0, HH * 1.66, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = night ? "rgba(180,230,180,0.45)" : "#3f8a4a";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 12, HW * 0.52, HH * 0.85, 0, 0, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(230,240,230,0.35)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 12, HW * 0.52, HH * 0.85, 0, 0, 7);
    ctx.stroke();
    for (var k = 0; k < 4; k++) {
      var a = k * 1.57 + 0.7;
      var lx = cx + Math.cos(a) * HW * 0.85;
      var ly = cy - 13 + Math.sin(a) * HH * 1.5;
      ctx.fillStyle = "#5a606e";
      ctx.fillRect(lx - 1.6, ly - 6, 3.2, 9);
      if (night) {
        ctx.fillStyle = "rgba(255,240,200,0.95)";
        ctx.beginPath();
        ctx.arc(lx, ly - 7, 1.5, 0, 7);
        ctx.fill();
      }
    }
  }

  function drawHospital(ctx, px, py, hh, night) {
    var b = drawBox(ctx, px, py, 22, "#b8bec6", "#8f959e", 0.86);
    var b2 = drawBox(ctx, px, py, 32, "#c6ccd4", "#9aa0a9", 0.52);
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(b.base.B[0] - 1.4, b.base.B[1] - 12, 2.8, 12);
    ctx.fillRect(b.base.B[0] - 7, b.base.B[1] - 6.4, 14, 2.8);
    if (night) {
      ctx.fillStyle = "rgba(255,170,160,0.4)";
      ctx.beginPath();
      ctx.arc(b2.roof.T[0], b2.roof.T[1] - 3, 3, 0, 7);
      ctx.fill();
    }
    windows(ctx, b, 3, 2, night, true);
  }

  function drawBuilding(ctx, st, x, y, i, t, time) {
    var px = (x - y) * HW, py = (x + y) * HH;
    var hh = h2(x * 13, y * 29);
    var night = st.light < 0.35;
    var z = st.zone[i], dev = st.dev[i];
    var powered = st.power[i] > 0;
    if (z === 1) drawRes(ctx, px, py, dev, hh, night, powered);
    else if (z === 2) drawCom(ctx, px, py, dev, hh, night, powered);
    else if (z === 3) drawInd(ctx, px, py, dev, hh, night, powered, time);
    switch (t) {
      case 1: drawPark(ctx, px, py, hh, night); break;
      case 2: drawPower(ctx, px, py, hh, powered, time); break;
      case 3: drawTower(ctx, px, py, hh, night); break;
      case 4: drawPolice(ctx, px, py, hh, false, night); break;
      case 5: drawPolice(ctx, px, py, hh, true, night); break;
      case 6: drawArkham(ctx, px, py, hh, night); break;
      case 7: drawBatcave(ctx, px, py, hh); break;
      case 8: drawWayne(ctx, px, py, hh, night); break;
      case 9: drawBeacon(ctx, px, py, hh, night, powered, time); break;
      case 10: drawMuseum(ctx, px, py, hh); break;
      case 11: drawUni(ctx, px, py, hh); break;
      case 12: drawStadium(ctx, px, py, hh, night, time); break;
      case 13: drawHospital(ctx, px, py, hh, night); break;
    }
  }

  function frame(st) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nightDark = Math.max(0, 1 - st.light);
    var day = Math.max(0, Math.min(1, (st.light - 0.25) / 0.75));
    var sg2 = ctx.createLinearGradient(0, 0, 0, cssH);
    sg2.addColorStop(0, "rgb(" + Math.round(8 + 95 * day) + "," + Math.round(12 + 115 * day) + "," + Math.round(26 + 145 * day) + ")");
    sg2.addColorStop(1, "rgb(" + Math.round(4 + 45 * day) + "," + Math.round(6 + 55 * day) + "," + Math.round(14 + 70 * day) + ")");
    ctx.fillStyle = sg2;
    ctx.fillRect(0, 0, cssW, cssH);
    var z = st.cam.z, ox = st.cam.ox, oy = st.cam.oy;
    ctx.translate(ox, oy);
    ctx.scale(z, z);

    if (!ground) buildGround(st);
    var gdx = (st.H - 1) * HW;
    var gw = (st.W + st.H) * HW;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ground, 0, 0, ground.width, ground.height, -gdx, 0, gw, (st.W + st.H) * HH);

    var time = st.time;
    var W = st.W, H = st.H;
    var items = [];
    var beacons = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var px = (x - y) * HW, py = (x + y) * HH;
        var bot = py + TH;
        var wx = px * z + ox, wy = bot * z + oy;
        if (wx < -80 || wx > cssW + 80 || wy < -300 || wy > cssH + 120) continue;
        items.push({ x: x, y: y, b: bot });
      }
    }
    items.sort(function (a, b2) { return a.b - b2.b || a.x - b2.x || a.y - b2.y; });

    for (var m = 0; m < items.length; m++) {
      var X = items[m].x, Y = items[m].y, i = Y * W + X;
      var tpx = (X - Y) * HW, tpy = (X + Y) * HH;
      if (st.land[i] === 1) {
        var tw = 0.08 + 0.08 * Math.sin(time * 1.5 + X * 1.7 + Y * 2.3);
        if (st.road[i]) {
          drawRoad(ctx, st, X, Y);
          ctx.strokeStyle = "rgba(160,220,255," + tw.toFixed(3) + ")";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(tpx - HW * 0.3, tpy + HH * 0.3);
          ctx.lineTo(tpx + HW * 0.1, tpy + HH * 0.5);
          ctx.stroke();
        }
        continue;
      }
      if (st.road[i]) drawRoad(ctx, st, X, Y);
      var zz = st.zone[i], dd = st.dev[i];
      if (zz > 0 && dd === 0) drawZoneBase(ctx, st, X, Y, i);
      var t = st.type[i];
      if (t === 9) beacons.push({ px: tpx, py: tpy, p: st.power[i] > 0 });
      if (t > 0) drawBuilding(ctx, st, X, Y, i, t, time);
      if (zz > 0 && dd > 0) drawBuilding(ctx, st, X, Y, i, 0, time);
    }

    if (st.crimeView) {
      for (var cg = 0; cg < W * H; cg++) {
        var ccv = st.crime[cg];
        if (ccv < 10) continue;
        var cxx = cg % W, cyy = (cg / W) | 0;
        var cpx = (cxx - cyy) * HW, cpy = (cxx + cyy) * HH;
        var cwx = cpx * z + ox, cwy = cpy * z + oy;
        if (cwx < -80 || cwx > cssW + 80 || cwy < -120 || cwy > cssH + 80) continue;
        var chue = Math.max(0, 115 - ccv * 1.15);
        ctx.globalAlpha = 0.14 + (ccv / 100) * 0.3;
        fillDiamond(ctx, cpx, cpy, "hsla(" + chue + ",85%,52%,1)", 1);
      }
      ctx.globalAlpha = 1;
    }
    if (st.coverView) {
      for (var cv = 0; cv < W * H; cv++) {
        if (!st.zone[cv] && !st.type[cv]) continue;
        var pw2 = st.power[cv] > 0, ww = st.water[cv] > 0;
        var cvx = cv % W, cvy = (cv / W) | 0;
        var vpx = (cvx - cvy) * HW, vpy = (cvx + cvy) * HH;
        var vwx = vpx * z + ox, vwy = vpy * z + oy;
        if (vwx < -80 || vwx > cssW + 80 || vwy < -120 || vwy > cssH + 80) continue;
        var col2;
        if (pw2 && ww) col2 = "rgba(90,220,120,0.24)";
        else if (pw2) col2 = "rgba(255,210,80,0.26)";
        else if (ww) col2 = "rgba(80,160,255,0.26)";
        else col2 = "rgba(255,90,90,0.3)";
        fillDiamond(ctx, vpx, vpy, col2, 1);
      }
    }
    if (st.ghost) {
      var gA = st.ghost.arr;
      for (var gg = 0; gg < gA.length; gg++) {
        var gv = gA[gg];
        if (!gv) continue;
        var gx2 = gg % W, gy2 = (gg / W) | 0;
        var gpx = (gx2 - gy2) * HW, gpy = (gx2 + gy2) * HH;
        if (gv === 1) {
          ctx.globalAlpha = 0.32;
          fillDiamond(ctx, gpx, gpy, st.ghost.okCol, 1);
        } else {
          ctx.globalAlpha = 0.15;
          fillDiamond(ctx, gpx, gpy, st.ghost.badCol, 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    var cr = st.cursor;
    if (cr) {
      var cpx = (cr.x - cr.y) * HW, cpy = (cr.x + cr.y) * HH;
      ctx.lineWidth = 3;
      ctx.strokeStyle = cr.ok ? "rgba(255,235,150,0.9)" : "rgba(255,80,80,0.85)";
      diamond(ctx, cpx, cpy, 1);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      diamond(ctx, cpx, cpy, 0.94);
      ctx.stroke();
    } else if (st.hover) {
      var hpx = (st.hover.x - st.hover.y) * HW, hpy = (st.hover.x + st.hover.y) * HH;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      diamond(ctx, hpx, hpy, 1);
      ctx.stroke();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var dark = Math.max(0, 1 - st.light);
    if (dark > 0.02) {
      ctx.fillStyle = "rgba(6,12,38," + (dark * 0.5).toFixed(3) + ")";
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (st.light > 0.2 && st.light < 0.8) {
      var warm = Math.round(40 + st.light * 30);
      var gr = ctx.createLinearGradient(0, 0, 0, cssH);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, "rgba(" + warm + "," + Math.round(warm * 0.55) + ",35," + (0.05 + (0.5 - Math.abs(st.light - 0.5)) * 0.25).toFixed(3) + ")");
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    if (st.light > 0.5) {
      var sun = Math.min(1, (st.light - 0.5) * 2);
      ctx.globalCompositeOperation = "overlay";
      var sg = ctx.createLinearGradient(0, 0, 0, cssH);
      sg.addColorStop(0, "rgba(255,246,210," + (0.7 * sun).toFixed(3) + ")");
      sg.addColorStop(0.55, "rgba(255,246,210," + (0.26 * sun).toFixed(3) + ")");
      sg.addColorStop(1, "rgba(255,246,210,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalCompositeOperation = "source-over";
    }
    if (st.light < 0.35 && beacons.length) {
      for (var bi = 0; bi < beacons.length; bi++) {
        var bp = beacons[bi];
        drawBeaconLight(ctx, bp.px * z + ox, bp.py * z + oy, bp.p, time);
      }
    }
    drawNightLights(ctx, st);
    var vg = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.46, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (st.crimeView) {
      var chipW = 86, chipX = 12, chipY = cssH - 34;
      ctx.fillStyle = "rgba(8,10,18,0.72)";
      ctx.fillRect(chipX - 6, chipY - 4, chipW + 12, 26);
      ctx.font = "600 10px Segoe UI, sans-serif";
      ctx.fillStyle = "#9aa4b8";
      ctx.textAlign = "left";
      ctx.fillText("CRIME", chipX + 2, chipY);
      var cgr = ctx.createLinearGradient(chipX + 2, 0, chipX + chipW - 2, 0);
      cgr.addColorStop(0, "hsl(115,85%,50%)");
      cgr.addColorStop(0.5, "hsl(55,85%,55%)");
      cgr.addColorStop(1, "hsl(0,85%,55%)");
      ctx.fillStyle = cgr;
      ctx.fillRect(chipX + 2, chipY + 5, chipW - 4, 5);
      ctx.fillStyle = "#5d6678";
      ctx.font = "9px Segoe UI, sans-serif";
      ctx.fillText("low                          high", chipX, chipY + 18);
    }
    if (st.coverView) {
      var chW = 214, chX = cssW - chW - 12, chY2 = cssH - 34;
      ctx.fillStyle = "rgba(8,10,18,0.72)";
      ctx.fillRect(chX - 6, chY2 - 4, chW + 12, 26);
      ctx.font = "600 10px Segoe UI, sans-serif";
      ctx.fillStyle = "#9aa4b8";
      ctx.textAlign = "left";
      ctx.fillText("COVERAGE", chX + 2, chY2);
      var sw = [
        ["rgba(90,220,120,0.9)", "P+W"],
        ["rgba(255,210,80,0.9)", "no water"],
        ["rgba(80,160,255,0.9)", "no power"],
        ["rgba(255,90,90,0.9)", "none"]
      ];
      ctx.font = "9px Segoe UI, sans-serif";
      for (var s2 = 0; s2 < sw.length; s2++) {
        var sxx = chX + 2 + s2 * 49;
        ctx.fillStyle = sw[s2][0];
        ctx.fillRect(sxx, chY2 + 6, 8, 5);
        ctx.fillStyle = "#5d6678";
        ctx.fillText(sw[s2][1], sxx + 10, chY2 + 11);
      }
    }
  }

  function init(c) {
    cv = c;
    ctx = cv.getContext("2d");
  }

  function resize(w, h) {
    cssW = w; cssH = h;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.width = cssW + "px";
    cv.style.height = cssH + "px";
    ground = null;
  }

  return {
    HW: HW, HH: HH,
    init: init,
    resize: resize,
    frame: frame,
    buildGround: buildGround
  };
})();
