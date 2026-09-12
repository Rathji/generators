import * as THREE from "https://esm.sh/three@0.160.0";
import { makeRng } from "./rng.js";
import { buildGeometries } from "./lib.js";
import { buildMaterials } from "./materials.js";
import { generateCity } from "./city.js";
import { buildAtmosphere } from "./atmosphere.js";
import { Player, bindControls } from "./player.js";
import { createSpirits } from "./spirits.js";
import { makeInscriptionFactory, WARD_BLURBS, makeSpiritProfile, spiritSpeak } from "./inscriptions.js";
import { Soundtrack } from "./audio.js";
import { loadSave, writeSave, clearSave, parseSaveText, serializeSave } from "./save.js";

// ---------------------------------------------------------------
//  perchance interop
// ---------------------------------------------------------------
function getRoot(){
  try { if (window.root) return window.root; } catch (e) {}
  try { return root; } catch (e) {}
  return {};
}
const root = getRoot();

// Persistent progress (kv-plugin). Resolved once at startup so the seed — and
// therefore the whole city — can be restored before anything is built.
const kv = (root && root.kv) ? root.kv : null;
let savedProgress = null;
try { savedProgress = await loadSave(kv); } catch (e) { savedProgress = null; }

function readConfig(name, dflt){
  try {
    const v = root.config && root.config[name];
    if (v === undefined || v === null || v === "") return dflt;
    const n = Number(String(v).trim());
    return Number.isNaN(n) ? dflt : n;
  } catch (e) { return dflt; }
}
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

// 1 = full quality, 0 = reduced (smaller shadows, fewer motes, lower DPR).
// Config `quality` may force it: 0 or 1. Anything else auto-detects.
function autoQuality(){
  try {
    const coarse = matchMedia("(pointer: coarse)").matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 820;
    const lowMem = navigator.deviceMemory ? navigator.deviceMemory <= 4 : false;
    const lowCores = navigator.hardwareConcurrency ? navigator.hardwareConcurrency <= 4 : false;
    return (coarse || small) && (coarse || lowMem || lowCores) ? 0 : 1;
  } catch (e) { return 1; }
}
const _q = readConfig("quality", -1);
const QUALITY = _q === 0 ? 0 : _q === 1 ? 1 : autoQuality();

function readTitles(){
  try {
    const node = root.districtTitle;
    if (node && node.selectAll){
      const arr = node.selectAll.map(n => n.evaluateItem).filter(Boolean);
      if (arr.length) return arr;
    }
  } catch (e) {}
  return ["Sorrow's Row", "The Hall of Kings", "The Ossuary Reach", "Gardens of Ash", "The Quiet Choir"];
}

const CFG = {
  seed: readConfig("seed", 0),
  avenueCount: clamp(readConfig("avenueCount", 14), 6, 24),
  cityRadius: clamp(readConfig("cityRadius", 250), 80, 400),
  fogDensity: clamp(readConfig("fogDensity", 0.0072), 0, 0.05),
  spiritCount: clamp(readConfig("spiritCount", 12), 0, 40),
  sigilsRequired: clamp(readConfig("sigilsRequired", 7), 1, 20),
  walkSpeed: clamp(readConfig("walkSpeed", 5.2), 1, 20),
  sprintSpeed: clamp(readConfig("sprintSpeed", 9.0), 1, 30),
  eyeHeight: clamp(readConfig("eyeHeight", 1.7), 0.5, 5),
  bloom: readConfig("bloom", 1) ? 1 : 0,
  quality: QUALITY,
};

// seed resolution: a pinned config seed wins, then a persisted run, then the
// current session's seed (e.g. after New City), then a fresh random city
let seed;
(function initSeed(){
  let stored = null;
  try { stored = sessionStorage.getItem("np-seed"); } catch (e) {}
  if (CFG.seed) seed = CFG.seed | 0;
  else if (savedProgress) seed = savedProgress.seed | 0;
  else if (stored) seed = parseInt(stored, 10) || 0;
  else seed = (Math.random() * 1e9) | 0;
  try { sessionStorage.setItem("np-seed", String(seed)); } catch (e) {}
  document.getElementById("seedVal").textContent = seedHex(seed);
})();

function seedHex(s){ return (s >>> 0).toString(16).toUpperCase().slice(0, 8); }

(function initSaveLine(){
  const el = document.getElementById("saveLine");
  if (!el) return;
  if (savedProgress){
    el.textContent = "Saved run — Seed " + seedHex(savedProgress.seed) + " · " +
      savedProgress.sigilsTaken.length + " sigil" + (savedProgress.sigilsTaken.length === 1 ? "" : "s") + " reclaimed";
  } else {
    el.textContent = "No saved run — you are starting a new city.";
  }
})();

// ---------------------------------------------------------------
//  DOM
// ---------------------------------------------------------------
const sceneCtn = document.getElementById("scene");
const panel = document.getElementById("panel");
const panelHeader = panel.querySelector(".ph");
const panelText = panel.querySelector(".pt");
const panelFooter = panel.querySelector(".pf");
const promptEl = document.getElementById("prompt");
const toastEl = document.getElementById("toast");
const crosshair = document.getElementById("crosshair");
const sigilBar = document.getElementById("sigilBar");
const sigilLabel = document.getElementById("sigilLabel");
const banner = document.getElementById("districtBanner");
const bannerTitle = banner.querySelector(".dt");
const bannerSub = banner.querySelector(".ds");
const objText = document.getElementById("objText");
const compassEl = document.getElementById("compass");
const pauseEl = document.getElementById("pause");
const menuEl = document.getElementById("menu");
const hudEl = document.getElementById("hud");
const loadingEl = document.getElementById("loading");
const loadBar = document.getElementById("loadBar");
const loadText = document.getElementById("loadText");
const flashEl = document.getElementById("flash");
const muteBtn = document.getElementById("muteBtn");

// ---------------------------------------------------------------
//  soundtrack
// ---------------------------------------------------------------
const soundtrack = new Soundtrack({ volume: 0.4 });
soundtrack.play("menu");
const firstGesture = () => {
  soundtrack.resume();
  window.removeEventListener("pointerdown", firstGesture);
  window.removeEventListener("keydown", firstGesture);
};
window.addEventListener("pointerdown", firstGesture);
window.addEventListener("keydown", firstGesture);
muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const muted = soundtrack.toggleMute();
  muteBtn.textContent = muted ? "SOUND OFF" : "SOUND ON";
  muteBtn.classList.toggle("off", muted);
});

// ---------------------------------------------------------------
//  mobile / touch controls
// ---------------------------------------------------------------
const touchUI = document.getElementById("touchUI");
const joyKnob = document.getElementById("joyKnob");
const actBtn = document.getElementById("actBtn");
const runBtn = document.getElementById("runBtn");
const touchToggle = document.getElementById("touchToggle");
const menuTouchBtn = document.getElementById("menuTouchBtn");
const panelClose = document.getElementById("panelClose");

const touchCapable = (() => {
  try { return ("ontouchstart" in window) || navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches; }
  catch (e) { return false; }
})();
let touchOn;
try {
  const stored = localStorage.getItem("np-touch");
  touchOn = stored === null ? touchCapable : stored === "1";
} catch (e) { touchOn = touchCapable; }

function actLabel(){ return touchOn ? "TAP" : "[E]"; }

function refreshTouch(){
  document.body.classList.toggle("touch", touchOn);
  const playing = menuEl.classList.contains("hidden") && !pauseEl.classList.contains("show");
  touchUI.classList.toggle("active", touchOn && playing);
  touchToggle.textContent = touchOn ? "TOUCH ON" : "TOUCH OFF";
  touchToggle.classList.toggle("off", !touchOn);
  menuTouchBtn.textContent = "Mobile Controls: " + (touchOn ? "ON" : "OFF");
}
function setTouchEnabled(on){
  touchOn = !!on;
  try { localStorage.setItem("np-touch", touchOn ? "1" : "0"); } catch (e) {}
  if (controls) controls.setTouchEnabled(touchOn);
  refreshTouch();
}
touchToggle.addEventListener("click", (e) => { e.stopPropagation(); setTouchEnabled(!touchOn); });
menuTouchBtn.addEventListener("click", (e) => { e.stopPropagation(); setTouchEnabled(!touchOn); });

function setProgress(p, text){
  loadBar.style.width = Math.round(p * 100) + "%";
  if (text) loadText.textContent = text;
}
let toastTimer = null;
function toast(msg, ms = 2600){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// ---------------------------------------------------------------
//  renderer / scene
// ---------------------------------------------------------------
const LOW = CFG.quality === 0;
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1.25 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = LOW ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneCtn.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 3000);

const geos = buildGeometries();
const mats = buildMaterials("np-" + seed).materials;

setProgress(0.05, "RAISING THE CITY");

const city = generateCity({
  rng: makeRng(seed),
  geos, mats, config: CFG, titles: readTitles(),
  onProgress: (p) => setProgress(p),
});
scene.add(city.group);

const atmo = buildAtmosphere(scene, makeRng(seed ^ 0x9e3779b9), CFG);
atmo.registerLanterns(city.lanterns);
atmo.addLanternGlows(city.lanterns);

// NOTE: image-based lighting from the sky is disabled for now — PMREM of the
// custom sky shader was washing the whole scene white. Revisit with a proper
// gradient cube texture once the base render is verified.

const spirits = createSpirits(scene, city.spirits, geos, makeRng(seed ^ 0x51ed270b));
const factories = makeInscriptionFactory(root, makeRng(seed ^ 0x2545f491));
for (let i = 0; i < spirits.list.length; i++){
  const spot = city.spirits[i];
  spirits.list[i].profile = makeSpiritProfile(makeRng(seed + i * 7919), spot.ward || city.wards[0], factories);
}

const player = new Player({ camera, footprints: city.footprints, grounds: city.grounds, radius: city.radius, config: CFG });
player.setPosition(city.spawn.x, city.spawn.z, city.spawn.yaw);
const controls = bindControls(renderer.domElement, player, { touchEnabled: touchOn });

// touch action buttons
const setRun = (v) => { controls.keys.sprint = v; runBtn.classList.toggle("on", v); };
actBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault(); e.stopPropagation();
  if (reading) closePanel(); else interact(findTarget());
});
runBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); setRun(true); });
["pointerup", "pointercancel", "pointerleave"].forEach((ev) => runBtn.addEventListener(ev, () => setRun(false)));
panelClose.addEventListener("click", (e) => { e.stopPropagation(); closePanel(); });
refreshTouch();

// ---------------------------------------------------------------
//  readable-inscription spatial grid
// ---------------------------------------------------------------
const readGrid = new Map();
const RCELL = 20;
for (let i = 0; i < city.readables.length; i++){
  const p = city.readables[i];
  const k = Math.floor(p.x / RCELL) + "," + Math.floor(p.z / RCELL);
  let a = readGrid.get(k); if (!a){ a = []; readGrid.set(k, a); }
  a.push(i);
}
function nearestReadable(x, z, maxD = 4.0){
  const gx = Math.floor(x / RCELL), gz = Math.floor(z / RCELL);
  let best = null, bd = maxD * maxD;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++){
    const a = readGrid.get((gx + dx) + "," + (gz + dz));
    if (!a) continue;
    for (const i of a){
      const p = city.readables[i];
      const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d2 < bd){ bd = d2; best = p; }
    }
  }
  return best;
}

// ---------------------------------------------------------------
//  sigils / HUD
// ---------------------------------------------------------------
let sigilsFound = 0;
for (let i = 0; i < CFG.sigilsRequired; i++){
  const d = document.createElement("div");
  d.className = "sigil";
  sigilBar.appendChild(d);
}
function updateHud(){
  const kids = sigilBar.children;
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle("on", i < sigilsFound);
  if (sigilsFound >= CFG.sigilsRequired){
    objText.textContent = "The Sanctum stands open. Enter the heart of the city.";
  } else {
    objText.textContent = "Reclaim the Soul Sigils. " + sigilsFound + " of " + CFG.sigilsRequired + " found.";
  }
}
updateHud();

// ---------------------------------------------------------------
//  finale
// ---------------------------------------------------------------
const finale = { active: false, t: 0, triggered: false, lit: false };
const finaleLight = new THREE.Mesh(
  new THREE.SphereGeometry(6, 32, 24),
  new THREE.MeshBasicMaterial({ color: 0xdffff2, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
);
finaleLight.position.set(0, 26, 0);
scene.add(finaleLight);

// ---------------------------------------------------------------
//  persistent progress: restore + autosave
// ---------------------------------------------------------------
function buildSaveData(){
  return {
    version: 1,
    generator: window.generatorName || "",
    savedAt: new Date().toISOString(),
    seed,
    sigilsTaken: city.shrines.map((s, i) => (s.taken ? i : -1)).filter(i => i >= 0),
    finaleTriggered: finale.triggered,
    finaleLit: finale.lit,
    position: { x: +player.pos.x.toFixed(3), z: +player.pos.z.toFixed(3), yaw: +player.yaw.toFixed(4) },
  };
}
// `persistEnabled` is switched off right before a New City / Import reload so
// the outgoing page's pagehide/visibilitychange save can't overwrite the
// cleared/imported save.
let persistEnabled = true;
function saveNow(){
  if (!kv || !persistEnabled) return;
  writeSave(kv, buildSaveData()).catch(() => {});
}
let saveTimer = 0;
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });
window.addEventListener("pagehide", saveNow);

function applySavedProgress(){
  const saved = savedProgress;
  if (!saved || saved.seed !== seed) return;
  const shrines = city.shrines || [];
  let n = 0;
  for (const idx of saved.sigilsTaken){
    const sh = shrines[idx];
    if (!sh || sh.taken) continue;
    sh.taken = true;
    if (sh.mesh) sh.mesh.visible = false;
    if (sh.glow) sh.glow.intensity = 0;
    n++;
  }
  sigilsFound = n;
  updateHud();
  if (saved.position) player.setPosition(saved.position.x, saved.position.z, saved.position.yaw || 0);
  if (saved.finaleTriggered){
    finale.triggered = true;
    if (saved.finaleLit){
      finale.active = true;
      finale.t = 5;
      updateFinale(0);
    }
  }
  if (n > 0) toast("Run restored — " + n + " of " + CFG.sigilsRequired + " sigils reclaimed", 3600);
}
applySavedProgress();

// ---------------------------------------------------------------
//  panel: reading + dialogue
// ---------------------------------------------------------------
let reading = false;
let currentStream = null;
let streamLoader = null;
let activeSpirit = null;
let panelType = null;

function setPrompt(html){
  if (html){ promptEl.innerHTML = html; promptEl.style.opacity = "1"; }
  else { promptEl.style.opacity = "0"; }
}

function openPanel(type){
  panelType = type;
  panel.classList.add("show");
  panelFooter.innerHTML = "";
  touchUI.classList.add("reading");
  player.frozen = true;
  player.joy.active = false; player.joy.dx = 0; player.joy.dy = 0;
}
function closePanel(){
  panel.classList.remove("show");
  reading = false;
  panelType = null;
  dialogueEls = null;
  touchUI.classList.remove("reading");
  player.frozen = false;
  if (activeSpirit){ activeSpirit.talking = false; activeSpirit = null; }
  if (currentStream && currentStream.stop){ try { currentStream.stop(); } catch (e) {} }
  currentStream = null;
  if (streamLoader){ streamLoader.remove(); streamLoader = null; }
}

function showEpitaph(p){
  reading = true;
  const ward = p.ward && p.ward.name ? p.ward.name : "";
  const themeKey = p.ward && p.ward.theme ? p.ward.theme.key : "sorrow";
  const insc = factories.make(p.ward || { theme: { key: themeKey }, name: ward });
  panelHeader.textContent = "A STONE THAT REMEMBERS";
  panelText.className = "pt epitaph";
  panelText.textContent = insc.text;
  openPanel("read");
  panelFooter.textContent = (ward ? ward.toUpperCase() + " · " : "") + actLabel() + " to look away";
}

function beginStream(clear = true){
  if (clear) panelText.textContent = "";
  panelText.className = "pt";
  streamLoader = document.createElement("span");
  streamLoader.className = "loader";
  streamLoader.innerHTML = "<i></i><i></i><i></i>";
  panelText.appendChild(streamLoader);
}
function pushChunk(txt){
  if (streamLoader && streamLoader.parentNode === panelText){
    panelText.insertBefore(document.createTextNode(txt), streamLoader);
  } else {
    panelText.appendChild(document.createTextNode(txt));
  }
}
function endStream(){
  if (streamLoader){ streamLoader.remove(); streamLoader = null; }
}

async function askSpirit(s, question){
  panelHeader.textContent = s.profile.name.toUpperCase() + " · " + s.profile.ward;
  beginStream(panelType !== "talk");
  setDialogueEnabled(false);
  try {
    currentStream = await spiritSpeak(root, s.profile, question, (chunk) => pushChunk(chunk));
    endStream();
  } catch (e) {
    endStream();
    pushChunk("\n\nThe spirit's voice fades before it can answer.");
  }
  currentStream = null;
  setDialogueEnabled(true);
}

let dialogueEls = null;
function setDialogueEnabled(on){
  if (!dialogueEls) return;
  dialogueEls.input.disabled = !on;
  dialogueEls.send.disabled = !on;
  dialogueEls.send.textContent = on ? "Speak" : "…";
  if (on){ try { dialogueEls.input.focus(); } catch (e) {} }
}

function dialogueInput(){
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex; gap:8px; margin-top:6px;";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "speak to the dead…";
  input.style.cssText = "flex:1; background:rgba(0,0,0,.5); border:1px solid rgba(143,230,200,.25); color:#e6dcc6; padding:8px 10px; font-family:inherit; font-size:15px; letter-spacing:normal; text-transform:none; outline:none;";
  const send = document.createElement("button");
  send.textContent = "Speak";
  send.className = "btn";
  send.style.cssText = "padding:8px 16px; font-size:11px;";
  const submit = (e) => {
    if (e) e.preventDefault();
    const q = input.value.trim();
    if (!q || input.disabled) return;
    input.value = "";
    pushChunk("\n\nYou spoke aloud.\n\n");
    askSpirit(activeSpirit, q);
  };
  send.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); submit(); e.stopPropagation(); } });
  wrap.appendChild(input);
  wrap.appendChild(send);
  dialogueEls = { input, send };
  return wrap;
}

function talkToSpirit(s){
  activeSpirit = s;
  s.talking = true;
  reading = true;
  panelText.textContent = "";
  panelFooter.innerHTML = "";
  openPanel("talk");
  panelFooter.appendChild(dialogueInput());
  askSpirit(s, "The living wanderer approaches in silence and waits for you to speak first.");
}

function takeSigil(sh){
  if (sh.taken) return;
  sh.taken = true;
  sh.mesh.visible = false;
  sh.glow.intensity = 0;
  sigilsFound++;
  updateHud();
  saveNow();
  toast("SIGIL RECLAIMED — " + sigilsFound + " OF " + CFG.sigilsRequired);
  if (sigilsFound >= CFG.sigilsRequired){
    setTimeout(() => toast("THE SANCTUM OPENS", 3600), 900);
  }
}

// ---------------------------------------------------------------
//  target selection
// ---------------------------------------------------------------
function findTarget(){
  const px = player.pos.x, pz = player.pos.z;
  const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
  const facing = (x, z, thresh) => {
    const dx = x - px, dz = z - pz;
    const d = Math.hypot(dx, dz) || 1;
    return (dx / d) * fwdX + (dz / d) * fwdZ > thresh;
  };
  let best = null, bestScore = -1;

  for (const sh of city.shrines){
    if (sh.taken) continue;
    const d = Math.hypot(sh.x - px, sh.z - pz);
    if (d < 6 && facing(sh.x, sh.z, 0)){
      const score = 100 - d;
      if (score > bestScore){ bestScore = score; best = { type: "shrine", data: sh }; }
    }
  }
  for (const s of spirits.list){
    const d = Math.hypot(s.x - px, s.z - pz);
    if (d < 7 && facing(s.x, s.z, -0.1)){
      const score = 80 - d;
      if (score > bestScore){ bestScore = score; best = { type: "spirit", data: s }; }
    }
  }
  const rd = nearestReadable(px, pz, 4.0);
  if (rd){
    const d = Math.hypot(rd.x - px, rd.z - pz);
    if (facing(rd.x, rd.z, -0.2)){
      const score = 40 - d;
      if (score > bestScore){ bestScore = score; best = { type: "read", data: rd }; }
    }
  }
  return best;
}

function updatePrompt(target){
  if (touchOn) actBtn.classList.toggle("hot", !!target && !reading);
  if (reading){ crosshair.classList.remove("hot"); setPrompt(""); return; }
  if (!target){ crosshair.classList.remove("hot"); setPrompt(""); return; }
  crosshair.classList.add("hot");
  if (target.type === "shrine") setPrompt("<b>" + actLabel() + "</b> Take the Soul Sigil");
  else if (target.type === "spirit") setPrompt("<b>" + actLabel() + "</b> Speak with " + (target.data.profile ? target.data.profile.name : "the spirit"));
  else setPrompt("<b>" + actLabel() + "</b> Read the inscription");
}

function interact(target){
  if (!target) return;
  if (target.type === "shrine") takeSigil(target.data);
  else if (target.type === "spirit") talkToSpirit(target.data);
  else if (target.type === "read") showEpitaph(target.data);
}

// ---------------------------------------------------------------
//  navigation HUD
// ---------------------------------------------------------------
let currentWardKey = null;
function wardAt(x, z){
  const r = Math.hypot(x, z);
  if (r < 28) return { sanctum: true };
  const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
  const span = (Math.PI * 2) / CFG.avenueCount;
  const idx = Math.floor(a / span) % city.wards.length;
  return city.wards[idx];
}
function updateNavigation(){
  const w = wardAt(player.pos.x, player.pos.z);
  const key = w.sanctum ? "__sanctum" : w.index;
  if (key !== currentWardKey){
    currentWardKey = key;
    if (w.sanctum){
      bannerTitle.textContent = "The Sanctum";
      bannerSub.textContent = sigilsFound >= CFG.sigilsRequired ? "The doors stand open." : "The doors are sealed. Seven sigils remain to be found.";
    } else {
      bannerTitle.textContent = w.name;
      bannerSub.textContent = WARD_BLURBS[w.theme.key] || "";
    }
    banner.style.opacity = "1";
    clearTimeout(banner._t);
    banner._t = setTimeout(() => { banner.style.opacity = "0"; }, 4200);
  }
  const dist = Math.hypot(player.pos.x, player.pos.z);
  compassEl.textContent = (w.sanctum ? "THE SANCTUM" : (w.name || "").toUpperCase()) + "  ·  " + Math.round(dist) + "m FROM THE HEART";
}

// ---------------------------------------------------------------
//  post-processing (bloom) — optional, degrades gracefully
// ---------------------------------------------------------------
let composer = null;
async function setupPost(){
  if (!CFG.bloom){ composer = null; return; }
  try {
    const [ec, rp, ub, op] = await Promise.all([
      import("https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js"),
      import("https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js"),
      import("https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js"),
      import("https://esm.sh/three@0.160.0/examples/jsm/postprocessing/OutputPass.js"),
    ]);
    composer = new ec.EffectComposer(renderer);
    composer.addPass(new rp.RenderPass(scene, camera));
    const bloom = new ub.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new op.OutputPass());
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1.0 : 1.5));
  } catch (e) {
    console.warn("Post-processing unavailable, using direct render:", e);
    composer = null;
  }
}

// ---------------------------------------------------------------
//  input wiring
// ---------------------------------------------------------------
function requestLock(){
  const el = renderer.domElement;
  if (!el.requestPointerLock) return;
  try {
    const p = el.requestPointerLock();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {}
}
document.getElementById("enterBtn").addEventListener("click", () => {
  menuEl.classList.add("hidden");
  hudEl.classList.add("show");
  soundtrack.play("explore");
  refreshTouch();
  requestLock();
  if (touchOn) setTimeout(() => toast("Drag to look · joystick to move · ACT to interact", 4200), 600);
});
document.getElementById("regenBtn").addEventListener("click", async () => {
  persistEnabled = false;
  try { await clearSave(kv); } catch (e) {}
  try { sessionStorage.setItem("np-seed", String((Math.random() * 1e9) | 0)); } catch (e) {}
  location.reload();
});

// ---------------------------------------------------------------
//  save-file export / import
// ---------------------------------------------------------------
const importFile = document.getElementById("importFile");
function exportSave(){
  try {
    const data = buildSaveData();
    const blob = new Blob([serializeSave(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (window.generatorName || "necropolis") + "-" + seedHex(seed) + ".save.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Progress exported", 2600);
  } catch (e) { toast("Export failed", 3000); }
}
async function importFromFile(file){
  try {
    const save = parseSaveText(await file.text());
    if (CFG.seed && CFG.seed !== save.seed){
      toast("That save belongs to a different city than the pinned seed", 4400);
      return;
    }
    const ok = await writeSave(kv, save);
    if (!ok) throw new Error("storage is unavailable");
    try { sessionStorage.setItem("np-seed", String(save.seed)); } catch (e) {}
    persistEnabled = false;
    toast("Importing " + save.sigilsTaken.length + "-sigil run…", 2000);
    setTimeout(() => location.reload(), 500);
  } catch (e) {
    toast("Import failed: " + (e && e.message ? e.message : "unknown error"), 4400);
  }
}
function pickImportFile(){ importFile.value = ""; importFile.click(); }
importFile.addEventListener("change", () => {
  const f = importFile.files && importFile.files[0];
  if (f) importFromFile(f);
});
for (const id of ["exportSaveBtn", "pauseExportBtn"]){
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", (e) => { e.stopPropagation(); exportSave(); });
}
for (const id of ["importSaveBtn", "pauseImportBtn"]){
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", (e) => { e.stopPropagation(); pickImportFile(); });
}
pauseEl.addEventListener("click", () => requestLock());
document.addEventListener("pointerlockchange", () => {
  const locked = controls.isLocked();
  if (!locked && menuEl.classList.contains("hidden") && !reading && panelType === null){
    pauseEl.classList.add("show");
  } else {
    pauseEl.classList.remove("show");
  }
  refreshTouch();
});
renderer.domElement.addEventListener("click", () => {
  if (!touchOn && menuEl.classList.contains("hidden") && !controls.isLocked() && !reading) requestLock();
});
window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.code === "KeyE"){
    if (reading){ closePanel(); }
    else { interact(findTarget()); }
  }
});
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// prevent the movement keys scrolling
window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------
//  main loop
// ---------------------------------------------------------------
const clock = new THREE.Clock();
const NO_KEYS = {};
let targetTimer = 0;
let target = null;
let navTimer = 0;
const moonDir = atmo.moonDir;

function updateFinale(dt){
  if (finale.active){
    finale.t += dt;
    const k = Math.min(1, finale.t / 5);
    finaleLight.material.opacity = k * 0.9;
    finaleLight.scale.setScalar(1 + k * 6);
    atmo.setFogDensity(CFG.fogDensity * (1 - k * 0.65));
    renderer.toneMappingExposure = 1.05 + k * 0.7;
    finale.lit = true;
  }
  const distHeart = Math.hypot(player.pos.x, player.pos.z);
  if (finale.triggered && finale.lit && distHeart > 70){
    // walked away from the Sanctum — restore the world so the finale's
    // brightening/thinning fog don't persist for the rest of the session
    finale.lit = false;
    finale.active = false;
    atmo.setFogDensity(CFG.fogDensity);
    renderer.toneMappingExposure = 1.3;
    finaleLight.material.opacity = 0;
  }
  if (finale.triggered && distHeart > 70) soundtrack.play("explore");
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  const activeKeys = reading ? NO_KEYS : controls.keys;
  player.update(dt, activeKeys);
  if (touchOn){
    const r = 40;
    joyKnob.style.transform = "translate(-50%,-50%) translate(" + (player.joy.dx * r).toFixed(1) + "px," + (player.joy.dy * r).toFixed(1) + "px)";
  }
  spirits.update(dt, t, player.pos);

  // sigil spin
  for (const sh of city.shrines){
    if (!sh.taken){
      sh.mesh.rotation.z = t * 0.8;
      sh.mesh.rotation.y = t * 0.4;
      sh.mesh.position.y = sh.y + Math.sin(t * 1.4) * 0.25;
      sh.glow.position.y = sh.mesh.position.y;
    }
  }

  // moonlight follows the player so shadows stay crisp nearby
  atmo.moonLight.position.set(
    player.pos.x + moonDir.x * 300,
    moonDir.y * 300,
    player.pos.z + moonDir.z * 300
  );
  atmo.moonLight.target.position.set(player.pos.x, 0, player.pos.z);
  atmo.moonLight.target.updateMatrixWorld();

  atmo.update(dt, t, player.pos, camera);

  // targeting, throttled
  targetTimer -= dt;
  if (targetTimer <= 0){
    targetTimer = 0.1;
    target = reading ? null : findTarget();
    updatePrompt(target);
  }

  navTimer -= dt;
  if (navTimer <= 0){ navTimer = 0.35; updateNavigation(); }

  saveTimer -= dt;
  if (saveTimer <= 0){ saveTimer = 6; saveNow(); }

  // finale
  if (!finale.triggered && sigilsFound >= CFG.sigilsRequired){
    const d = Math.hypot(player.pos.x, player.pos.z);
    if (d < 8){
      finale.triggered = true;
      finale.active = true;
      saveNow();
      soundtrack.play("sanctum");
      flashEl.style.opacity = "1";
      setTimeout(() => { flashEl.style.opacity = "0"; }, 1200);
      reading = true;
      panelHeader.textContent = "THE HEART OF THE CITY";
      beginStream();
      panelFooter.textContent = actLabel() + " to look away";
      openPanel("read");
      if (typeof root.generateText === "function"){
        try {
          root.generateText({
            instruction:
              "You are the voice of Necropolis Prime, the first city of the dead, speaking at last to a mortal who gathered the seven sigils and has just climbed the Sanctum's steps to stand before its sealed doors. In four to six short, solemn, beautiful sentences, reveal what the city truly is and what the sigils were — the dead were not imprisoned here, they were keeping something in, or the city is a memory that someone is dreaming, or every stone is a soul that chose to become architecture. Speak in second person to the wanderer. Do not use stage directions.",
            onChunk: (d) => pushChunk(d.textChunk || ""),
          }).then(() => { endStream(); }).catch(() => { endStream(); });
        } catch (e) { endStream(); pushChunk("The city says nothing. Perhaps it cannot, with words."); }
      } else {
        endStream();
        pushChunk("You have reached the heart of the city. The sigils were never keys. They were the last seven souls who still remembered being alive, and by carrying them here you have finally let the city rest.");
      }
    }
  }
  updateFinale(dt);

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// debug handle (harmless; handy for tuning from the console)
window.__np = {
  THREE, scene, camera, renderer, city, atmo, player, spirits, geos, mats, CFG, soundtrack, controls,
  get composer(){ return composer; },
  debug: { findTarget, interact, takeSigil, talkToSpirit, showEpitaph, closePanel, updateFinale,
    saveNow, buildSaveData, exportSave, importFromFile, seedHex,
    setPersist(v){ persistEnabled = !!v; },
    get seed(){ return seed; },
    get savedProgress(){ return savedProgress; },
    get sigilsFound(){ return sigilsFound; }, set sigilsFound(v){ sigilsFound = v; updateHud(); },
    get finale(){ return finale; } },
};

// ---------------------------------------------------------------
//  go
// ---------------------------------------------------------------
(async function start(){
  setProgress(0.98, "LIGHTING THE LAMPS");
  await setupPost();
  animate();
  setProgress(1, "READY");
  setTimeout(() => loadingEl.classList.add("hidden"), 400);
})();
