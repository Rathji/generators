// Five Realms — canonical realm definitions & symbolic emblems (typographic SVG only).
// Realms are the thematic faces of the game: each maps to one classic color letter.
// Single source of truth for realm metadata; the emblem concepts are design canon.
(function () {
  "use strict";

  const REALMS = {
    solara: { id: "solara", name: "Solara",   domain: "Order / Light",   color: "#F8F6F0", mtg: "W" },
    verdant:{ id: "verdant",name: "Verdant",  domain: "Nature / Life",   color: "#3E8E45", mtg: "G" },
    tide:   { id: "tide",    name: "Tide",     domain: "Water / Mystery", color: "#2A6CB8", mtg: "U" },
    ember:  { id: "ember",   name: "Ember",    domain: "Fire / War",      color: "#C4372E", mtg: "R" },
    umbra:  { id: "umbra",   name: "Umbra",    domain: "Shadow / Death",  color: "#19161B", mtg: "B" },
    generic:{ id: "generic", name: "—",        domain: "colourless",      color: "#9B937F", mtg: null },
  };

  const REALM_ORDER = ["solara", "verdant", "tide", "ember", "umbra"];

  function realmForColor(mtg) {
    for (const id of REALM_ORDER) if (REALMS[id].mtg === mtg) return REALMS[id];
    return REALMS.generic;
  }

  // ---- Emblem builders: each returns inner SVG markup (viewBox 0 0 100 100), single color. ----

  // Smooth logarithmic spiral path (nautilus/tendril). Never self-crosses.
  function spiralPath(cx, cy, r0, b, thetaStart, thetaEnd, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const th = thetaStart + ((thetaEnd - thetaStart) * i) / n;
      const r = r0 * Math.exp(b * th);
      pts.push((cx + r * Math.cos(th)).toFixed(2) + " " + (cy + r * Math.sin(th)).toFixed(2));
    }
    return "M " + pts.join(" L ");
  }

  function emblemSolara(c) {
    let g = `<g transform="translate(50 50)">`;
    const long = "0,-40 7,-8 -7,-8";
    const short = "0,-22 6,-8 -6,-8";
    for (const a of [0, 90, 180, 270]) g += `<polygon points="${long}" fill="${c}" transform="rotate(${a})"/>`;
    for (const a of [45, 135, 225, 315]) g += `<polygon points="${short}" fill="${c}" transform="rotate(${a})"/>`;
    g += `<circle r="6" fill="none" stroke="${c}" stroke-width="3"/>`;
    g += `<circle r="2.2" fill="${c}"/>`;
    return g + `</g>`;
  }

  function emblemVerdant(c) {
    const stem = spiralPath(58, 55, 4, 0.18, 0, 10, 140);
    let g = `<g stroke="${c}" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
    g += `<path d="${stem}" stroke-width="3.5"/>`;
    for (const th of [6.28, 7.85, 9.42]) {
      const r = 4 * Math.exp(0.18 * th);
      const x = 58 + r * Math.cos(th);
      const y = 55 + r * Math.sin(th);
      const deg = (((th + Math.PI / 2) * 180) / Math.PI) % 360;
      g += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})">` +
           `<path d="M 0 0 L 10 0" stroke-width="2"/>` +
           `<path d="M 10 0 C 14 -9, 26 -2, 30 0 C 26 2, 14 9, 10 0 Z" fill="${c}" stroke="none"/></g>`;
    }
    g += `<circle cx="62" cy="55" r="2.2" fill="${c}" stroke="none"/>`;
    g += `</g>`;
    return g;
  }

  function emblemTide(c) {
    const naut = spiralPath(50, 50, 4, 0.14, 0, 11.5, 160);
    let g = `<path fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" d="${naut}"/>`;
    const crest = `<path fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" d="M 2 24 C 4 10, 15 6, 21 14 C 26 20, 22 27, 16 25 C 13 24, 13 21, 16 19"/>`;
    g += `<g transform="translate(2 32)">${crest}</g>`;
    g += `<g transform="translate(98 32) scale(-1 1)">${crest}</g>`;
    return g;
  }

  function emblemEmber(c) {
    const flame = "50,10 58,28 66,36 62,44 70,52 60,58 64,68 54,70 56,80 50,86 44,80 46,70 36,68 40,58 30,52 38,44 34,36 42,28";
    let g = `<polygon points="${flame}" fill="${c}"/>`;
    const lines = ["M 50 10 L 50 44", "M 38 44 L 62 44", "M 50 44 L 40 58", "M 50 44 L 60 58", "M 40 58 L 50 70 L 60 58"];
    g += `<g stroke="rgba(255,255,255,0.35)" stroke-width="1.6" fill="none" stroke-linejoin="round">`;
    for (const d of lines) g += `<path d="${d}"/>`;
    g += `</g>`;
    return g;
  }

  function emblemUmbra(c) {
    let g = `<path fill="${c}" fill-rule="evenodd" d="M 55 20 a 30 30 0 1 0 0 60 a 30 30 0 1 0 0 -60 Z M 44 8 a 24 24 0 1 1 0 48 a 24 24 0 1 1 0 -48 Z"/>`;
    const thorn = (ang) => `<polygon transform="translate(55 50) rotate(${ang}) translate(0 -31)" points="0,-10 4,0 -4,0" fill="${c}"/>`;
    for (const ang of [60, 90, 120, 150, 180, 210, 240]) g += thorn(ang);
    return g;
  }

  function emblemGeneric(c) {
    return `<circle cx="50" cy="50" r="30" fill="none" stroke="${c}" stroke-width="4"/>` +
           `<circle cx="50" cy="50" r="8" fill="${c}"/>`;
  }

  const EMBLEMS = { solara: emblemSolara, verdant: emblemVerdant, tide: emblemTide, ember: emblemEmber, umbra: emblemUmbra, generic: emblemGeneric };

  function realmEmblem(id, opts) {
    const o = opts || {};
    const size = o.size || 64;
    const r = REALMS[id] || REALMS.generic;
    const color = o.color || r.color;
    const inner = (EMBLEMS[r.id] || emblemGeneric)(color);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" shape-rendering="geometricPrecision">${inner}</svg>`;
  }

  function realmEmblemDataUri(id, opts) {
    const svg = realmEmblem(id, opts);
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  }

  window.REALMS = REALMS;
  window.REALM_ORDER = REALM_ORDER;
  window.realmForColor = realmForColor;
  window.realmEmblem = realmEmblem;
  window.realmEmblemDataUri = realmEmblemDataUri;
})();
