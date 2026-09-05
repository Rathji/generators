// shapes.js — canonical node shapes. Pure geometry + tiny op descriptors;
// theme-agnostic. Both the crisp SVG renderer and the rough.js (hand-drawn /
// chalk) renderer consume the same ops.

export const KIND = {
  START: "start", END: "end", PROCESS: "process", DECISION: "decision",
  DATA: "data", DATABASE: "database", DOCUMENT: "document", NOTE: "note",
  CLOUD: "cloud", PERSON: "person", SERVER: "server", DEVICE: "device",
};

const A = {
  start: KIND.START, terminator: KIND.START, begin: KIND.START,
  end: KIND.END, stop: KIND.END, finish: KIND.END,
  process: KIND.PROCESS, action: KIND.PROCESS, step: KIND.PROCESS, task: KIND.PROCESS,
  operation: KIND.PROCESS, function: KIND.PROCESS, component: KIND.PROCESS, module: KIND.PROCESS,
  system: KIND.PROCESS, box: KIND.PROCESS, rect: KIND.PROCESS, rectangle: KIND.PROCESS,
  service: KIND.PROCESS, api: KIND.PROCESS, microservice: KIND.PROCESS, worker: KIND.PROCESS,
  job: KIND.PROCESS, queue: KIND.PROCESS, event: KIND.PROCESS, handler: KIND.PROCESS,
  app: KIND.PROCESS, application: KIND.PROCESS, screen: KIND.PROCESS, page: KIND.PROCESS,
  function: KIND.PROCESS,
  decision: KIND.DECISION, diamond: KIND.DECISION, question: KIND.DECISION,
  condition: KIND.DECISION, choice: KIND.DECISION, branch: KIND.DECISION,
  gateway: KIND.DECISION, check: KIND.DECISION, test: KIND.DECISION,
  data: KIND.DATA, io: KIND.DATA, input: KIND.DATA, output: KIND.DATA,
  message: KIND.DATA, packet: KIND.DATA,
  database: KIND.DATABASE, db: KIND.DATABASE, rdbms: KIND.DATABASE, sql: KIND.DATABASE,
  nosql: KIND.DATABASE, datastore: KIND.DATABASE, warehouse: KIND.DATABASE,
  table: KIND.DATABASE, cache: KIND.DATABASE,
  document: KIND.DOCUMENT, file: KIND.DOCUMENT, report: KIND.DOCUMENT,
  email: KIND.DOCUMENT, record: KIND.DOCUMENT,
  note: KIND.NOTE, comment: KIND.NOTE, remark: KIND.NOTE, sticky: KIND.NOTE, tip: KIND.NOTE,
  cloud: KIND.CLOUD, internet: KIND.CLOUD, saas: KIND.CLOUD, aws: KIND.CLOUD,
  external: KIND.CLOUD, web: KIND.CLOUD, public: KIND.CLOUD,
  person: KIND.PERSON, user: KIND.PERSON, client: KIND.PERSON, customer: KIND.PERSON,
  human: KIND.PERSON, actor: KIND.PERSON, employee: KIND.PERSON, player: KIND.PERSON,
  viewer: KIND.PERSON, operator: KIND.PERSON, admin: KIND.PERSON, manager: KIND.PERSON,
  server: KIND.SERVER, backend: KIND.SERVER, host: KIND.SERVER, vm: KIND.SERVER,
  computer: KIND.SERVER, machine: KIND.SERVER,
  device: KIND.DEVICE, phone: KIND.DEVICE, mobile: KIND.DEVICE, laptop: KIND.DEVICE,
  tablet: KIND.DEVICE, iot: KIND.DEVICE, browser: KIND.DEVICE, printer: KIND.DEVICE,
};

export function canonKind(k) {
  if (!k) return KIND.PROCESS;
  const s = String(k).toLowerCase().trim().replace(/[\s_\-]+/g, "");
  if (A[s] !== undefined) return A[s];
  if (s.includes("terminator") || s.includes("start") || s.includes("begin")) return KIND.START;
  if (s.includes("decision") || s.includes("condition") || s.includes("question") || s.includes("branch") || s.includes("choice")) return KIND.DECISION;
  if (s.includes("database") || s.includes("datastore") || s.includes("storage") || s.includes("sql") || s.includes("nosql") || s.includes("db")) return KIND.DATABASE;
  if (s.includes("cloud") || s.includes("internet") || s.includes("saas")) return KIND.CLOUD;
  if (s.includes("user") || s.includes("client") || s.includes("actor") || s.includes("person") || s.includes("customer") || s.includes("human")) return KIND.PERSON;
  if (s.includes("server") || s.includes("backend") || s.includes("host")) return KIND.SERVER;
  if (s.includes("document") || s.includes("file") || s.includes("report")) return KIND.DOCUMENT;
  if (s.includes("note") || s.includes("comment")) return KIND.NOTE;
  if (s.includes("input") || s.includes("output") || s.includes("data")) return KIND.DATA;
  if (s.includes("end") || s.includes("stop") || s.includes("finish")) return KIND.END;
  if (s.includes("device") || s.includes("phone") || s.includes("mobile")) return KIND.DEVICE;
  if (s.includes("decision")) return KIND.DECISION;
  return KIND.PROCESS;
}

export const isStartEnd = (k) => k === KIND.START || k === KIND.END;

// Extra vertical zone reserved for glyphs drawn above the label (px).
export function iconZone(kind, w) {
  if (kind === KIND.PERSON) return Math.max(30, Math.min(52, w * 0.44));
  if (kind === KIND.SERVER) return 16;
  return 0;
}

export function slant(h) { return Math.max(10, Math.min(h * 0.34, 44)); }

// ---- sizing ---------------------------------------------------------------

// kind, textW (widest line), textH (all lines incl sub label) → w/h
export function boxFor(kind, textW, textH) {
  const px = 13, py = 9;
  switch (kind) {
    case KIND.START: case KIND.END:
      return { w: Math.max(46, textW + 42), h: Math.max(30, textH + 2 * py) };
    case KIND.PROCESS: case KIND.DEVICE: case KIND.SERVER: case KIND.PERSON: {
      const w = Math.max(52, textW + 2 * px + (kind === KIND.PERSON ? 22 : 8));
      const h = Math.max(34, textH + 2 * py + iconZone(kind, w));
      return { w, h };
    }
    case KIND.DECISION: {
      const h = Math.max(42, textH + 2 * py * 1.8);
      const w = Math.max(64, textW + 2 * px + 8, h * 1.4);
      return { w, h };
    }
    case KIND.DATA: {
      const h = Math.max(36, textH + 2 * py);
      const w = Math.max(58, textW + 2 * px + slant(h));
      return { w, h };
    }
    case KIND.DATABASE: {
      const w = Math.max(62, textW + 2 * px + 6);
      const capH = Math.max(8, Math.min(18, w * 0.16));
      const h = Math.max(46, textH + 2 * py + capH * 2);
      return { w, h };
    }
    case KIND.DOCUMENT: {
      const w = Math.max(62, textW + 2 * px + 6);
      const h = Math.max(44, textH + 2 * py + 12);
      return { w, h };
    }
    case KIND.NOTE: {
      const w = Math.max(58, textW + 2 * px + 14);
      const h = Math.max(40, textH + 2 * py + 2);
      return { w, h };
    }
    case KIND.CLOUD: {
      const w = Math.max(92, textW + 2 * px + 20, (textH + 2 * py) * 1.35);
      const h = Math.max(52, textH + 2 * py + 12);
      return { w, h };
    }
    default:
      return { w: Math.max(52, textW + 2 * px), h: Math.max(32, textH + 2 * py) };
  }
}

export const fold = (b) => Math.max(10, Math.min(30, b.w * 0.22, b.h * 0.3));

// ---- glyph ops ------------------------------------------------------------
// Ops: {k:'rect'|'poly'|'path'|'ellipse'|'line'|'circle', ...} + optional flags

export function nodeGlyphOps(kind, b) {
  const ops = [];
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  switch (kind) {
    case KIND.START: case KIND.END:
      ops.push({ k: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: Math.min(b.h / 2, 28) });
      break;
    case KIND.PROCESS:
      ops.push({ k: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: 5 });
      break;
    case KIND.DEVICE:
      ops.push({ k: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: Math.min(b.h / 2, 15) });
      break;
    case KIND.DECISION:
      ops.push({ k: "poly", pts: [[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]] });
      break;
    case KIND.DATA: {
      const sl = slant(b.h);
      ops.push({ k: "poly", pts: [[b.x + sl, b.y], [b.x + b.w, b.y], [b.x + b.w - sl, b.y + b.h], [b.x, b.y + b.h]] });
      break;
    }
    case KIND.DATABASE: {
      const capH = Math.max(8, Math.min(18, b.w * 0.16));
      ops.push({ k: "path", d: `M ${b.x} ${b.y + capH} L ${b.x} ${b.y + b.h - capH} ` +
        `A ${(b.w / 2).toFixed(1)} ${capH} 0 0 0 ${b.x + b.w} ${b.y + b.h - capH} ` +
        `L ${b.x + b.w} ${b.y + capH} ` +
        `A ${(b.w / 2).toFixed(1)} ${capH} 0 0 0 ${b.x} ${b.y + capH} Z` });
      break;
    }
    case KIND.DOCUMENT: {
      const wv = 10;
      let d = `M ${b.x} ${b.y} L ${b.x + b.w} ${b.y} L ${b.x + b.w} ${b.y + b.h - wv}`;
      const bw = b.w / 3;
      for (let i = 0; i < 3; i++) {
        const x1 = b.x + b.w - bw * (i + 1);
        const xc = x1 + bw / 2;
        const yb = b.y + b.h;
        d += ` Q ${xc} ${(yb + wv * 1.1).toFixed(1)} ${x1} ${(yb - wv * 0.15).toFixed(1)}`;
      }
      d += ` Z`;
      ops.push({ k: "path", d });
      break;
    }
    case KIND.NOTE: {
      const f = fold(b);
      ops.push({ k: "path", d:
        `M ${b.x} ${b.y} L ${b.x + b.w} ${b.y} L ${b.x + b.w} ${b.y + b.h} ` +
        `L ${b.x + f} ${b.y + b.h} L ${b.x} ${b.y + b.h - f} Z` });
      ops.push({ k: "path", d: `M ${b.x + f} ${b.y + b.h - f} L ${b.x + f} ${b.y + b.h} L ${b.x} ${b.y + b.h}` });
      break;
    }
    case KIND.CLOUD: {
      const base = "M19.35 10.04C18.67 6.59 15.64 4 12 4c-2.89 0-5.4 1.64-6.65 4.04C2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z";
      ops.push({ k: "path", d: scalePath(base, b.w / 24, b.h / 20, b.x, b.y) });
      break;
    }
    case KIND.PERSON: {
      const iz = iconZone(kind, b.w);
      ops.push({ k: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: 12 });
      const hr = Math.max(3.4, iz * 0.15);
      ops.push({ k: "circle", cx, cy: b.y + iz * 0.32, r: hr });
      ops.push({ k: "line", x1: cx, y1: b.y + iz * 0.5, x2: cx, y2: b.y + iz * 0.88 });
      ops.push({ k: "line", x1: cx - iz * 0.24, y1: b.y + iz * 0.58, x2: cx + iz * 0.24, y2: b.y + iz * 0.58 });
      ops.push({ k: "line", x1: cx, y1: b.y + iz * 0.62, x2: cx - iz * 0.2, y2: b.y + iz * 0.96 });
      ops.push({ k: "line", x1: cx, y1: b.y + iz * 0.62, x2: cx + iz * 0.2, y2: b.y + iz * 0.96 });
      break;
    }
    case KIND.SERVER: {
      ops.push({ k: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: 4 });
      const dw = Math.max(10, b.w * 0.48);
      for (let i = 0; i < 3; i++) {
        const yy = b.y + 5 + i * 2.8;
        ops.push({ k: "line", x1: cx - dw / 2, y1: yy, x2: cx + dw / 2, y2: yy });
      }
      break;
    }
    default:
      ops.push({ k: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: 5 });
  }
  return ops;
}

// Scale an SVG path d-string by (sx, sy) and translate by (ox, oy).
// Handles M/L/H/V/C/S/Q/T/A/Z in both cases; flags are left untouched.
export function scalePath(d, sx, sy, ox, oy) {
  const parts = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  let cmd = "";
  let i = 0;
  const n = () => parseFloat(parts[i++]);
  const isAbs = () => cmd === cmd.toUpperCase();
  let out = "";
  const push = (v) => out += (v >= 0 ? " " : " ") + round(v);
  const round = (v) => Math.round(v * 100) / 100;
  while (i < parts.length) {
    const p = parts[i];
    if (/[a-zA-Z]/.test(p)) { cmd = p; i++; if (cmd.toLowerCase() === "z") { out += " Z"; continue; } }
    const abs = isAbs();
    switch (cmd.toLowerCase()) {
      case "m": case "l": case "t": {
        const x = n() * sx + (abs ? ox : 0), y = n() * sy + (abs ? oy : 0);
        out += " " + cmd + " " + round(x) + " " + round(y);
        break;
      }
      case "h": case "v": {
        const v = n();
        out += " " + cmd + " " + round(cmd.toLowerCase() === "h" ? v * sx : v * sy);
        break;
      }
      case "c": case "s": case "q": {
        const k = cmd.toLowerCase() === "c" ? 3 : 2;
        let seg = "";
        for (let j = 0; j < k; j++) {
          const x = n() * sx + (abs ? ox : 0), y = n() * sy + (abs ? oy : 0);
          seg += " " + round(x) + " " + round(y);
        }
        out += " " + cmd + seg;
        break;
      }
      case "a": {
        const rx = n() * sx, ry = n() * sy;
        const rot = n(), laf = n(), sf = n();
        const x = n() * sx + (abs ? ox : 0), y = n() * sy + (abs ? oy : 0);
        out += ` A ${round(rx)} ${round(ry)} ${rot} ${laf} ${sf} ${round(x)} ${round(y)}`;
        break;
      }
      default:
        out += " " + cmd;
    }
  }
  return out.trim();
}

// ---- anchors --------------------------------------------------------------
// side: 'l' | 'r' | 't' | 'b' → point on the actual outline

export function anchorFor(kind, b, side) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  switch (side) {
    case "l":
      if (kind === KIND.CLOUD) return { x: b.x + b.w * 0.06, y: cy + b.h * 0.1 };
      return { x: b.x, y: cy };
    case "r":
      if (kind === KIND.DATA) return { x: b.x + b.w - slant(b.h) / 2, y: cy };
      if (kind === KIND.CLOUD) return { x: b.x + b.w * 0.94, y: cy + b.h * 0.1 };
      return { x: b.x + b.w, y: cy };
    case "t":
      if (kind === KIND.CLOUD) return { x: cx, y: b.y + b.h * 0.16 };
      return { x: cx, y: b.y };
    case "b":
      if (kind === KIND.CLOUD) return { x: cx, y: b.y + b.h * 0.78 };
      return { x: cx, y: b.y + b.h };
  }
}

// ---- text placement -------------------------------------------------------

export function textCenter(kind, b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (kind === KIND.PERSON) {
    const iz = iconZone(kind, b.w);
    return { x: cx, y: b.y + iz + (b.h - iz) / 2, leftPad: 10, rightPad: 10 };
  }
  if (kind === KIND.SERVER) {
    return { x: cx, y: b.y + 14 + (b.h - 14) / 2, leftPad: 6, rightPad: 6 };
  }
  if (kind === KIND.NOTE) {
    const f = fold(b);
    return { x: cx + f / 2, y: cy, leftPad: 8, rightPad: f + 10 };
  }
  if (kind === KIND.DOCUMENT) {
    return { x: cx, y: b.y + (b.h - 8) / 2, leftPad: 10, rightPad: 10 };
  }
  if (kind === KIND.DATABASE) {
    const capH = Math.max(8, Math.min(18, b.w * 0.16));
    return { x: cx, y: b.y + capH + (b.h - capH) / 2, leftPad: 12, rightPad: 12 };
  }
  if (kind === KIND.CLOUD) {
    return { x: cx, y: cy + b.h * 0.02, leftPad: 16, rightPad: 16 };
  }
  if (kind === KIND.DECISION) {
    return { x: cx, y: cy, leftPad: b.w * 0.12, rightPad: b.w * 0.12 };
  }
  return { x: cx, y: cy, leftPad: 10, rightPad: 10 };
}

// Text width available inside the glyph for wrapping.
export function textRoom(kind, nominalW) {
  switch (kind) {
    case KIND.DECISION: return nominalW * 0.6;
    case KIND.DATA: return nominalW - 40;
    case KIND.NOTE: return nominalW - 32;
    case KIND.CLOUD: return nominalW - 46;
    case KIND.PERSON: return nominalW - 24;
    default: return nominalW - 24;
  }
}
