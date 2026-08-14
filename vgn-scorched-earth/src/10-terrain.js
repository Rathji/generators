// 10-terrain.js — destructible mountain generation + rendering
(function () {
  "use strict";

  const SE = window.SE, W = SE.W, H = SE.H;
  const MINY = 60, MAXY = 456;

  const t = {
    h: new Float32Array(W),
    groundCv: null,
    speckle: new Uint8Array(W),
  };
  SE.terrain = t;

  t.generate = function () {
    const h = t.h;
    h[0] = SE.ri(220, 320);
    h[W - 1] = SE.ri(220, 320);
    // midpoint displacement
    let spacing = W - 1, rough = 210;
    while (spacing > 1) {
      for (let i = 0; i + spacing < W; i += spacing) {
        const mid = i + (spacing >> 1);
        h[mid] = SE.clamp((h[i] + h[i + spacing]) / 2 + SE.rand(-rough, rough), MINY, MAXY);
      }
      spacing = spacing >> 1;
      rough *= 0.5;
    }
    // rolling hills / peaks
    for (let k = 0; k < 6; k++) {
      const cx = SE.ri(50, W - 50);
      const hgt = SE.ri(25, 85);
      const sigma = SE.ri(45, 130);
      const base = SE.ri(230, 350);
      for (let x = Math.max(0, Math.floor(cx - sigma * 3)); x < Math.min(W, Math.ceil(cx + sigma * 3)); x++) {
        const d = (x - cx) / sigma;
        const yy = base - hgt * Math.exp(-d * d);
        if (yy < h[x]) h[x] = yy;
      }
    }
    // light smoothing
    for (let pass = 0; pass < 2; pass++) {
      const prev = h.slice();
      for (let x = 1; x < W - 1; x++) h[x] = (prev[x - 1] + prev[x] * 2 + prev[x + 1]) / 4;
      h[0] = (h[0] + h[1]) / 2;
      h[W - 1] = (h[W - 1] + h[W - 2]) / 2;
    }
    for (let x = 0; x < W; x++) {
      h[x] = SE.clamp(Math.round(h[x]), 24, MAXY);
      t.speckle[x] = SE.ri(0, 9);
    }
  };

  t.render = function () {
    if (!t.groundCv) {
      t.groundCv = document.createElement("canvas");
      t.groundCv.width = W;
      t.groundCv.height = H;
    }
    const g = t.groundCv.getContext("2d");
    // sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2f6fd6");
    sky.addColorStop(0.6, "#7cb3e8");
    sky.addColorStop(1, "#cfe6ff");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // sun
    g.fillStyle = "rgba(255,247,192,0.9)";
    g.beginPath(); g.arc(610, 66, 30, 0, 7); g.fill();
    g.fillStyle = "#ffd95e";
    g.beginPath(); g.arc(610, 66, 22, 0, 7); g.fill();
    // clouds
    const clouds = [[130, 52, 58, 15], [320, 84, 82, 18], [470, 44, 46, 12], [210, 120, 66, 13], [630, 108, 52, 13], [60, 140, 60, 12]];
    for (const [cx, cy, rw, rh] of clouds) {
      g.fillStyle = "rgba(255,255,255,0.82)";
      g.beginPath();
      g.arc(cx, cy, rh, 0, 7);
      g.arc(cx + rw * 0.5, cy - rh * 0.5, rh * 0.9, 0, 7);
      g.arc(cx + rw, cy, rh, 0, 7);
      g.fill();
      g.fillRect(cx, cy, rw, rh);
    }
    // terrain columns
    const h = t.h;
    for (let x = 0; x < W; x++) {
      const top = h[x] | 0;
      if (top >= H) continue;
      // grass
      g.fillStyle = "#6cc13c"; g.fillRect(x, top, 1, 1);
      g.fillStyle = "#4f9e26"; g.fillRect(x, top + 1, 1, 6);
      g.fillStyle = t.speckle[x] < 3 ? "#3f8a1e" : "#5aa830";
      g.fillRect(x, top + 2, 1, 2);
      // soil
      g.fillStyle = "#8a5a2b"; g.fillRect(x, top + 7, 1, 16);
      g.fillStyle = "#7c4f24"; g.fillRect(x, top + 12, 1, 4);
      g.fillStyle = "#6f4723"; g.fillRect(x, top + 23, 1, 26);
      // rock strata
      const rockTop = top + 49;
      if (rockTop < H) {
        let band = 0;
        for (let y = rockTop; y < H; y += 26) {
          g.fillStyle = band % 2 ? "#8b7f6d" : "#9a8e7c";
          g.fillRect(x, y, 1, Math.min(26, H - y));
          band++;
        }
      }
      // edge shading
      g.fillStyle = "rgba(0,0,0,0.20)"; g.fillRect(x, top + 7, 1, 2);
      g.fillStyle = "rgba(255,255,255,0.14)"; g.fillRect(x, top + 4, 1, 2);
    }
  };

  // carve a circular crater centred on the impact point (x, y)
  t.destruct = function (cx, cy, r, depthScale) {
    depthScale = depthScale || 1;
    const h = t.h;
    const x0 = Math.max(0, Math.round(cx - r));
    const x1 = Math.min(W - 1, Math.round(cx + r));
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const rr = r * r - dx * dx;
      if (rr <= 0) continue;
      const depth = Math.sqrt(rr) * depthScale;
      const yy = cy - depth;
      if (yy < h[x]) h[x] = Math.max(24, Math.round(yy));
    }
    t.render();
  };

  t.groundAt = function (x) {
    return t.h[SE.clamp(Math.round(x), 0, W - 1)];
  };
})();
