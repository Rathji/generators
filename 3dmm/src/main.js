import * as T3 from "./three.js";
import { estimateDepth, normalizeDepth, warmUpDepth } from "./depth.js";
import { warmUpMatte, cutoutSubject } from "./matting.js";
import { buildReliefGeometry } from "./relief.js";
import { buildSolidGeometry, BACK_MODES } from "./volume-build.js";
import { analyzeMesh, closeMesh, calibrate, formatLength, formatArea, formatVolume, formatMass, DENSITIES } from "./volume.js";
import { download, toGLB, toSTL, toOBJ, toPLY, slug } from "./exporters.js";
import { loadModelFile, normalizeObject, fileKind, isTgaFile, setLoaderRenderer } from "./loaders.js";
import { tgaToCanvas, encodeTGA } from "./tga.js";
import { openVideo, frameToDataUrl } from "./video.js";
import { createThumbRenderer, disposeTree } from "./thumb.js";
import { initStudio } from "./studio.js";
import { createSceneBase } from "./scene-base.js";
import { img3dSupported, probeDevice, reconstructFromCanvas, rebuildMesh, probeBackbone, modelsLoaded as img3dModelsLoaded } from "./img3d.js";
import { createTestPanel } from "./test-panel.js";
import { createLibrary } from "./library.js";
import { createAddons } from "./addons.js";
import { EnvironmentManager, applyLightRig, ENV_PRESETS } from "./environments.js";
import { PostFX, LOOK_PRESETS } from "./render-fx.js";
import { deriveDetailMaps, canvasTexture, ensureUv1 } from "./material-maps.js";
import { createRig } from "./armature.js";
import { createAutoArmature } from "./auto-armature.js";
import { createMuscleRig } from "./muscle-rig.js";
import { createRigPanel } from "./rig-panel.js";
import { createAnimator } from "./anim.js";
import { createMotionLayer, MOTIONS } from "./motion.js";
import { createAuthor } from "./anim-author.js";
import { createNoLimit } from "./nolimit.js";
import { createAiPanel } from "./ai-panel.js";
import { createAiAnim } from "./ai-anim.js";
import { createPartner } from "./partner.js";
import { createWorkflow } from "./workflow.js";
import { createVolume } from "./volume-panel.js";
import { createShapeKeys, AUTO_SHAPES } from "./shape-keys.js";
import { createShapePanel } from "./shape-panel.js";
import { createTargets } from "./targets.js";

const THREE = T3.THREE;
const $ = (id) => document.getElementById(id);

const dom = {
  prompt: $("promptInput"),
  generateBtn: $("generateBtn"),
  imageBtn: $("imageBtn"),
  surpriseBtn: $("surpriseBtn"),
  styleChips: $("styleChips"),
  uploadBtn: $("uploadBtn"),
  fileInput: $("fileInput"),
  resSelect: $("resSelect"),
  removeBgCheck: $("removeBgCheck"),
  viewSelect: $("viewSelect"),
  detailRange: $("detailRange"), detailVal: $("detailVal"),
  depthRange: $("depthRange"), depthVal: $("depthVal"),
  smoothRange: $("smoothRange"), smoothVal: $("smoothVal"),
  baseRange: $("baseRange"), baseVal: $("baseVal"),
  invertCheck: $("invertCheck"),
  alphaCheck: $("alphaCheck"),
  matteCheck: $("matteCheck"),
  volumeCheck: $("volumeCheck"),
  autorotateCheck: $("autorotateCheck"),
  baseCheck: $("baseCheck"),
  srcThumb: $("srcThumb"),
  depthThumb: $("depthThumb"),
  depthCaption: $("depthCaption"),
  exportGlbBtn: $("exportGlbBtn"),
  exportPlyBtn: $("exportPlyBtn"),
  exportStlBtn: $("exportStlBtn"),
  exportObjBtn: $("exportObjBtn"),
  exportPngBtn: $("exportPngBtn"),
  exportTgaBtn: $("exportTgaBtn"),
  exportBaseCheck: $("exportBaseCheck"),
  dragOutBtn: $("dragOutBtn"),
  dragOutLabel: $("dragOutLabel"),
  history: $("history"),
  status: $("status"),
  statusText: $("statusText"),
  statusTrack: $("statusTrack"),
  statusFill: $("statusFill"),
  qualitySeg: $("qualitySeg"),
  qualityNote: $("qualityNote"),
  aiBadge: $("aiBadge"),
  aiControls: $("aiControls"),
  aiDetailRange: $("aiDetailRange"), aiDetailVal: $("aiDetailVal"),
  aiSmoothRange: $("aiSmoothRange"), aiSmoothVal: $("aiSmoothVal"),
  dropOverlay: $("dropOverlay"),
  emptyState: $("emptyState"),
  stage: $("stage"),
  view: $("view"),
  app: $("app"),
  studioBtn: $("studioBtn"),
  workflowBtn: $("workflowBtn"),
  testsBtn: $("testsBtn"),
  libraryBtn: $("libraryBtn"),
  rigBtn: $("rigBtn"),
  aiBtn: $("aiBtn"),
  volumeBtn: $("volumeBtn"),
  shapeBtn: $("shapeBtn"),
  targetsBtn: $("targetsBtn"),
  refRow: $("refRow"),
  refDrop: $("refDrop"),
  refThumb: $("refThumb"),
  refEmpty: $("refEmpty"),
  refInput: $("refInput"),
  refClearBtn: $("refClearBtn"),
  refSub: $("refSub"),
  ref3dRow: $("ref3dRow"),
  ref3dDrop: $("ref3dDrop"),
  ref3dThumb: $("ref3dThumb"),
  ref3dEmpty: $("ref3dEmpty"),
  ref3dInput: $("ref3dInput"),
  ref3dClearBtn: $("ref3dClearBtn"),
  ref3dSub: $("ref3dSub"),
  refVideoRow: $("refVideoRow"),
  refVideoDrop: $("refVideoDrop"),
  refVideoThumb: $("refVideoThumb"),
  refVideoEmpty: $("refVideoEmpty"),
  refVideoInput: $("refVideoInput"),
  refVideoClearBtn: $("refVideoClearBtn"),
  refVideoSub: $("refVideoSub"),
  refVideoFrameRow: $("refVideoFrameRow"),
  refVideoFrame: $("refVideoFrame"),
  refVideoTime: $("refVideoTime"),
  imageCard: $("imageCard"),
  aiImageEl: $("aiImageEl"),
  imgViewBtn: $("imgViewBtn"),
  imgBuildBtn: $("imgBuildBtn"),
  imgRefBtn: $("imgRefBtn"),
  imgDownloadBtn: $("imgDownloadBtn"),
  imgGallery: $("imgGallery"),
  imgCount: $("imgCount"),
  imgLightbox: $("imgLightbox"),
  lightboxImg: $("lightboxImg"),
  lightboxClose: $("lightboxClose"),
  lookPresetSel: $("lookPresetSel"),
  envSelect: $("envSelect"),
  envIntensityRange: $("envIntensityRange"), envIntensityVal: $("envIntensityVal"),
  envBgCheck: $("envBgCheck"),
  lightRigSelect: $("lightRigSelect"),
  fxCheck: $("fxCheck"),
  fxPresetSel: $("fxPresetSel"),
  fxExposureRange: $("fxExposureRange"), fxExposureVal: $("fxExposureVal"),
  fxContrastRange: $("fxContrastRange"), fxContrastVal: $("fxContrastVal"),
  fxSaturationRange: $("fxSaturationRange"), fxSaturationVal: $("fxSaturationVal"),
  fxBloomRange: $("fxBloomRange"), fxBloomVal: $("fxBloomVal"),
  fxVignetteRange: $("fxVignetteRange"), fxVignetteVal: $("fxVignetteVal"),
  fxGrainRange: $("fxGrainRange"), fxGrainVal: $("fxGrainVal"),
  fxCaRange: $("fxCaRange"), fxCaVal: $("fxCaVal"),
  fxSharpenRange: $("fxSharpenRange"), fxSharpenVal: $("fxSharpenVal"),
  matRoughRange: $("matRoughRange"), matRoughVal: $("matRoughVal"),
  matMetalRange: $("matMetalRange"), matMetalVal: $("matMetalVal"),
  toneMapSelect: $("toneMapSelect"),
  shadowRange: $("shadowRange"), shadowVal: $("shadowVal"),
  detailCheck: $("detailCheck"),
  detailNormalRange: $("detailNormalRange"), detailNormalVal: $("detailNormalVal"),
  detailAoRange: $("detailAoRange"), detailAoVal: $("detailAoVal"),
  fxResetBtn: $("fxResetBtn"),
  animCard: $("animCard"),
  animBadge: $("animBadge"),
  animEmpty: $("animEmpty"),
  animRows: $("animRows"),
  animMorphs: $("animMorphs"),
  animControls: $("animControls"),
  animStopBtn: $("animStopBtn"),
  animLoopCheck: $("animLoopCheck"),
  animSpeedRange: $("animSpeedRange"), animSpeedVal: $("animSpeedVal"),
};

const state = {
  busy: false,
  depth: null,
  depthW: 0,
  depthH: 0,
  alpha: null,
  sourceAlpha: null,
  matteComputed: false,
  prepCanvas: null,
  textureCanvas: null,
  label: "model",
  mesh: null,
  hasModel: false,
  history: [],
  historyIndex: -1,
  mode: "empty",
  ref: null,
  ref3d: null,
  refVideo: null,
  quality: "fast",
  imageSrc: null,
  ai: null,
  aiResolution: 256,
  aiThreshold: 25,
  aiSmooth: 0.75,
  cutMethod: null,
  genImages: [],
  genIndex: -1,
  generatedImage: null,
  matTouched: false,
  solid: false,
  volumeBack: "mirror",
  volumeReport: null,
  volumeScaleHeight: null,
  volumeDensity: 1000,
  volumeAxis: "y",
  aiMetrics: null,
};

/* The smoothing slider is 0\u20131; this maps it to a world-space Taubin radius. The default
   value (0.55 \u2192 0.022) is the "8 passes" setting that removed the surface ripple in
   testing without dulling the blade. */
const AI_SMOOTH_WORLD = 0.04;

if (!renderer_ok()) {
  dom.emptyState.innerHTML =
    '<div class="esTitle">WebGL unavailable</div><div class="esText">This generator needs WebGL. Try a different browser or enable hardware acceleration.</div>';
}

function renderer_ok() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) {
    return false;
  }
}

const renderer = new THREE.WebGLRenderer({
  canvas: dom.view,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* The glTF loader needs the renderer for KTX2 texture format detection. */
setLoaderRenderer(renderer);

const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = makeBackdrop();

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
camera.position.set(1.6, 1.1, 3.4);

const controls = new T3.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.6;
controls.maxDistance = 40;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.1;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new T3.RoomEnvironment(), 0.03).texture;

const hemiLight = new THREE.HemisphereLight(0xa9c0ff, 0x14161f, 0.45);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xfff3e2, 2.4);
keyLight.position.set(3.2, 4.6, 3.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.bias = -0.0006;
keyLight.shadow.normalBias = 0.02;
const sc = keyLight.shadow.camera;
sc.near = 0.5; sc.far = 24; sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x8fb0ff, 1.15);
rimLight.position.set(-4.5, 1.6, -4.2);
scene.add(rimLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.34, color: 0x05070c }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.05;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(24, 24, 0x2a3450, 0x1b2130);
grid.material.opacity = 0.5;
grid.material.transparent = true;
grid.position.y = -1.045;
scene.add(grid);

const sceneBase = createSceneBase();
sceneBase.setFloorY(-1.045);
scene.add(sceneBase.group);

const modelGroup = new THREE.Group();
scene.add(modelGroup);

/* Skeleton overlay + remote-user ghosts live here, NOT in modelGroup, so they can
   never end up in an export (see armature.js). */
const rigOverlay = new THREE.Group();
rigOverlay.name = "rig-overlay";
scene.add(rigOverlay);
let rig = null;
let rigPanel = null;
/* The duplicated second body. Created after the motion layer exists; declared here so
   clearModel()/refreshRig() can safely dispose it before it is assigned. See partner.js. */
let partner = null;
/* Set once the Shape system exists; lets refreshRig() drop stale shape data on a rebuild. */
let onModelChanged = null;

/* Plays clips for models that carry animation but no skeleton (morph targets, node
   transforms); defers to the rig's own mixer whenever a rig exists. See anim.js. */
const animator = createAnimator({ root: modelGroup, getRig: () => rig });

/* Procedural, bone-level motion presets — driven straight from the skeleton so a
   model with no clips can still move (and, in the Intimate category, move
   explicitly). See motion.js. */
const motions = createMotionLayer({ getRig: () => rig });

/* The second body. A real deep clone of the loaded model with its own rig and its own
   motion layer, seated by matching hips and frame-locked to the main motion. Powers the
   Motion card's Partner category. See partner.js / motion.js. */
partner = createPartner({
  scene,
  getModel: () => modelGroup,
  getRig: () => rig,
  getMainLayer: () => motions,
  getSize: () => {
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return 2;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) || 2;
  },
  render: () => renderFrame(),
  toast,
});

/* Keyframe animation authoring — pose the rig, drop keys, play/export the result.
   See anim-author.js. */
const author = createAuthor({
  getRig: () => rig,
  getKv: () => (window.root && window.root.kv) || null,
  getModel: () => modelGroup,
  onApply: () => {
    if (rig && rig.updateSkeleton) rig.updateSkeleton();
  },
});

/* The no-limit content policy shared by every AI call (image prompt, vision,
   chat). Default ON, persisted per-device. See nolimit.js. */
const nolimit = createNoLimit({ getKv: () => (window.root && window.root.kv) || null, toast });
nolimit.load();

function refreshRig() {
  if (rig) {
    rig.dispose();
    rig = null;
  }
  rig = createRig({ root: modelGroup, overlay: rigOverlay, size: 2 });
  animator.refresh();
  motions.setRig(rig);
  if (rigPanel) rigPanel.onRig(rig);
  refreshAnimUI();
  if (onModelChanged) onModelChanged();
  return rig;
}

/* ------------------------------------------------------------------ animation */

/* The Animation card is the app-level (non-Studio) clip player. It lists every clip the
   loaded file carried — skeletal or not — and drives them through `animator`, which routes
   skeletal clips to the rig's mixer and everything else to its own. */
const animUI = { active: -1, playing: false, speed: 1, loop: true, scrubbing: false };

function animPlay(i) {
  if (!animator.clips.length) return;
  if (i == null) i = animator.clipIndex >= 0 ? animator.clipIndex : 0;
  const ok = animator.playClip(i, { loop: animUI.loop, speed: animUI.speed });
  animUI.active = ok ? i : -1;
  animUI.playing = ok;
  syncAnimButtons();
}

function animToggle(i) {
  if (animUI.active === i && animUI.playing) {
    animator.setPlaying(false);
    animUI.playing = false;
  } else {
    animPlay(i);
  }
  syncAnimButtons();
}

function syncAnimButtons() {
  if (!dom.animRows) return;
  const rows = dom.animRows.querySelectorAll(".animRow");
  rows.forEach((row, i) => {
    const b = row.querySelector(".animPlay");
    if (b) b.innerHTML = animUI.playing && animUI.active === i ? "&#10074;&#10074;" : "&#9654;";
    row.classList.toggle("active", animUI.active === i);
  });
}

function refreshAnimUI() {
  if (!dom.animCard) return;
  const clips = animator.clips;
  const morphs = state.hasModel ? animator.morphTargets() : [];
  const show = !!state.hasModel && (clips.length > 0 || morphs.length > 0);
  dom.animCard.hidden = !show;
  if (!show) return;

  dom.animBadge.hidden = clips.length === 0;
  dom.animBadge.textContent = String(clips.length);
  dom.animEmpty.hidden = clips.length > 0;
  dom.animEmpty.textContent = morphs.length
    ? "No clips in this model — morph targets are listed below."
    : "No animation clips in this model.";

  dom.animRows.innerHTML = "";
  clips.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "animRow";
    row.innerHTML =
      '<div class="row tight"><button class="btn ghost animPlay" title="Play / pause">&#9654;</button>' +
      '<span class="animName"></span></div>' +
      '<input class="animScrub" type="range" min="0" step="0.001" value="0">';
    row.querySelector(".animName").textContent = `${c.name} · ${(c.duration || 0).toFixed(2)}s · ${c.tracks} tracks${c.morphTracks ? " (" + c.morphTracks + " morph)" : ""}`;
    row.querySelector(".animPlay").onclick = () => animToggle(i);
    const scrub = row.querySelector(".animScrub");
    scrub.max = String(Math.max(c.duration || 1, 0.001));
    scrub.onpointerdown = () => {
      animUI.scrubbing = true;
    };
    scrub.onpointerup = () => {
      animUI.scrubbing = false;
    };
    scrub.oninput = () => {
      animator.setClipTime(Number(scrub.value));
    };
    dom.animRows.appendChild(row);
  });

  dom.animMorphs.innerHTML = "";
  if (morphs.length) {
    const head = document.createElement("div");
    head.className = "cardHead";
    head.innerHTML = "<span>Morph targets</span>";
    dom.animMorphs.appendChild(head);
    for (const m of morphs) {
      const label = document.createElement("label");
      label.className = "slider";
      label.innerHTML = '<span class="animMorphName"></span><input type="range" min="0" max="1" step="0.01" value="0">';
      label.querySelector(".animMorphName").textContent = `${m.mesh} · ${m.name}`;
      const range = label.querySelector("input");
      range.value = String(m.value);
      range.oninput = () => animator.setMorph(m.mesh, m.name, Number(range.value));
      dom.animMorphs.appendChild(label);
    }
  }

  const hasClips = clips.length > 0;
  if (dom.animControls) dom.animControls.hidden = !hasClips;
  if (dom.animSpeedRange) dom.animSpeedRange.closest(".slider").hidden = !hasClips;
  syncAnimButtons();

  /* Bring a freshly loaded animated model to life straight away. */
  if (hasClips && animUI.active === -1) animPlay(0);
}

function updateAnimUI() {
  if (!dom.animCard || dom.animCard.hidden) return;
  if (animator.clipIndex < 0) return;
  const rows = dom.animRows.querySelectorAll(".animRow");
  const row = rows[animator.clipIndex];
  if (!row) return;
  const scrub = row.querySelector(".animScrub");
  if (scrub && document.activeElement !== scrub && !animUI.scrubbing) scrub.value = String(animator.time);
}

if (dom.animStopBtn) {
  dom.animStopBtn.onclick = () => {
    animator.stopClip();
    animUI.playing = false;
    syncAnimButtons();
  };
}
if (dom.animLoopCheck) {
  dom.animLoopCheck.onchange = () => {
    animUI.loop = dom.animLoopCheck.checked;
    animator.setLoop(animUI.loop);
  };
}
if (dom.animSpeedRange) {
  dom.animSpeedRange.oninput = () => {
    animUI.speed = Math.max(0.05, Number(dom.animSpeedRange.value) || 1);
    if (dom.animSpeedVal) dom.animSpeedVal.textContent = animUI.speed.toFixed(2);
    animator.setSpeed(animUI.speed);
  };
}

/* --------------------------------------------------------------- realism layer */

const lights = { hemiLight, keyLight, rimLight };
const env = new EnvironmentManager(renderer, scene);
const fx = new PostFX(renderer);

/* The single render entry point for the whole app (live loop, PNG export, Studio snapshot) so the
   composited look is identical everywhere. */
function renderFrame() {
  env.refresh();
  fx.render(scene, camera);
}

/* Render an arbitrary scene + camera into an offscreen square canvas and hand back the pixels.
   The export targets use this for the VTT token render — their own scene (no grid, no ground),
   the app's environment map, and the same WebGLRenderer without touching the visible canvas. */
function renderOffscreen(tempScene, tempCamera, size, opts = {}) {
  const target = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const pixels = new Uint8Array(size * size * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, opts.transparent ? 0 : 1);
    renderer.autoClear = true;
    renderer.clear();
    renderer.render(tempScene, tempCamera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
    target.dispose();
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    img.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const look = {
  preset: "studio",
  env: "studio",
  rig: "studio",
  envIntensity: 1.0,
  showBackground: false,
  fx: "clean",
  tone: "aces",
  shadow: 0.34,
};

/* Tone mapping operator. Changing it changes the shader's tone-mapping defines, so every material
   must be flagged for recompile — three would otherwise keep the program it was born with. */
const TONE_MAPS = {
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  linear: THREE.LinearToneMapping,
  none: THREE.NoToneMapping,
};

function setToneMapping(op) {
  look.tone = TONE_MAPS[op] ? op : "aces";
  renderer.toneMapping = TONE_MAPS[look.tone];
  scene.traverse((o) => {
    if (!o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) m.needsUpdate = true;
  });
  renderFrame();
}

function setShadowStrength(v) {
  look.shadow = v;
  ground.material.opacity = v;
  ground.material.needsUpdate = true;
  renderFrame();
}

function applyLook(name, { silent = false } = {}) {
  const p = LOOK_PRESETS[name];
  if (!p) return;
  look.preset = name;
  look.env = p.env;
  look.rig = p.rig;
  look.envIntensity = p.envIntensity;
  look.showBackground = p.showBackground;
  look.fx = p.fx;
  look.tone = p.tone || "aces";
  look.shadow = p.shadow != null ? p.shadow : 0.34;
  env.apply(p.env, { intensity: p.envIntensity, showBackground: p.showBackground });
  applyLightRig(p.rig, lights);
  fx.applyPreset(p.fx);
  setToneMapping(look.tone);
  setShadowStrength(look.shadow);
  if (!silent) {
    syncRealismUI();
    renderFrame();
  }
}

const frontMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.62,
  metalness: 0.0,
  side: THREE.FrontSide,
});
const solidMat = new THREE.MeshStandardMaterial({
  color: 0x2b3141,
  roughness: 0.85,
  metalness: 0.06,
  side: THREE.DoubleSide,
});

let texture = null;
let studio = null;

function renderNow() {
  renderFrame();
}

function makeBackdrop() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(512, 380, 60, 512, 512, 760);
  g.addColorStop(0, "#1b2233");
  g.addColorStop(0.55, "#111621");
  g.addColorStop(1, "#07090e");
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 1024);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let presets = [];
try {
  presets = window.root.getStylePresets();
} catch (e) {
  presets = [{ id: "none", label: "None", keywords: "", negative: "" }];
}
let activeStyle = presets[0] || { id: "none", label: "None", keywords: "", negative: "" };

function renderChips() {
  dom.styleChips.innerHTML = "";
  presets.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (p.id === activeStyle.id ? " active" : "");
    b.textContent = p.label;
    b.onclick = () => {
      activeStyle = p;
      renderChips();
    };
    dom.styleChips.appendChild(b);
  });
}
renderChips();

function randomPromptText() {
  try {
    const t = window.root.randomPrompt.evaluateItem;
    if (t) return t;
  } catch (e) {}
  return "a friendly little robot, clay sculpture, plain background";
}

function setStatus(text, spinner = true, progress = null) {
  if (!text) {
    dom.status.hidden = true;
    dom.statusTrack.hidden = true;
    return;
  }
  dom.statusText.textContent = text;
  const sp = dom.status.querySelector(".spinner");
  if (sp) sp.style.display = spinner ? "" : "none";
  if (progress == null || !Number.isFinite(progress)) {
    dom.statusTrack.hidden = true;
  } else {
    dom.statusTrack.hidden = false;
    const pct = Math.max(0, Math.min(1, progress)) * 100;
    dom.statusFill.style.width = `${pct.toFixed(1)}%`;
  }
  dom.status.hidden = false;
}

let toastTimer = 0;
function toast(text, ms = 2600) {
  setStatus(text, false);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (!state.busy) setStatus(null);
  }, ms);
}

function prettyError(e) {
  const m = (e && (e.message || String(e))) || "Something went wrong";
  if (/too many requests|rate ?limit|quota/i.test(m)) return "Rate limited \u2014 wait a moment and try again";
  if (/nsfw|blocked|inappropriate/i.test(m)) return "That prompt was blocked";
  if (/Load failed|Failed to fetch/i.test(m)) return "Network hiccup \u2014 please try again";
  return m.slice(0, 150);
}

function setExportsEnabled(on) {
  dom.exportGlbBtn.disabled = !on;
  dom.exportPlyBtn.disabled = !on;
  dom.exportStlBtn.disabled = !on;
  dom.exportObjBtn.disabled = !on;
  dom.exportPngBtn.disabled = !on;
  dom.exportTgaBtn.disabled = !on;
  setDragOutReady(false);
  if (on) scheduleDragFile();
}

/* "Drag the model out" support: browsers only let a drag carry a real file when the DataTransfer
   item is added synchronously during dragstart, so the GLB is built ahead of time (once per model)
   and cached as a File. Dragging then drops a genuine .glb onto the desktop / Blender / any DCC. */
let dragFile = null;
let dragPrepping = false;
let dragPrepTimer = 0;
function scheduleDragFile() {
  clearTimeout(dragPrepTimer);
  dragPrepTimer = setTimeout(prepareDragFile, 700);
}
async function prepareDragFile() {
  if (!state.hasModel || dragPrepping) return;
  dragPrepping = true;
  dragFile = null;
  try {
    const blob = await toGLB(modelGroup);
    dragFile = new File([blob], exportName("glb"), { type: "model/gltf-binary" });
    setDragOutReady(true);
  } catch (e) {
    console.warn("drag-out prep failed", e);
    setDragOutReady(false);
  } finally {
    dragPrepping = false;
  }
}
function setDragOutReady(ready) {
  if (!dom.dragOutBtn) return;
  dom.dragOutBtn.setAttribute("draggable", ready ? "true" : "false");
  dom.dragOutBtn.dataset.ready = ready ? "true" : "false";
  dom.dragOutLabel.textContent = ready
    ? "Drag the model into Blender / your desktop"
    : state.hasModel
      ? "Preparing the model for drag-out\u2026"
      : "Drag the model into Blender / your desktop";
}

const shapeControls = [
  dom.detailRange, dom.depthRange, dom.smoothRange, dom.baseRange,
  dom.invertCheck, dom.alphaCheck, dom.matteCheck, dom.volumeCheck,
];
function setShapeEnabled(on) {
  shapeControls.forEach((el) => { el.disabled = !on; });
}

async function run(fn) {
  if (state.busy) return false;
  state.busy = true;
  dom.generateBtn.disabled = true;
  dom.imageBtn.disabled = true;
  dom.uploadBtn.disabled = true;
  let ok = false;
  try {
    await fn();
    ok = true;
  } catch (e) {
    console.error(e);
    toast(prettyError(e), 4200);
  } finally {
    state.busy = false;
    dom.generateBtn.disabled = false;
    dom.imageBtn.disabled = false;
    dom.uploadBtn.disabled = false;
    if (ok) setStatus(null);
  }
  return ok;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = src;
  });
}

function prepareInputs(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(4, Math.round(img.width * scale));
  const h = Math.max(4, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Float32Array(w * h);
  let hasAlpha = false;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    alpha[i] = a;
    if (a < 0.98) hasAlpha = true;
  }
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#b4b4b4";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return { canvas: c, width: w, height: h, alpha: hasAlpha ? alpha : null };
}

function updateTexture() {
  if (texture) texture.dispose();
  texture = new THREE.CanvasTexture(state.textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAniso;
  texture.needsUpdate = true;
  applyView();
}

function applyShading(mode) {
  state.shading = mode;
  const aiTextured = state.mode === "ai" && (mode === "textured" || mode === "wireframe");
  frontMat.wireframe = false;
  solidMat.wireframe = false;
  frontMat.vertexColors = aiTextured;
  frontMat.map = aiTextured ? null : texture;
  frontMat.color.set(0xffffff);
  frontMat.roughness = 0.62;
  frontMat.metalness = 0.0;
  frontMat.emissiveIntensity = 1;
  solidMat.color.set(0x5b6170);
  solidMat.roughness = 0.8;
  solidMat.metalness = 0.06;
  if (mode === "solid" || mode === "clay") {
    frontMat.map = null;
    frontMat.color.set(0xdecbab);
    frontMat.roughness = 0.95;
    frontMat.metalness = 0.0;
    solidMat.color.set(0xc2ad8d);
    solidMat.roughness = 0.95;
    solidMat.metalness = 0.0;
  } else if (mode === "material" || mode === "steel") {
    frontMat.map = null;
    frontMat.color.set(0xc3cad6);
    frontMat.roughness = 0.24;
    frontMat.metalness = 0.95;
    solidMat.color.set(0x939baa);
    solidMat.roughness = 0.3;
    solidMat.metalness = 0.9;
  } else if (mode === "wireframe" || mode === "wire") {
    frontMat.map = texture;
    frontMat.color.set(0xffffff);
    frontMat.roughness = 0.7;
    frontMat.metalness = 0.0;
    frontMat.wireframe = true;
    solidMat.wireframe = true;
  }
  frontMat.needsUpdate = true;
  solidMat.needsUpdate = true;
  applyMaterialOverrides();
  applyDetailMaps();
  renderNow();
}

function applyView() {
  applyShading(dom.viewSelect.value);
}

/* --------------------------------------------------------------- material detail maps */

/* Derived normal + AO maps (see src/material-maps.js) that give a photo-textured mesh real surface
   micro-relief. Applied to every standard material in the model that does not already ship its own
   map, and cached per source image + strength so a rebuild is cheap. */
const detail = { enabled: true, normalStrength: 0.8, aoStrength: 0.5 };
let detailMaps = null;
let detailKey = null;
let detailSig = "";
const detailTex = { normal: null, ao: null };

function detailSource() {
  if (state.textureCanvas) return state.textureCanvas;
  if (texture && texture.image) return texture.image;
  let found = null;
  modelGroup.traverse((o) => {
    if (found) return;
    const m = o.material;
    if (m && m.map && m.map.image) found = m.map.image;
  });
  return found;
}

function rebuildDetailMaps() {
  const src = detailSource();
  if (!src) {
    detailMaps = null; detailKey = null; detailSig = "";
    return null;
  }
  const sig = `${detail.normalStrength}:${detail.aoStrength}`;
  if (src === detailKey && sig === detailSig && detailMaps) return detailMaps;
  const maps = deriveDetailMaps(src, { size: 512, normalStrength: detail.normalStrength, aoStrength: detail.aoStrength });
  if (!maps) return null;
  if (detailTex.normal) detailTex.normal.dispose();
  if (detailTex.ao) detailTex.ao.dispose();
  detailTex.normal = canvasTexture(maps.normal, false);
  detailTex.ao = canvasTexture(maps.ao, false);
  detailMaps = maps;
  detailKey = src;
  detailSig = sig;
  return maps;
}

function applyDetailMaps() {
  const on = detail.enabled && state.hasModel;
  if (on && detailSource()) {
    ensureUv1(modelGroup);
    rebuildDetailMaps();
  }
  const ready = on && detailTex.normal && detailTex.ao;
  const s = detail.normalStrength;
  modelGroup.traverse((o) => {
    const m = o.material;
    if (!m) return;
    const hasUv = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.uv);
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (!mat.isMeshStandardMaterial) continue;
      if (mat.userData._detailTouched === undefined) {
        mat.userData._detailTouched = true;
        mat.userData._origNormalMap = mat.normalMap || null;
        mat.userData._origNormalScale = mat.normalScale ? mat.normalScale.clone() : null;
        mat.userData._origAoMap = mat.aoMap || null;
        mat.userData._origAoIntensity = mat.aoMapIntensity;
      }
      if (ready && hasUv) {
        if (!mat.userData._origNormalMap) {
          mat.normalMap = detailTex.normal;
          if (!mat.normalScale) mat.normalScale = new THREE.Vector2(s, s);
          else mat.normalScale.set(s, s);
        }
        if (!mat.userData._origAoMap) {
          mat.aoMap = detailTex.ao;
          mat.aoMapIntensity = detail.aoStrength;
        }
      } else {
        mat.normalMap = mat.userData._origNormalMap;
        if (mat.userData._origNormalScale) {
          if (!mat.normalScale) mat.normalScale = mat.userData._origNormalScale.clone();
          else mat.normalScale.copy(mat.userData._origNormalScale);
        }
        mat.aoMap = mat.userData._origAoMap;
        mat.aoMapIntensity = mat.userData._origAoIntensity;
      }
      mat.needsUpdate = true;
    }
  });
}

/* --------------------------------------------------------------- realism UI */

function setRange(el, valEl, value, digits) {
  if (el) el.value = value;
  if (valEl) valEl.textContent = Number(value).toFixed(digits);
}

function applyMaterialOverrides() {
  if (!state.matTouched) return;
  const r = Number(dom.matRoughRange.value);
  const m = Number(dom.matMetalRange.value);
  frontMat.roughness = r; solidMat.roughness = r;
  frontMat.metalness = m; solidMat.metalness = m;
  frontMat.needsUpdate = true; solidMat.needsUpdate = true;
}

function syncRealismUI() {
  const p = fx.params;
  if (dom.lookPresetSel) dom.lookPresetSel.value = look.preset || "studio";
  if (dom.envSelect) dom.envSelect.value = look.env;
  if (dom.envBgCheck) dom.envBgCheck.checked = look.showBackground;
  setRange(dom.envIntensityRange, dom.envIntensityVal, look.envIntensity, 2);
  if (dom.lightRigSelect) dom.lightRigSelect.value = look.rig;
  if (dom.fxCheck) dom.fxCheck.checked = p.enabled;
  if (dom.fxPresetSel) dom.fxPresetSel.value = look.fx || "custom";
  setRange(dom.fxExposureRange, dom.fxExposureVal, p.exposure, 2);
  setRange(dom.fxContrastRange, dom.fxContrastVal, p.contrast, 2);
  setRange(dom.fxSaturationRange, dom.fxSaturationVal, p.saturation, 2);
  setRange(dom.fxBloomRange, dom.fxBloomVal, p.bloom, 2);
  setRange(dom.fxVignetteRange, dom.fxVignetteVal, p.vignette, 2);
  setRange(dom.fxGrainRange, dom.fxGrainVal, p.grain, 3);
  setRange(dom.fxCaRange, dom.fxCaVal, p.ca, 2);
  setRange(dom.fxSharpenRange, dom.fxSharpenVal, p.sharpen, 2);
  setRange(dom.matRoughRange, dom.matRoughVal, frontMat.roughness, 2);
  setRange(dom.matMetalRange, dom.matMetalVal, frontMat.metalness, 2);
  if (dom.toneMapSelect) dom.toneMapSelect.value = look.tone;
  setRange(dom.shadowRange, dom.shadowVal, look.shadow, 2);
  if (dom.detailCheck) dom.detailCheck.checked = detail.enabled;
  setRange(dom.detailNormalRange, dom.detailNormalVal, detail.normalStrength, 2);
  setRange(dom.detailAoRange, dom.detailAoVal, detail.aoStrength, 2);
}

function setEnv(name) {
  look.env = name;
  env.apply(name, { intensity: look.envIntensity, showBackground: look.showBackground });
  renderFrame();
}

function setEnvIntensity(v) {
  look.envIntensity = v;
  env.setIntensity(v);
  renderFrame();
}

function setEnvBackground(on) {
  look.showBackground = on;
  env.setShowBackground(on);
  renderFrame();
}

function setLightRig(name) {
  look.rig = name;
  applyLightRig(name, lights);
  renderFrame();
}

function setFx(patch, presetId) {
  fx.set(patch);
  if (presetId) look.fx = presetId;
  renderFrame();
}

function wireRealism() {
  if (dom.lookPresetSel) {
    for (const [id, p] of Object.entries(LOOK_PRESETS)) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = p.label;
      dom.lookPresetSel.appendChild(o);
    }
    dom.lookPresetSel.onchange = () => {
      look.preset = dom.lookPresetSel.value;
      applyLook(look.preset);
    };
  }
  if (dom.envSelect) {
    for (const e of ENV_PRESETS) {
      const o = document.createElement("option");
      o.value = e.id;
      o.textContent = e.label;
      dom.envSelect.appendChild(o);
    }
    dom.envSelect.onchange = () => setEnv(dom.envSelect.value);
  }
  if (dom.envIntensityRange) dom.envIntensityRange.oninput = () => {
    setRange(null, dom.envIntensityVal, dom.envIntensityRange.value, 2);
    setEnvIntensity(Number(dom.envIntensityRange.value));
  };
  if (dom.envBgCheck) dom.envBgCheck.onchange = () => setEnvBackground(dom.envBgCheck.checked);
  if (dom.lightRigSelect) dom.lightRigSelect.onchange = () => setLightRig(dom.lightRigSelect.value);

  if (dom.fxCheck) dom.fxCheck.onchange = () => setFx({ enabled: dom.fxCheck.checked });
  if (dom.fxPresetSel) dom.fxPresetSel.onchange = () => {
    look.fx = dom.fxPresetSel.value;
    fx.applyPreset(look.fx);
    syncRealismUI();
    renderFrame();
  };

  const bindFx = (rangeEl, valEl, key, digits) => {
    if (!rangeEl) return;
    rangeEl.oninput = () => {
      if (valEl) valEl.textContent = Number(rangeEl.value).toFixed(digits);
      setFx({ [key]: Number(rangeEl.value) });
      if (dom.fxPresetSel) dom.fxPresetSel.value = "custom";
      look.fx = "custom";
    };
  };
  bindFx(dom.fxExposureRange, dom.fxExposureVal, "exposure", 2);
  bindFx(dom.fxContrastRange, dom.fxContrastVal, "contrast", 2);
  bindFx(dom.fxSaturationRange, dom.fxSaturationVal, "saturation", 2);
  bindFx(dom.fxBloomRange, dom.fxBloomVal, "bloom", 2);
  bindFx(dom.fxVignetteRange, dom.fxVignetteVal, "vignette", 2);
  bindFx(dom.fxGrainRange, dom.fxGrainVal, "grain", 3);
  bindFx(dom.fxCaRange, dom.fxCaVal, "ca", 2);
  bindFx(dom.fxSharpenRange, dom.fxSharpenVal, "sharpen", 2);

  if (dom.matRoughRange) dom.matRoughRange.oninput = () => {
    state.matTouched = true;
    if (dom.matRoughVal) dom.matRoughVal.textContent = Number(dom.matRoughRange.value).toFixed(2);
    applyMaterialOverrides();
    renderFrame();
  };
  if (dom.matMetalRange) dom.matMetalRange.oninput = () => {
    state.matTouched = true;
    if (dom.matMetalVal) dom.matMetalVal.textContent = Number(dom.matMetalRange.value).toFixed(2);
    applyMaterialOverrides();
    renderFrame();
  };

  if (dom.toneMapSelect) dom.toneMapSelect.onchange = () => setToneMapping(dom.toneMapSelect.value);
  if (dom.shadowRange) dom.shadowRange.oninput = () => {
    if (dom.shadowVal) dom.shadowVal.textContent = Number(dom.shadowRange.value).toFixed(2);
    setShadowStrength(Number(dom.shadowRange.value));
  };

  if (dom.detailCheck) dom.detailCheck.onchange = () => {
    detail.enabled = dom.detailCheck.checked;
    applyDetailMaps();
    renderFrame();
  };
  const bindDetail = (rangeEl, valEl, key) => {
    if (!rangeEl) return;
    rangeEl.oninput = () => {
      detail[key] = Number(rangeEl.value);
      if (valEl) valEl.textContent = Number(rangeEl.value).toFixed(2);
      applyDetailMaps();
      renderFrame();
    };
  };
  bindDetail(dom.detailNormalRange, dom.detailNormalVal, "normalStrength");
  bindDetail(dom.detailAoRange, dom.detailAoVal, "aoStrength");

  if (dom.fxResetBtn) dom.fxResetBtn.onclick = () => {
    state.matTouched = false;
    detail.enabled = true;
    detail.normalStrength = 0.8;
    detail.aoStrength = 0.5;
    fx.applyPreset("neutral");
    fx.set({ enabled: false });
    look.preset = "studio";
    applyLook("studio");
    applyView();
    syncRealismUI();
    renderFrame();
  };
}

function buildMesh(frame) {
  if (!state.depth) return;
  const solid = dom.volumeCheck.checked;
  const common = {
    depth: state.depth,
    width: state.depthW,
    height: state.depthH,
    alpha: state.alpha,
    useAlpha: dom.alphaCheck.checked,
    cutout: dom.alphaCheck.checked,
    segments: Number(dom.detailRange.value),
    relief: Number(dom.depthRange.value),
    thickness: Number(dom.baseRange.value),
    smooth: Number(dom.smoothRange.value),
    invert: dom.invertCheck.checked,
  };
  /* "Solid volume" builds a genuinely closed mesh (front + shaped back, shared rim) so
     its interior has a measurable volume — see volume-build.js. Unticked, it is the flat
     relief sheet. */
  const built = solid
    ? buildSolidGeometry({ ...common, size: 2, backMode: state.volumeBack || "mirror" })
    : buildReliefGeometry({ ...common, size: 2, volume: false });
  clearModel();
  state.mesh = new THREE.Mesh(built.geometry, [frontMat, solidMat]);
  state.mesh.castShadow = true;
  state.mesh.receiveShadow = false;
  modelGroup.add(state.mesh);
  state.triangles = built.triangles;
  state.cutout = !!built.cutout;
  state.mode = "relief";
  state.solid = solid;
  state.hasModel = true;
  setExportsEnabled(true);
  setShapeEnabled(true);
  dom.emptyState.hidden = true;
  if (frame) frameObject();
  if (studio) studio.onModelChanged();
  refreshRig();
  applyView();
  renderNow();
  scheduleVolumeMeasure();
}

function clearModel() {
  if (partner) partner.remove();
  while (modelGroup.children.length) {
    const c = modelGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
  }
}

/* --------------------------------------------------------------- volume measurement */

/* Flatten the stage model into one world-space triangle soup (skinning is ignored, so a
   posed rig is measured in its bind pose). A mesh only has a well-defined interior volume
   when it is closed; analyzeMesh reports watertightness alongside the number rather than
   hiding it. Hidden meshes are skipped: auto-armature / MetaRforge keep the original mesh
   in the graph with `.visible = false` while a weighted clone renders in its place, and
   counting both would double the volume. */
function stageTriangleSoup() {
  modelGroup.updateMatrixWorld(true);
  const positions = [];
  const indices = [];
  let base = 0;
  const v = new THREE.Vector3();
  modelGroup.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.visible === false) return;
    const pos = o.geometry.getAttribute("position");
    if (!pos) return;
    const m = o.matrixWorld;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
    }
    const idx = o.geometry.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(base + i);
    }
    base += pos.count;
  });
  return positions.length
    ? { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
    : null;
}

function measureStage() {
  const soup = stageTriangleSoup();
  state.volumeReport = soup ? analyzeMesh(soup) : null;
  dispatchEvent(new CustomEvent("textTo3d:volume", { detail: { report: state.volumeReport } }));
  return state.volumeReport;
}

let volumeMeasureTimer = 0;
function scheduleVolumeMeasure(delay = 220) {
  clearTimeout(volumeMeasureTimer);
  volumeMeasureTimer = setTimeout(() => {
    try {
      measureStage();
    } catch (e) {
      console.warn("volume measure failed", e);
    }
  }, delay);
}

/* The measured mesh in physical units. With no real-world height set the scale is 1, so
   the numbers read as "model units" (the panel labels them accordingly). */
function calibratedVolume() {
  if (!state.volumeReport) return null;
  return calibrate(state.volumeReport, {
    realHeight: state.volumeScaleHeight,
    axis: state.volumeAxis,
    density: state.volumeDensity,
  });
}

/* Make the stage mesh a genuinely closed solid by capping every open boundary loop (see
   closeMesh in volume.js). This is what gives an AI iso-surface — or any imported open
   sheet — a well-defined interior volume, and what makes it printable/writable as STL.
   The original model is replaced by one watertight mesh; vertex colours (the AI mesh's
   colour channel) are carried across by index, the material is kept. */
function closeStageMesh() {
  modelGroup.updateMatrixWorld(true);
  const meshes = [];
  modelGroup.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.getAttribute("position")) meshes.push(o);
  });
  if (!meshes.length) {
    toast("Build a model first", 2600);
    return null;
  }

  const before = measureStage();
  if (before && before.watertight && before.closed) {
    toast("This mesh is already a closed solid", 2400);
    return before;
  }

  const single = meshes.length === 1 ? meshes[0] : null;
  const colorAttr = single && single.geometry.getAttribute("color") ? single.geometry.getAttribute("color") : null;

  const positions = [];
  const indices = [];
  let base = 0;
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4().copy(modelGroup.matrixWorld).invert();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    const local = inv.clone().multiply(m.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(local);
      positions.push(v.x, v.y, v.z);
    }
    const idx = m.geometry.index;
    if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) indices.push(base + i);
    base += pos.count;
  }
  const soup = { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
  const closed = closeMesh(soup);
  if (!closed || !closed.cappedTriangles) {
    toast("Couldn't cap this mesh \\u2014 it has non-manifold seams", 3200);
    return before;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(closed.positions, 3));
  if (colorAttr) {
    const col = new Float32Array(closed.vertices * 3);
    for (let i = 0; i < colorAttr.count * 3 && i < col.length; i++) col[i] = colorAttr.array[i];
    for (const loop of closed.loops) {
      let r = 0, g = 0, b = 0;
      for (const vi of loop.verts) {
        r += colorAttr.getX(vi);
        g += colorAttr.getY(vi);
        b += colorAttr.getZ(vi);
      }
      const n = Math.max(1, loop.verts.length);
      col[loop.centroid * 3] = r / n;
      col[loop.centroid * 3 + 1] = g / n;
      col[loop.centroid * 3 + 2] = b / n;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  geo.setIndex(new THREE.BufferAttribute(closed.indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const material = single ? single.material : solidMat;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  clearModel();
  modelGroup.add(mesh);
  state.mesh = mesh;
  state.triangles = closed.indices.length / 3;
  state.hasModel = true;
  dom.depthCaption.textContent = "solid";
  dom.emptyState.hidden = true;
  setExportsEnabled(true);
  if (studio) studio.onModelChanged();
  refreshRig();
  applyView();
  renderNow();
  const after = measureStage();
  toast(
    "Capped " + closed.loops.length + " opening" + (closed.loops.length === 1 ? "" : "s") +
      " \\u2014 now a watertight solid",
    3200,
  );
  return after;
}

function frameObject() {
  modelGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 2;
  const fitH = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const dist = Math.max(fitH * 1.32, 1.1);
  controls.target.copy(center);
  const dir = new THREE.Vector3(0.5, 0.34, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(dist / 400, 0.02);
  camera.far = dist * 40;
  camera.updateProjectionMatrix();
  controls.update();
  ground.position.y = box.min.y - 0.015;
  grid.position.y = box.min.y - 0.012;
  sceneBase.setFloorY(box.min.y - 0.012);
}

function drawDepthThumb() {
  if (!state.depth) return;
  const gw = state.depthW;
  const gh = state.depthH;
  const n = normalizeDepth(state.depth, gw, gh, dom.invertCheck.checked);
  const tmp = document.createElement("canvas");
  tmp.width = gw;
  tmp.height = gh;
  const tctx = tmp.getContext("2d");
  const id = tctx.createImageData(gw, gh);
  for (let i = 0; i < n.length; i++) {
    const v = n[i];
    id.data[i * 4] = v;
    id.data[i * 4 + 1] = v;
    id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(id, 0, 0);
  dom.depthThumb.width = gw;
  dom.depthThumb.height = gh;
  const c = dom.depthThumb.getContext("2d");
  c.clearRect(0, 0, gw, gh);
  c.drawImage(tmp, 0, 0);
}

async function applyAutoMatte() {
  if (!state.prepCanvas) return;
  try {
    const w = state.depthW || state.prepCanvas.width;
    const h = state.depthH || state.prepCanvas.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d", { willReadFrequently: true }).drawImage(state.prepCanvas, 0, 0, w, h);
    const cut = await cutoutSubject(c, (t) => setStatus(t));
    state.alpha = cut.data;
    state.matteComputed = true;
    state.cutMethod = cut.method;
  } catch (e) {
    console.warn("auto cut-out failed", e);
    toast("Couldn't cut out the subject \u2014 using the full frame", 3200);
    state.alpha = state.sourceAlpha;
    state.matteComputed = false;
  }
}

function refreshAlphaUI() {
  dom.alphaCheck.disabled = !state.alpha;
  dom.alphaCheck.checked = !!state.alpha;
}

/* ------------------------------------------------------- accurate AI (TripoSR) */

function linearToSrgb(v) {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return c <= 0.0031308 ? c * 12.92 : Math.pow(c, 1 / 2.4) * 1.055 - 0.055;
}

async function prepareAiSource(img) {
  const scale = Math.min(1, 768 / Math.max(img.width, img.height));
  const w = Math.max(4, Math.round(img.width * scale));
  const h = Math.max(4, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  let hasAlpha = false;
  for (let i = 3; i < id.data.length; i += 4) {
    if (id.data[i] < 250) { hasAlpha = true; break; }
  }
  if (!hasAlpha && dom.matteCheck.checked) {
    setStatus("Cutting out the subject\u2026");
    const cut = await cutoutSubject(c, (t) => setStatus(t));
    state.cutMethod = cut.method;
    const mc = document.createElement("canvas");
    mc.width = w;
    mc.height = h;
    const mctx = mc.getContext("2d");
    const mid = mctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(Math.max(0, Math.min(1, cut.data[i])) * 255);
      mid.data[i * 4] = 255;
      mid.data[i * 4 + 1] = 255;
      mid.data[i * 4 + 2] = 255;
      mid.data[i * 4 + 3] = v;
    }
    mctx.putImageData(mid, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mc, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
  return c;
}

function drawAiThumb(res, center, scale) {
  const size = 160;
  dom.depthThumb.width = size;
  dom.depthThumb.height = size;
  const ctx = dom.depthThumb.getContext("2d");
  ctx.fillStyle = "#0c0f16";
  ctx.fillRect(0, 0, size, size);
  if (!res) return;
  const { positions, colors } = res;
  const n = positions.length / 3;
  const r = 0.44;
  const step = n > 90000 ? 2 : 1;
  const px = ctx.createImageData(size, size);
  const put = (x, y, cr, cg, cb) => {
    const xi = (x * size) | 0;
    const yi = (y * size) | 0;
    if (xi < 0 || yi < 0 || xi >= size || yi >= size) return;
    const o = (yi * size + xi) * 4;
    px.data[o] = cr;
    px.data[o + 1] = cg;
    px.data[o + 2] = cb;
    px.data[o + 3] = 255;
  };
  for (let i = 0; i < n; i += step) {
    const x = (positions[i * 3] - center.x) * scale;
    const y = (positions[i * 3 + 1] - center.y) * scale;
    const cr = colors ? linearToSrgb(colors[i * 3]) * 255 : 220;
    const cg = colors ? linearToSrgb(colors[i * 3 + 1]) * 255 : 200;
    const cb = colors ? linearToSrgb(colors[i * 3 + 2]) * 255 : 175;
    put(0.5 + x * r, 0.5 - y * r, cr, cg, cb);
  }
  ctx.putImageData(px, 0, 0);
}

function buildAiMesh(result, frame) {
  clearModel();
  state.mesh = null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
  if (result.colors) geo.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(result.faces, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2 / maxDim;
  geo.translate(-center.x, -center.y, -center.z);
  geo.scale(scale, scale, scale);
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  state.mesh = new THREE.Mesh(geo, frontMat);
  state.mesh.castShadow = true;
  state.mesh.receiveShadow = false;
  modelGroup.add(state.mesh);
  state.mode = "ai";
  state.triangles = result.triangles;
  state.cutout = false;
  state.solid = false;
  state.aiMetrics = result.metrics || null;
  state.hasModel = true;
  setExportsEnabled(true);
  setShapeEnabled(false);
  dom.emptyState.hidden = true;
  dom.depthCaption.textContent = "mesh";
  drawAiThumb(result, center, scale);
  if (frame) frameObject();
  if (studio) studio.onModelChanged();
  refreshRig();
  applyView();
  renderNow();
  scheduleVolumeMeasure();
}

async function buildAiFromImage(src, meta, opts = {}) {
  setQualityUI("ai");
  const img = await loadImage(src);
  setStatus("Preparing AI input\u2026", true, 0.02);
  state.textureCanvas = await prepareAiSource(img);
  state.prepCanvas = state.textureCanvas;
  state.sourceAlpha = null;
  state.alpha = null;
  state.matteComputed = false;
  state.depth = null;
  state.depthW = 0;
  state.depthH = 0;
  refreshAlphaUI();
  updateTexture();
  dom.srcThumb.src = src;
  const result = await reconstructFromCanvas(state.textureCanvas, {
    onProgress: (t, f) => setStatus(t, true, f),
    resolution: opts.resolution || state.aiResolution,
    threshold: state.aiThreshold,
    smooth: state.aiSmooth * AI_SMOOTH_WORLD,
    multiView: !!opts.multiView,
  });
  if (!result || !result.faces || !result.faces.length) throw new Error("Reconstruction produced an empty mesh");
  state.ai = result;
  setStatus("Building mesh\u2026", true, 0.99);
  buildAiMesh(result, true);
  pushHistory({ src, label: state.label, method: "ai", ai: result, textureCanvas: state.textureCanvas, aiResolution: state.aiResolution, aiSmooth: state.aiSmooth });
}

async function rebuildAi(threshold, resolution, smooth) {
  if (!state.ai) throw new Error("Generate an AI model first");
  const t = threshold == null ? state.aiThreshold : threshold;
  const r = resolution == null ? state.aiResolution : resolution;
  const s = smooth == null ? state.aiSmooth * AI_SMOOTH_WORLD : smooth;
  const res = await rebuildMesh({ threshold: t, resolution: r, smooth: s });
  state.ai = res;
  state.aiThreshold = t;
  state.aiResolution = r;
  buildAiMesh(res, true);
  return { vertices: res.vertices, triangles: res.triangles, threshold: t, resolution: r, smooth: s };
}

async function buildFromImageSrc(src, meta, method) {
  const use = method || state.quality;
  state.imageSrc = src;
  state.label = (meta && meta.label) || "model";
  if (use === "ai") {
    await buildAiFromImage(src, meta);
    return;
  }
  const img = await loadImage(src);
  setStatus("Preparing image\u2026");
  const prep = prepareInputs(img, 768);
  const est = await estimateDepth(prep.canvas, (t) => { if (!state.busy || true) setStatus(t); });
  state.depth = est.data;
  state.depthW = est.width;
  state.depthH = est.height;
  state.textureCanvas = prep.canvas;
  state.prepCanvas = prep.canvas;
  state.sourceAlpha = prep.alpha;
  state.matteComputed = false;
  state.alpha = prep.alpha;
  state.ai = null;
  if (!prep.alpha && dom.matteCheck.checked) await applyAutoMatte();
  refreshAlphaUI();
  updateTexture();
  dom.srcThumb.src = src;
  dom.depthCaption.textContent = "depth";
  drawDepthThumb();
  setStatus("Building mesh\u2026");
  buildMesh(true);
  pushHistory({
    src,
    label: state.label,
    method: "fast",
    depth: state.depth,
    depthW: state.depthW,
    depthH: state.depthH,
    alpha: state.alpha,
    sourceAlpha: state.sourceAlpha,
    matteComputed: state.matteComputed,
    textureCanvas: state.textureCanvas,
  });
}

function showExternalObject(object, label) {
  clearModel();
  state.mesh = null;
  state.ai = null;
  dom.depthCaption.textContent = "depth";
  modelGroup.add(object);
  state.mode = "external";
  state.solid = false;
  state.aiMetrics = null;
  state.hasModel = true;
  state.label = label || "model";
  let tris = 0;
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes && g.attributes.position ? g.attributes.position.count : 0) / 3;
  });
  state.triangles = Math.round(tris);
  setExportsEnabled(true);
  setShapeEnabled(false);
  dom.emptyState.hidden = true;
  frameObject();
  if (studio) studio.onModelChanged();
  refreshRig();
  applyView();
  renderNow();
  scheduleVolumeMeasure();
}

function renderHistory() {
  dom.history.innerHTML = "";
  if (!state.history.length) {
    dom.history.innerHTML = '<div class="empty small">Nothing yet</div>';
    return;
  }
  state.history.forEach((h, i) => {
    const img = document.createElement("img");
    img.src = h.src;
    img.alt = h.label || "model";
    img.title = h.label || "model";
    if (i === state.historyIndex) img.classList.add("active");
    img.onclick = () => restoreHistory(i);
    dom.history.appendChild(img);
  });
}

function pushHistory(entry) {
  state.history.unshift(entry);
  if (state.history.length > 12) state.history.pop();
  state.historyIndex = 0;
  renderHistory();
}

function restoreHistory(i) {
  const h = state.history[i];
  if (!h) return;
  state.historyIndex = i;
  state.imageSrc = h.src;
  state.label = h.label;
  if (h.method === "ai") {
    setQualityUI("ai");
    if (h.aiResolution != null) state.aiResolution = h.aiResolution;
    if (h.aiSmooth != null) state.aiSmooth = h.aiSmooth;
    dom.aiDetailRange.value = String(state.aiResolution);
    dom.aiSmoothRange.value = String(state.aiSmooth);
    syncAiLabels();
    state.ai = h.ai;
    state.depth = null;
    state.depthW = 0;
    state.depthH = 0;
    state.alpha = null;
    state.sourceAlpha = null;
    state.matteComputed = false;
    state.prepCanvas = h.textureCanvas;
    state.textureCanvas = h.textureCanvas;
    updateTexture();
    refreshAlphaUI();
    dom.srcThumb.src = h.src;
    buildAiMesh(h.ai, true);
    renderHistory();
    return;
  }
  setQualityUI("fast");
  state.ai = null;
  state.depth = h.depth;
  state.depthW = h.depthW;
  state.depthH = h.depthH;
  state.alpha = h.alpha;
  state.sourceAlpha = h.sourceAlpha !== undefined ? h.sourceAlpha : h.alpha;
  state.matteComputed = !!h.matteComputed;
  state.prepCanvas = h.textureCanvas;
  state.textureCanvas = h.textureCanvas;
  updateTexture();
  refreshAlphaUI();
  dom.srcThumb.src = h.src;
  dom.depthCaption.textContent = "depth";
  drawDepthThumb();
  buildMesh(true);
  renderHistory();
}

async function requestImage() {
  const userPrompt = dom.prompt.value.trim();
  const style = activeStyle || { keywords: "", negative: "" };
  const refParts = [];
  if (state.ref) {
    setStatus("Reading reference image\u2026");
    const d = await describeReference(state.ref.blob, "image");
    if (d) refParts.push(d);
    else toast("Couldn't read the reference \u2014 using your prompt alone", 3200);
  }
  if (state.ref3d) {
    setStatus("Reading 3D reference\u2026");
    const d = await describeReference(state.ref3d.blob, "3d");
    if (d) refParts.push(d);
  }
  if (state.refVideo && state.refVideo.dataUrl) {
    setStatus("Reading video reference\u2026");
    const d = await describeReference(dataURLtoBlob(state.refVideo.dataUrl), "video");
    if (d) refParts.push(d);
  }
  const full = [userPrompt, ...refParts, style.keywords].filter(Boolean).join(", ");
  const negative = [style.negative, "blurry, low quality, jpeg artifacts, text, watermark, signature, collage, multiple panels, frame"]
    .filter(Boolean)
    .join(", ");
  setStatus("Generating image\u2026");
  const res = await window.root.generateImage({
    prompt: nolimit.append("image", full),
    negativePrompt: negative,
    resolution: dom.resSelect.value,
    removeBackground: dom.removeBgCheck.checked,
  });
  const dataUrl = res && res.dataUrl;
  if (!dataUrl) throw new Error("Image generation failed");
  showGeneratedImage(dataUrl, { label: userPrompt, prompt: full });
  return dataUrl;
}

async function generate() {
  const userPrompt = dom.prompt.value.trim();
  if (!userPrompt && !state.ref && !state.ref3d && !state.refVideo) {
    toast("Type a prompt first", 2400);
    return;
  }
  if (!window.root.generateImage) {
    toast("Image generator unavailable", 3200);
    return;
  }
  let produced = false;
  const ok = await run(async () => {
    const dataUrl = await requestImage();
    await buildFromImageSrc(dataUrl, { label: userPrompt });
    produced = true;
  });
  if (ok && produced) toast("Model ready \u2014 drag to spin it", 2600);
}

/* Text\u2192image only: make the AI image from the prompt (+ style & reference) and show it, without
   sculpting a mesh. The user can then Save it, reuse it as a reference, or Build 3D from it. */
async function generateImageOnly() {
  const userPrompt = dom.prompt.value.trim();
  if (!userPrompt && !state.ref && !state.ref3d && !state.refVideo) {
    toast("Type a prompt first", 2400);
    return;
  }
  if (!window.root.generateImage) {
    toast("Image generator unavailable", 3200);
    return;
  }
  const ok = await run(async () => {
    await requestImage();
  });
  if (ok) toast("Image ready \u2014 Save it, or hit Build 3D", 2600);
}

/* ---- generated-image viewer (card + session gallery + lightbox) ---- */

function showGeneratedImage(dataUrl, meta) {
  const i = state.genImages.findIndex((g) => g.dataUrl === dataUrl);
  if (i >= 0) {
    state.genIndex = i;
  } else {
    state.genImages.unshift({
      dataUrl,
      label: (meta && meta.label) || "",
      prompt: (meta && meta.prompt) || "",
    });
    if (state.genImages.length > 12) state.genImages.pop();
    state.genIndex = 0;
  }
  state.generatedImage = dataUrl;
  renderGeneratedImage();
}

function renderGeneratedImage() {
  const cur = state.genImages[state.genIndex] || null;
  dom.imageCard.hidden = !cur;
  dom.imgGallery.innerHTML = "";
  if (!cur) return;
  dom.aiImageEl.src = cur.dataUrl;
  dom.imgGallery.hidden = state.genImages.length < 2;
  dom.imgCount.hidden = state.genImages.length < 2;
  dom.imgCount.textContent = String(state.genImages.length);
  if (state.genImages.length < 2) return;
  state.genImages.forEach((g, i) => {
    const im = document.createElement("img");
    im.src = g.dataUrl;
    im.alt = g.label || "image";
    im.title = g.label || "image";
    if (i === state.genIndex) im.classList.add("active");
    im.onclick = () => {
      state.genIndex = i;
      state.generatedImage = g.dataUrl;
      renderGeneratedImage();
    };
    dom.imgGallery.appendChild(im);
  });
}

function openLightbox(src) {
  if (!src) return;
  dom.lightboxImg.src = src;
  dom.imgLightbox.hidden = false;
}

function closeLightbox() {
  dom.imgLightbox.hidden = true;
  dom.lightboxImg.removeAttribute("src");
}

function generatedImageBlob() {
  const cur = state.genImages[state.genIndex];
  if (!cur) return null;
  const blob = dataURLtoBlob(cur.dataUrl);
  const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
  return { blob, ext, label: cur.label };
}

function imageFileName(label, ext) {
  return `${slug(label || "image")}.${ext}`;
}

async function handleFiles(files, opts = {}) {
  if (!files || !files.length) return;
  const file = files.find((f) => fileKind(f) !== "unknown") || files[0];
  const kind = fileKind(file);

  if (kind === "text") {
    try {
      dom.prompt.value = (await file.text()).slice(0, 1500).trim();
      toast("Prompt loaded from file", 2400);
    } catch (e) {
      toast("Could not read that file", 2600);
    }
    return;
  }

  if (kind === "image") {
    const src = await imageFileToDataURL(file);
    const ok = await run(async () => {
      await buildFromImageSrc(src, { label: file.name.replace(/\.[^.]+$/, "") });
    });
    if (ok) {
      toast("Model ready \u2014 drag to spin it", 2600);
      if (!opts.skipLibrary) library.addFile(file);
    }
    return;
  }

  if (kind === "model") {
    const ok = await run(async () => {
      setStatus("Loading model\u2026");
      const obj = await loadModelFile(file);
      normalizeObject(obj, 2);
      showExternalObject(obj, file.name.replace(/\.[^.]+$/, ""));
    });
    if (ok) {
      toast("Mesh loaded \u2014 export it any time", 2600);
      if (!opts.skipLibrary) library.addFile(file);
    }
    return;
  }

  toast("Unsupported file type", 2600);
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

/* Image File -> data URL, decoding TGA ourselves because no browser will. */
async function imageFileToDataURL(file) {
  if (!isTgaFile(file)) return readAsDataURL(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return canvasToDataURL(tgaToCanvas(bytes));
}

function canvasToDataURL(canvas) {
  if (typeof canvas.toDataURL === "function") return Promise.resolve(canvas.toDataURL("image/png"));
  return canvas.convertToBlob({ type: "image/png" }).then(
    (blob) =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      })
  );
}

function dataURLtoBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/png";
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function exportName(ext) {
  return `${slug(state.label)}-3d.${ext}`;
}

function glbIncludeBase() {
  return !!(dom.exportBaseCheck && dom.exportBaseCheck.checked);
}

async function exportGlbBlob() {
  if (!glbIncludeBase()) return toGLB(modelGroup);
  const groupVis = sceneBase.group.visible;
  const states = sceneBase.entries.map((e) => [e.obj, e.obj.visible]);
  sceneBase.group.visible = true;
  for (const [o] of states) o.visible = true;
  try {
    return await toGLB([modelGroup, sceneBase.group]);
  } finally {
    sceneBase.group.visible = groupVis;
    for (const [o, v] of states) o.visible = v;
  }
}

async function doExport(kind) {
  if (!state.hasModel) return;
  const ok = await run(async () => {
    setStatus(`Exporting ${kind.toUpperCase()}\u2026`);
    if (kind === "glb") {
      download(await exportGlbBlob(), exportName("glb"));
    } else if (kind === "ply") {
      download(toPLY(modelGroup), exportName("ply"));
    } else if (kind === "stl") {
      download(toSTL(modelGroup), exportName("stl"));
    } else if (kind === "obj") {
      download(toOBJ(modelGroup), exportName("obj"));
    } else if (kind === "png") {
      renderFrame();
      download(dataURLtoBlob(renderer.domElement.toDataURL("image/png")), exportName("png"));
    } else if (kind === "tga") {
      renderFrame();
      const src = renderer.domElement;
      const tmp = document.createElement("canvas");
      tmp.width = src.width;
      tmp.height = src.height;
      const ctx = tmp.getContext("2d");
      ctx.drawImage(src, 0, 0);
      const img = ctx.getImageData(0, 0, tmp.width, tmp.height);
      const bytes = encodeTGA({ width: tmp.width, height: tmp.height, data: img.data }, { rle: true });
      download(new Blob([bytes], { type: "image/x-tga" }), exportName("tga"));
    }
  });
  if (ok) toast(`${kind.toUpperCase()} saved`, 2200);
}

function syncLabels() {
  dom.detailVal.textContent = dom.detailRange.value;
  dom.depthVal.textContent = Number(dom.depthRange.value).toFixed(2);
  dom.smoothVal.textContent = Number(dom.smoothRange.value).toFixed(2);
  dom.baseVal.textContent = Number(dom.baseRange.value).toFixed(2);
}

let rebuildTimer = 0;
function scheduleRebuild() {
  syncLabels();
  drawDepthThumb();
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    if (state.mode === "relief") buildMesh(false);
  }, 60);
}

/* ------------------------------------------------------------------- volume */

/* Real 3D volume estimation. `measureStage()` runs on the live stage model (see above);
   these are the controls the Volume panel drives, plus the library entry point that turns
   a saved image straight into a measured solid volume. User's scale/material/back-surface
   choices persist in the kv store. */
function volumePrefsFolder() {
  const r = window.root;
  return r && r.kv ? r.kv.volume : null;
}

async function loadVolumePrefs() {
  const f = volumePrefsFolder();
  if (!f) return;
  try {
    const s = await f.get("prefs");
    if (!s) return;
    if (s.backMode) state.volumeBack = s.backMode;
    if (s.axis) state.volumeAxis = s.axis;
    if (Number.isFinite(s.density)) state.volumeDensity = s.density;
    if (s.scaleHeight) state.volumeScaleHeight = s.scaleHeight;
  } catch (e) {
    /* ignore */
  }
}

function saveVolumePrefs() {
  const f = volumePrefsFolder();
  if (!f) return;
  f.set("prefs", {
    backMode: state.volumeBack,
    axis: state.volumeAxis,
    density: state.volumeDensity,
    scaleHeight: state.volumeScaleHeight || null,
  }).catch(() => {});
}

function setVolumeSolid(on) {
  dom.volumeCheck.checked = !!on;
  if (!state.depth) {
    toast("Build a model from an image first", 2600);
    return;
  }
  buildMesh(true);
}

function setVolumeBackMode(mode) {
  state.volumeBack = mode || "mirror";
  saveVolumePrefs();
  if (state.depth && dom.volumeCheck.checked) scheduleRebuild();
}

function setVolumeThickness(v) {
  if (!Number.isFinite(v)) return;
  dom.baseRange.value = String(v);
  scheduleRebuild();
}

function setVolumeScale({ height, axis, density } = {}) {
  state.volumeScaleHeight = Number.isFinite(height) && height > 0 ? height : null;
  if (axis) state.volumeAxis = axis;
  if (Number.isFinite(density)) state.volumeDensity = density;
  saveVolumePrefs();
  measureStage();
}

/* Re-run the reconstruction on the current source image with the current quality setting
   (the Volume panel's "Rebuild from image"). */
async function rebuildFromImage() {
  const src = state.generatedImage || state.imageSrc;
  if (!src) throw new Error("Generate or pick an image first");
  await buildFromImageSrc(src, { label: state.label || "image" });
}

/* The neural volume path: run TripoSR on the current image and read the volume off both
   the density field and the extracted mesh. `multiView` fuses the image with its mirror
   (test-time augmentation) for a fuller solid. */
async function buildAiVolume({ multiView = false, resolution } = {}) {
  const src = state.generatedImage || state.imageSrc;
  if (!src) throw new Error("Generate or pick an image first");
  if (!img3dSupported()) throw new Error("This browser has no WebGPU \\u2014 use the fast depth solid instead");
  setQualityUI("ai");
  const img = await loadImage(src);
  setStatus("Preparing AI input\\u2026", true, 0.02);
  state.textureCanvas = await prepareAiSource(img);
  state.prepCanvas = state.textureCanvas;
  state.sourceAlpha = null;
  state.alpha = null;
  state.matteComputed = false;
  state.depth = null;
  state.depthW = 0;
  state.depthH = 0;
  refreshAlphaUI();
  updateTexture();
  dom.srcThumb.src = src;
  const result = await reconstructFromCanvas(state.textureCanvas, {
    onProgress: (t, f) => setStatus(t, true, f),
    resolution: resolution || state.aiResolution,
    threshold: state.aiThreshold,
    smooth: state.aiSmooth * AI_SMOOTH_WORLD,
    multiView,
  });
  if (!result || !result.faces || !result.faces.length) throw new Error("Reconstruction produced an empty mesh");
  state.ai = result;
  state.aiMetrics = result.metrics || null;
  state.imageSrc = src;
  if (!state.label || state.label === "model") state.label = dom.prompt.value.trim() || "image";
  setStatus("Building mesh\\u2026", true, 0.99);
  buildAiMesh(result, true);
  setStatus(null);
  pushHistory({
    src,
    label: state.label,
    method: "ai",
    ai: result,
    textureCanvas: state.textureCanvas,
    aiResolution: state.aiResolution,
    aiSmooth: state.aiSmooth,
  });
  toast(multiView ? "AI volume built (multi-view fusion)" : "AI volume built", 2600);
  return { metrics: state.aiMetrics, report: state.volumeReport };
}

function buildVolumeReportText() {
  const r = state.volumeReport;
  if (!r) return null;
  const cal = calibratedVolume();
  const real = !!cal && cal.height > 0;
  const lines = [];
  lines.push("3D Model Maker \\u2014 volume report");
  lines.push("Generated: " + new Date().toISOString());
  lines.push("Generator: https://perchance.org/" + (window.generatorName || ""));
  lines.push("Model: " + state.label + " \\u00b7 mode " + state.mode + (state.solid ? " (closed solid)" : ""));
  lines.push("");
  lines.push("Dimensions (model units): " + r.dims.map((d) => d.toFixed(4)).join(" \\u00d7 "));
  lines.push("Volume (model units\\u00b3): " + r.volume.toFixed(6));
  lines.push("Surface area (model units\\u00b2): " + r.surfaceArea.toFixed(6));
  lines.push("Vertices: " + r.vertices + " \\u00b7 triangles: " + r.triangles + " \\u00b7 shells: " + r.shells);
  lines.push(
    "Watertight: " + (r.watertight ? "yes" : "no") +
      " (boundary edges " + r.boundaryEdges + ", non-manifold " + r.nonManifoldEdges + ")",
  );
  lines.push("Euler characteristic: " + r.euler);
  lines.push("Fill ratio (volume / bounding box): " + (r.fillRatio * 100).toFixed(2) + "%");
  if (r.principalExtents) lines.push("Principal extents: " + r.principalExtents.map((d) => d.toFixed(4)).join(" \\u00d7 "));
  if (r.centroid) lines.push("Centroid: " + r.centroid.map((d) => d.toFixed(4)).join(", "));
  if (real) {
    lines.push("");
    lines.push("Real-world scale: 1 model unit = " + cal.scale.toFixed(6) + " m, measured along " + cal.axis.toUpperCase());
    lines.push("Dimensions: " + cal.dims.map((d) => formatLength(d)).join(" \\u00d7 "));
    lines.push("Volume: " + formatVolume(cal.volume));
    lines.push("Surface area: " + formatArea(cal.surfaceArea));
    lines.push("Material density: " + state.volumeDensity + " kg/m\\u00b3");
    lines.push("Mass: " + formatMass(cal.mass));
  }
  if (state.aiMetrics && state.aiMetrics.density) {
    const d = state.aiMetrics.density;
    lines.push("");
    lines.push("AI density-field volume (model units\\u00b3): " + d.volume.toFixed(6));
    lines.push("AI occupied voxels: " + d.occupied + " / " + d.samples + " at resolution " + d.resolution);
  }
  return lines.join("\\n");
}

function saveVolumeReport() {
  const text = buildVolumeReportText();
  if (!text) {
    toast("Nothing measured yet", 2200);
    return;
  }
  download(new Blob([text], { type: "text/plain" }), slug(state.label || "model") + "-volume.txt");
  toast("Measurement report downloaded", 2200);
}

/* Library entry point: turn a saved image into a measured solid volume and open the panel.
   `opts.method` is "fast" (the depth model gives a fast, deterministic watertight solid that
   works everywhere) or "ai" (the TripoSR network reconstructs a real 3D mesh, which is then
   capped to a solid if its iso-surface came out open). */
async function buildVolumeFromLibrary(src, name, opts = {}) {
  const method = opts.method === "ai" ? "ai" : "fast";
  try {
    if (library && library.isOpen) library.close();
    state.label = name || "library image";
    state.imageSrc = src;

    if (method === "ai") {
      if (!img3dSupported()) throw new Error("This browser has no WebGPU, use the fast solid instead");
      await buildAiFromImage(src, { label: state.label }, { multiView: opts.multiView !== false });
      setStatus("Closing the surface into a solid", true, null);
      try {
        closeStageMesh();
      } catch (e) {
        console.warn("auto-close failed", e);
      }
      setStatus(null);
      if (volumePanel) volumePanel.open();
      toast('Built a real AI 3D volume from "' + state.label + '"', 3000);
      return { report: state.volumeReport, metrics: state.aiMetrics };
    }

    const img = await loadImage(src);
    setStatus("Preparing image\\u2026", true, 0.05);
    const prep = prepareInputs(img, 768);
    const est = await estimateDepth(prep.canvas, (t) => setStatus(t, true, null));
    state.depth = est.data;
    state.depthW = est.width;
    state.depthH = est.height;
    state.textureCanvas = prep.canvas;
    state.prepCanvas = prep.canvas;
    state.sourceAlpha = prep.alpha;
    state.alpha = prep.alpha;
    state.matteComputed = false;
    state.ai = null;
    if (!prep.alpha && dom.matteCheck.checked) await applyAutoMatte();
    refreshAlphaUI();
    updateTexture();
    dom.srcThumb.src = src;
    dom.depthCaption.textContent = "depth";
    drawDepthThumb();
    dom.volumeCheck.checked = true;
    setStatus("Building solid volume\\u2026", true, null);
    buildMesh(true);
    setStatus(null);
    if (volumePanel) volumePanel.open();
    toast('Built a solid volume from "' + (name || "image") + '"', 2800);
  } catch (e) {
    console.warn("library volume build failed", e);
    setStatus(null);
    toast((e && e.message) || "Couldn't build a volume from that image", 3200);
  }
}

/* ---- AI (TripoSR) mesh controls: grid resolution + surface smoothing ---- */

function syncAiLabels() {
  dom.aiDetailVal.textContent = dom.aiDetailRange.value;
  dom.aiSmoothVal.textContent = Number(dom.aiSmoothRange.value).toFixed(2);
}

let aiRebuildTimer = 0;
let aiRebuilding = false;
let aiRebuildQueued = false;

function scheduleAiRebuild() {
  syncAiLabels();
  clearTimeout(aiRebuildTimer);
  aiRebuildTimer = setTimeout(runAiRebuild, 200);
}

/* Serialised "latest wins" rebuild: dragging a slider while a rebuild is running queues
   exactly one more pass with the final values, so the last frame always wins. */
async function runAiRebuild() {
  if (state.mode !== "ai" || !state.ai) return;
  if (aiRebuilding) { aiRebuildQueued = true; return; }
  aiRebuilding = true;
  state.aiSmooth = Number(dom.aiSmoothRange.value);
  const res = Number(dom.aiDetailRange.value);
  try {
    setStatus("Rebuilding the mesh (AI)\u2026", true, 0);
    const out = await rebuildMesh({
      threshold: state.aiThreshold,
      resolution: res,
      smooth: state.aiSmooth * AI_SMOOTH_WORLD,
      onProgress: (t, f) => setStatus(t, true, f),
    });
    state.ai = out;
    state.aiResolution = res;
    buildAiMesh(out, false);
    setStatus(null);
  } catch (e) {
    console.error(e);
    toast(prettyError(e), 4200);
  } finally {
    aiRebuilding = false;
    if (aiRebuildQueued) { aiRebuildQueued = false; runAiRebuild(); }
  }
}

/* --------------------------------------------------------- reference image */

function syncRefUI() {
  const has = !!state.ref;
  dom.refRow.classList.toggle("has", has);
  dom.refThumb.hidden = !has;
  dom.refEmpty.hidden = has;
  dom.refClearBtn.hidden = !has;
  if (has) {
    dom.refThumb.src = state.ref.dataUrl;
    dom.refSub.textContent = state.ref.name
      ? `Guiding the image with "${state.ref.name}" \u2014 click to replace`
      : "Reference attached \u2014 click to replace";
  } else {
    dom.refThumb.removeAttribute("src");
    dom.refSub.textContent = "Drop or click \u2014 the AI image follows its subject & style";
  }
}

async function setReferenceFromFile(file) {
  if (!file || fileKind(file) !== "image") {
    toast("That isn't an image", 2400);
    return;
  }
  const dataUrl = await imageFileToDataURL(file);
  // The vision/reference path needs a format the model service accepts, so a TGA is
  // handed on as the PNG we decoded it to (the preview uses the same data URL).
  const blob = isTgaFile(file) ? dataURLtoBlob(dataUrl) : file;
  state.ref = {
    dataUrl,
    blob,
    name: (file.name || "").replace(/\.[^.]+$/, "").slice(0, 40),
  };
  syncRefUI();
  toast("Reference image attached", 2200);
}

function clearReference() {
  state.ref = null;
  syncRefUI();
}

const REF_LEADS = {
  image: "You are given a reference image for an AI image generator.",
  "3d": "You are given a render of a 3D reference model for an AI image generator. Focus on the model's subject, silhouette and shape, proportions, and any pose.",
  video: "You are given a single frame from a reference video for an AI image generator. Focus on the subject, action/pose, and framing shown in this frame.",
};

async function describeReference(blob, kind = "image") {
  if (!blob || !window.root.generateText) return "";
  const lead = REF_LEADS[kind] || REF_LEADS.image;
  const ask = `${lead} Describe it as a single comma-separated list of image-generation keywords, covering: the main subject and its pose/expression, key materials and colours, art style and medium, lighting, and background/framing. Reply with ONLY the keyword list on one line (no sentences, no preamble, no quotes, no bullet points), under 45 words.`;
  const rule = nolimit.block("vision");
  const instruction = rule ? [`${rule}\n\n${ask}`, blob] : [ask, blob];
  try {
    const out = await window.root.generateText({ instruction });
    return String(out || "")
      .trim()
      .split("\n")[0]
      .replace(/\s+/g, " ")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .slice(0, 400);
  } catch (e) {
    console.warn("reference description failed", e);
    return "";
  }
}

/* --------------------------------------------------------- 3D reference */

let ref3dThumbRenderer = null;

function syncRef3dUI() {
  const has = !!state.ref3d;
  dom.ref3dRow.classList.toggle("has", has);
  dom.ref3dRow.classList.remove("loading");
  dom.ref3dThumb.hidden = !has;
  dom.ref3dEmpty.hidden = has;
  dom.ref3dClearBtn.hidden = !has;
  if (has) {
    if (state.ref3d.dataUrl) dom.ref3dThumb.src = state.ref3d.dataUrl;
    dom.ref3dSub.textContent = `Guiding the image with "${state.ref3d.name}" \u2014 click to replace`;
  } else {
    dom.ref3dThumb.removeAttribute("src");
    dom.ref3dSub.textContent = "Drop or click \u2014 the AI image follows this model's shape";
  }
}

async function setRef3dFromFile(file) {
  const name = (file && file.name) || "";
  if (!file || fileKind(file) !== "model") {
    toast("That isn't a 3D model file", 2400);
    return;
  }
  dom.ref3dRow.classList.add("loading");
  try {
    const object = await loadModelFile(file);
    normalizeObject(object, 2);
    if (!ref3dThumbRenderer) ref3dThumbRenderer = createThumbRenderer(240, 170);
    const canvas = document.createElement("canvas");
    const dataUrl = ref3dThumbRenderer.render(object, canvas);
    disposeTree(object);
    if (!dataUrl) throw new Error("render failed");
    state.ref3d = {
      dataUrl,
      blob: dataURLtoBlob(dataUrl),
      name: name.replace(/\.[^.]+$/, "").slice(0, 40),
      bytes: file.size || 0,
    };
  } catch (e) {
    console.warn("3D reference failed", e);
    dom.ref3dRow.classList.remove("loading");
    toast("Couldn't read that 3D file", 3000);
    return;
  }
  syncRef3dUI();
  toast("3D reference attached", 2200);
}

function clearRef3d() {
  state.ref3d = null;
  syncRef3dUI();
}

/* --------------------------------------------------------- video reference */

let refVideoEl = null;
let refVideoSession = null;
let refVideoSeekTimer = null;

function syncRefVideoUI() {
  const has = !!state.refVideo;
  dom.refVideoRow.classList.toggle("has", has);
  dom.refVideoRow.classList.remove("loading");
  dom.refVideoThumb.hidden = !has;
  dom.refVideoEmpty.hidden = has;
  dom.refVideoClearBtn.hidden = !has;
  dom.refVideoFrameRow.hidden = !has || !(state.refVideo && state.refVideo.duration > 0.2);
  if (has) {
    if (state.refVideo.dataUrl) dom.refVideoThumb.src = state.refVideo.dataUrl;
    dom.refVideoSub.textContent = `Guiding the image with a frame from "${state.refVideo.name}" \u2014 drag to pick one`;
    dom.refVideoTime.textContent = `${(state.refVideo.time || 0).toFixed(1)}s`;
  } else {
    dom.refVideoThumb.removeAttribute("src");
    dom.refVideoSub.textContent = "Drop or click \u2014 the AI image follows a frame from it";
    dom.refVideoTime.textContent = "0.0s";
  }
}

function loadVideoEl(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.preload = "auto";
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      v.removeEventListener("loadeddata", onReady);
      v.removeEventListener("canplay", onReady);
      v.removeEventListener("loadedmetadata", onReady);
      v.removeEventListener("error", onError);
      clearTimeout(timer);
      if (ok) resolve(v);
      else reject(new Error("video load failed"));
    };
    const onReady = () => done(true);
    const onError = () => done(false);
    v.addEventListener("loadeddata", onReady);
    v.addEventListener("canplay", onReady);
    v.addEventListener("loadedmetadata", onReady);
    v.addEventListener("error", onError);
    // A background/hidden tab throttles media loading and may never fire these events,
    // so never wait forever — fall back to whatever state we reached.
    const timer = setTimeout(() => done(v.readyState >= 1), timeoutMs);
    v.src = url;
    try {
      v.load();
    } catch {}
  });
}

function seekVideoEl(v, time) {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    try {
      v.currentTime = Math.max(0, time);
    } catch {
      resolve();
    }
    setTimeout(done, 1200);
  });
}

function drawVideoFrame(v) {
  const w = v.videoWidth;
  const h = v.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 640 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * scale));
  c.height = Math.max(2, Math.round(h * scale));
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

async function refreshRefVideoFrame(time) {
  if (!state.refVideo || (!refVideoSession && !refVideoEl)) return null;
  const dur = state.refVideo.duration || 0;
  const t = Math.min(Math.max(time, 0), Math.max(dur - 0.05, 0));
  let frame = null;
  if (refVideoSession) {
    frame = frameToDataUrl(await refVideoSession.frameAt(t));
  } else {
    await seekVideoEl(refVideoEl, t);
    frame = drawVideoFrame(refVideoEl);
  }
  if (frame) state.refVideo.dataUrl = frame;
  state.refVideo.time = t;
  syncRefVideoUI();
  return state.refVideo.dataUrl;
}

function scheduleRefVideoSeek() {
  if (!state.refVideo || !refVideoEl) return;
  const dur = state.refVideo.duration || 0;
  const t = dur > 0 ? (Number(dom.refVideoFrame.value) / 1000) * dur : 0;
  dom.refVideoTime.textContent = `${t.toFixed(1)}s`;
  clearTimeout(refVideoSeekTimer);
  refVideoSeekTimer = setTimeout(() => refreshRefVideoFrame(t).catch(() => {}), 140);
}

async function setRefVideoFromFile(file) {
  const name = (file && file.name) || "";
  const isVideo = (file && /^video\//i.test(file.type || "")) || /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(name);
  if (!file || !isVideo) {
    toast("That isn't a video file", 2400);
    return;
  }
  teardownRefVideo();
  dom.refVideoRow.classList.add("loading");
  const cleanName = name.replace(/\.[^.]+$/, "").slice(0, 40);
  // WebCodecs first — the <video> element never loads in the editor preview.
  let session = null;
  try {
    session = await openVideo(file);
  } catch (e) {
    console.warn("video decode failed", e);
    session = null;
  }
  if (session) {
    refVideoSession = session;
    state.refVideo = { blob: file, name: cleanName, duration: session.duration, time: 0, dataUrl: null };
  } else {
    const url = URL.createObjectURL(file);
    let v;
    try {
      v = await loadVideoEl(url);
    } catch (e) {
      console.warn("video reference failed", e);
      URL.revokeObjectURL(url);
      dom.refVideoRow.classList.remove("loading");
      toast("Couldn't read that video", 3000);
      return;
    }
    refVideoEl = v;
    state.refVideo = {
      blob: file,
      url,
      name: cleanName,
      duration: isFinite(v.duration) ? v.duration : 0,
      time: 0,
      dataUrl: null,
    };
  }
  const start = Math.min(state.refVideo.duration * 0.25, 1.5);
  if (!(await refreshRefVideoFrame(start))) {
    teardownRefVideo();
    state.refVideo = null;
    dom.refVideoRow.classList.remove("loading");
    toast("Couldn't read a frame from that video", 3000);
    return;
  }
  dom.refVideoFrame.value = String(state.refVideo.duration > 0 ? Math.round((start / state.refVideo.duration) * 1000) : 0);
  syncRefVideoUI();
  toast("Reference video attached", 2200);
}

function teardownRefVideo() {
  if (refVideoSession) {
    try {
      refVideoSession.dispose();
    } catch {}
    refVideoSession = null;
  }
  if (refVideoEl) {
    try {
      refVideoEl.removeAttribute("src");
      refVideoEl.load();
    } catch {}
    refVideoEl = null;
  }
  if (state.refVideo && state.refVideo.url) URL.revokeObjectURL(state.refVideo.url);
}

function clearRefVideo() {
  teardownRefVideo();
  state.refVideo = null;
  syncRefVideoUI();
}

function wireRefRow(row, onFile) {
  ["dragenter", "dragover"].forEach((ev) =>
    row.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.add("over");
    }),
  );
  row.addEventListener("dragleave", (e) => {
    e.stopPropagation();
    row.classList.remove("over");
  });
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("over");
    dragDepth = 0;
    dom.dropOverlay.hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

function setQualityUI(q) {
  state.quality = q;
  for (const b of dom.qualitySeg.children) b.classList.toggle("active", b.dataset.quality === q);
  const ai = q === "ai";
  dom.qualityNote.textContent = ai
    ? "Neural reconstruction (TripoSR) \u2014 one-time ~485 MB model download, cached by the browser. WebGPU required."
    : "Rebuilds the shape from depth \u2014 instant, works everywhere.";
  dom.qualityNote.classList.toggle("warn", ai);
  dom.aiControls.hidden = !ai;
}

function setQuality(q, rebuild = true) {
  if (state.quality === q) return;
  setQualityUI(q);
  if (rebuild && state.imageSrc && !state.busy) {
    run(async () => {
      await buildFromImageSrc(state.imageSrc, { label: state.label }, q);
    });
  }
}

for (const b of dom.qualitySeg.children) {
  b.onclick = () => setQuality(b.dataset.quality);
}

probeDevice().then((d) => {
  const aiBtn = dom.qualitySeg.querySelector('[data-quality="ai"]');
  if (d.gpu) {
    dom.aiBadge.hidden = false;
    dom.aiBadge.textContent = d.adapter ? "WebGPU" : "WebGPU";
    aiBtn.title = `TripoSR on ${d.adapter || "WebGPU"}`;
  } else {
    aiBtn.disabled = true;
    aiBtn.title = d.reason || "WebGPU unavailable";
    dom.aiBadge.hidden = true;
  }
});

dom.generateBtn.onclick = () => generate();
dom.imageBtn.onclick = () => generateImageOnly();
dom.surpriseBtn.onclick = () => {
  dom.prompt.value = randomPromptText();
};

dom.imgViewBtn.onclick = () => openLightbox(state.generatedImage);
dom.imgDownloadBtn.onclick = () => {
  const g = generatedImageBlob();
  if (g) download(g.blob, imageFileName(g.label, g.ext));
};
dom.imgRefBtn.onclick = async () => {
  const g = generatedImageBlob();
  if (!g) return;
  await setReferenceFromFile(new File([g.blob], `generated.${g.ext}`, { type: g.blob.type }));
};
dom.imgBuildBtn.onclick = async () => {
  const cur = state.genImages[state.genIndex];
  if (!cur) return;
  const ok = await run(async () => {
    setStatus("Building from image\u2026");
    await buildFromImageSrc(cur.dataUrl, { label: cur.label });
  });
  if (ok) toast("Model ready \u2014 drag to spin it", 2600);
};
dom.lightboxClose.onclick = (e) => { e.stopPropagation(); closeLightbox(); };
dom.imgLightbox.onclick = () => closeLightbox();
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
dom.srcThumb.addEventListener("click", () => openLightbox(dom.srcThumb.currentSrc || dom.srcThumb.src));
dom.uploadBtn.onclick = () => dom.fileInput.click();
dom.fileInput.onchange = () => {
  if (dom.fileInput.files && dom.fileInput.files.length) handleFiles([...dom.fileInput.files]);
  dom.fileInput.value = "";
};

dom.refDrop.onclick = () => dom.refInput.click();
dom.refInput.onchange = () => {
  if (dom.refInput.files && dom.refInput.files.length) setReferenceFromFile(dom.refInput.files[0]);
  dom.refInput.value = "";
};
dom.refClearBtn.onclick = (e) => {
  e.stopPropagation();
  clearReference();
};
["dragenter", "dragover"].forEach((ev) =>
  dom.refRow.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dom.refRow.classList.add("over");
  }),
);
dom.refRow.addEventListener("dragleave", (e) => {
  e.stopPropagation();
  dom.refRow.classList.remove("over");
});
dom.refRow.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dom.refRow.classList.remove("over");
  dragDepth = 0;
  dom.dropOverlay.hidden = true;
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) setReferenceFromFile(f);
});

dom.ref3dDrop.onclick = () => dom.ref3dInput.click();
dom.ref3dInput.onchange = () => {
  if (dom.ref3dInput.files && dom.ref3dInput.files.length) setRef3dFromFile(dom.ref3dInput.files[0]);
  dom.ref3dInput.value = "";
};
dom.ref3dClearBtn.onclick = (e) => {
  e.stopPropagation();
  clearRef3d();
};
wireRefRow(dom.ref3dRow, setRef3dFromFile);

dom.refVideoDrop.onclick = () => dom.refVideoInput.click();
dom.refVideoInput.onchange = () => {
  if (dom.refVideoInput.files && dom.refVideoInput.files.length) setRefVideoFromFile(dom.refVideoInput.files[0]);
  dom.refVideoInput.value = "";
};
dom.refVideoClearBtn.onclick = (e) => {
  e.stopPropagation();
  clearRefVideo();
};
dom.refVideoFrame.oninput = scheduleRefVideoSeek;
dom.refVideoFrame.onchange = scheduleRefVideoSeek;
wireRefRow(dom.refVideoRow, setRefVideoFromFile);

syncRef3dUI();
syncRefVideoUI();

dom.viewSelect.onchange = () => applyView();
dom.invertCheck.onchange = () => { syncLabels(); drawDepthThumb(); scheduleRebuild(); };
dom.alphaCheck.onchange = () => scheduleRebuild();
dom.volumeCheck.onchange = () => scheduleRebuild();
dom.matteCheck.onchange = async () => {
  if (state.busy) return;
  if (dom.matteCheck.checked) {
    if (!state.alpha && state.prepCanvas) {
      const ok = await run(async () => {
        setStatus("Cutting out the subject\u2026");
        await applyAutoMatte();
        refreshAlphaUI();
        buildMesh(false);
      });
      if (ok && state.matteComputed) toast(state.cutMethod === "flat" ? "Subject cut out (flat backdrop)" : "Subject cut out", 2000);
    }
  } else if (state.matteComputed) {
    state.alpha = state.sourceAlpha;
    state.matteComputed = false;
    refreshAlphaUI();
    buildMesh(false);
  }
};
[dom.detailRange, dom.depthRange, dom.smoothRange, dom.baseRange].forEach((el) => {
  el.addEventListener("input", scheduleRebuild);
});
[dom.aiDetailRange, dom.aiSmoothRange].forEach((el) => {
  el.addEventListener("input", scheduleAiRebuild);
});
syncAiLabels();
dom.autorotateCheck.onchange = () => { controls.autoRotate = dom.autorotateCheck.checked; };
controls.autoRotate = dom.autorotateCheck.checked;
dom.baseCheck.onchange = () => sceneBase.setEnabled(dom.baseCheck.checked);
dom.baseCheck.checked = sceneBase.isEnabled();

dom.exportGlbBtn.onclick = () => doExport("glb");
dom.exportPlyBtn.onclick = () => doExport("ply");
dom.exportStlBtn.onclick = () => doExport("stl");
dom.exportObjBtn.onclick = () => doExport("obj");
dom.exportPngBtn.onclick = () => doExport("png");
dom.exportTgaBtn.onclick = () => doExport("tga");

dom.dragOutBtn.addEventListener("dragstart", (e) => {
  if (!dragFile) {
    e.preventDefault();
    prepareDragFile();
    return;
  }
  e.dataTransfer.effectAllowed = "copy";
  try { e.dataTransfer.setData("text/plain", dragFile.name); } catch (err) {}
  try { e.dataTransfer.items.add(dragFile); } catch (err) { console.warn("drag-out items.add failed", err); }
  document.body.classList.add("dragging-out");
});
dom.dragOutBtn.addEventListener("dragend", () => document.body.classList.remove("dragging-out"));

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  dom.dropOverlay.hidden = false;
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dom.dropOverlay.hidden = true;
  }
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dom.dropOverlay.hidden = true;
  const dt = e.dataTransfer;
  if (!dt) return;
  const files = dt.files && dt.files.length ? [...dt.files] : [];
  if (files.length) handleFiles(files);
});

/* Paste interop: a file copied in Blender's file browser / the OS file manager (clipboardData.files
   or a file item), or a link to an image/model. Images keep working exactly as before. */
window.addEventListener("paste", (e) => {
  if (state.busy) return;
  const dt = e.clipboardData;
  if (!dt) return;

  const files = dt.files && dt.files.length ? [...dt.files] : [];
  if (files.length) {
    e.preventDefault();
    handleFiles(files);
    return;
  }

  const items = dt.items ? [...dt.items] : [];
  for (const it of items) {
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) {
        e.preventDefault();
        handleFiles([f]);
        return;
      }
    }
  }

  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;

  const uri = (dt.getData("text/uri-list") || "").split(/[\r\n]+/).map((s) => s.trim()).find((s) => /^https?:\/\//i.test(s));
  const plain = (dt.getData("text/plain") || "").trim();
  const url = uri || (/^https?:\/\/\S+$/i.test(plain) ? plain : "");
  if (url) {
    e.preventDefault();
    handleUrl(url);
  }
});

const TYPE_EXT = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
  "model/gltf-binary": ".glb", "model/gltf+json": ".gltf", "model/stl": ".stl",
  "application/octet-stream": ".glb", "text/plain": ".txt",
};

async function handleUrl(url) {
  if (state.busy) return;
  let file;
  try {
    setStatus("Fetching link\u2026");
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    let name = decodeURIComponent((url.split("/").pop() || "").split("?")[0]);
    if (!/\.[a-z0-9]+$/i.test(name)) name = (name || "download") + (TYPE_EXT[blob.type] || "");
    file = new File([blob], name || "download", { type: blob.type || "application/octet-stream" });
  } catch (err) {
    console.warn("link fetch failed", err);
    if (!state.busy) setStatus(null);
    toast("Couldn't fetch that link", 3000);
    return;
  }
  handleFiles([file]);
}

function resize() {
  const w = dom.stage.clientWidth;
  const h = dom.stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderNow();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    resize();
    renderNow();
  }
});
new ResizeObserver(resize).observe(dom.stage);
resize();

syncLabels();
syncRefUI();
wireRealism();
applyLook("studio");
applyView();
setShapeEnabled(false);
setExportsEnabled(false);
controls.update();

studio = initStudio({
  THREE,
  scene,
  camera,
  renderer,
  controls,
  modelGroup,
  ground,
  grid,
  sceneBase,
  hemiLight,
  keyLight,
  rimLight,
  frontMat,
  solidMat,
  state,
  stage: dom.stage,
  getTexture: () => texture,
  getRig: () => rig,
  getAnim: () => animator,
  applyShading,
  frameObject,
  render: renderFrame,
  export: doExport,
  toast,
  setStatus,
  onMode: applyStudioState,
  onBaseChange: (on) => { dom.baseCheck.checked = on; },
});

function applyStudioState(on) {
  sceneBase.setStudio(on);
  dom.app.classList.toggle("studio", on);
  dom.studioBtn.classList.toggle("active", on);
  dom.studioBtn.textContent = on ? "Exit Studio" : "Studio";
  dom.emptyState.hidden = on ? true : !state.hasModel;
  resize();
  setTimeout(resize, 0);
}

function setStudioMode(on) {
  studio.setMode(on);
}
dom.studioBtn.onclick = () => setStudioMode(!studio.isOn());

/* Bundled fixtures in ./src/test-assets/ — an in-app test browser (see test-panel.js). */
const testPanel = createTestPanel();
if (dom.testsBtn) dom.testsBtn.onclick = () => testPanel.toggle();

/* Auto-armature — forge a humanoid skeleton for a model that has none, then link the
   mesh with automatic proximity weights, so Motion, the Shape keys and the exporter all
   work on an unrigged AI / relief / imported mesh. See auto-armature.js. */
const autoArmature = createAutoArmature({
  getRoot: () => modelGroup,
  getRig: () => rig,
  refreshRig,
  render: renderNow,
  toast,
});

/* Muscle rig — the anatomical layer built on the auto-armature: one bone per muscle belly,
   bound into the same skin and swelling automatically as the joints flex. See muscle-rig.js. */
const muscleRig = createMuscleRig({
  getRoot: () => modelGroup,
  getRig: () => rig,
  refreshRig,
  render: renderNow,
  autoArmature,
  toast,
});

/* Armature workspace — understand the loaded rig (bones, clips, poses) and share it
   live with other people on the same rig (see armature.js / net.js / the server script). */
rigPanel = createRigPanel({
  overlay: rigOverlay,
  scene,
  stage: dom.stage,
  toast,
  getRig: () => rig,
  getRoot: () => modelGroup,
  motions,
  author,
  partner,
  autoArmature,
  muscleRig,
  getModelSize: () => {
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return 2;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) || 2;
  },
  render: renderNow,
  camera,
  renderer,
  onChange: (on) => {
    if (dom.rigBtn) dom.rigBtn.classList.toggle("active", on);
  },
});
if (dom.rigBtn) dom.rigBtn.onclick = () => rigPanel.toggle();

/* Real AI animation — the text model writes a keyframe spec from a written
   motion description and it is baked onto the rig. See ai-anim.js. */
const aiAnim = createAiAnim({
  getNoLimit: () => nolimit,
  getRig: () => rig,
  getMotions: () => motions,
  getAuthor: () => author,
  toast,
});

/* No-Limit AI — a streaming chat assistant, an unrestricted vision reader
   (image or sampled video frames) and the AI animation tab, all applying the
   no-limit rule. See ai-panel.js / nolimit.js. */
const aiPanel = createAiPanel({
  getNoLimit: () => nolimit,
  getGeneratedImage: () => state.generatedImage || null,
  captureViewport: () => {
    renderFrame();
    return renderer.domElement.toDataURL("image/png");
  },
  getAiAnim: () => aiAnim,
  onAnimateDone: () => {
    if (rigPanel && rigPanel.refreshKeyframes) rigPanel.refreshKeyframes();
  },
  toast,
});
if (dom.aiBtn) dom.aiBtn.onclick = () => aiPanel.toggle();

/* Persistent asset library — every imported / dragged file is saved to IndexedDB
   via the kv-plugin, so it survives reloads (see library.js). */
const library = createLibrary({
  getKv: () => (window.root && window.root.kv) || null,
  loadFiles: handleFiles,
  setReference: (src, name) => (window.textTo3d ? window.textTo3d.setReference(src, name) : Promise.resolve(false)),
  toast,
  onChange: (n) => {
    if (!dom.libraryBtn) return;
    dom.libraryBtn.innerHTML = n ? `Library <span class="libCount">${n}</span>` : "Library";
  },
  onVisible: (on) => {
    if (dom.libraryBtn) dom.libraryBtn.classList.toggle("active", on);
  },
  getAddons: () => addons,
  onBuildVolume: (src, name, opts) => buildVolumeFromLibrary(src, name, opts),
  canAiVolume: () => img3dSupported(),
});
if (dom.libraryBtn) dom.libraryBtn.onclick = () => library.toggle();
library.init().catch((e) => console.warn("library init failed", e));

/* Add-ons — optional extensions browsable from the Library's "Add-ons" tab.
   Enabled state is persisted, and every hook an add-on registers is torn down
   when it is switched off (see addons.js). */
const addons = createAddons({
  getKv: () => (window.root && window.root.kv) || null,
  getApp: () => window.textTo3d,
  toast,
  onChange: () => library.refreshAddonBadge(),
});
addons.init().catch((e) => console.warn("add-ons init failed", e));

/* Guided workflow — the seven-step pipeline that unifies prompt → image → 3D →
   look → rig → animation → export. Every control is a thin mirror of an existing
   one and every status is read from the live app state, so the two can never
   disagree. See workflow.js. */
const workflow = createWorkflow({
  getKv: () => (window.root && window.root.kv) || null,
  app: {
    prompt: {
      get: () => dom.prompt.value,
      set: (v) => {
        dom.prompt.value = v;
      },
    },
    randomPrompt: () => {
      dom.prompt.value = randomPromptText();
    },
    refs: () => ({ image: !!state.ref, model: !!state.ref3d, video: !!state.refVideo }),
    generatedImage: () => state.generatedImage || null,
    info: () => ({ hasModel: state.hasModel, triangles: state.triangles, quality: state.quality, mode: state.mode }),
    rigInfo: () => (rig && rig.bones && rig.bones.length ? { bones: rig.boneCount || rig.bones.length, clips: (rig.clips && rig.clips.length) || 0 } : null),
    motionId: () => (motions.motionId || null),
    keyCount: () => author.keyCount || 0,
    resolution: {
      get: () => dom.resSelect.value,
      set: (v) => {
        dom.resSelect.value = v;
      },
    },
    cutout: {
      get: () => dom.removeBgCheck.checked,
      set: (b) => {
        dom.removeBgCheck.checked = !!b;
      },
    },
    quality: {
      get: () => state.quality,
      set: (q) => setQuality(q),
    },
    lookPresets: () => Object.entries(LOOK_PRESETS).map(([id, p]) => ({ id, label: p.label })),
    lookPreset: {
      get: () => look.preset,
      set: (id) => {
        look.preset = id;
        applyLook(id);
        if (dom.lookPresetSel) dom.lookPresetSel.value = id;
      },
    },
    motionList: () => MOTIONS.map((m) => ({ id: m.id, label: m.label, category: m.category })),
    generateImage: () => generateImageOnly(),
    generate3d: () => generate(),
    build3d: () =>
      state.generatedImage
        ? buildFromImageSrc(state.generatedImage, { label: dom.prompt.value.trim() || "image" })
        : Promise.reject(new Error("Generate or pick an image first")),
    playMotion: (id) => {
      if (author.playing) author.pause();
      if (!motions.play(id)) toast("This model has no usable skeleton", 2600);
      if (rigPanel && rigPanel.refresh) rigPanel.refresh();
    },
    stopMotion: () => {
      motions.stop();
      if (rigPanel && rigPanel.refresh) rigPanel.refresh();
    },
    openRig: () => rigPanel.open(),
    openStudio: () => setStudioMode(true),
    openLibrary: () => library.open(),
    openVolume: () => volumePanel.open(),
    openTargets: () => targets.open(),
    /* A one-line volume reading for the workflow's Mesh / Export steps. Shown in real
       units once the user has calibrated, otherwise in model units. */
    volumeText: () => {
      const r = state.volumeReport;
      if (!r) return null;
      if (state.volumeScaleHeight) {
        const c = calibratedVolume();
        return formatVolume(c.volume) + " \\u00b7 " + formatMass(c.mass);
      }
      return r.volume.toFixed(4) + " u\\u00b3";
    },
    volumeClosed: () => !!(state.volumeReport && state.volumeReport.watertight && state.volumeReport.closed),
    aiVolume: () => buildAiVolume({ multiView: true }),
    hasWebgpu: () => img3dSupported(),
    openAiTab: (tab) => {
      aiPanel.open();
      aiPanel.showTab(tab);
    },
    export: (kind) => doExport(kind),
  },
  onChange: (on) => {
    if (dom.workflowBtn) dom.workflowBtn.classList.toggle("active", on);
  },
  toast,
});
if (dom.workflowBtn) dom.workflowBtn.onclick = () => workflow.toggle();

/* Volume — real 3D volume estimation & the closed-solid builder. Every reading is pulled
   live from the stage model, so the panel and the viewport can never disagree. See
   volume-panel.js / volume.js / volume-build.js. */
const volumePanel = createVolume({
  app: {
    info: () => ({
      hasModel: state.hasModel,
      hasDepth: !!state.depth,
      hasImage: !!(state.generatedImage || state.imageSrc),
      mode: state.mode,
      solid: state.solid,
      triangles: state.triangles || 0,
      quality: state.quality,
      label: state.label,
      imageSrc: state.generatedImage || state.imageSrc || null,
      depth: state.depthW ? state.depthW + "\\u00d7" + state.depthH : "",
      backMode: state.volumeBack,
      thickness: Number(dom.baseRange.value),
      scaleHeight: state.volumeScaleHeight || 0,
      density: state.volumeDensity,
      axis: state.volumeAxis,
    }),
    report: () => state.volumeReport,
    measure: () => measureStage(),
    calibrated: () => calibratedVolume(),
    backModes: BACK_MODES,
    densities: DENSITIES,
    setBackMode: (m) => setVolumeBackMode(m),
    getThickness: () => Number(dom.baseRange.value),
    setThickness: (v) => setVolumeThickness(v),
    maxThickness: () => Number(dom.baseRange.max),
    makeSolid: () => setVolumeSolid(true),
    makeRelief: () => setVolumeSolid(false),
    closeMesh: () => closeStageMesh(),
    setScale: (o) => setVolumeScale(o),
    buildAiVolume: (o) => buildAiVolume(o),
    rebuildFromImage: () => rebuildFromImage(),
    currentImage: () => state.generatedImage || state.imageSrc || null,
    generateImage: () => generateImageOnly(),
    setQuality: (q) => setQuality(q),
    exportGlb: () => doExport("glb"),
    saveReport: saveVolumeReport,
    openLibrary: () => library.open(),
    hasWebgpu: () => img3dSupported(),
    setStatus,
    clearStatus: () => setStatus(null),
    formatters: { formatLength, formatArea, formatVolume, formatMass },
  },
  toast,
});
if (dom.volumeBtn) dom.volumeBtn.onclick = () => volumePanel.toggle();
loadVolumePrefs().then(() => {
  if (state.solid && state.depth) scheduleRebuild();
});

/* Shape — automatic Shape Keys / morph targets on the stage mesh. Procedural shapes
   straight from the geometry, plus rig-driven corrective (Flex/Bulge) keys. They are real
   geometry.morphAttributes morphs, so they render live and export inside the GLB (Blender
   opens them as Shape Keys). See shape-keys.js / shape-panel.js. */
const shapeName = (spec) => "Shape \u00b7 " + (spec && spec.label ? spec.label : spec);
const shapeKeys = createShapeKeys({
  getRoot: () => modelGroup,
  toast,
  onChange: () => {
    if (shapePanel && shapePanel.isOpen) shapePanel.refresh(true);
  },
});
const shapePanel = createShapePanel({
  app: {
    info: () => shapeKeys.info(),
    listShapes: () => shapeKeys.list(),
    shapeName: (spec) => (spec && spec.label ? shapeName(spec) : String(spec || "")),
    getWeight: (n) => shapeKeys.getWeight(n),
    setWeight: (n, v) => shapeKeys.setWeight(n, v),
    autoShape: (ids) => shapeKeys.autoShape(ids === "all" ? AUTO_SHAPES.map((s) => s.id) : ids),
    autoShapeKeys: () => shapeKeys.autoShapeKeys(),
    resetShapes: () => shapeKeys.reset(),
    clearShapes: () => shapeKeys.clear(),
    removeShape: (n) => shapeKeys.remove(n),
    hasRig: () => !!rig,
    autoArmature: () => autoArmature.generate(),
    exportGlb: () => doExport("glb"),
    openLibrary: () => library.open(),
    setStatus,
    clearStatus: () => setStatus(null),
  },
  toast,
});
if (dom.shapeBtn) dom.shapeBtn.onclick = () => {
  shapePanel.toggle();
  if (dom.shapeBtn) dom.shapeBtn.classList.toggle("active", shapePanel.isOpen);
};
// Any model rebuild drops the previous mesh's shapes and the cached vertex frames.
onModelChanged = () => {
  shapeKeys.invalidate();
  shapeKeys.clear();
  shapePanel.refresh(true);
  if (targets) targets.refresh();
};

/* Export targets — pick a destination (3D print, Tabletop Simulator, VTT token, game engine)
   and the panel processes the stage model into the files that destination expects, packaged
   when needed. See targets.js. */
const targets = createTargets({
  app: {
    getRoot: () => modelGroup,
    info: () => ({
      hasModel: state.hasModel,
      triangles: state.triangles || 0,
      label: state.label,
      mode: state.mode,
      quality: state.quality,
    }),
    getEnvTexture: () => scene.environment,
    renderOffscreen,
    setStatus,
    clearStatus: () => setStatus(null),
    download,
  },
  toast,
});
if (dom.targetsBtn) dom.targetsBtn.onclick = () => {
  targets.toggle();
  dom.targetsBtn.classList.toggle("active", targets.isOpen);
};

addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (workflow.isOpen) workflow.close();
  if (library.isOpen) library.close();
  if (testPanel.isOpen) testPanel.close();
  if (rigPanel && rigPanel.isOpen) rigPanel.close();
  if (volumePanel.isOpen) volumePanel.close();
  if (aiPanel.isOpen) aiPanel.close();
  if (shapePanel.isOpen) shapePanel.close();
  if (targets.isOpen) targets.close();
  if (dom.shapeBtn) dom.shapeBtn.classList.remove("active");
  if (dom.targetsBtn) dom.targetsBtn.classList.remove("active");
});

let lastT = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  controls.update();
  if (studio) studio.update(dt);
  if (rig) rig.update(dt);
  author.update(dt);
  if (rig && author.autoKey && !author.playing) author.captureIfChanged();
  motions.update(dt);
  if (partner) partner.update(dt);
  if (muscleRig) muscleRig.update(dt);
  animator.update(dt);
  addons.update(dt);
  updateAnimUI();
  if (rigPanel) rigPanel.update();
  renderFrame();
});

let warmedUp = false;
function warmUpOnce() {
  if (warmedUp) return;
  warmedUp = true;
  removeEventListener("pointerdown", warmUpOnce);
  removeEventListener("keydown", warmUpOnce);
  removeEventListener("focusin", warmUpOnce);
  warmUpDepth((t) => {
    if (!state.busy) setStatus(t);
  })
    .then(() => {
      if (!state.busy) setStatus(null);
    })
    .catch((e) => console.warn("depth warm-up failed", e));
  if (dom.matteCheck.checked) {
    warmUpMatte((t) => {
      if (!state.busy) setStatus(t);
    })
      .then(() => {
        if (!state.busy) setStatus(null);
      })
      .catch((e) => console.warn("cut-out warm-up failed", e));
  }
}
addEventListener("pointerdown", warmUpOnce);
addEventListener("keydown", warmUpOnce);
addEventListener("focusin", warmUpOnce);
setTimeout(warmUpOnce, 15000);

window.textTo3d = {
  scene,
  camera,
  controls,
  renderer,
  model: modelGroup,
  grid,
  ground,
  sceneBase,
  frontMat,
  solidMat,
  render: renderNow,
  frameObject,
  applyShading,
  setStudioMode,
  get studio() { return studio; },
  tests: testPanel,
  armature: rigPanel,
  get rig() { return rig; },
  anim: animator,
  motions,
  motionPresets: MOTIONS,
  partner,
  author,
  nolimit,
  ai: aiPanel,
  aiAnim,
  workflow,
  refreshRig,
  autoArmature,
  autoRig: (opts) => autoArmature.generate(opts),
  forgeArmature: (opts) => autoArmature.forge(opts),
  linkArmature: () => autoArmature.bind(),
  removeArmature: () => autoArmature.remove(),
  muscleRig,
  autoMuscleRig: (opts) => muscleRig.generate(opts),
  removeMuscles: (silent) => muscleRig.remove(silent),
  setMuscleFlex: (patch) => muscleRig.setOptions(patch),
  muscleState: () => muscleRig.state(),
  library,
  addons,
  setSize: (w, h) => {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderNow();
  },
  generate,
  generateImageOnly,
  fromImage: (src, label) => buildFromImageSrc(src, { label: label || "image" }),
  fromAiImage: (src, label) => buildFromImageSrc(src, { label: label || "image" }, "ai"),
  rebuildAi,
  volume: volumePanel,
  shape: shapeKeys,
  shapePanel,
  targets,
  exportTargets: (id) => targets.build(id),
  shapes: () => shapeKeys.list(),
  autoShape: (ids) => shapeKeys.autoShape(ids),
  autoShapeKeys: (opts) => shapeKeys.autoShapeKeys(opts),
  setShape: (name, v) => shapeKeys.setWeight(name, v),
  resetShapes: () => shapeKeys.reset(),
  clearShapes: () => shapeKeys.clear(),
  shapeName: (label) => shapeName(label),
  BACK_MODES,
  DENSITIES,
  measureVolume: () => measureStage(),
  volumeReport: () => state.volumeReport,
  aiMetrics: () => state.aiMetrics,
  calibratedVolume: () => calibratedVolume(),
  setVolumeScale: (opts) => {
    setVolumeScale(opts || {});
    return calibratedVolume();
  },
  setVolumeSolid: (on) => setVolumeSolid(on),
  setVolumeBackMode: (mode) => setVolumeBackMode(mode),
  closeMesh: () => closeStageMesh(),
  buildSolidVolume: (opts = {}) => {
    if (opts.backMode) state.volumeBack = opts.backMode;
    if (opts.thickness != null) dom.baseRange.value = String(opts.thickness);
    setVolumeSolid(true);
    return { report: state.volumeReport, solid: state.solid };
  },
  buildAiVolume,
  aiVolume: (o = {}) => buildAiVolume({ multiView: true, ...o }),
  buildVolumeFromLibrary,
  volumeReportText: () => buildVolumeReportText(),
  setQuality,
  get quality() { return state.quality; },
  img3dSupported,
  img3dModelsLoaded,
  probeBackbone: async (src, ep, opts) => {
    const img = await loadImage(src);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    return probeBackbone(c, { ep: ep || "webgpu", opts });
  },
  fromFiles: handleFiles,
  get generatedImage() { return state.generatedImage || null; },
  get generatedImages() { return state.genImages.slice(); },
  showGeneratedImage,
  setReference: async (src, name) => {
    if (typeof src === "string" && src.startsWith("data:")) {
      state.ref = { dataUrl: src, blob: dataURLtoBlob(src), name: name || "" };
      syncRefUI();
      return true;
    }
    await setReferenceFromFile(src);
    return !!state.ref;
  },
  clearReference,
  describeReference: () => (state.ref ? describeReference(state.ref.blob) : Promise.resolve("")),
  get ref() { return state.ref; },
  setReference3d: async (file) => { await setRef3dFromFile(file); return !!state.ref3d; },
  clearReference3d: clearRef3d,
  get ref3d() { return state.ref3d; },
  setReferenceVideo: async (file) => { await setRefVideoFromFile(file); return !!state.refVideo; },
  setReferenceVideoTime: (t) => refreshRefVideoFrame(t),
  clearReferenceVideo: clearRefVideo,
  get refVideo() { return state.refVideo; },
  export: doExport,
  look: {
    setPreset: (name) => { look.preset = name; applyLook(name); return look.preset; },
    setEnv,
    setEnvIntensity,
    setEnvBackground,
    setLightRig,
    setToneMapping: (op) => { setToneMapping(op); syncRealismUI(); return look.tone; },
    setShadowStrength: (v) => { setShadowStrength(v); syncRealismUI(); return look.shadow; },
    setDetail: (patch) => { Object.assign(detail, patch); applyDetailMaps(); syncRealismUI(); renderFrame(); return { ...detail }; },
    get detail() { return { ...detail }; },
    setFx: (patch) => { setFx(patch); syncRealismUI(); return { ...fx.params }; },
    setFxPreset: (id) => { fx.applyPreset(id); look.fx = id; syncRealismUI(); renderFrame(); return { ...fx.params }; },
    get params() { return { ...look }; },
    get fx() { return { ...fx.params }; },
    get env() { return env; },
    get fxEngine() { return fx; },
  },
  exportDataUrl: async (kind = "glb") => {
    if (!state.hasModel) return null;
    if (kind === "glb") return readAsDataURL(await toGLB(modelGroup));
    if (kind === "ply") return readAsDataURL(toPLY(modelGroup));
    if (kind === "stl") return readAsDataURL(toSTL(modelGroup));
    if (kind === "obj") return readAsDataURL(toOBJ(modelGroup));
    if (kind === "png") {
      renderFrame();
      return renderer.domElement.toDataURL("image/png");
    }
    return null;
  },
  info: () => ({
    mode: state.mode,
    hasModel: state.hasModel,
    label: state.label,
    quality: state.quality,
    depth: state.depthW + "x" + state.depthH,
    triangles: state.triangles,
    cutout: state.cutout,
    hasAlpha: !!state.alpha,
    matte: state.matteComputed,
    cutMethod: state.cutMethod,
    volume: dom.volumeCheck.checked,
    aiVertices: state.ai ? state.ai.vertices : 0,
    aiColored: !!(state.ai && state.ai.colors),
  }),
};

console.log("3D Model Maker ready");
