/*
 * targets.js — the "Export" overlay: turn whatever is on the stage into a finished file (or a
 * ready-to-import package) for a specific destination.
 *
 * The app's plain Export card writes one mesh in one format. That is enough when you know the
 * format you want, but every destination has its own conventions — a slicer wants a watertight
 * solid scaled in millimetres, Tabletop Simulator wants an OBJ + MTL + texture in a folder, a
 * game engine wants a normalised pivot with LODs and a collision proxy, a virtual tabletop wants
 * a square token image. This panel encodes those conventions as destinations you pick, then runs
 * one export pipeline that bakes the stage model once and processes it per target:
 *
 *   bake (geo-ops.bakeGeometry)
 *     -> repair open surfaces into solids      (volume.js closeMesh, via geo-ops.repair)
 *     -> scale to a real-world / engine size   (geo-ops.standOnOrigin, yUpToZUp, centerOnOrigin)
 *     -> hollow for printing                   (geo-ops.hollow)
 *     -> add a print/tabletop base             (geo-ops.addBase)
 *     -> decimate for LODs, hull for collision (geo-ops.decimateTo / convexHull)
 *     -> write STL / OBJ / MTL / PNG / GLB     (geo-ops writers + three's GLTFExporter)
 *     -> package the multi-file targets        (zip.js)
 *
 * Every target reports what it is about to produce (the file list updates live as you change the
 * options), and the printability readout comes from the same `analyzeMesh` the Volume panel uses,
 * so the two can never disagree.
 */

import { THREE } from "./three.js";
import { toGLB, slug } from "./exporters.js";
import * as G from "./geo-ops.js";
import { zipBlob } from "./zip.js";
import { DENSITIES } from "./volume.js";

/* --------------------------------------------------------------- small helpers */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function btn(label, cls, onClick, title) {
  const b = el("button", "btn " + (cls || "ghost"), label);
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

const enc = new TextEncoder();
const bytes = (text) => enc.encode(text);
const round = (n, d = 1) => (Number.isFinite(n) ? Number(n.toFixed(d)) : n);

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

const MATERIALS = [
  { id: "pla", label: "PLA", density: 1.24, note: "rigid, easy, the default filament" },
  { id: "petg", label: "PETG", density: 1.27, note: "tougher, slightly flexible" },
  { id: "abs", label: "ABS / ASA", density: 1.04, note: "heat resistant" },
  { id: "tpu", label: "TPU", density: 1.21, note: "flexible" },
  { id: "resin", label: "SLA resin", density: 1.1, note: "for resin printers" },
  { id: "nylon", label: "Nylon (PA12)", density: 1.01, note: "SLS / MJF" },
];

/* --------------------------------------------------------------- destinations */

const TARGETS = [
  {
    id: "print",
    label: "3D Print · STL",
    short: "3D Print",
    icon: "🖨",
    tagline: "A watertight STL scaled in millimetres — repaired, grounded and sized for a slicer.",
    mode: "file",
    primary: (o, ctx) => `${ctx.name}-${round(o.height, 0)}mm.stl`,
    defaults: {
      height: 80,
      repair: true,
      base: "none",
      baseSize: 0,
      baseHeight: 2,
      hollow: false,
      wall: 2,
      material: "pla",
      ascii: false,
      zip: false,
    },
    options: [
      { key: "height", type: "number", label: "Real-world height", unit: "mm", min: 5, max: 1000, step: 1, hint: "The printed height. Everything scales uniformly from this." },
      { key: "material", type: "select", label: "Material", options: MATERIALS.map((m) => ({ value: m.id, label: `${m.label} — ${m.density} g/cm³` })) },
      { key: "repair", type: "check", label: "Repair open surfaces (cap holes)", hint: "Caps boundary loops so the mesh is a closed solid. Required before hollowing." },
      { key: "hollow", type: "check", label: "Hollow the model", hint: "Offsets an inner wall so the print is hollow — saves a lot of material on big pieces." },
      { key: "wall", type: "number", label: "Wall thickness", unit: "mm", min: 0.4, max: 12, step: 0.1, when: (o) => o.hollow },
      { key: "base", type: "select", label: "Add a base", options: [
        { value: "none", label: "None" },
        { value: "round", label: "Round" },
        { value: "hex", label: "Hex" },
        { value: "square", label: "Square" },
      ] },
      { key: "baseSize", type: "number", label: "Base diameter", unit: "mm", min: 0, max: 400, step: 1, when: (o) => o.base !== "none", hint: "0 = auto (fits the model's footprint)." },
      { key: "baseHeight", type: "number", label: "Base height", unit: "mm", min: 0.4, max: 30, step: 0.1, when: (o) => o.base !== "none" },
      { key: "ascii", type: "check", label: "ASCII STL (text, bigger file)" },
      { key: "zip", type: "check", label: "Bundle everything as a .zip" },
    ],
    build: (o, ctx) =>
      buildPrint(o, ctx, {
        name: ctx.name,
        targetHeight: o.height,
        wantBase: o.base !== "none",
      }),
  },
  {
    id: "mini",
    label: "Miniature · STL",
    short: "Miniature",
    icon: "⛨",
    tagline: "A resin-print miniature: heroic scale, standing on a round or hex base, hollowed.",
    mode: "file",
    primary: (o, ctx) => `${ctx.name}-${miniScaleLabel(o)}.stl`,
    defaults: {
      preset: "32",
      height: 38,
      base: "round",
      baseSize: 25,
      baseHeight: 3,
      hollow: true,
      wall: 1.5,
      material: "resin",
      speedGap: true,
      ascii: false,
      zip: false,
    },
    options: [
      { key: "preset", type: "select", label: "Scale", options: [
        { value: "28", label: "28 mm heroic (~32 mm tall)" },
        { value: "32", label: "32 mm heroic (~38 mm tall)" },
        { value: "40", label: "40 mm (~48 mm tall)" },
        { value: "54", label: "54 mm (~64 mm tall)" },
        { value: "75", label: "75 mm (~90 mm tall)" },
        { value: "custom", label: "Custom height" },
      ] },
      { key: "height", type: "number", label: "Total height", unit: "mm", min: 10, max: 200, step: 1, when: (o) => o.preset === "custom" },
      { key: "base", type: "select", label: "Base shape", options: [
        { value: "round", label: "Round" },
        { value: "hex", label: "Hex" },
        { value: "square", label: "Square" },
        { value: "none", label: "No base" },
      ] },
      { key: "baseSize", type: "number", label: "Base diameter", unit: "mm", min: 5, max: 100, step: 1, when: (o) => o.base !== "none" },
      { key: "baseHeight", type: "number", label: "Base height", unit: "mm", min: 1, max: 12, step: 0.5, when: (o) => o.base !== "none" },
      { key: "hollow", type: "check", label: "Hollow (saves resin)", hint: "Prints hollow with drain-friendly thin walls." },
      { key: "wall", type: "number", label: "Wall thickness", unit: "mm", min: 0.6, max: 4, step: 0.1, when: (o) => o.hollow },
      { key: "material", type: "select", label: "Material", options: MATERIALS.map((m) => ({ value: m.id, label: `${m.label} — ${m.density} g/cm³` })) },
      { key: "speedGap", type: "check", label: "Leave a base clearance gap", hint: "Lifts the model a hair above the base so it prints as two clean pieces." },
      { key: "ascii", type: "check", label: "ASCII STL (text, bigger file)" },
      { key: "zip", type: "check", label: "Bundle everything as a .zip" },
    ],
    build: (o, ctx) => buildPrint(o, ctx, { name: ctx.name, targetHeight: miniHeight(o), wantBase: o.base !== "none", miniature: true }),
  },
  {
    id: "tts",
    label: "Tabletop Simulator",
    short: "Tabletop Sim",
    icon: "🎲",
    tagline: "OBJ + MTL + texture in a folder — the exact trio TTS's Custom Model importer wants.",
    mode: "package",
    defaults: {
      height: 1,
      texture: true,
      collision: "none",
      up: "y",
    },
    options: [
      { key: "height", type: "number", label: "Height in table units", unit: "u", min: 0.05, max: 12, step: 0.05, hint: "TTS's standard 1×1 tile is 1 unit. A miniature is usually 0.8–1.2." },
      { key: "up", type: "select", label: "Up axis", options: [
        { value: "y", label: "Y-up (TTS / Unity / glTF)" },
        { value: "z", label: "Z-up (Blender)" },
      ] },
      { key: "texture", type: "check", label: "Include the colour texture (.png + map_Kd)" },
      { key: "collision", type: "select", label: "Extra collider mesh", options: [
        { value: "none", label: "None (TTS auto-hull is fine)" },
        { value: "hull", label: "Convex hull OBJ" },
      ] },
    ],
    build: (o, ctx) => buildTTS(o, ctx),
  },
  {
    id: "token",
    label: "VTT Token",
    short: "Token",
    icon: "🛡",
    tagline: "A square token image (Roll20 / Foundry / Fantasy Grounds) plus a GLB for 3D canvases.",
    mode: "file",
    primary: (o, ctx) => `${ctx.name}-token-${o.size}.png`,
    defaults: {
      view: "threeQuarter",
      size: 512,
      ring: true,
      transparent: true,
      bg: "#232833",
      glb: true,
    },
    options: [
      { key: "view", type: "select", label: "Token view", options: [
        { value: "threeQuarter", label: "3/4 front (portrait)" },
        { value: "front", label: "Front" },
        { value: "top", label: "Top-down (grid game)" },
      ] },
      { key: "size", type: "select", label: "Resolution", options: [
        { value: "256", label: "256 × 256" },
        { value: "512", label: "512 × 512" },
        { value: "1024", label: "1024 × 1024" },
      ] },
      { key: "ring", type: "check", label: "Circular mask + border ring" },
      { key: "transparent", type: "check", label: "Transparent background" },
      { key: "bg", type: "color", label: "Backdrop", when: (o) => !o.transparent },
      { key: "glb", type: "check", label: "Also export a GLB (Foundry 3D canvas / TTS)" },
    ],
    build: (o, ctx) => buildToken(o, ctx),
  },
  {
    id: "glb",
    label: "Game Engine · GLB",
    short: "Game GLB",
    icon: "🎮",
    tagline: "A normalised, pivot-correct GLB with optional LOD levels and a collision proxy.",
    mode: "package",
    defaults: {
      scale: "1m",
      stand: true,
      lods: "3",
      collision: "hull",
      animations: true,
      base: false,
    },
    options: [
      { key: "scale", type: "select", label: "Size", options: [
        { value: "1m", label: "Normalise to 1 m tall (engine standard)" },
        { value: "keep", label: "Keep the current size" },
      ] },
      { key: "stand", type: "check", label: "Stand on origin (min Y = 0, centred on X/Z)" },
      { key: "lods", type: "select", label: "LOD chain", options: [
        { value: "none", label: "None" },
        { value: "2", label: "2 levels (100% / 40%)" },
        { value: "3", label: "3 levels (100% / 50% / 20%)" },
      ] },
      { key: "collision", type: "select", label: "Collision proxy", options: [
        { value: "none", label: "None" },
        { value: "hull", label: "Convex hull" },
        { value: "box", label: "Bounding box (cheapest)" },
        { value: "lowpoly", label: "Low-poly decimate" },
      ] },
      { key: "animations", type: "check", label: "Include animation clips" },
      { key: "base", type: "check", label: "Include the Blender scene base" },
    ],
    build: (o, ctx) => buildGameGlb(o, ctx),
  },
  {
    id: "obj",
    label: "Game Engine · OBJ",
    short: "Game OBJ",
    icon: "📦",
    tagline: "OBJ + MTL + texture, with a Y-up/Z-up choice — the universal interchange set.",
    mode: "package",
    defaults: {
      scale: "1m",
      up: "y",
      texture: true,
      normals: true,
      collision: "none",
    },
    options: [
      { key: "scale", type: "select", label: "Size", options: [
        { value: "1m", label: "Normalise to 1 m tall" },
        { value: "keep", label: "Keep the current size" },
      ] },
      { key: "up", type: "select", label: "Up axis", options: [
        { value: "y", label: "Y-up (Unity / glTF / TTS)" },
        { value: "z", label: "Z-up (Blender / Unreal)" },
      ] },
      { key: "texture", type: "check", label: "Include the colour texture" },
      { key: "normals", type: "check", label: "Write vertex normals" },
      { key: "collision", type: "select", label: "Also write a collision mesh", options: [
        { value: "none", label: "None" },
        { value: "hull", label: "Convex hull OBJ" },
        { value: "lowpoly", label: "Low-poly OBJ" },
      ] },
    ],
    build: (o, ctx) => buildGameObj(o, ctx),
  },
  {
    id: "all",
    label: "Everything",
    short: "Everything",
    icon: "🗂",
    tagline: "One archive with a print STL, a game GLB, an OBJ set, a token PNG and a manifest.",
    mode: "package",
    defaults: { height: 80, token: true, glb: true, obj: true },
    options: [
      { key: "height", type: "number", label: "Print height", unit: "mm", min: 5, max: 1000, step: 1 },
      { key: "glb", type: "check", label: "Include a game-ready GLB + LODs" },
      { key: "obj", type: "check", label: "Include an OBJ + MTL + texture set" },
      { key: "token", type: "check", label: "Include a 512 px token PNG" },
    ],
    build: (o, ctx) => buildEverything(o, ctx),
  },
];

const TARGET_BY_ID = new Map(TARGETS.map((t) => [t.id, t]));

function miniHeight(o) {
  if (o.preset === "custom") return Number(o.height) || 38;
  return { "28": 32, "32": 38, "40": 48, "54": 64, "75": 90 }[o.preset] || 38;
}

function miniScaleLabel(o) {
  if (o.preset === "custom") return `${round(o.height, 0)}mm`;
  return `${o.preset}mm`;
}

/* --------------------------------------------------------------- build pipeline */

/* Bake once per build; `raw` is the world-space triangle soup every target starts from. */
function bake(ctx) {
  const root = ctx.app.getRoot();
  const soup = G.bakeGeometry(root);
  const material = firstMaterial(root);
  return { soup, material };
}

function firstMaterial(root) {
  let mat = null;
  root.traverse((o) => {
    if (mat || !o.isMesh || !o.material) return;
    mat = Array.isArray(o.material) ? o.material[0] : o.material;
  });
  return mat || null;
}

function materialFor(ctx, soup) {
  const src = ctx.material;
  const m = src ? src.clone() : new THREE.MeshStandardMaterial({ color: 0xc2cad8, roughness: 0.68, metalness: 0.02 });
  if (src) {
    m.wireframe = false;
    if (m.map) m.vertexColors = false;
    else if (soup.hasColors) m.vertexColors = true;
    m.needsUpdate = true;
  } else {
    m.vertexColors = !!soup.hasColors;
  }
  m.side = THREE.FrontSide;
  return m;
}

/* Repair -> watertight solid, reporting what it did. Returns { soup, report, capped }. */
function makeSolid(soup, doRepair) {
  let report = G.printReport(soup);
  let capped = 0;
  let out = soup;
  if (doRepair && report && report.boundaryEdges > 0) {
    const r = G.repair(soup);
    if (r.capped) {
      out = r.soup;
      capped = r.capped;
      report = G.printReport(out);
    }
  }
  return { soup: out, report, capped };
}

/* A mesh is "closed" for slicing when it has no free (boundary) edges — the criterion every
   slicer actually uses. `analyzeMesh`'s stricter `watertight` flag additionally rejects a
   handful of non-manifold/flipped edges, which most slicers tolerate, so the two are reported
   separately rather than conflated. */
function closed(report) {
  return !!report && report.boundaryEdges === 0;
}

/* Scale uniformly to a target height (in whatever units the target wants). */
function scaleToHeight(soup, height) {
  const b = G.bounds(soup.positions);
  if (!height || !(b.size[1] > 0)) return soup;
  const s = height / b.size[1];
  return G.scaleSoup(soup, s);
}

function densityOf(id) {
  const m = MATERIALS.find((x) => x.id === id);
  return m ? m.density : 1.24;
}

function materialLabel(id) {
  const m = MATERIALS.find((x) => x.id === id);
  return m ? m.label : id;
}

function printReportText(ctx, opts, report, extra) {
  const dims = report ? report.dims : [0, 0, 0];
  const volCm3 = report ? report.volume / 1000 : 0;
  const mass = volCm3 * densityOf(opts.material);
  const bnd = report ? report.boundaryEdges : 0;
  const nmf = report ? report.nonManifoldEdges : 0;
  const lines = [
    `${ctx.name} — print package`,
    `Generated ${new Date().toISOString()}`,
    "",
    `Target height : ${round(opts.height, 1)} mm`,
    `Dimensions    : ${round(dims[0], 1)} × ${round(dims[1], 1)} × ${round(dims[2], 1)} mm`,
    `Volume        : ${round(volCm3, 2)} cm³`,
    `Surface area  : ${round((report ? report.surfaceArea : 0) / 100, 2)} cm²`,
    `Triangles     : ${report ? report.triangles.toLocaleString() : "—"}`,
    "",
    `Closed solid  : ${bnd === 0 ? "yes" : `NO — ${bnd} boundary edges`}`,
    `Non-manifold  : ${nmf}`,
    `Shells        : ${report ? report.shells : "—"}`,
    `Euler χ       : ${report ? report.euler : "—"}`,
  ];
  if (extra && extra.capped) lines.push(`Holes capped  : ${extra.capped} triangles added by the repair pass`);
  if (opts.hollow) lines.push(`Hollow        : wall ${round(opts.wall, 2)} mm`);
  if (opts.base && opts.base !== "none") lines.push(`Base          : ${opts.base}, ${round(opts.baseSize || 0, 1)} mm`);
  lines.push("", `Material      : ${materialLabel(opts.material)} (${densityOf(opts.material)} g/cm³)`);
  lines.push(`Estimated mass: ~${round(mass, 1)} g solid (before supports / infill)`);
  if (extra && extra.speedGap) lines.push("", "A clearance gap was left under the model so it releases from the base.");
  if (opts.hollow) lines.push("", "Hollowed solids print best with drain holes and adequate wall thickness;", "check the wall in your slicer's preview before committing.");
  return lines.join("\n") + "\n";
}

/*
 * The shared print pipeline used by both the "3D Print" and "Miniature" destinations. Order
 * matters and is deliberate:
 *   scale first (so the wall thickness and base size below are real millimetres)
 *   hollow the model (before the base, so the base stays solid)
 *   add the base (its top is flush with the model's feet)
 *   ground the whole thing on y = 0
 */
function buildPrint(opts, ctx, cfg) {
  const height = cfg.targetHeight;
  let soup = G.cloneSoup(G.expand(ctx.raw));

  const solid = makeSolid(soup, opts.repair || opts.hollow);
  const solidClosed = closed(solid.report);
  soup = solid.soup;
  soup = scaleToHeight(soup, height);

  /* Hollowing is only free when every wall of the model is thicker than the requested shell — on a
     mesh with features thinner than the wall the inner offset self-intersects and can tear the
     surface open. When that happens on an otherwise-closed solid, the honest export is the solid
     one, so we detect it and fall back rather than shipping a torn hollow. */
  let hollowed = false;
  if (opts.hollow) {
    if (!solidClosed) {
      ctx.note("Hollowing needs a closed solid — the result may be imperfect. Try repairing first.");
      soup = G.hollow(soup, Math.max(0.2, opts.wall || 2));
      hollowed = true;
    } else {
      const wall = Math.max(0.2, opts.wall || 2);
      const shell = G.hollow(soup, wall);
      if (closed(G.printReport(shell))) {
        soup = shell;
        hollowed = true;
      } else {
        ctx.note(`Hollowing with a ${round(wall, 2)} mm wall would have opened this mesh (features thinner than the wall), so the solid model was exported instead — try a thinner wall.`);
      }
    }
  }

  if (cfg.wantBase) {
    const b = G.bounds(soup.positions);
    const autoSize = Math.max(b.size[0], b.size[2]) * 1.12;
    const dia = Number(opts.baseSize) > 0 ? Number(opts.baseSize) : autoSize;
    const gap = cfg.miniature && opts.speedGap ? Math.max(0.15, (opts.baseHeight || 3) * 0.08) : 0;
    soup = G.addBase(soup, { shape: opts.base, radius: dia / 2, height: opts.baseHeight || 2, atY: b.min[1] - gap });
  }

  G.standOnOrigin(soup, { height: null });
  const report = G.printReport(soup);
  const name = cfg.name;
  const up = G.yUpToZUp(soup);

  const stl = opts.ascii
    ? bytes(G.toAsciiSTL(up, name))
    : new Uint8Array(G.toBinarySTL(up, { header: `${name} — print ${dateStamp()}` }));
  const reportText = printReportText({ ...ctx, name }, { ...opts, height, hollow: hollowed }, report, { capped: solid.capped, speedGap: cfg.miniature && opts.speedGap });
  const files = [{ name: `${name}.stl`, data: stl }];
  const extras = [{ name: `${name}-PRINT-REPORT.txt`, data: reportText }];

  return {
    files,
    extras,
    primary: `${name}.stl`,
    summary: report
      ? `${round(report.dims[0], 1)} × ${round(report.dims[1], 1)} × ${round(report.dims[2], 1)} mm · ${round(report.volume / 1000, 2)} cm³ · ${closed(report) ? "watertight" : "open"}`
      : "no geometry",
    notes: [
      closed(report)
        ? "Closed solid — slice it directly."
        : solidClosed
          ? "The surface closed cleanly, but hollowing/thin features left a few open edges — try a thinner wall or turn hollowing off."
          : "Still open after repair — check the mesh in the Volume panel.",
      hollowed ? `Hollow, ${round(opts.wall, 2)} mm wall.` : null,
      report && report.nonManifoldEdges > 0 ? `${report.nonManifoldEdges} non-manifold edges — most slicers ignore these, but a check in your slicer's repair view is wise.` : null,
    ].filter(Boolean),
  };
}

async function buildTTS(opts, ctx) {
  const name = ctx.name;
  let soup = G.indexed(G.expand(ctx.raw));
  soup = scaleToHeight(soup, Number(opts.height) || 1);
  G.centerOnOrigin(soup);
  if (opts.up === "z") G.yUpToZUp(soup);
  G.computeNormals(soup);

  const hasTex = !!(opts.texture && ctx.tex);
  const texFile = hasTex ? `${name}.png` : null;
  const matName = name;
  const obj = G.toOBJ(soup, { mtl: `${name}.mtl`, material: matName, uvs: hasTex, normals: true });
  const mtl = G.toMTL({ name: matName, texture: texFile, color: [0.78, 0.78, 0.8], shininess: 24 });

  const files = [
    { name: `${name}.obj`, data: obj },
    { name: `${name}.mtl`, data: mtl },
  ];
  if (hasTex) files.push({ name: texFile, data: await ctx.textureBytes() });

  const notes = [];
  if (!hasTex) notes.push("No texture was available — the model imports as flat grey. Use a textured (AI) build or the relief mode to get a colour map.");
  if (opts.collision === "hull") {
    const hull = G.convexHull(soup);
    files.push({ name: `${name}-collider.obj`, data: G.toOBJ(hull, { material: matName, uvs: false, normals: true }) });
  }

  files.push({ name: "HOW-TO-IMPORT.txt", data: ttsInstructions(name, hasTex, opts) });

  return {
    files,
    summary: `${soup.positions.length / 3} verts (indexed) · ${G.triangleCount(soup).toLocaleString()} tris · ${round(opts.height, 2)} table units tall`,
    notes,
  };
}

function ttsInstructions(name, hasTex, opts) {
  return [
    `Tabletop Simulator — custom model: ${name}`,
    "",
    "1. Copy this whole folder to:",
    "   Documents/My Games/Tabletop Simulator/Mods/Models/",
    "2. In TTS open Objects > Components > Custom > Model.",
    "3. Point Mesh at " + name + ".obj",
    hasTex ? "   Point Diffuse/Texture at " + name + ".png" : "   (No texture was exported — set a flat tint in the material picker.)",
    "4. Set the model's type/scale, then save it as a custom object.",
    "",
    `The model is ${round(opts.height, 2)} table units tall (1 unit = one standard tile).`,
    "Origin is centred, so it plants on the table correctly.",
    "",
    "Note: TTS generates its own convex collider by default. A -collider.obj is included only",
    "if you asked for one; import it as the model's collider in the custom object editor.",
  ].join("\n") + "\n";
}

async function buildToken(opts, ctx) {
  const size = Number(opts.size) || 512;
  const shot = await ctx.capture({ size, view: opts.view, transparent: !!opts.transparent });
  const canvas = tokenCanvas(shot, {
    size,
    ring: opts.ring,
    transparent: opts.transparent,
    bg: opts.bg,
  });
  const png = await canvasBytes(canvas);

  const files = [{ name: `${ctx.name}-token-${size}.png`, data: png }];
  const extras = [];
  if (opts.glb) {
    const g = G.indexed(G.expand(ctx.raw));
    scaleToHeight(g, 1);
    G.centerOnOrigin(g);
    const mesh = G.toObject3D(g, materialFor(ctx, g));
    const group = new THREE.Group();
    group.add(mesh);
    const blob = await toGLB(group);
    files.push({ name: `${ctx.name}-token.glb`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  files.push({ name: "HOW-TO-USE.txt", data: tokenInstructions(ctx.name, size, !!opts.glb) });
  return {
    files,
    extras,
    primary: `${ctx.name}-token-${size}.png`,
    summary: `${size} × ${size} PNG${opts.glb ? " + GLB" : ""}`,
    notes: ["Drop the PNG onto a token in Roll20 / Foundry / Fantasy Grounds and set it to 1×1."],
  };
}

function tokenInstructions(name, size, glb) {
  return [
    `Virtual tabletop token: ${name}`,
    "",
    `${name}-token-${size}.png`,
    "  Roll20      : upload to your library, drag onto the map, set width/height to 1 grid cell.",
    "  Foundry VTT : put it in your user Data/tokens folder, then set the actor's prototype token image.",
    "  Fantasy Gr. : add as a token asset and size it to one square.",
    "",
    glb
      ? `${name}-token.glb\n  A 1-unit-tall GLB for Foundry's 3D Canvas module, TTS, or any web viewer.`
      : "Ask for the GLB option if you also want a 3D model for a 3D canvas.",
    "",
    "The image is square and centred; a circular alpha mask is applied when the ring option is on,",
    "so it drops cleanly over a round token base.",
  ].join("\n") + "\n";
}

async function buildGameGlb(opts, ctx) {
  const name = ctx.name;
  const root = ctx.app.getRoot();
  const files = [];
  const notes = [];
  const stats = [];

  const restore = opts.stand || opts.scale === "1m" ? transformRoot(root, { height: opts.scale === "1m" ? 1 : null, stand: !!opts.stand }) : null;
  try {
    const blob = await toGLB(root, { animations: opts.animations });
    files.push({ name: `${name}.glb`, data: new Uint8Array(await blob.arrayBuffer()) });
  } finally {
    if (restore) restore();
  }

  const soup = G.indexed(G.expand(ctx.raw));
  stats.push(`${G.triangleCount(soup).toLocaleString()} triangles`);

  if (opts.lods && opts.lods !== "none") {
    const ratios = opts.lods === "3" ? [0.5, 0.2] : [0.4];
    let prev = G.triangleCount(soup);
    for (let i = 0; i < ratios.length; i++) {
      const target = Math.max(80, Math.round(prev * ratios[i]));
      const lod = G.decimateTo(soup, target);
      const mesh = G.toObject3D(lod, materialFor(ctx, lod));
      const g = new THREE.Group();
      g.add(mesh);
      const blob = await toGLB(g);
      files.push({ name: `${name}-LOD${i + 1}.glb`, data: new Uint8Array(await blob.arrayBuffer()) });
      stats.push(`LOD${i + 1}: ${G.triangleCount(lod).toLocaleString()} tris`);
      prev = G.triangleCount(lod);
    }
  }

  if (opts.collision && opts.collision !== "none") {
    const col = collisionSoup(soup, opts.collision);
    files.push({ name: `${name}-collision.obj`, data: G.toOBJ(col, { material: name, uvs: false, normals: true }) });
    stats.push(`collision: ${G.triangleCount(col)} tris`);
  }

  files.push({ name: "IMPORT-NOTES.txt", data: gameInstructions(name, opts, stats) });
  return { files, summary: stats.join(" · "), notes };
}

async function buildGameObj(opts, ctx) {
  const name = ctx.name;
  let soup = G.indexed(G.expand(ctx.raw));
  if (opts.scale === "1m") scaleToHeight(soup, 1);
  G.centerOnOrigin(soup);
  if (opts.up === "z") G.yUpToZUp(soup);
  G.computeNormals(soup);

  const hasTex = !!(opts.texture && ctx.tex);
  const files = [
    { name: `${name}.obj`, data: G.toOBJ(soup, { mtl: `${name}.mtl`, material: name, uvs: hasTex, normals: !!opts.normals }) },
    { name: `${name}.mtl`, data: G.toMTL({ name, texture: hasTex ? `${name}.png` : null, color: [0.78, 0.78, 0.8] }) },
  ];
  if (hasTex) files.push({ name: `${name}.png`, data: await ctx.textureBytes() });
  if (opts.collision === "hull") files.push({ name: `${name}-collision.obj`, data: G.toOBJ(G.convexHull(soup), { material: name, uvs: false }) });
  if (opts.collision === "lowpoly") files.push({ name: `${name}-collision.obj`, data: G.toOBJ(G.vertexCluster(soup, 14), { material: name, uvs: false }) });
  files.push({ name: "IMPORT-NOTES.txt", data: objInstructions(name, hasTex, opts) });
  return {
    files,
    summary: `${G.triangleCount(soup).toLocaleString()} triangles · ${opts.up.toUpperCase()}-up`,
    notes: hasTex ? [] : ["No texture available — the MTL carries a flat colour instead."],
  };
}

function objInstructions(name, hasTex, opts) {
  return [
    `OBJ interchange set: ${name}`,
    "",
    `${name}.obj   — the mesh${opts.normals ? " with vertex normals" : ""}`,
    `${name}.mtl   — the material (keep it beside the .obj; the .obj references it)`,
    hasTex ? `${name}.png   — the diffuse texture (map_Kd in the .mtl)` : "(no texture in this export)",
    "",
    `Up axis: ${opts.up === "z" ? "Z-up — correct for Blender and Unreal Engine" : "Y-up — correct for Unity, glTF and three.js"}.`,
    "Size: " + (opts.scale === "1m" ? "normalised to 1 metre tall." : "kept at the model's current scale."),
    "",
    "Unity    : drop the folder into Assets/. If it imports magenta, set the material's shader to Standard/Lit.",
    "Unreal   : File > Import Into Level, pick the .obj (the .mtl is read automatically).",
    "Blender  : File > Import > Wavefront (.obj); the .mtl and texture come along.",
  ].join("\n") + "\n";
}

function gameInstructions(name, opts, stats) {
  return [
    `Game-ready GLB: ${name}`,
    "",
    `${name}.glb — main mesh${opts.animations ? " with animation clips" : ""}`,
    ...(opts.lods && opts.lods !== "none" ? [`${name}-LOD1.glb, ${name}-LOD2.glb — decimated levels for distance switching`] : []),
    ...(opts.collision && opts.collision !== "none" ? [`${name}-collision.obj — a ${opts.collision} proxy for physics`] : []),
    "",
    "Stats: " + stats.join(" | "),
    "",
    "Unity      : drag the .glb into Assets/ — materials, textures, morph targets and clips import.",
    "Unreal     : Import into Content; glTF works through the Interchange glTF pipeline.",
    "Godot      : drop it into the project; scenes import automatically.",
    "three.js   : new GLTFLoader().load(url).",
    "",
    opts.scale === "1m"
      ? "The model was normalised to 1 metre tall and re-pivoted at its feet, so it drops into a scene at a predictable size."
      : "The model keeps its current size; check the scale in-engine.",
    opts.animations ? "" : "Animation clips were excluded (unchecked).",
  ]
    .filter((l) => l !== "")
    .join("\n") + "\n";
}

function collisionSoup(soup, kind) {
  if (kind === "box") {
    const b = G.bounds(soup.positions);
    const size = new THREE.Vector3(b.size[0], b.size[1], b.size[2]);
    const center = new THREE.Vector3(b.center[0], b.center[1], b.center[2]);
    const box = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed();
    const arr = new Float32Array(box.attributes.position.array);
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += center.x;
      arr[i + 1] += center.y;
      arr[i + 2] += center.z;
    }
    const out = { positions: arr, normals: new Float32Array(arr.length), uvs: new Float32Array((arr.length / 3) * 2), colors: new Float32Array(arr.length).fill(0.8), hasNormals: true, hasUvs: true, hasColors: true, textures: [], triangles: arr.length / 9 };
    G.computeNormals(out);
    return out;
  }
  if (kind === "lowpoly") return G.vertexCluster(soup, 14);
  return G.convexHull(soup);
}

async function buildEverything(opts, ctx) {
  const name = ctx.name;
  const files = [];
  const manifest = [`${name} — export bundle`, `Generated ${new Date().toISOString()}`, ""];

  const print = buildPrint(
    { height: Number(opts.height) || 80, repair: true, base: "none", baseSize: 0, baseHeight: 2, hollow: false, wall: 2, material: "pla", ascii: false },
    ctx,
    { name, targetHeight: Number(opts.height) || 80, wantBase: false }
  );
  files.push(...print.files);
  manifest.push(`print/${name}.stl`, `  ${print.summary}`);

  if (opts.glb) {
    const restored = transformRoot(ctx.app.getRoot(), { height: 1, stand: true });
    try {
      const blob = await toGLB(ctx.app.getRoot(), { animations: false });
      files.push({ name: `${name}.glb`, data: new Uint8Array(await blob.arrayBuffer()) });
      manifest.push(`game/${name}.glb`, "  1 m tall, pivot at the feet");
    } finally {
      restored();
    }
  }

  if (opts.obj) {
    try {
      const objSet = await buildGameObj({ scale: "1m", up: "y", texture: true, normals: true, collision: "none" }, ctx);
      for (const f of objSet.files) files.push(f);
      manifest.push(`game/${name}.obj`, "  OBJ + MTL + texture");
    } catch (e) {
      console.warn("bundle obj failed", e);
    }
  }

  if (opts.token) {
    try {
      const shot = await ctx.capture({ size: 512, view: "threeQuarter", transparent: true });
      const canvas = tokenCanvas(shot, { size: 512, ring: true, transparent: true });
      files.push({ name: `${name}-token.png`, data: await canvasBytes(canvas) });
      manifest.push(`token/${name}-token.png`, "  512 px circular token");
    } catch (e) {
      console.warn("bundle token failed", e);
    }
  }

  files.push({ name: "MANIFEST.txt", data: manifest.join("\n") + "\n" });
  return { files, summary: `${files.length} files`, notes: [] };
}

/* Temporarily normalise the live root's transform for a GLB export, then restore it. GLTFExporter
   writes the root's own transform, so this is how a normalised-size + feet-on-floor export is
   produced without cloning a skinned hierarchy (which would lose the clips). */
function transformRoot(root, { height, stand }) {
  const oldScale = root.scale.clone();
  const oldPos = root.position.clone();
  if (height) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 1e-9) root.scale.multiplyScalar(height / size.y);
  }
  root.updateMatrixWorld(true);
  if (stand) {
    const b = new THREE.Box3().setFromObject(root);
    root.position.x -= (b.min.x + b.max.x) / 2;
    root.position.z -= (b.min.z + b.max.z) / 2;
    root.position.y -= b.min.y;
    root.updateMatrixWorld(true);
  }
  return () => {
    root.scale.copy(oldScale);
    root.position.copy(oldPos);
    root.updateMatrixWorld(true);
  };
}

/* --------------------------------------------------------------- image plumbing */

function tokenCanvas(shot, opts) {
  const s = opts.size;
  const out = document.createElement("canvas");
  out.width = s;
  out.height = s;
  const ctx = out.getContext("2d");
  ctx.clearRect(0, 0, s, s);
  const r = s / 2 * 0.98;
  if (opts.ring) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.clip();
    if (!opts.transparent) {
      ctx.fillStyle = opts.bg || "#232833";
      ctx.fillRect(0, 0, s, s);
    }
    ctx.drawImage(shot, 0, 0, s, s);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r - Math.max(1, s * 0.012), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, s * 0.022);
    ctx.strokeStyle = "rgba(232,192,125,0.95)";
    ctx.stroke();
  } else {
    if (!opts.transparent) {
      ctx.fillStyle = opts.bg || "#232833";
      ctx.fillRect(0, 0, s, s);
    }
    ctx.drawImage(shot, 0, 0, s, s);
  }
  return out;
}

async function canvasBytes(canvas) {
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/* A tiny offscreen render of the baked model for the token target: its own scene (so the stage's
   grid/ground never appear), lit by the app's environment map plus a key/fill pair. */
function captureModel(ctx, app) {
  return async ({ size, view, transparent }) => {
    const scene = new THREE.Scene();
    const env = app.getEnvTexture && app.getEnvTexture();
    if (env) scene.environment = env;
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-3, 2, -2);
    scene.add(rim);

    const soup = G.expand(ctx.raw);
    const mesh = G.toObject3D(soup, materialFor(ctx, soup));
    scene.add(mesh);

    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(1e-4, box.getSize(new THREE.Vector3()).length() / 2);
    const cam = new THREE.PerspectiveCamera(30, 1, radius * 0.02, radius * 60);
    const dir = viewDir(view);
    cam.up.set(0, 1, 0);
    if (view === "top") cam.up.set(0, 0, -1);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.98;
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.lookAt(center);

    const canvas = app.renderOffscreen(scene, cam, size, { transparent });
    mesh.geometry.dispose();
    return canvas;
  };
}

function viewDir(view) {
  if (view === "top") return new THREE.Vector3(0, 1, 0.0001).normalize();
  if (view === "front") return new THREE.Vector3(0, 0.06, 1).normalize();
  return new THREE.Vector3(0.62, 0.42, 1).normalize();
}

/* --------------------------------------------------------------- the panel */

export function createTargets({ app, toast } = {}) {
  let overlay = null;
  let open = false;
  let current = "print";
  const opts = {};
  const inputs = {};
  let lastBuild = null;
  let cache = null; // { key, soup, material, report }
  let tick = 0;
  let scanBtn = null;
  let contentsEl = null;
  let modelEl = null;
  let buildBtn = null;
  let notesEl = null;
  let targetRow = null;
  let defWrap = null;

  function def() {
    return TARGET_BY_ID.get(current) || TARGETS[0];
  }

  function defaultOpts(t) {
    return { ...t.defaults };
  }

  /* --------------------------------------------------------- soup cache */

  function signature() {
    const info = (app.info && app.info()) || {};
    return `${info.triangles || 0}|${info.label || ""}|${info.mode || ""}|${info.hasModel ? 1 : 0}`;
  }

  function ensureCache(force) {
    const key = signature();
    if (!force && cache && cache.key === key) return cache;
    if (!app.info || !app.info().hasModel) {
      cache = { key, soup: null, material: null, report: null };
      return cache;
    }
    const { soup, material } = bake({ app });
    cache = { key, soup, material, report: G.printReport(soup) };
    return cache;
  }

  /* --------------------------------------------------------- target switching */

  function selectTarget(id) {
    if (!TARGET_BY_ID.has(id)) return;
    current = id;
    const t = def();
    opts[id] = opts[id] || defaultOpts(t);
    renderTargets();
    renderOptions();
    renderContents();
  }

  function renderTargets() {
    targetRow.innerHTML = "";
    for (const t of TARGETS) {
      const b = el("button", "segBtn forgeTarget" + (t.id === current ? " active" : ""));
      b.type = "button";
      b.append(el("span", "forgeIcon", t.icon));
      b.append(el("span", null, t.short));
      b.title = t.tagline;
      b.addEventListener("click", () => selectTarget(t.id));
      targetRow.append(b);
    }
  }

  /* --------------------------------------------------------- option form */

  function renderOptions() {
    const t = def();
    const o = opts[t.id];
    defWrap.innerHTML = "";
    defWrap.append(el("div", "forgeBlurb", t.tagline));
    for (const opt of t.options) {
      const visible = !opt.when || opt.when(o);
      const node = optionNode(t, opt, o);
      if (node) defWrap.append(node);
      if (node) node.hidden = !visible;
    }
    const b = (app.info && app.info()) || {};
    defWrap.append(el("div", "forgeModelHint", b.hasModel ? "Processing the current stage model. Change any option to update the file list." : "No model on the stage yet — generate or import one first."));
  }

  function optionNode(t, opt, o) {
    const id = `forge_${t.id}_${opt.key}`;
    if (opt.type === "check") {
      const lab = el("label", "check");
      const inp = el("input");
      inp.type = "checkbox";
      inp.id = id;
      inp.checked = !!o[opt.key];
      inp.addEventListener("change", () => {
        o[opt.key] = inp.checked;
        renderOptions();
        renderContents();
      });
      lab.append(inp, el("span", null, opt.label));
      if (opt.hint) lab.title = opt.hint;
      return lab;
    }
    if (opt.type === "select") {
      const lab = el("label", "field");
      lab.append(el("span", null, opt.label));
      const sel = el("select");
      sel.id = id;
      for (const op of opt.options) {
        const option = el("option", null, op.label);
        option.value = op.value;
        sel.append(option);
      }
      sel.value = String(o[opt.key]);
      sel.addEventListener("change", () => {
        o[opt.key] = sel.value;
        renderOptions();
        renderContents();
      });
      lab.append(sel);
      if (opt.hint) lab.title = opt.hint;
      return lab;
    }
    if (opt.type === "color") {
      const lab = el("label", "field");
      lab.append(el("span", null, opt.label));
      const inp = el("input");
      inp.type = "color";
      inp.id = id;
      inp.value = o[opt.key] || "#232833";
      inp.addEventListener("input", () => {
        o[opt.key] = inp.value;
        renderContents();
      });
      lab.append(inp);
      return lab;
    }
    // number
    const lab = el("label", "field");
    lab.append(el("span", null, opt.label));
    const inp = el("input");
    inp.type = "number";
    inp.id = id;
    if (opt.min != null) inp.min = String(opt.min);
    if (opt.max != null) inp.max = String(opt.max);
    inp.step = String(opt.step != null ? opt.step : 1);
    inp.value = String(o[opt.key] != null ? o[opt.key] : "");
    inp.addEventListener("change", () => {
      const v = Number(inp.value);
      o[opt.key] = Number.isFinite(v) ? v : 0;
      renderContents();
    });
    lab.append(inp);
    if (opt.unit) lab.append(el("span", "forgeUnit", opt.unit));
    if (opt.hint) lab.title = opt.hint;
    return lab;
  }

  /* --------------------------------------------------------- file list preview */

  function renderContents() {
    const t = def();
    const o = opts[t.id];
    contentsEl.innerHTML = "";
    const info = (app.info && app.info()) || {};
    const name = slug(info.label || "model");
    const ctxName = name;

    let rows = [];
    if (t.id === "print" || t.id === "all") {
      rows.push([`${ctxName}.stl`, o.ascii ? "ASCII STL, millimetres" : "binary STL, millimetres"]);
      rows.push([`${ctxName}-PRINT-REPORT.txt`, "dimensions, volume, mass estimate"]);
    } else if (t.id === "mini") {
      rows.push([`${ctxName}-${miniScaleLabel(o)}.stl`, "miniature STL, millimetres" + (o.base !== "none" ? `, ${o.baseSize} mm base` : "")]);
      rows.push([`${ctxName}-PRINT-REPORT.txt`, "print report"]);
    } else if (t.id === "tts") {
      rows.push([`${ctxName}.obj`, "indexed mesh"]);
      rows.push([`${ctxName}.mtl`, "material"]);
      if (o.texture) rows.push([`${ctxName}.png`, "diffuse texture (if the model has one)"]);
      if (o.collision === "hull") rows.push([`${ctxName}-collider.obj`, "convex collider"]);
      rows.push(["HOW-TO-IMPORT.txt", "TTS import steps"]);
    } else if (t.id === "token") {
      rows.push([`${ctxName}-token-${o.size}.png`, `${o.size}² ${o.view} token${o.ring ? ", circular" : ""}`]);
      if (o.glb) rows.push([`${ctxName}-token.glb`, "1-unit GLB"]);
      rows.push(["HOW-TO-USE.txt", "Roll20 / Foundry steps"]);
    } else if (t.id === "glb") {
      rows.push([`${ctxName}.glb`, "main mesh" + (o.animations ? " + clips" : "")]);
      if (o.lods === "2") rows.push([`${ctxName}-LOD1.glb`, "~40% triangles"]);
      if (o.lods === "3") {
        rows.push([`${ctxName}-LOD1.glb`, "~50% triangles"]);
        rows.push([`${ctxName}-LOD2.glb`, "~20% triangles"]);
      }
      if (o.collision !== "none") rows.push([`${ctxName}-collision.obj`, `${o.collision} collision proxy`]);
      rows.push(["IMPORT-NOTES.txt", "engine steps + stats"]);
    } else if (t.id === "obj") {
      rows.push([`${ctxName}.obj`, "mesh"]);
      rows.push([`${ctxName}.mtl`, "material"]);
      if (o.texture) rows.push([`${ctxName}.png`, "diffuse texture (if any)"]);
      if (o.collision !== "none") rows.push([`${ctxName}-collision.obj`, `${o.collision} proxy`]);
      rows.push(["IMPORT-NOTES.txt", "import steps"]);
    }

    for (const [file, desc] of rows) {
      const row = el("div", "forgeFile");
      row.append(el("span", "forgeFileName", file));
      row.append(el("span", "forgeFileDesc", desc));
      contentsEl.append(row);
    }
    if (buildBtn) buildBtn.disabled = !info.hasModel;
    if (notesEl) notesEl.hidden = true;
  }

  /* --------------------------------------------------------- model summary */

  function renderModel() {
    if (!modelEl) return;
    const info = (app.info && app.info()) || {};
    modelEl.innerHTML = "";
    if (!info.hasModel) {
      modelEl.append(el("div", "forgeHint", "No model on the stage. Generate one from a prompt, or drop an image / 3D file onto the page."));
      return;
    }
    const c = ensureCache(false);
    const r = c.report;
    const row = el("div", "forgeStats");
    const add = (k, v, cls) => {
      const it = el("div", "forgeStat" + (cls ? " " + cls : ""));
      it.append(el("span", "forgeStatK", k));
      it.append(el("span", "forgeStatV", v));
      row.append(it);
    };
    add("Triangles", Math.round(c.soup ? G.triangleCount(c.soup) : info.triangles || 0).toLocaleString());
    if (r) {
      add("Size (units)", `${round(r.dims[0], 2)} × ${round(r.dims[1], 2)} × ${round(r.dims[2], 2)}`);
      add("Closed", closed(r) ? "yes" : "no", closed(r) ? "ok" : "warn");
      add("Shells", String(r.shells));
      add("Boundary edges", String(r.boundaryEdges), r.boundaryEdges ? "warn" : "ok");
      add("Non-manifold", String(r.nonManifoldEdges), r.nonManifoldEdges ? "warn" : "ok");
      add("Euler χ", String(r.euler));
    }
    modelEl.append(row);
    if (r && r.boundaryEdges > 0) {
      modelEl.append(el("div", "forgeHint", `This mesh is open (${r.boundaryEdges} boundary edges). Enable “Repair open surfaces” on the print targets, or use Close mesh in the Volume panel, to get a solid.`));
    } else if (r && r.nonManifoldEdges > 0) {
      modelEl.append(el("div", "forgeHint", `${r.nonManifoldEdges} non-manifold edges — harmless for most slicers; a check in your slicer's repair view is wise.`));
    }
  }

  /* --------------------------------------------------------- building */

  async function runBuild() {
    const t = def();
    const info = (app.info && app.info()) || {};
    if (!info.hasModel) {
      toast("There is no model on the stage yet", 2600);
      return;
    }
    buildBtn.disabled = true;
    const label = buildBtn.textContent;
    buildBtn.textContent = "Working…";
    app.setStatus && app.setStatus(`Building ${t.short} package…`, true);
    const notes = [];
    try {
      const c = ensureCache(true);
      const name = slug(info.label || "model");
      const ctx = {
        app,
        raw: c.soup,
        material: c.material,
        tex: c.soup && c.soup.textures && c.soup.textures.length ? c.soup.textures[0].image : null,
        name,
        note: (m) => notes.push(m),
        textureBytes: () => imageBytes(ctx.tex),
      };
      ctx.capture = captureModel(ctx, app);
      const result = await t.build(opts[t.id], ctx);
      await deliver(t, opts[t.id], result, notes);
    } catch (e) {
      console.warn("export target failed", e);
      toast((e && e.message) || "That export failed — check the console", 4000);
    } finally {
      app.clearStatus && app.clearStatus();
      buildBtn.textContent = label;
      buildBtn.disabled = false;
    }
  }

  async function deliver(t, o, result, notes) {
    const info = (app.info && app.info()) || {};
    const name = slug(info.label || "model");
    const all = [...(result.files || [])];
    const extras = [...(result.extras || [])];
    lastBuild = { target: t, files: all, extras, summary: result.summary, notes: [...(result.notes || []), ...notes] };

    const bundle = t.mode === "package" || (o && o.zip);
    const blob = bundle ? zipBlob([...all, ...extras], { folder: `${name}-${t.id}` }) : null;
    if (bundle) {
      downloadBlob(blob, `${name}-${t.id === "all" ? "bundle" : t.id}.zip`);
    } else if (result.primary) {
      const f = all.find((x) => x.name === result.primary) || all[0];
      downloadBlob(dataBlob(f.data, f.name), f.name);
    } else if (all.length) {
      downloadBlob(dataBlob(all[0].data, all[0].name), all[0].name);
    }

    renderResult(lastBuild, bundle);
    toast(`${t.short} export ready`, 2400);
  }

  function downloadBlob(blob, filename) {
    if (app.download) app.download(blob, filename);
    else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }
  }

  function dataBlob(data, filename) {
    if (typeof data === "string") return new Blob([data], { type: mimeFor(filename) });
    return new Blob([data], { type: mimeFor(filename) });
  }

  function mimeFor(name) {
    if (/\.stl$/i.test(name)) return "model/stl";
    if (/\.obj$/i.test(name)) return "text/plain";
    if (/\.mtl$/i.test(name)) return "text/plain";
    if (/\.glb$/i.test(name)) return "model/gltf-binary";
    if (/\.png$/i.test(name)) return "image/png";
    if (/\.zip$/i.test(name)) return "application/zip";
    return "text/plain";
  }

  function renderResult(build, bundled) {
    if (!notesEl) return;
    notesEl.hidden = false;
    notesEl.innerHTML = "";
    notesEl.append(el("div", "forgeResultHead", "Export ready"));
    if (build.summary) notesEl.append(el("div", "forgeSummary", build.summary));
    for (const n of build.notes) notesEl.append(el("div", "forgeNote", "• " + n));
    if (!bundled && build.extras && build.extras.length) {
      const row = el("div", "testRow");
      row.append(
        btn("Download extras (.zip)", "ghost", () => {
          const info = (app.info && app.info()) || {};
          const nm = slug(info.label || "model");
          downloadBlob(zipBlob(build.extras, { folder: `${nm}-${build.target.id}-extras` }), `${nm}-${build.target.id}-extras.zip`);
        })
      );
      notesEl.append(row);
    }
  }

  /* --------------------------------------------------------- panel chrome */

  function build() {
    overlay = el("div", "testsOverlay forgeOverlay");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Export targets");

    const sheet = el("div", "testsSheet forgeSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "Export — one file per destination"));
    head.append(el("div", "testsSpacer"));
    const scan = (scanBtn = el("button", "btn ghost", "Rescan"));
    scan.title = "Re-read the stage model";
    scan.addEventListener("click", () => {
      ensureCache(true);
      renderModel();
      renderContents();
      toast("Re-scanned the stage model", 1600);
    });
    head.append(scan);
    const close = el("button", "btn ghost testsClose", "×");
    close.title = "Close";
    close.addEventListener("click", closePanel);
    head.append(close);

    targetRow = el("div", "seg forgeTargets");

    const body = el("div", "forgeBody");
    const left = el("div", "forgeCol");
    const right = el("div", "forgeCol");

    modelEl = el("div", "forgeCard");
    const optCard = el("div", "forgeCard");
    optCard.append(el("div", "rigCardHead", "Options"));
    defWrap = el("div", "forgeOptions");
    optCard.append(defWrap);
    left.append(modelEl, optCard);

    const contentsCard = el("div", "forgeCard");
    contentsCard.append(el("div", "rigCardHead", "Package contents"));
    contentsEl = el("div", "forgeContents");
    contentsCard.append(contentsEl);
    notesEl = el("div", "forgeResult");
    notesEl.hidden = true;
    contentsCard.append(notesEl);
    right.append(contentsCard);

    body.append(left, right);

    const foot = el("div", "forgeFoot");
    buildBtn = btn("Build package", "primary", runBuild, "Process the model and download the result");
    foot.append(buildBtn);
    sheet.append(head, targetRow, body, foot);
    overlay.append(sheet);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePanel();
    });
    (document.getElementById("app") || document.body).append(overlay);

    selectTarget(current);
    return overlay;
  }

  function refresh() {
    if (!open) return;
    renderModel();
    renderContents();
  }

  function openPanel() {
    if (!overlay) build();
    open = true;
    overlay.hidden = false;
    ensureCache(false);
    renderModel();
    renderContents();
    clearInterval(tick);
    tick = setInterval(() => {
      if (open && signature() !== (cache && cache.key)) {
        ensureCache(false);
        renderModel();
      }
    }, 1500);
  }

  function closePanel() {
    open = false;
    if (overlay) overlay.hidden = true;
    clearInterval(tick);
  }

  return {
    open: openPanel,
    close: closePanel,
    toggle: () => (open ? closePanel() : openPanel()),
    refresh,
    build: (id) => {
      if (!overlay) build();
      if (id) selectTarget(id);
      return runBuild();
    },
    get isOpen() {
      return open;
    },
    get target() {
      return current;
    },
    get lastBuild() {
      return lastBuild;
    },
    targets: TARGETS,
  };
}

/* Read a texture image (canvas / ImageBitmap / HTMLImageElement) into PNG bytes. */
async function imageBytes(image) {
  if (!image) return null;
  const w = image.width || image.videoWidth || 0;
  const h = image.height || image.videoHeight || 0;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(image, 0, 0, w, h);
  return canvasBytes(canvas);
}

export { TARGETS };
