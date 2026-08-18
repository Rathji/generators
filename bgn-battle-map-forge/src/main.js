import { App } from "./app.js";
import { computeVisibility } from "./los.js";
import { hasLocalSave, clearLocalSave } from "./local.js";

const ui = {
  canvas: document.getElementById("mapCanvas"),
  container: document.getElementById("main"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  hintText: document.getElementById("hintText"),
  connDot: document.getElementById("connDot"),
  connText: document.getElementById("connText"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  fitBtn: document.getElementById("fitBtn"),
  zoomTokenBtn: document.getElementById("zoomTokenBtn"),
  playerViewBtn: document.getElementById("playerViewBtn"),
  banner: document.getElementById("banner"),
  toast: document.getElementById("toast"),
  tabBtns: [...document.querySelectorAll(".tabs button")],
  panels: [...document.querySelectorAll(".panel")],
  chatLog: document.getElementById("chatLog"),
  chatInput: document.getElementById("chatInput"),
  chatSendBtn: document.getElementById("chatSendBtn"),
  nameInput: document.getElementById("nameInput"),
  nameSaveBtn: document.getElementById("nameSaveBtn"),
  dmBox: document.getElementById("dmBox"),
  playerList: document.getElementById("playerList"),
  importInput: document.getElementById("importInput"),
  importBtn: document.getElementById("importBtn"),
  defaultChars: document.getElementById("defaultChars"),
  npcChars: document.getElementById("npcChars"),
  monsterChars: document.getElementById("monsterChars"),
  bossChars: document.getElementById("bossChars"),
  initList: document.getElementById("initList"),
  initAddSel: document.getElementById("initAddSel"),
  initAddBtn: document.getElementById("initAddBtn"),
  initNextBtn: document.getElementById("initNextBtn"),
  initSortBtn: document.getElementById("initSortBtn"),
  initNowRow: document.getElementById("initNowRow"),
  initNowEl: document.getElementById("initNowEl"),
  sidebarFloatBtn: document.getElementById("sidebarFloatBtn"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop"),
  mapPicker: document.getElementById("mapPicker"),
  mapFileInput: document.getElementById("mapFileInput"),
  mapUploadBtn: document.getElementById("mapUploadBtn"),
  hostNameEl: document.getElementById("hostNameEl"),
  hostSubEl: document.getElementById("hostSubEl"),
  guestNameEl: document.getElementById("guestNameEl"),
  guestSubEl: document.getElementById("guestSubEl"),
  turnEl: document.getElementById("turnEl"),
  roomCodeEl: document.getElementById("roomCodeEl"),
  newGameBtn: document.getElementById("newGameBtn"),
  logEl: document.getElementById("logEl")
};

window.__ui = ui;
window.__createApp = (opts) => {
  if (window.__app) {
    try { window.__app.destroy(); } catch (e) {}
  }
  const app = new App(window.root, ui, opts);
  window.__app = app;
  return app;
};
window.__los = computeVisibility;
window.__hasLocalSave = hasLocalSave;
window.__clearLocalSave = clearLocalSave;
