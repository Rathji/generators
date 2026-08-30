// Webuntu OS — Desktop root (Phase 1, Task 3; FS-backed since Task 22)
// Renders the Rathji wallpaper layer + the desktop icon grid with hover/
// selection and auto-arrange (CSS grid, column-major flow so icons never
// overlap). Icons are the shortcut/folder nodes of the virtual FS folder
// /home/user/Desktop (seeded from main.pjs's desktopDefaults config); double-
// clicking routes through window.Launcher. Exposes window.Desktop for later
// tasks (FS-backed icons, arrange, wallpaper API).

(function () {
  "use strict";

  const gridEl = document.getElementById("desktopIcons");
  const desktopEl = document.getElementById("desktop");
  const DESKTOP_PATH = "/home/user/Desktop";
  const SETTINGS_KEY = "webuntu.settings";

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // ---------- wallpaper (Task 21: choice persists; Task 25: builtins + picker;
  // Task 56: the pack — 12 built-ins) ----------
  // The stored value (webuntu.settings.wallpaper) is either a builtin name
  // (BUILTIN_WALLPAPERS), a custom image URL, or any raw CSS background value.
  // Applied by overriding the --wallpaper token on <html> — #desktop and
  // #login both read that token, so the whole screen re-paints together;
  // clearing it restores the theme default (the radial glow).
  const BUILTIN_WALLPAPERS = {
    radial:   { label: "Radial Glow",  bg: () => "var(--wp-radial)" },
    gradient: { label: "Gradient",     bg: () => "var(--wp-gradient)" },
    grid:     { label: "Grid Pattern", bg: () => "var(--wp-grid)" },
    network:  { label: "Network Hub",  bg: () => networkSvgDataUri() },
    aurora:   { label: "Aurora",       bg: () => auroraSvgDataUri() },
    orbit:    { label: "Planet",       bg: () => orbitSvgDataUri() },
    circuit:  { label: "Circuit",      bg: () => circuitSvgDataUri() },
    stars:    { label: "Stardust",     bg: () => starsSvgDataUri() },
    waves:    { label: "Waveform",     bg: () => wavesSvgDataUri() },
    hex:      { label: "Hex",          bg: () => hexSvgDataUri() },
    dusk:     { label: "Dusk",         bg: () => "var(--wp-dusk)" },
    peaks:    { label: "Peaks",        bg: () => peaksSvgDataUri() },
  };
  const BUILTIN_ORDER = ["radial", "gradient", "grid", "network", "aurora", "orbit", "circuit", "stars", "waves", "hex", "dusk", "peaks"];

  function readToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Rathji "network-hub" art, generated as a data-URI SVG from the *current*
  // accent / accent2 / theme colors, so it always matches the active palette.
  // Deterministic layout (fixed node positions) so every render is identical.
  function networkSvgDataUri() {
    const accent = readToken("--accent") || "#7c6cff";
    const accent2 = readToken("--accent2") || "#22d3ee";
    const isLight = (document.documentElement.getAttribute("data-theme") || "dark") === "light";
    const bg = isLight ? "#f5f6fa" : "#0a0e17";
    const hub = [800, 450];
    const nodes = [
      [170, 150], [330, 560], [610, 120], [880, 720], [1180, 200],
      [1430, 470], [470, 400], [1150, 530], [150, 430], [1290, 760],
      [700, 770], [940, 90],
    ];
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += `<rect width='1600' height='900' fill='${bg}'/>`;
    // outer web ring + chords (back layer)
    const ring = [0, 2, 4, 11, 7, 9, 1, 8, 0];
    let ringPath = "M" + ring.map((i) => nodes[i][0] + " " + nodes[i][1]).join(" L ");
    s += `<path d='${ringPath} Z' fill='none' stroke='${accent}' stroke-opacity='0.32' stroke-width='1.3'/>`;
    s += `<path d='M${nodes[2][0]} ${nodes[2][1]} L${nodes[4][0]} ${nodes[4][1]} L${nodes[6][0]} ${nodes[6][1]}' fill='none' stroke='${accent2}' stroke-opacity='0.28' stroke-width='1.2'/>`;
    s += `<path d='M${nodes[3][0]} ${nodes[3][1]} L${nodes[10][0]} ${nodes[10][1]} L${nodes[5][0]} ${nodes[5][1]}' fill='none' stroke='${accent2}' stroke-opacity='0.24' stroke-width='1.2'/>`;
    // spokes hub -> nodes
    for (const [x, y] of nodes) {
      s += `<line x1='${hub[0]}' y1='${hub[1]}' x2='${x}' y2='${y}' stroke='${accent}' stroke-opacity='0.5' stroke-width='1.5'/>`;
    }
    // hub glow + core
    s += `<circle cx='${hub[0]}' cy='${hub[1]}' r='74' fill='${accent}' fill-opacity='0.16'/>`;
    s += `<circle cx='${hub[0]}' cy='${hub[1]}' r='34' fill='${accent}' fill-opacity='0.32'/>`;
    s += `<circle cx='${hub[0]}' cy='${hub[1]}' r='12' fill='${accent}'/>`;
    s += `<circle cx='${hub[0]}' cy='${hub[1]}' r='4.5' fill='#fff'/>`;
    // nodes (cyan) with bright cores
    for (const [x, y] of nodes) {
      s += `<circle cx='${x}' cy='${y}' r='5.5' fill='${accent2}'/>`;
      s += `<circle cx='${x}' cy='${y}' r='2.2' fill='#fff'/>`;
    }
    s += "</svg>";
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(s)}") center/cover no-repeat`;
  }

  // Task 56 — the wallpaper pack. All generated art is accent/theme aware and
  // deterministic (seeded PRNG), so every render is identical; each returns a
  // full CSS `background` value, ready for the --wallpaper token or a thumbnail.
  function svgDataUri(svg) {
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") center/cover no-repeat`;
  }
  function pal() {
    const isLight = (document.documentElement.getAttribute("data-theme") || "dark") === "light";
    return {
      accent: readToken("--accent") || "#7c6cff",
      accent2: readToken("--accent2") || "#22d3ee",
      purple: "#8b5cf6",
      isLight,
      bg: isLight ? "#f5f6fa" : "#0a0e17",
    };
  }
  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Aurora — soft flowing curtains (radial-gradient ellipses, no SVG filters so
  // it rasterizes cheaply) over a sparse starfield.
  function auroraSvgDataUri() {
    const { accent, accent2, purple, isLight, bg } = pal();
    const rnd = mulberry32(0xA17AA5);
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += "<defs>";
    s += `<radialGradient id='ag1'><stop offset='0%' stop-color='${accent}' stop-opacity='0.85'/><stop offset='100%' stop-color='${accent}' stop-opacity='0'/></radialGradient>`;
    s += `<radialGradient id='ag2'><stop offset='0%' stop-color='${accent2}' stop-opacity='0.85'/><stop offset='100%' stop-color='${accent2}' stop-opacity='0'/></radialGradient>`;
    s += `<radialGradient id='ag3'><stop offset='0%' stop-color='${purple}' stop-opacity='0.85'/><stop offset='100%' stop-color='${purple}' stop-opacity='0'/></radialGradient>`;
    s += "</defs>";
    s += `<rect width='1600' height='900' fill='${bg}'/>`;
    s += `<ellipse cx='620' cy='540' rx='940' ry='240' transform='rotate(-24 620 540)' fill='url(#ag1)' opacity='${isLight ? 0.4 : 0.6}'/>`;
    s += `<ellipse cx='1000' cy='430' rx='780' ry='190' transform='rotate(-14 1000 430)' fill='url(#ag2)' opacity='${isLight ? 0.34 : 0.52}'/>`;
    s += `<ellipse cx='760' cy='690' rx='1000' ry='250' transform='rotate(-30 760 690)' fill='url(#ag3)' opacity='${isLight ? 0.32 : 0.48}'/>`;
    s += `<ellipse cx='360' cy='300' rx='520' ry='150' transform='rotate(-34 360 300)' fill='url(#ag2)' opacity='${isLight ? 0.22 : 0.34}'/>`;
    for (let i = 0; i < 46; i++) {
      const x = Math.round(rnd() * 1600);
      const y = Math.round(rnd() * 900);
      const r = rnd() < 0.8 ? 1 : 1.6;
      const op = (rnd() * 0.35 + 0.15).toFixed(2);
      s += `<circle cx='${x}' cy='${y}' r='${r}' fill='${rnd() < 0.28 ? accent2 : "#fff"}' opacity='${op}'/>`;
    }
    s += "</svg>";
    return svgDataUri(s);
  }

  // Planet — a ringed world with dashed orbits and a moon.
  function orbitSvgDataUri() {
    const { accent, accent2, isLight, bg } = pal();
    const rnd = mulberry32(0x0B8B17);
    const px = 1190, py = 630, R = 148;
    const rx = 330, ry = 96, rot = -16;
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += `<rect width='1600' height='900' fill='${bg}'/>`;
    for (let i = 0; i < 52; i++) {
      const x = Math.round(rnd() * 1600);
      const y = Math.round(rnd() * 900);
      if (Math.hypot(x - px, y - py) < R * 2.4) continue;
      const r = rnd() < 0.8 ? 1 : 1.7;
      const op = (rnd() * 0.4 + 0.18).toFixed(2);
      s += `<circle cx='${x}' cy='${y}' r='${r}' fill='${rnd() < 0.3 ? accent2 : "#fff"}' opacity='${op}'/>`;
    }
    const orbit = (ox, oy, oRot, col, op) => `<ellipse cx='${px}' cy='${py}' rx='${ox}' ry='${oy}' transform='rotate(${oRot} ${px} ${py})' fill='none' stroke='${col}' stroke-opacity='${op}' stroke-width='1.6' stroke-dasharray='3 16' stroke-linecap='round'/>`;
    s += orbit(540, 170, -12, accent2, isLight ? 0.45 : 0.55);
    s += orbit(370, 132, 22, accent, isLight ? 0.4 : 0.5);
    s += `<ellipse cx='${px}' cy='${py}' rx='${rx}' ry='${ry}' transform='rotate(${rot} ${px} ${py})' fill='none' stroke='${accent}' stroke-opacity='${isLight ? 0.3 : 0.38}' stroke-width='36'/>`;
    s += `<circle cx='${px}' cy='${py}' r='${(R * 1.9).toFixed(0)}' fill='${accent}' opacity='${isLight ? 0.1 : 0.14}'/>`;
    s += "<defs><radialGradient id='plGrad' cx='0.35' cy='0.28' r='1'>";
    s += `<stop offset='0%' stop-color='${isLight ? "#e6dfff" : "#d3c7ff"}'/>`;
    s += `<stop offset='52%' stop-color='${accent}'/>`;
    s += `<stop offset='100%' stop-color='${isLight ? "#4c3f9e" : "#241b52"}'/>`;
    s += "</radialGradient></defs>";
    s += `<circle cx='${px}' cy='${py}' r='${R}' fill='url(#plGrad)'/>`;
    s += `<clipPath id='plClip'><circle cx='${px}' cy='${py}' r='${R}'/></clipPath>`;
    s += `<g clip-path='url(#plClip)'><circle cx='${px + R * 0.5}' cy='${py + R * 0.5}' r='${R}' fill='rgba(8,10,20,0.3)'/></g>`;
    s += `<clipPath id='ringFront'><rect x='-2000' y='${py}' width='4000' height='2000' transform='rotate(${rot} ${px} ${py})'/></clipPath>`;
    s += `<g clip-path='url(#ringFront)'><ellipse cx='${px}' cy='${py}' rx='${rx}' ry='${ry}' transform='rotate(${rot} ${px} ${py})' fill='none' stroke='${accent2}' stroke-opacity='${isLight ? 0.7 : 0.8}' stroke-width='36'/><ellipse cx='${px}' cy='${py}' rx='${rx}' ry='${ry}' transform='rotate(${rot} ${px} ${py})' fill='none' stroke='${accent}' stroke-opacity='0.45' stroke-width='12'/></g>`;
    const ma = 0.85, mr = (-12 * Math.PI) / 180;
    const mx = px + 540 * Math.cos(ma) * Math.cos(mr) - 170 * Math.sin(ma) * Math.sin(mr);
    const my = py + 540 * Math.cos(ma) * Math.sin(mr) + 170 * Math.sin(ma) * Math.cos(mr);
    s += `<circle cx='${mx.toFixed(0)}' cy='${my.toFixed(0)}' r='16' fill='${accent2}' opacity='0.22'/>`;
    s += `<circle cx='${mx.toFixed(0)}' cy='${my.toFixed(0)}' r='9' fill='#fff'/>`;
    s += "</svg>";
    return svgDataUri(s);
  }

  // Circuit — PCB traces radiating from a central chip.
  function circuitSvgDataUri() {
    const { accent, accent2, purple, isLight, bg } = pal();
    const rnd = mulberry32(0xC1AC17);
    const cx = 800, cy = 440, cw = 136, ch = 136;
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += `<rect width='1600' height='900' fill='${bg}'/>`;
    s += `<circle cx='340' cy='250' r='380' fill='${accent}' opacity='${isLight ? 0.09 : 0.12}'/>`;
    s += `<circle cx='1290' cy='720' r='420' fill='${accent2}' opacity='${isLight ? 0.08 : 0.1}'/>`;
    const pads = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd() * 0.22;
      const rad = 430 + rnd() * 260;
      pads.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad * 0.92 });
    }
    const cols = [accent, accent2, purple];
    for (const p of pads) {
      const col = cols[Math.floor(rnd() * cols.length)];
      const op = isLight ? 0.65 : 0.5;
      const wd = 2 + Math.round(rnd() * 2);
      const midY = p.y + (cy - p.y) * 0.5;
      const landX = cx + (p.x < cx ? -cw / 2 : cw / 2);
      s += `<path d='M${p.x.toFixed(0)} ${p.y.toFixed(0)} V${midY.toFixed(0)} L${landX} ${cy}' fill='none' stroke='${col}' stroke-opacity='${op}' stroke-width='${wd}' stroke-linecap='round'/>`;
      s += `<rect x='${(p.x - 4).toFixed(0)}' y='${(p.y - 4).toFixed(0)}' width='8' height='8' fill='${col}' opacity='${(op + 0.25).toFixed(2)}'/>`;
      s += `<circle cx='${p.x.toFixed(0)}' cy='${midY.toFixed(0)}' r='3' fill='#fff' opacity='0.85'/>`;
    }
    s += `<rect x='${cx - cw / 2}' y='${cy - ch / 2}' width='${cw}' height='${ch}' rx='16' fill='${isLight ? "#ffffff" : "#131d36"}' stroke='${accent}' stroke-opacity='0.9' stroke-width='2.5'/>`;
    s += `<rect x='${cx - cw / 2 + 11}' y='${cy - ch / 2 + 11}' width='${cw - 22}' height='${ch - 22}' rx='9' fill='none' stroke='${accent2}' stroke-opacity='0.55' stroke-width='1.5'/>`;
    s += `<circle cx='${cx}' cy='${cy}' r='17' fill='${accent}'/><circle cx='${cx}' cy='${cy}' r='5.5' fill='#fff'/>`;
    s += "</svg>";
    return svgDataUri(s);
  }

  // Stardust — a dense starfield with a soft milky-way band (radial-gradient
  // ellipse, no SVG filters) and a handful of glowing stars.
  function starsSvgDataUri() {
    const { accent, accent2, isLight, bg } = pal();
    const rnd = mulberry32(0x574A2C);
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += "<defs><radialGradient id='milky'><stop offset='0%' stop-color='#fff' stop-opacity='0.95'/><stop offset='55%' stop-color='#fff' stop-opacity='0.55'/><stop offset='100%' stop-color='#fff' stop-opacity='0'/></radialGradient></defs>";
    s += `<rect width='1600' height='900' fill='${bg}'/>`;
    const band = (cx, cy, rx, ry, rot, op) => `<ellipse cx='${cx}' cy='${cy}' rx='${rx}' ry='${ry}' transform='rotate(${rot} ${cx} ${cy})' fill='url(#milky)' opacity='${op}'/>`;
    s += band(820, 640, 1250, 260, -24, isLight ? 0.16 : 0.1);
    s += band(820, 640, 1250, 120, -24, isLight ? 0.2 : 0.14);
    s += band(380, 250, 700, 150, -36, isLight ? 0.1 : 0.07);
    for (let i = 0; i < 220; i++) {
      const x = Math.round(rnd() * 1600);
      const y = Math.round(rnd() * 900);
      const r = Math.pow(rnd(), 2.4) * 2.2 + 0.4;
      const roll = rnd();
      const col = roll < 0.14 ? accent : roll < 0.26 ? accent2 : "#fff";
      s += `<circle cx='${x}' cy='${y}' r='${r.toFixed(1)}' fill='${col}' opacity='${(rnd() * 0.6 + 0.3).toFixed(2)}'/>`;
    }
    for (let i = 0; i < 30; i++) {
      const x = Math.round(rnd() * 1600);
      const y = Math.round(rnd() * 900);
      s += `<circle cx='${x}' cy='${y}' r='${(1.6 + rnd() * 1.2).toFixed(1)}' fill='#fff' opacity='${(rnd() * 0.3 + 0.55).toFixed(2)}'/>`;
    }
    for (let i = 0; i < 3; i++) {
      const x = 160 + Math.round(rnd() * 1280);
      const y = 160 + Math.round(rnd() * 580);
      const r = 2.5 + rnd() * 2.5;
      s += `<circle cx='${x}' cy='${y}' r='${(r * 3).toFixed(1)}' fill='${rnd() < 0.5 ? accent2 : accent}' opacity='${isLight ? 0.1 : 0.16}'/>`;
      s += `<circle cx='${x}' cy='${y}' r='${r.toFixed(1)}' fill='#fff'/>`;
    }
    s += "</svg>";
    return svgDataUri(s);
  }

  // Waveform — layered sine surfaces under a bright crest line.
  function wavesSvgDataUri() {
    const { accent, accent2, purple, isLight, bg } = pal();
    const fillWave = (base, amp, freq, phase, col, op) => {
      let d = `M-100 ${base}`;
      for (let x = -100; x <= 1700; x += 32) {
        const y = base + Math.sin((x / 1600) * freq * Math.PI * 2 + phase) * amp;
        d += ` L${x} ${y.toFixed(1)}`;
      }
      d += ` L1700 900 L-100 900 Z`;
      return `<path d='${d}' fill='${col}' opacity='${op}'/>`;
    };
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += `<rect width='1600' height='900' fill='${bg}'/>`;
    s += fillWave(560, 90, 3, 0.6, accent2, isLight ? 0.13 : 0.17);
    s += fillWave(660, 130, 2, 1.4, accent, isLight ? 0.15 : 0.19);
    s += fillWave(780, 150, 4, 0.1, purple, isLight ? 0.14 : 0.18);
    let d = "M-100 560";
    for (let x = -100; x <= 1700; x += 32) {
      d += ` L${x} ${(560 + Math.sin((x / 1600) * 3 * Math.PI * 2 + 0.6) * 90).toFixed(1)}`;
    }
    s += `<path d='${d}' fill='none' stroke='${accent2}' stroke-opacity='${isLight ? 0.5 : 0.62}' stroke-width='3' stroke-linecap='round'/>`;
    s += "</svg>";
    return svgDataUri(s);
  }

  // Hex — a honeycomb of outlined hexagons over soft accent glows.
  function hexSvgDataUri() {
    const { accent, accent2, isLight, bg } = pal();
    const rnd = mulberry32(0x7A47CE);
    const side = 30;
    const dx = side * Math.sqrt(3);
    const dy = side * 1.5;
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += `<defs><pattern id='hexPat' width='${dx.toFixed(2)}' height='${(dy * 2).toFixed(2)}' patternUnits='userSpaceOnUse'>`;
    for (const [hx, hy] of [[0, 0], [dx / 2, dy], [dx, dy * 2]]) {
      let d = "";
      for (let k = 0; k < 6; k++) {
        const a = ((k * 60 + 90) * Math.PI) / 180;
        d += (k ? "L" : "M") + (hx + side * Math.cos(a)).toFixed(1) + " " + (hy + side * Math.sin(a)).toFixed(1);
      }
      d += "Z";
      if (rnd() < 0.035) {
        s += `<path d='${d}' fill='${rnd() < 0.5 ? accent : accent2}' fill-opacity='0.16'/>`;
      }
      s += `<path d='${d}' fill='none' stroke='${isLight ? "#64748b" : "#94a3b8"}' stroke-opacity='${isLight ? 0.2 : 0.18}' stroke-width='1.4'/>`;
    }
    s += "</pattern></defs>";
    s += `<rect width='1600' height='900' fill='${bg}'/>`;
    s += `<circle cx='380' cy='210' r='430' fill='${accent}' opacity='${isLight ? 0.1 : 0.13}'/>`;
    s += `<circle cx='1280' cy='760' r='470' fill='${accent2}' opacity='${isLight ? 0.08 : 0.11}'/>`;
    s += `<rect width='1600' height='900' fill='url(#hexPat)'/>`;
    s += "</svg>";
    return svgDataUri(s);
  }

  // Peaks — moonlit mountain ridges under a starry gradient sky.
  function peaksSvgDataUri() {
    const { accent, isLight, bg } = pal();
    const rnd = mulberry32(0x0C14E57);
    const ridge = (baseY, amp, seg, col) => {
      const pts = [[0, baseY + (rnd() - 0.5) * amp]];
      for (let i = 1; i <= seg; i++) {
        pts.push([(1600 / seg) * i, baseY - Math.abs(rnd()) * amp]);
      }
      const line = "M" + pts.map((p) => p[0].toFixed(0) + " " + p[1].toFixed(0)).join(" L");
      return { fill: line + " L1600 900 L0 900 Z", line };
    };
    let s = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'>";
    s += "<defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'>";
    s += `<stop offset='0%' stop-color='${isLight ? "#cfe0ff" : "#070a16"}'/>`;
    s += `<stop offset='100%' stop-color='${isLight ? "#c9b8ff" : "#1a1240"}'/>`;
    s += "</linearGradient></defs>";
    s += `<rect width='1600' height='900' fill='url(#sky)'/>`;
    for (let i = 0; i < 40; i++) {
      const x = Math.round(rnd() * 1600);
      const y = Math.round(rnd() * 520);
      s += `<circle cx='${x}' cy='${y}' r='${rnd() < 0.8 ? 1 : 1.6}' fill='#fff' opacity='${(rnd() * 0.5 + 0.2).toFixed(2)}'/>`;
    }
    s += `<circle cx='1260' cy='170' r='130' fill='#fff' opacity='${isLight ? 0.12 : 0.16}'/>`;
    s += `<circle cx='1260' cy='170' r='70' fill='#fff' opacity='${isLight ? 0.9 : 0.95}'/>`;
    s += `<circle cx='1292' cy='150' r='60' fill='${bg}' opacity='${isLight ? 0.55 : 0.25}'/>`;
    s += `<ellipse cx='800' cy='600' rx='700' ry='120' fill='${accent}' opacity='${isLight ? 0.06 : 0.1}'/>`;
    const back = ridge(660, 150, 7, isLight ? "#a9b8e8" : "#1e2450");
    s += `<path d='${back.fill}' fill='${isLight ? "#a9b8e8" : "#1e2450"}'/>`;
    s += `<path d='${back.line}' fill='none' stroke='${accent}' stroke-opacity='${isLight ? 0.4 : 0.55}' stroke-width='2.5'/>`;
    const mid = ridge(760, 180, 9, isLight ? "#8f9fd6" : "#141a3a");
    s += `<path d='${mid.fill}' fill='${isLight ? "#8f9fd6" : "#141a3a"}'/>`;
    const front = ridge(880, 160, 11, isLight ? "#7b89c2" : "#0b0f1c");
    s += `<path d='${front.fill}' fill='${isLight ? "#7b89c2" : "#0b0f1c"}'/>`;
    s += "</svg>";
    return svgDataUri(s);
  }

  function applyWallpaper(source, persist) {
    const el = document.documentElement;
    if (source) {
      if (BUILTIN_WALLPAPERS[source]) {
        el.style.setProperty("--wallpaper", BUILTIN_WALLPAPERS[source].bg());
      } else if (/^(https?:|data:|blob:)/i.test(String(source))) {
        el.style.setProperty("--wallpaper", `url("${source}") center/cover no-repeat`);
      } else {
        el.style.setProperty("--wallpaper", String(source));
      }
    } else {
      el.style.removeProperty("--wallpaper");
    }
    if (persist) {
      const s = loadSettings();
      if (source) s.wallpaper = source; else delete s.wallpaper;
      saveSettings(s);
    }
  }

  function getWallpaper() { return loadSettings().wallpaper || null; }
  function clearWallpaper() { applyWallpaper(null, true); }
  function isBuiltin(v) { return !!BUILTIN_WALLPAPERS[v]; }

  // Task 23 — "Desktop icons" toggle (Control Center). A class on <html>
  // (icons-off) hides the grid; `#desktopIcons` uses display:grid which would
  // beat the `hidden` attribute, so a CSS rule drives it instead.
  function setIconsVisible(visible, persist) {
    document.documentElement.classList.toggle("icons-off", !visible);
    if (persist) {
      const s = loadSettings();
      s.desktopIcons = !!visible;
      saveSettings(s);
    }
  }
  function getIconsVisible() {
    const stored = loadSettings().desktopIcons;
    return stored === undefined ? true : !!stored;
  }

  let items = [];
  let selectedId = null;

  function loadItems() {
    items = (window.FS && window.FS.list(DESKTOP_PATH)) || [];
  }

  function tileStyle(color) {
    const fallback =
      getComputedStyle(document.documentElement).getPropertyValue("--tile-fallback").trim() ||
      "rgba(148,163,184,.35)";
    const c = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!c) return { background: fallback };
    const hex = c[1];
    const light = hex + "cc";
    const dark = hex + "55";
    return { background: `linear-gradient(140deg, #${light}, #${dark})` };
  }

  function makeIcon(item) {
    const el = document.createElement("div");
    el.className = "desk-icon";
    el.dataset.id = item.name;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    const comingSoon = window.FS.isShortcut(item) && item.meta && item.meta.comingSoon;
    el.title = item.name + (comingSoon ? " — Coming soon" : "");

    const tile = document.createElement("div");
    tile.className = "tile";
    Object.assign(tile.style, tileStyle(item.color));
    tile.textContent = item.icon;
    el.appendChild(tile);

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = item.name;
    el.appendChild(label);

    // Task 40 — coming-soon shortcuts show a small "Soon" badge.
    if (comingSoon) {
      const soon = document.createElement("span");
      soon.className = "desk-soon";
      soon.textContent = "Soon";
      el.appendChild(soon);
    }

    return el;
  }

  function select(id, focusEl) {
    if (selectedId === id) return;
    selectedId = id;
    for (const child of gridEl.children) {
      child.classList.toggle("selected", child.dataset.id === id);
    }
    if (focusEl) focusEl.focus();
  }

  function clearSelection() {
    selectedId = null;
    for (const child of gridEl.children) child.classList.remove("selected");
  }

  function activate(item) {
    if (window.Launcher) window.Launcher.launch(item);
  }

  function render() {
    gridEl.textContent = "";
    for (const item of items) {
      const el = makeIcon(item);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        select(item.name, el);
      });
      el.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        activate(item);
      });
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          activate(item);
        }
      });
      gridEl.appendChild(el);
    }
  }

  function arrange() {
    // Auto-arrange = re-render; the CSS grid (column-major flow, fixed cells)
    // guarantees a non-overlapping layout and reflows on resize automatically.
    loadItems();
    render();
  }

  function refresh() {
    loadItems();
    render();
  }

  desktopEl.addEventListener("mousedown", (ev) => {
    if (ev.target === desktopEl) clearSelection();
  });

  window.Desktop = {
    get items() { return items; },
    get selectedId() { return selectedId; },
    refresh,
    render,
    arrange,
    clearSelection,
    setWallpaper: (source) => applyWallpaper(source, true),
    // Task 64 — apply a wallpaper without persisting it to the global setting
    // (workspaces use this for per-desktop overrides and for re-applying the
    // global wallpaper when a desktop without an override becomes active).
    apply: (source) => applyWallpaper(source, false),
    getWallpaper,
    clearWallpaper,
    WALLPAPERS: BUILTIN_ORDER.map((n) => ({ name: n, label: BUILTIN_WALLPAPERS[n].label })),
    isBuiltin,
    wallpaperThumbBg: (name) => (BUILTIN_WALLPAPERS[name] ? BUILTIN_WALLPAPERS[name].bg() : null),
    setIconsVisible,
    getIconsVisible,
  };

  // Boot-time: apply the stored wallpaper choice (if any).
  applyWallpaper(getWallpaper(), false);
  setIconsVisible(getIconsVisible(), false);

  arrange();
})();
