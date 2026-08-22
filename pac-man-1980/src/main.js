import { Game } from "./engine.js";
import { drawFruit, fruitTypeForLevel, fruitPoints } from "./fruit.js";

const $ = (id) => document.getElementById(id);
const levelIntroFruitsEl = $("levelIntroFruitsEl");

window.pm80 = new Game({
  canvas: $("gameCanvas"),
  stage: $("stage"),
  scoreEl: $("scoreEl"),
  highScoreEl: $("highScoreEl"),
  livesEl: $("livesEl"),
  highScoreTitleEl: $("highScoreTitleEl"),
  goScoreEl: $("goScoreEl"),
  newHighEl: $("newHighEl"),
  levelIntroTitleEl: $("levelIntroTitleEl"),
  overlays: {
    title: $("titleOverlay"),
    ready: $("readyOverlay"),
    pause: $("pauseOverlay"),
    gameover: $("gameoverOverlay"),
    levelIntro: $("levelIntroOverlay")
  },
  soundBtn: $("soundBtn"),
  fullscreenBtn: $("fullscreenBtn"),
  crtBtn: $("crtBtn"),
  crtOverlay: $("crtOverlay"),
  onLevelIntro: (level) => {
    levelIntroFruitsEl.innerHTML = "";
    const type = fruitTypeForLevel(level);
    const wrap = document.createElement("div");
    wrap.className = "level-fruit";
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    c.setAttribute("aria-hidden", "true");
    wrap.appendChild(c);
    const label = document.createElement("span");
    label.textContent = String(fruitPoints(type)).padStart(4, "0");
    wrap.appendChild(label);
    levelIntroFruitsEl.appendChild(wrap);
    drawFruit(c.getContext("2d"), type, 32, 36);
  }
});

window.pm80StartLevel = (n) => window.pm80.startAtLevel(n);

$("soundBtn").addEventListener("click", () => window.pm80.toggleMuted());
$("crtBtn").addEventListener("click", () => window.pm80.toggleCrt());
$("fullscreenBtn").addEventListener("click", () => window.pm80.toggleFullscreen());

const modal = $("roadmapModal");
const openRoadmap = () => { modal.hidden = false; };
const closeRoadmap = () => { modal.hidden = true; };
$("roadmapBtn").addEventListener("click", openRoadmap);
$("closeRoadmapBtn").addEventListener("click", closeRoadmap);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeRoadmap();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeRoadmap();
});
