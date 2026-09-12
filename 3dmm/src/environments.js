/* Environment + light rigs — the realism layer that sits under the model.
 *
 * An "environment" is an equirectangular sky painted procedurally into a 2D canvas. The same
 * texture does two jobs: it is the scene background (when shown) and, filtered through a PMREM,
 * the image-based lighting every PBR material reflects. Because it is generated in canvas there is
 * no HDRI to download and the presets are tiny — but a proper studio soft-box gradient is the
 * single biggest thing that makes a generated mesh stop looking like a flat scan and start looking
 * like a photographed object, so this is the high-leverage part of the realism layer.
 *
 * Equirect layout: x is longitude (wraps at the edges), y is latitude (top = straight up, horizon
 * at 0.5, bottom = straight down). Painters fill that space; `softBlob` is the soft-box helper.
 */

import { THREE } from "./three.js";

const W = 2048;
const H = 1024;

function newCanvas() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return c;
}

function vgrad(ctx, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function softBlob(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(0.55, color.replace(/[\d.]+\)$/, "0.35)"));
  g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ------------------------------------------------------------------ painters */

function paintStudio(ctx) {
  vgrad(ctx, [
    [0, "#eef2f9"], [0.40, "#c3ccdb"], [0.5, "#9aa4b6"],
    [0.505, "#40465a"], [0.72, "#2a2f3c"], [1, "#1d2029"],
  ]);
  // overhead softboxes, left warm-neutral, right cool — gives the model a lit-from-above read
  softBlob(ctx, W * 0.22, H * 0.30, H * 0.34, "rgba(255,255,255,1)");
  softBlob(ctx, W * 0.60, H * 0.24, H * 0.26, "rgba(255,251,242,0.95)");
  softBlob(ctx, W * 0.88, H * 0.42, H * 0.22, "rgba(206,222,255,0.85)");
  softBlob(ctx, W * 0.05, H * 0.46, H * 0.20, "rgba(255,238,220,0.7)");
}

function paintSoft(ctx) {
  vgrad(ctx, [
    [0, "#f6f8fc"], [0.44, "#d5dce8"], [0.5, "#b8c0cf"],
    [0.505, "#8b93a2"], [1, "#6d7480"],
  ]);
  softBlob(ctx, W * 0.18, H * 0.34, H * 0.4, "rgba(255,255,255,1)");
  softBlob(ctx, W * 0.68, H * 0.30, H * 0.36, "rgba(255,255,255,0.9)");
}

function paintNeutral(ctx) {
  vgrad(ctx, [
    [0, "#e2e7f0"], [0.5, "#aeb6c4"], [0.505, "#3a3f4a"], [1, "#282c34"],
  ]);
}

function paintOutdoor(ctx) {
  vgrad(ctx, [
    [0, "#1f5fbf"], [0.36, "#6ea6e6"], [0.48, "#cfe3fb"], [0.5, "#eef4ff"],
    [0.505, "#6d7a58"], [0.72, "#48513a"], [1, "#2b3125"],
  ]);
  softBlob(ctx, W * 0.62, H * 0.28, H * 0.30, "rgba(255,252,235,1)");
  softBlob(ctx, W * 0.86, H * 0.12, H * 0.34, "rgba(255,255,255,0.55)");
}

function paintSunset(ctx) {
  vgrad(ctx, [
    [0, "#0e1a40"], [0.30, "#5d3f78"], [0.43, "#c96a44"],
    [0.48, "#f6b06a"], [0.5, "#ffe0ad"], [0.505, "#3a2a24"], [1, "#160f12"],
  ]);
  softBlob(ctx, W * 0.34, H * 0.455, H * 0.16, "rgba(255,244,214,1)");
  softBlob(ctx, W * 0.34, H * 0.42, H * 0.5, "rgba(255,170,90,0.7)");
}

function paintNight(ctx) {
  vgrad(ctx, [
    [0, "#02030a"], [0.42, "#0a1124"], [0.5, "#182444"], [0.505, "#0a0e16"], [1, "#04060a"],
  ]);
  const rnd = lcg(1337);
  ctx.save();
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const y = rnd() * H * 0.49;
    const a = 0.25 + rnd() * 0.7;
    const r = rnd() < 0.9 ? 0.8 : 1.6;
    ctx.fillStyle = "rgba(230,240,255," + a.toFixed(2) + ")";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  softBlob(ctx, W * 0.72, H * 0.20, H * 0.085, "rgba(226,235,255,1)");
  softBlob(ctx, W * 0.72, H * 0.20, H * 0.26, "rgba(180,205,255,0.35)");
}

const PAINTERS = {
  studio: paintStudio,
  soft: paintSoft,
  neutral: paintNeutral,
  outdoor: paintOutdoor,
  sunset: paintSunset,
  night: paintNight,
};

export const ENV_PRESETS = [
  { id: "studio", label: "Studio" },
  { id: "soft", label: "Soft" },
  { id: "neutral", label: "Neutral" },
  { id: "outdoor", label: "Outdoor" },
  { id: "sunset", label: "Sunset" },
  { id: "night", label: "Night" },
];

/* ------------------------------------------------------------------- rigs */

/* Each rig drives the three existing lights (hemisphere, key, rim). Keeping the rigs as plain data
   means a look preset can carry one and `applyLightRig` just writes it onto the scene lights. */
export const LIGHT_RIGS = {
  studio: {
    hemi: { sky: 0xa9c0ff, ground: 0x14161f, intensity: 0.45 },
    key: { color: 0xfff3e2, intensity: 2.4, pos: [3.2, 4.6, 3.6] },
    rim: { color: 0x8fb0ff, intensity: 1.15, pos: [-4.5, 1.6, -4.2] },
  },
  soft: {
    hemi: { sky: 0xdfe8ff, ground: 0x232833, intensity: 0.85 },
    key: { color: 0xfff7ee, intensity: 1.55, pos: [2.6, 5.2, 3.2] },
    rim: { color: 0xc0d4ff, intensity: 0.65, pos: [-4, 2.2, -3.4] },
  },
  dramatic: {
    hemi: { sky: 0x2b3550, ground: 0x05070c, intensity: 0.18 },
    key: { color: 0xffd39a, intensity: 3.4, pos: [4.4, 3.2, 2.2] },
    rim: { color: 0x6fa8ff, intensity: 0.7, pos: [-5, 1.4, -4] },
  },
  outdoor: {
    hemi: { sky: 0xcfe3ff, ground: 0x5a4a35, intensity: 1.05 },
    key: { color: 0xfff0d8, intensity: 3.0, pos: [4.2, 6.2, 2.4] },
    rim: { color: 0xa9c8ff, intensity: 0.85, pos: [-4, 2.2, -4] },
  },
  night: {
    hemi: { sky: 0x24406f, ground: 0x05070c, intensity: 0.35 },
    key: { color: 0xd2e2ff, intensity: 1.15, pos: [3.2, 4.4, 3.2] },
    rim: { color: 0x4a7cff, intensity: 1.0, pos: [-4, 2, -4] },
  },
};

export function applyLightRig(name, lights) {
  const rig = LIGHT_RIGS[name];
  if (!rig || !lights) return;
  const { hemiLight, keyLight, rimLight } = lights;
  if (hemiLight) {
    hemiLight.color.set(rig.hemi.sky);
    hemiLight.groundColor.set(rig.hemi.ground);
    hemiLight.intensity = rig.hemi.intensity;
  }
  if (keyLight) {
    keyLight.color.set(rig.key.color);
    keyLight.intensity = rig.key.intensity;
    keyLight.position.set(...rig.key.pos);
  }
  if (rimLight) {
    rimLight.color.set(rig.rim.color);
    rimLight.intensity = rig.rim.intensity;
    rimLight.position.set(...rig.rim.pos);
  }
}

/* Image-based lighting intensity lives on the material, so a change means a walk of the scene —
   cheap enough here (a handful of materials) that we do it on demand rather than per frame. */
export function applyEnvIntensity(root, v) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m && "envMapIntensity" in m) m.envMapIntensity = v;
  });
}

/* ------------------------------------------------------------------ manager */

export class EnvironmentManager {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this._skies = new Map();
    this._envRT = null;
    this._envName = null;
    this.intensity = 1;
    this.showBackground = true;
    this._fallbackBg = scene.background || null;
  }

  _sky(name) {
    let entry = this._skies.get(name);
    if (entry) return entry;
    const paint = PAINTERS[name] || PAINTERS.studio;
    const canvas = newCanvas();
    paint(canvas.getContext("2d"));
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    entry = { canvas, tex };
    this._skies.set(name, entry);
    return entry;
  }

  apply(name, { intensity = this.intensity, showBackground = this.showBackground } = {}) {
    const { tex } = this._sky(name);
    if (this._envName !== name) {
      if (this._envRT) this._envRT.dispose();
      this._envRT = this.pmrem.fromEquirectangular(tex);
      this.scene.environment = this._envRT.texture;
      this._envName = name;
    }
    this.intensity = intensity;
    this.showBackground = showBackground;
    this.scene.background = showBackground ? tex : this._fallbackBg;
    applyEnvIntensity(this.scene, intensity);
    return this;
  }

  setIntensity(v) {
    this.intensity = v;
    applyEnvIntensity(this.scene, v);
  }

  setShowBackground(on) {
    this.showBackground = on;
    const { tex } = this._sky(this._envName || "studio");
    this.scene.background = on ? tex : this._fallbackBg;
  }

  // New meshes (a rebuilt model, a studio primitive) carry fresh materials — re-stamp the current
  // intensity onto them so the env scale stays uniform across the scene.
  refresh() {
    applyEnvIntensity(this.scene, this.intensity);
  }

  dispose() {
    if (this._envRT) this._envRT.dispose();
    for (const s of this._skies.values()) s.tex.dispose();
    this._skies.clear();
    this.pmrem.dispose();
  }
}
