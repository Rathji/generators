import { App } from "./app.js";
import { hasLocalSave, clearLocalSave } from "./local.js";

const ui = {
  toast: document.getElementById("toast"),
  initList: document.getElementById("initList"),
  initNextBtn: document.getElementById("initNextBtn"),
  initSortBtn: document.getElementById("initSortBtn"),
  initNowRow: document.getElementById("initNowRow"),
  initNowEl: document.getElementById("initNowEl"),
  initRoundEl: document.getElementById("initRoundEl"),
  addCombatantBtn: document.getElementById("addCombatantBtn"),
  addPanel: document.getElementById("addPanel"),
  diceBtn: document.getElementById("diceBtn"),
  dicePanel: document.getElementById("dicePanel"),
  diceLog: document.getElementById("diceLog"),
  diceCount: document.getElementById("diceCount"),
  diceMod: document.getElementById("diceMod"),
  diceAdv: document.getElementById("diceAdv"),
  diceClearBtn: document.getElementById("diceClearBtn"),
  dieBtns: [...document.querySelectorAll(".dieBtn")],
  diceActor: document.getElementById("diceActor"),
  diceTargetSel: document.getElementById("diceTargetSel"),
  attackBtn: document.getElementById("attackBtn"),
  saveBtn: document.getElementById("saveBtn"),
  checkBtn: document.getElementById("checkBtn"),
  diceSaveSel: document.getElementById("diceSaveSel"),
  diceCheckSel: document.getElementById("diceCheckSel"),
  diceCheckMod: document.getElementById("diceCheckMod"),
  diceTypeSel: document.getElementById("diceTypeSel"),
  diceSaveRow: document.getElementById("diceSaveRow"),
  diceCheckRow: document.getElementById("diceCheckRow"),
  diceCheckModRow: document.getElementById("diceCheckModRow"),
  csAc: document.getElementById("csAc"),
  csAtk: document.getElementById("csAtk"),
  csDmg: document.getElementById("csDmg"),
  csImm: document.getElementById("csImm"),
  csRes: document.getElementById("csRes"),
  csVuln: document.getElementById("csVuln"),
  csGroup: document.getElementById("csGroup"),
  csConc: document.getElementById("csConc"),
  csApplyBtn: document.getElementById("csApplyBtn"),
  csDeathBox: document.getElementById("csDeathBox"),
  csProf: document.getElementById("csProf"),
  csCondImm: document.getElementById("csCondImm"),
  csLangs: document.getElementById("csLangs"),
  csHd: document.getElementById("csHd"),
  hdRollBtn: document.getElementById("hdRollBtn"),
  abilScores: (() => {
    const m = {};
    for (const el of document.querySelectorAll(".abilScore")) m[el.dataset.a] = el;
    return m;
  })(),
  abilMods: (() => {
    const m = {};
    for (const el of document.querySelectorAll(".abilMod")) m[el.dataset.a] = el;
    return m;
  })(),
  saveChips: [...document.querySelectorAll(".saveChip")],
  skillGrid: document.getElementById("skillGrid"),
  encName: document.getElementById("encName"),
  encSaveBtn: document.getElementById("encSaveBtn"),
  encSel: document.getElementById("encSel"),
  encAddBtn: document.getElementById("encAddBtn"),
  encDelBtn: document.getElementById("encDelBtn"),
  importInput: document.getElementById("importInput"),
  importBtn: document.getElementById("importBtn"),
  defaultChars: document.getElementById("defaultChars"),
  npcChars: document.getElementById("npcChars"),
  bossChars: document.getElementById("bossChars"),
  compSearch: document.getElementById("compSearch"),
  compFilter: document.getElementById("compFilter"),
  compGrid: document.getElementById("compGrid"),
  effectsOverlay: document.getElementById("effectsOverlay"),
  effectsCloseBtn: document.getElementById("effectsCloseBtn"),
  effectsTitleEl: document.getElementById("effectsTitleEl"),
  effectsSubEl: document.getElementById("effectsSubEl"),
  effectsListEl: document.getElementById("effectsListEl"),
  effNameInput: document.getElementById("effNameInput"),
  effTypeSel: document.getElementById("effTypeSel"),
  effStatSel: document.getElementById("effStatSel"),
  effBonusInput: document.getElementById("effBonusInput"),
  effDurSel: document.getElementById("effDurSel"),
  effDurInput: document.getElementById("effDurInput"),
  effCondsEl: document.getElementById("effCondsEl"),
  effAddBtn: document.getElementById("effAddBtn"),
  hpInput: document.getElementById("hpInput"),
  maxHpInput: document.getElementById("maxHpInput"),
  hpApplyBtn: document.getElementById("hpApplyBtn"),
  hpQuickBtns: [...document.querySelectorAll(".hpQ")]
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
window.__hasLocalSave = hasLocalSave;
window.__clearLocalSave = clearLocalSave;
