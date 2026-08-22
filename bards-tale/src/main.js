// A Bard's Tale — app shell: screens, party creation, dungeon controls,
// character sheets, minimap, encounter/combat flow. Modules imported from
// ./engine.js, ./party.js, ./combat.js, ./renderer.js.

import {
  createGameState, generateMap, tryMove, turn, enterDungeon, placePlayerAtStart,
  interact, tileAhead, addMessage, revealAround, descend, DX, DY,
  TILE_WALL, TILE_DOOR, TILE_DOOR_LOCKED, TILE_CHEST, TILE_TRAP, TILE_EXIT,
  TILE_FLOOR, TILE_DARK, TILE_PIT, TILE_VALVE, TILE_GATE,
} from "./engine.js";
import { loadRaces, loadClasses, rollStats, createCharacter, addPartyMember, removePartyMember, partySummary, STAT_ORDER, equipAttackBonus, equipAcBonus, effectiveAc, effectiveAttack } from "./party.js";
import { loadMonsters, spawnMonsters, spawnBoss, buildTurnQueue, computeHit, partyDamage, monsterDamageRoll, actorAlive, rollDamage } from "./combat.js";
import { loadSpells, getKnownSpells, spellTierForLevel, applySpellEffect } from "./spells.js";
import { serializeState, deserializeState } from "./save.js";
import { initCanvas, renderScene } from "./renderer.js";
import { sfx, playMusic, stopMusic, setTrack, setMuted, isMuted, toggleMute, ensureAudio, currentMusic } from "./audio.js";

// Background music — uploaded MP3s. (Task 42)
setTrack("dungeon", "https://user.uploads.dev/file/3ab99f9ad3cccbbad28b87348651d839.mp3");
setTrack("boss", "https://user.uploads.dev/file/cd551d970a4e47ad6afe8eb87940cf48.mp3");
setTrack("town", "https://user.uploads.dev/file/1a84a4c8b008bd17730a06bafe73d7b3.mp3");

const races = loadRaces();
const classes = loadClasses();
const state = createGameState();

// Pull user-tweakable config from main.pjs.
(function applyConfig() {
  const cfg = root.gameConfig;
  if (cfg) {
    state.baseLight = Number(cfg.lightRadius) || 9;
    state.lightRadius = state.baseLight;
    state.encounterChance = Number(cfg.encounterChance);
    if (Number.isNaN(state.encounterChance)) state.encounterChance = 0.14;
  }
})();

let screen = "title";
let recruitMode = false;
let canvasInfo = null;

const NAMES = ["Aran", "Brenna", "Cedric", "Doria", "Elias", "Fenna", "Gavin", "Hilda", "Ivor", "Kira", "Lark", "Mirek", "Nessa", "Orin", "Petra", "Rowan", "Sable", "Torin", "Una", "Varek", "Wyn", "Yara", "Zane"];

function show(name) {
  const screenIds = ["screenTitle", "screenCreate", "screenRoster", "screenDungeon", "screenTown", "screenVictory"];
  const target = "screen" + name[0].toUpperCase() + name.slice(1);
  for (const id of screenIds) {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== target;
  }
  screen = name;
  if (name === "dungeon") {
    canvasInfo.resize();
    if (!state.running) enterDungeon(state);
    startLoop();
  } else if (name === "town") {
    renderTown(state);
  }
  if (name === "town" || name === "roster" || name === "victory") playMusic("town");
  else if (name === "dungeon") playMusic("dungeon");
  else stopMusic();
}

let looping = false;
function startLoop() {
  if (looping) return;
  looping = true;
  requestAnimationFrame(dungeonLoop);
}

// ── Title screen ────────────────────────────────────────────────
document.getElementById("startBtn").addEventListener("click", () => {
  ensureAudio();
  sfx.click();
  recruitMode = false;
  buildCreateScreen();
  show("create");
});

// ── Audio ───────────────────────────────────────────────────────
let sfxOn = !isMuted();
function updateMuteButtons() {
  const muted = isMuted();
  for (const b of document.querySelectorAll(".muteBtn")) b.textContent = muted ? "🔇 Muted" : "🔊 Sound";
}
function bindMute(btn) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    ensureAudio();
    toggleMute();
    updateMuteButtons();
  });
}
bindMute(document.getElementById("muteBtn"));
bindMute(document.getElementById("muteBtnHud"));
updateMuteButtons();

// Engine hooks for one-shot sounds and the final-boss chamber.
state.onSound = (st, label) => { if (sfx[label]) sfx[label](); };
state.onExit = (st) => {
  if (st.floor >= st.bossFloor && !st.bossDefeated && !st.combat) { startBossFight(); return "handled"; }
  return "descend";
};

// Run-time stat: seconds spent in town or the dungeon.
let lastTick = Date.now();
setInterval(() => {
  if (screen === "dungeon" || screen === "town") state.stats.secondsPlayed += Math.round((Date.now() - lastTick) / 1000);
  lastTick = Date.now();
}, 1000);

// Visual feedback: screen shake + a red flash overlay when blows land.
function fxShake() {
  const wrap = document.querySelector(".view-wrap");
  if (!wrap) return;
  wrap.classList.remove("shake");
  void wrap.offsetWidth;
  wrap.classList.add("shake");
}
function fxFlash(color) {
  const el = document.getElementById("hitFlash");
  if (!el) return;
  el.style.background = color || "rgba(255,70,70,0.32)";
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}
function flashCard(uid) {
  const el = document.querySelector('.cmon[data-uid="' + uid + '"]');
  if (el) { el.classList.add("flashcard"); setTimeout(() => el.classList.remove("flashcard"), 340); }
}

// ── Create-party screen ─────────────────────────────────────────
function buildCreateScreen() {
  const ctn = document.getElementById("createCtn");
  ctn.innerHTML = "";
  const sub = document.querySelector("#screenCreate .subhead");
  if (sub) {
    sub.querySelector("h2").textContent = recruitMode ? "Recruit an Adventurer" : "Assemble Your Company";
    sub.querySelector("p").textContent = recruitMode
      ? "A new face for the company. Room is limited to four in arms."
      : "Roll up to four adventurers, then descend into the dark.";
  }
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const div = document.createElement("div");
    div.className = "slot";
    div.innerHTML =
      '<h3>Adventurer ' + (i + 1) + "</h3>" +
      '<label>Name <input class="nameInput" maxlength="18" placeholder="—"></label>' +
      '<label>Race <select class="raceSel"></select></label>' +
      '<label>Class <select class="classSel"></select></label>' +
      '<div class="statsBox"></div>' +
      '<button type="button" class="rerollBtn ghost">Reroll Stats</button>';
    ctn.appendChild(div);
    slots.push({ div, i, rolls: null });
  }

  function fillStatBlock(div, rolls, raceId, classId) {
    const race = races.find(r => r.id === raceId);
    const cls = classes.find(c => c.id === classId);
    const box = div.querySelector(".statsBox");
    if (!race || !cls) { box.innerHTML = ""; return; }
    const final = {}, mods = {};
    for (const s of STAT_ORDER) {
      const v = Math.max(1, rolls[s] + race.mods[s] + cls.mods[s]);
      final[s] = v;
      mods[s] = Math.floor((v - 10) / 2);
    }
    const hp = Math.max(1, cls.hpBase + mods.CON);
    const ac = 10 + mods.DEX + cls.acBonus;
    const mana = Math.max(0, cls.manaBase + mods.INT * 2);
    box.innerHTML =
      '<div class="statrow">' + STAT_ORDER.map(s =>
        '<span><b>' + s + '</b> ' + final[s] + ' <em>' + (mods[s] >= 0 ? "+" + mods[s] : mods[s]) + "</em></span>"
      ).join("") + "</div>" +
      '<div class="derived">HP <b>' + hp + "</b> · AC <b>" + ac + "</b> · MP <b>" + mana + "</b></div>";
    return { final, mods, hp, ac, mana };
  }

  for (const slot of slots) {
    const raceSel = slot.div.querySelector(".raceSel");
    for (const r of races) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.name;
      raceSel.appendChild(opt);
    }
    raceSel.addEventListener("change", () => {
      fillClassOptions(slot.div);
      refresh(slot);
    });
    slot.div.querySelector(".classSel").addEventListener("change", () => refresh(slot));
    slot.div.querySelector(".rerollBtn").addEventListener("click", () => {
      slot.rolls = rollStats();
      refresh(slot);
    });
    slot.rolls = rollStats();
    fillClassOptions(slot.div);
    refresh(slot);
  }

  function fillClassOptions(div) {
    const raceId = div.querySelector(".raceSel").value;
    const race = races.find(r => r.id === raceId);
    const sel = div.querySelector(".classSel");
    const prev = sel.value;
    sel.innerHTML = "";
    for (const cid of race.allowedClasses) {
      const cls = classes.find(c => c.id === cid);
      const opt = document.createElement("option");
      opt.value = cid;
      opt.textContent = cls.name;
      sel.appendChild(opt);
    }
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  }

  function refresh(slot) {
    const raceId = slot.div.querySelector(".raceSel").value;
    const classId = slot.div.querySelector(".classSel").value;
    if (!slot.rolls) slot.rolls = rollStats();
    fillStatBlock(slot.div, slot.rolls, raceId, classId);
  }

  document.getElementById("finalizeBtn").textContent = recruitMode ? "Hire" : "Finalize Party";
  document.getElementById("finalizeBtn").onclick = () => finalizeParty();
  document.getElementById("backTitleBtn").onclick = () => {
    if (recruitMode) { recruitMode = false; show("town"); renderTown(state); }
    else show("title");
  };
}

function finalizeParty() {
  const slots = [...document.querySelectorAll("#screenCreate .slot")];
  const created = [];
  for (const div of slots) {
    const name = div.querySelector(".nameInput").value.trim();
    if (!name) continue;
    const raceId = div.querySelector(".raceSel").value;
    const classId = div.querySelector(".classSel").value;
    created.push(createCharacter(name, raceId, classId, rollStats()));
  }
  if (!created.length) return;
  if (recruitMode) {
    for (const ch of created) {
      if (state.party.length >= 4) break;
      state.party.push(ch);
    }
    recruitMode = false;
    buildRosterScreen();
    renderTown(state);
    show("town");
    return;
  }
  state.party = created;
  buildRosterScreen();
  show("roster");
}

// ── Roster screen ───────────────────────────────────────────────
function buildRosterScreen() {
  const ctn = document.getElementById("rosterCtn");
  ctn.innerHTML = "";
  state.party.forEach((m, i) => {
    const card = document.createElement("div");
    card.className = "member";
    card.dataset.index = i;
    card.innerHTML =
      '<div class="m-head"><b>' + m.name + "</b><span>" + m.raceName + " · " + m.className + "</span></div>" +
      '<div class="m-stats">Lvl <b>' + m.level + '</b> · HP <b>' + m.hp + "/" + m.maxHp +
      "</b> · MP <b>" + m.mana + "/" + m.maxMana + "</b> · AC <b>" + m.ac + "</b></div>" +
      '<div class="m-rolls">' + STAT_ORDER.map(s => s + " " + m.stats[s]).join("  ") + "</div>" +
      '<div class="m-actions">' +
        '<button type="button" class="upBtn ghost">▲</button>' +
        '<button type="button" class="downBtn ghost">▼</button>' +
        '<button type="button" class="removeBtn ghost">Dismiss</button>' +
      "</div>";
    card.querySelector(".upBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (i > 0) { swapPartyMembers(i, i - 1); buildRosterScreen(); }
    });
    card.querySelector(".downBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (i < state.party.length - 1) { swapPartyMembers(i, i + 1); buildRosterScreen(); }
    });
    card.querySelector(".removeBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      removePartyMember(state, i);
      buildRosterScreen();
    });
    card.addEventListener("click", () => openCharacterSheet(i));
    ctn.appendChild(card);
  });
  const enterBtn = document.getElementById("enterBtn");
  enterBtn.disabled = state.party.length === 0;
  document.getElementById("backCreateBtn").onclick = () => {
    buildCreateScreen();
    show("create");
  };
}

document.getElementById("enterBtn").addEventListener("click", () => {
  if (!state.party.length) return;
  show("dungeon");
});

document.getElementById("townBtn").addEventListener("click", () => {
  if (!state.party.length) return;
  renderTown(state);
  show("town");
});

function swapPartyMembers(a, b) {
  const t = state.party[a];
  state.party[a] = state.party[b];
  state.party[b] = t;
}

// ── Character sheet modal (task 11) ─────────────────────────────
const sheetModal = document.getElementById("sheetModal");
const sheetBody = document.getElementById("sheetBody");

function openCharacterSheet(index) {
  const m = state.party[index];
  if (!m) return;
  const race = races.find(r => r.id === m.raceId);
  const cls = classes.find(c => c.id === m.classId);
  sheetBody.innerHTML =
    '<div class="sheet-head"><h3>' + m.name + '</h3><span>' + m.raceName + " · " + m.className + " · Lvl " + m.level + "</span></div>" +
    '<div class="sheet-bars">HP <b>' + m.hp + "/" + m.maxHp + '</b> · MP <b>' + m.mana + "/" + m.maxMana + '</b> · AC <b>' + effectiveAc(m) + '</b> · Atk <b>+' + effectiveAttack(m) + "</b> · XP <b>" + m.xp + "</b></div>" +
    '<div class="sheet-stats">' + STAT_ORDER.map(s =>
      '<span><b>' + s + '</b> ' + m.stats[s] + ' <em>' + (m.mods[s] >= 0 ? "+" + m.mods[s] : m.mods[s]) + "</em></span>"
    ).join("") + "</div>" +
    '<div class="sheet-equip"><h4>Equipment</h4>' +
    ([["head", "Head"], ["body", "Body"], ["weapon", "Weapon"], ["offhand", "Off-Hand"], ["light", "Light"]].map(([slot, label]) => {
      const it = (m.equipment || {})[slot];
      return '<div class="sheet-equip-row"><span>' + label + "</span><b>" + (it ? it.name : "—") + "</b></div>";
    }).join("")) + "</div>" +
    '<div class="sheet-desc"><p>' + (race ? race.desc : "") + "</p><p>" + (cls ? cls.desc : "") + "</p></div>";
  sheetModal.hidden = false;
}

sheetModal.addEventListener("click", (e) => {
  if (e.target === sheetModal || e.target.closest("#sheetCloseBtn")) sheetModal.hidden = true;
});

// ── Dungeon screen ──────────────────────────────────────────────
const canvas = document.getElementById("gameCanvas");
canvasInfo = initCanvas(canvas);

function dungeonLoop() {
  if (screen !== "dungeon") { looping = false; return; }
  if (!state.combat) renderScene(canvasInfo, state);
  updateHud();
  requestAnimationFrame(dungeonLoop);
}

const FACING_GLYPH = ["N", "E", "S", "W"];

function updateHud() {
  const p = state.player;
  const coordsEl = document.getElementById("coordsEl");
  if (coordsEl) coordsEl.textContent = state.mapName + " · floor " + state.floor + " · (" + p.x + "," + p.y + ")";
  const compassEl = document.getElementById("compassEl");
  if (compassEl) compassEl.textContent = "Facing " + FACING_GLYPH[p.facing];
  const hud = document.getElementById("partyHud");
  if (hud) {
    hud.innerHTML = state.party.map((m, i) =>
      '<div class="pcard" data-index="' + i + '"><span class="pname">' + m.name + ' <em>' + m.className + "</em></span>" +
      '<span class="pv">HP <b>' + m.hp + "/" + m.maxHp + '</b> · MP <b>' + m.mana + "/" + m.maxMana + '</b> · AC <b>' + m.ac + "</b></span></div>"
    ).join("");
    hud.querySelectorAll(".pcard").forEach(card => {
      card.addEventListener("click", () => openCharacterSheet(Number(card.dataset.index)));
    });
  }
  const goldEl = document.getElementById("goldEl");
  if (goldEl) goldEl.textContent = "Gold " + state.gold + " · Keys " + state.keys;
  const msgLog = document.getElementById("msgLog");
  if (msgLog) msgLog.innerHTML = state.messages.slice(-6).map(t => "<div>" + t + "</div>").join("");
  drawMinimap();
}

// Auto-map: fog-of-war minimap showing explored cells and revealed walls.
function drawMinimap() {
  const cv = document.getElementById("minimapCanvas");
  if (!cv || !state.currentMap) return;
  const cell = 8;
  const grid = state.currentMap.grid;
  cv.width = grid[0].length * cell;
  cv.height = grid.length * cell;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0a0c16";
  ctx.fillRect(0, 0, cv.width, cv.height);

  const show = new Set(state.visited);
  for (const key of state.revealed) show.add(key);

  for (const key of show) {
    const [x, y] = key.split(",").map(Number);
    const row = grid[y];
    if (!row || row[x] === undefined) continue;
    const t = row[x];
    if (t === TILE_WALL) ctx.fillStyle = "#5268ad";
    else if (t === TILE_DOOR) ctx.fillStyle = "#c9973f";
    else if (t === TILE_DOOR_LOCKED) ctx.fillStyle = "#e05c52";
    else if (t === TILE_CHEST) ctx.fillStyle = "#f0c860";
    else if (t === TILE_TRAP) ctx.fillStyle = "#c75a4a";
    else if (t === TILE_PIT) ctx.fillStyle = "#7a2f2f";
    else if (t === TILE_DARK) ctx.fillStyle = "#05040c";
    else if (t === TILE_VALVE) ctx.fillStyle = "#8aa84a";
    else if (t === TILE_GATE) ctx.fillStyle = "#9670b8";
    else if (t === TILE_EXIT) ctx.fillStyle = "#54c07a";
    else ctx.fillStyle = "#182540";
    ctx.fillRect(x * cell, y * cell, cell, cell);
  }
  const p = state.player;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
}

// ── Movement / input ────────────────────────────────────────────
// Movement triggers encounters via state.onMove (fired by engine.tryMove).
function maybeEncounter() {
  if (state.combat) return;
  if (debugForceEncounter || Math.random() < state.encounterChance) startCombat();
}
state.onMove = maybeEncounter;

let debugForceEncounter = false;

function doAction(act) {
  if (screen !== "dungeon") return;
  if (state.combat) return;
  if (act === "forward" || act === "back" || act === "left" || act === "right") {
    if (tryMove(state, act)) {
      sfx.step();
      if (state.floor === state.bossFloor && !state.bossDefeated && !state.combat) {
        addMessage(state, "The air grows still. Below, a single chord is held, waiting.");
      }
    }
  }
  else if (act === "turnLeft") { turn(state, -1); sfx.turn(); }
  else if (act === "turnRight") { turn(state, 1); sfx.turn(); }
  else if (act === "interact") {
    if (tileAhead(state) === TILE_GATE) openGatePrompt();
    else if (interact(state)) sfx.click();
  }
}

document.addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === "Escape" && !helpModal.hidden) { e.preventDefault(); helpModal.hidden = true; return; }
  if (state.combat) {
    if (k === "Enter" || k === " ") { e.preventDefault(); partyAttackFirstTarget(); }
    else if (k === "f" || k === "F") { e.preventDefault(); partyFlee(); }
    return;
  }
  if (!gateModal.hidden) {
    if (k === "Enter") { e.preventDefault(); submitGateAnswer(); }
    else if (k === "Escape") { e.preventDefault(); gateModal.hidden = true; currentGateRiddle = null; }
    return;
  }
  if (!invModal.hidden) {
    if (k === "Escape") { e.preventDefault(); invModal.hidden = true; }
    return;
  }
  const map = {
    ArrowUp: "forward", ArrowDown: "back", ArrowLeft: "turnLeft", ArrowRight: "turnRight",
    w: "forward", W: "forward", s: "back", S: "back",
    a: "turnLeft", A: "turnLeft", d: "turnRight", D: "turnRight",
    q: "left", Q: "left",
  };
  const act = map[k];
  if (act) { e.preventDefault(); doAction(act); return; }
  if (k === "e" || k === "E") { e.preventDefault(); doAction("interact"); }
});

document.getElementById("campBtn").addEventListener("click", () => {
  buildRosterScreen();
  show("roster");
});

document.getElementById("restBtn").addEventListener("click", doRest);

for (const btn of document.querySelectorAll("#touchCtrls button")) {
  btn.addEventListener("click", () => doAction(btn.dataset.act));
}
document.getElementById("interactBtn").addEventListener("click", () => doAction("interact"));

// ── Combat (tasks 16–20) ────────────────────────────────────────
const combatPanel = document.getElementById("combatPanel");

function combatLog(text) {
  if (state.combat) {
    state.combat.log.push(text);
    if (state.combat.log.length > 14) state.combat.log.shift();
  }
}

function startCombat() {
  if (state.combat) return;
  state.combat = {
    monsters: spawnMonsters(state.floor),
    log: [],
    round: 0,
    queue: [],
    index: 0,
    over: false,
  };
  combatPanel.hidden = false;
  canvas.hidden = true;
  sfx.fight();
  combatLog("A fight begins!");
  state.combat.round = 1;
  state.combat.queue = buildTurnQueue(state.party, state.combat.monsters);
  renderCombat();
  advanceCombat();
}

// The final boss — the Nameless Dirge — a scripted, multi-stage foe.
function startBossFight() {
  if (state.combat) return;
  state.combat = {
    monsters: spawnBoss(),
    log: [],
    round: 0,
    queue: [],
    index: 0,
    over: false,
  };
  combatPanel.hidden = false;
  canvas.hidden = true;
  combatLog("The darkness gathers and rises into a towering shape of bound sound.");
  combatLog("THE NAMELESS DIRGE stands before you — a choir of dead voices in one body.");
  playMusic("boss");
  sfx.boss();
  fxShake();
  fxFlash("#a46cff");
  state.combat.round = 1;
  state.combat.queue = buildTurnQueue(state.party, state.combat.monsters);
  renderCombat();
  advanceCombat();
}

function endCombat() {
  for (const m of state.party) m.buff = null;
  state.combat = null;
  combatPanel.hidden = true;
  canvas.hidden = false;
  renderCombat();
  if (state.victory) {
    sfx.victory();
    setTimeout(() => { buildVictory(); show("victory"); }, 350);
  }
}

// ── Leveling & resting ──────────────────────────────────────────
// Balance pass: a gentler XP curve so level 3 (tier-3 spells) arrives
// comfortably mid-dungeon without grinding.
function xpNeeded(level) { return Math.round(level * 90); }

function checkLevelUp(m) {
  let leveled = false;
  while (m.xp >= xpNeeded(m.level)) {
    m.xp -= xpNeeded(m.level);
    m.level++;
    const hpGain = Math.max(2, 3 + (m.mods.CON || 0));
    const mpGain = m.maxMana > 0 ? Math.max(1, 2 + (m.mods.INT || 0)) : 0;
    m.maxHp += hpGain;
    m.hp += hpGain;
    m.maxMana += mpGain;
    m.mana += mpGain;
    leveled = true;
    sfx.levelup();
  }
  return leveled;
}

// Rest in the dungeon: a little HP and half the party's missing mana back.
// Rests are restless — a chance the dark takes notice.
function doRest() {
  if (screen !== "dungeon" || state.combat) return false;
  const living = state.party.filter(m => m.hp > 0);
  if (!living.length) { addMessage(state, "None can rest — the fallen need a temple."); return false; }
  for (const m of state.party) {
    if (m.hp <= 0) continue;
    m.hp = Math.min(m.maxHp, m.hp + Math.max(1, Math.ceil(m.maxHp * 0.25)));
    m.mana = Math.min(m.maxMana, m.mana + Math.max(1, Math.ceil(m.maxMana * 0.5)));
  }
  addMessage(state, "You rest, binding wounds and regaining focus.");
  sfx.rest();
  for (const m of state.party) {
    if (m.hp <= 0) addMessage(state, m.name + " lies fallen and cannot be roused by rest.");
  }
  if (Math.random() < 0.35) {
    addMessage(state, "Restless sounds in the dark...!");
    setTimeout(startCombat, 400);
  }
  return true;
}

function addGold(n) { state.gold += n; }
function subGold(n) { state.gold = Math.max(0, state.gold - n); }

function monstersAlive(c) { return c.monsters.some(mo => mo.hp > 0); }
function partyAlive() { return state.party.some(m => m.hp > 0); }

function advanceCombat() {
  const c = state.combat;
  if (!c || c.over) return;

  while (c.index < c.queue.length && !actorAlive(c.queue[c.index])) c.index++;

  if (c.index >= c.queue.length) {
    if (monstersAlive(c) && partyAlive()) {
      c.round++;
      for (const m of state.party) {
        if (m.buff) {
          m.buff.roundsLeft--;
          if (m.buff.roundsLeft <= 0) { m.buff = null; combatLog("A ward fades from the party."); }
        }
      }
      c.queue = buildTurnQueue(state.party, c.monsters);
      c.index = 0;
      combatLog("— Round " + c.round + " —");
    } else {
      resolveCombatEnd(c);
      return;
    }
  }

  const actor = c.queue[c.index];
  if (c.casting && (actor.kind !== "party" || actor.member !== c.casting.member)) c.casting = null;
  if (c.item && (actor.kind !== "party" || actor.member !== c.item.member)) c.item = null;
  if (actor.kind === "monster") {
    renderCombat();
    setTimeout(() => monsterAct(actor), 700);
  } else {
    renderCombat();
  }
}

function monsterAct(actor) {
  const c = state.combat;
  if (!c || c.over) return;
  const mo = actor.monster;
  if (mo.skips > 0) {
    mo.skips = 0;
    combatLog(mo.name + " is bound and loses its turn.");
    c.index++;
    advanceCombat();
    return;
  }
  if (mo.boss) { bossAct(actor); return; }
  const targets = state.party.filter(m => m.hp > 0);
  if (!targets.length) { resolveCombatEnd(c); return; }
  const target = targets[Math.floor(Math.random() * targets.length)];
  const guard = target.buff ? (target.buff.acBonus || 0) : 0;
  if (computeHit(mo.attack, target.ac + guard + equipAcBonus(target))) {
    const dmg = monsterDamageRoll(mo);
    target.hp = Math.max(0, target.hp - dmg);
    combatLog(mo.name + " hits " + target.name + " for " + dmg + " damage.");
    sfx.hit();
    fxShake();
    fxFlash("#ff4a4a");
  } else {
    combatLog(mo.name + " misses " + target.name + ".");
    sfx.miss();
  }
  c.index++;
  advanceCombat();
}

// The Dirge's stage script: shambling (66%+), choral (33-66%), dirge (<33%).
function bossAct(actor) {
  const c = state.combat;
  const mo = actor.monster;
  if (mo.hp <= 0) { c.index++; advanceCombat(); return; } // dead boss must not act
  const frac = mo.hp / mo.maxHp;
  const stage = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
  if (stage !== (mo.stage || 1)) {
    mo.stage = stage;
    if (stage === 2) {
      combatLog("The Dirge splits its voice into a choir of lost names.");
      sfx.boss();
      fxFlash("#8a5cff");
    } else {
      combatLog("The Dirge sheds its shape and rises — all sound turns to malice.");
      sfx.boss();
      fxShake();
      fxFlash("#c84aff");
    }
  }
  const living = state.party.filter(m => m.hp > 0);
  if (!living.length) { resolveCombatEnd(c); return; }

  if (stage === 1) {
    const t = living[Math.floor(Math.random() * living.length)];
    if (computeHit(mo.attack + 4, effectiveAc(t))) {
      const dmg = rollDamage("2d8") + Math.max(0, Math.floor((mo.attack - 5) / 2));
      t.hp = Math.max(0, t.hp - dmg);
      combatLog("Rending Claw — " + t.name + " takes " + dmg + " damage.");
      fxShake();
      fxFlash("#ff4a4a");
    } else {
      combatLog("The Dirge's claw rakes the empty air — " + t.name + " ducks clear.");
    }
  } else if (stage === 2) {
    if (Math.random() < 0.5) {
      let total = 0;
      for (const m of living) { const d = rollDamage("1d6") + 3; m.hp = Math.max(0, m.hp - d); total += d; }
      combatLog("Echoing Roar! The choir howls through every mind — " + total + " damage across the party.");
    } else {
      const targets = living.sort(() => Math.random() - 0.5).slice(0, 2);
      let total = 0;
      for (const t of targets) { const d = rollDamage("2d6") + 2; t.hp = Math.max(0, t.hp - d); total += d; }
      combatLog("Grasping Echo — " + targets.map(t => t.name).join(" and ") + " take " + total + " damage.");
    }
    fxShake();
    fxFlash("#8a5cff");
  } else {
    const t = living[Math.floor(Math.random() * living.length)];
    const d = rollDamage("3d8") + 4;
    t.hp = Math.max(0, t.hp - d);
    combatLog("Final Dirge — one unbearable chord. " + t.name + " takes " + d + " damage.");
    for (const m of living) {
      if (m.maxMana > 0 && m.mana > 0) {
        const drain = Math.min(m.mana, 3);
        m.mana -= drain;
        combatLog("The Dirge siphons " + drain + " MP from " + m.name + ".");
      }
    }
    fxShake();
    fxFlash("#c84aff");
  }
  sfx.hit();
  c.index++;
  advanceCombat();
}

function currentPartyActor() {
  const c = state.combat;
  if (!c) return null;
  const a = c.queue[c.index];
  return (a && a.kind === "party" && a.member.hp > 0) ? a : null;
}

function partyAttack(uid) {
  const c = state.combat;
  const actor = currentPartyActor();
  if (!actor || !c) return;
  const target = c.monsters.find(mo => mo.uid === uid && mo.hp > 0);
  if (!target) return;
  const member = actor.member;
  if (computeHit(member.mods.DEX, target.ac)) {
    const dmg = partyDamage(member);
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp === 0 && !target.killed) { target.killed = true; state.stats.kills++; }
    combatLog(member.name + " hits the " + target.name + " for " + dmg + " damage.");
    sfx.hit();
    flashCard(uid);
  } else {
    combatLog(member.name + " misses the " + target.name + ".");
    sfx.miss();
  }
  c.index++;
  advanceCombat();
}

function partyAttackFirstTarget() {
  const c = state.combat;
  if (!currentPartyActor() || !c) return;
  const target = c.monsters.find(mo => mo.hp > 0);
  if (target) partyAttack(target.uid);
}

function partyFlee() {
  const c = state.combat;
  if (!currentPartyActor() || !c) return;
  if (Math.random() < 0.6) {
    combatLog("You slip away into the dark!");
    sfx.flee();
    c.over = true;
    setTimeout(endCombat, 700);
  } else {
    combatLog("You try to flee, but the way is blocked!");
    c.index++;
    advanceCombat();
  }
}

function resolveCombatEnd(c) {
  if (c.over) return;
  c.over = true;
  if (!monstersAlive(c)) {
    const totalXp = c.monsters.reduce((n, mo) => n + mo.xp, 0);
    for (const m of state.party) {
      if (m.hp <= 0) { combatLog(m.name + " lies fallen and gains no XP."); continue; }
      m.xp += totalXp;
      if (checkLevelUp(m)) combatLog(m.name + " reaches level " + m.level + "!");
    }
    combatLog("Victory! You gain " + totalXp + " XP each.");
    // Gold from the dead keeps the town economy honest (balance pass).
    const goldGain = Math.max(1, Math.round(totalXp * 0.6));
    state.gold += goldGain;
    state.stats.goldEarned += goldGain;
    combatLog("You loot " + goldGain + " gold from the fallen.");
    sfx.coin();
    const boss = c.monsters.find(mo => mo.boss);
    if (boss) {
      state.bossDefeated = true;
      state.stats.bossDefeated = 1;
      state.victory = true;
      combatLog("The Dirge's last note fades. The dark beneath the city is quiet.");
    }
  } else {
    const hadAlive = state.party.some(m => m.hp > 0);
    for (const m of state.party) if (m.hp > 0) m.hp = Math.max(1, Math.floor(m.maxHp / 2));
    if (hadAlive) {
      combatLog("Your party lies broken in the dark. You drag yourselves to safety.");
      for (const m of state.party) {
        if (m.hp <= 0) combatLog(m.name + " lies fallen and must be borne to the temple.");
      }
    } else {
      const lost = Math.floor(state.gold / 2);
      state.gold -= lost;
      for (const m of state.party) m.hp = 1;
      combatLog("All is lost... You wake in the temple, " + lost + " gold lighter.");
    }
  }
  setTimeout(endCombat, 1200);
}

function renderCombat() {
  if (!state.combat) {
    const monstersEl = document.getElementById("combatMonsters");
    const partyEl = document.getElementById("combatParty");
    const logEl = document.getElementById("combatLog");
    const actionsEl = document.getElementById("combatActions");
    if (monstersEl) monstersEl.innerHTML = "";
    if (partyEl) partyEl.innerHTML = "";
    if (logEl) logEl.innerHTML = "";
    if (actionsEl) actionsEl.innerHTML = "";
    return;
  }
  const c = state.combat;
  const roundEl = document.getElementById("combatRoundEl");
  if (roundEl) roundEl.textContent = "Round " + c.round;
  const statusEl = document.getElementById("combatStatusEl");
  if (statusEl) statusEl.textContent = state.mapName;

  const monstersEl = document.getElementById("combatMonsters");
  monstersEl.innerHTML = c.monsters.map(mo =>
    '<div class="cmon' + (mo.hp <= 0 ? " dead" : "") + '" data-uid="' + mo.uid + '"><b>' + mo.name + '</b> ×' + mo.stackSize +
    ' · <span class="c-hp">HP ' + mo.hp + "/" + mo.maxHp + '</span> · AC ' + mo.ac + "</div>"
  ).join("");

  const partyEl = document.getElementById("combatParty");
  partyEl.innerHTML = state.party.map(m =>
    '<div class="cp' + (m.hp <= 0 ? " dead" : "") + '"><b>' + m.name + '</b> <em>' + m.className +
    '</em> · HP ' + m.hp + "/" + m.maxHp + " · MP " + m.mana + "</div>"
  ).join("");

  const logEl = document.getElementById("combatLog");
  logEl.innerHTML = c.log.map(l => "<div>" + l + "</div>").join("");
  logEl.scrollTop = logEl.scrollHeight;

  const actionsEl = document.getElementById("combatActions");
  actionsEl.innerHTML = "";
  const actor = currentPartyActor();
  if (actor) {
    const member = actor.member;
    if (c.casting && c.casting.member === member) {
      renderCastingActions(c, member, actionsEl);
    } else if (c.item && c.item.member === member) {
      renderItemActions(c, member, actionsEl);
    } else {
      const head = document.createElement("div");
      head.className = "cact-head";
      head.textContent = member.name + "'s turn — choose an action.";
      actionsEl.appendChild(head);
      for (const t of c.monsters.filter(mo => mo.hp > 0)) {
        const b = mkBtn(t.name + " (HP " + t.hp + ")", false);
        b.addEventListener("click", () => partyAttack(t.uid));
        actionsEl.appendChild(b);
      }
      const flee = mkBtn("Flee", false);
      flee.className = "cbtn flee";
      flee.addEventListener("click", partyFlee);
      actionsEl.appendChild(flee);
      const spells = getKnownSpells(member);
      const canCast = spells.some(s => s.mp <= member.mana);
      const spell = mkBtn("Spell", !canCast);
      spell.title = canCast ? "Cast one of your known spells (costs MP)." : (spells.length ? "Not enough mana." : "No spells known.");
      spell.addEventListener("click", () => {
        c.casting = { member, stage: "pick", spell: null };
        renderCombat();
      });
      actionsEl.appendChild(spell);
      const usable = state.inventory.filter(it => it.type === "potion" || it.type === "scroll");
      const item = mkBtn("Item", !usable.length);
      item.title = usable.length ? "Use a consumable from the party bag." : "No consumables in the bag.";
      item.addEventListener("click", () => {
        c.item = { member, stage: "pick", itemIdx: null, spell: null };
        renderCombat();
      });
      actionsEl.appendChild(item);
    }
  } else {
    const wait = document.createElement("div");
    wait.className = "cact-head";
    wait.textContent = "The foes move...";
    actionsEl.appendChild(wait);
  }
}

function mkBtn(label, disabled) {
  const b = document.createElement("button");
  b.className = "cbtn";
  b.textContent = label;
  b.disabled = !!disabled;
  return b;
}

// Menu-driven casting: pick a spell, then a target for enemy/ally spells.
function renderCastingActions(c, member, actionsEl) {
  const cast = c.casting;
  if (cast.stage === "pick") {
    const head = document.createElement("div");
    head.className = "cact-head";
    head.textContent = member.name + " — which spell?";
    actionsEl.appendChild(head);
    const spells = getKnownSpells(member);
    for (const s of spells) {
      const b = mkBtn(s.name + " — " + s.mp + " MP", s.mp > member.mana);
      b.title = s.desc;
      b.addEventListener("click", () => {
        if (s.target === "all") { castSpell(s, null); return; }
        cast.stage = "target";
        cast.spell = s;
        renderCombat();
      });
      actionsEl.appendChild(b);
    }
    const back = mkBtn("Back", false);
    back.addEventListener("click", () => { c.casting = null; renderCombat(); });
    actionsEl.appendChild(back);
  } else {
    const s = cast.spell;
    const head = document.createElement("div");
    head.className = "cact-head";
    head.textContent = member.name + " — " + s.name + " at whom?";
    actionsEl.appendChild(head);
    const opts = s.target === "enemy"
      ? c.monsters.filter(mo => mo.hp > 0)
      : state.party.filter(m => m.hp > 0);
    for (const t of opts) {
      const b = mkBtn(t.name + (t.hp !== undefined ? " (HP " + t.hp + ")" : ""), false);
      b.addEventListener("click", () => castSpell(s, t));
      actionsEl.appendChild(b);
    }
    const back = mkBtn("Back", false);
    back.addEventListener("click", () => { cast.stage = "pick"; cast.spell = null; renderCombat(); });
    actionsEl.appendChild(back);
  }
}

// Menu-driven consumables: pick a bag item; potions are drunk by the acting
// member immediately, scrolls may need a target like spells.
function renderItemActions(c, member, actionsEl) {
  const item = c.item;
  if (item.stage === "pick") {
    const head = document.createElement("div");
    head.className = "cact-head";
    head.textContent = member.name + " — use which item?";
    actionsEl.appendChild(head);
    const usable = state.inventory.map((it, idx) => ({ it, idx })).filter(x => x.it.type === "potion" || x.it.type === "scroll");
    for (const { it, idx } of usable) {
      const b = mkBtn(it.name, false);
      b.title = it.desc || itemStatText(it);
      b.addEventListener("click", () => {
        const spell = it.type === "scroll" ? (loadSpells().find(s => s.id === it.spell) || null) : null;
        if (it.type === "scroll" && spell && spell.target !== "all") {
          item.stage = "target";
          item.itemIdx = idx;
          item.spell = spell;
          renderCombat();
        } else if (useItemFromBag(idx, member)) {
          c.item = null;
          c.index++;
          advanceCombat();
        }
      });
      actionsEl.appendChild(b);
    }
    const back = mkBtn("Back", false);
    back.addEventListener("click", () => { c.item = null; renderCombat(); });
    actionsEl.appendChild(back);
  } else {
    const s = item.spell;
    const head = document.createElement("div");
    head.className = "cact-head";
    head.textContent = member.name + " — " + s.name + " at whom?";
    actionsEl.appendChild(head);
    const opts = s.target === "enemy"
      ? c.monsters.filter(mo => mo.hp > 0)
      : state.party.filter(m => m.hp > 0);
    for (const t of opts) {
      const b = mkBtn(t.name + (t.hp !== undefined ? " (HP " + t.hp + ")" : ""), false);
      b.addEventListener("click", () => useScrollFromBag(item.itemIdx, member, t));
      actionsEl.appendChild(b);
    }
    const back = mkBtn("Back", false);
    back.addEventListener("click", () => { item.stage = "pick"; item.spell = null; item.itemIdx = null; renderCombat(); });
    actionsEl.appendChild(back);
  }
}

function useItemFromBag(idx, target) {
  const it = state.inventory[idx];
  if (!it) return false;
  if (it.type === "potion") {
    const options = state.party.filter(m => m.hp > 0);
    let m = target || options[0];
    if (!m) return false;
    if (it.heal) m.hp = Math.min(m.maxHp, m.hp + it.heal);
    if (it.mana) m.mana = Math.min(m.maxMana, m.mana + it.mana);
    state.inventory.splice(idx, 1);
    sfx.heal();
    if (state.combat) {
      combatLog(m.name + " drinks the " + it.name + "!");
    } else {
      addMessage(state, m.name + " drinks the " + it.name + ".");
    }
    return true;
  }
  if (it.type === "scroll") {
    if (!state.combat) { addMessage(state, "Scrolls only crackle to life in battle."); return false; }
    const spell = loadSpells().find(s => s.id === it.spell);
    if (!spell) return false;
    const reader = target || state.party.find(m => m.hp > 0);
    if (!reader) return false;
    applySpellEffect(state, state.combat, reader, spell, spell.target === "all" ? null : target);
    state.inventory.splice(idx, 1);
    combatLog(reader.name + " unrolls the " + it.name + " and reads aloud!");
    return true;
  }
  return false;
}

// Scroll targeted in combat: reader is the acting member.
function useScrollFromBag(idx, reader, target) {
  const it = state.inventory[idx];
  const spell = loadSpells().find(s => s.id === it.spell);
  if (!it || !spell) return;
  applySpellEffect(state, state.combat, reader, spell, target);
  state.inventory.splice(idx, 1);
  combatLog(reader.name + " unrolls the " + it.name + " and reads aloud!");
  const c = state.combat;
  c.item = null;
  c.index++;
  advanceCombat();
}

function castSpell(spell, target) {
  const c = state.combat;
  const actor = currentPartyActor();
  if (!actor || !c) return;
  const member = actor.member;
  if (member.mana < spell.mp) { combatLog(member.name + " lacks the mana for " + spell.name + "."); return; }
  member.mana -= spell.mp;
  applySpellEffect(state, c, member, spell, target);
  if (spell.school === "heal") sfx.heal();
  else if (spell.school === "buff") sfx.heal();
  else sfx.spell();
  c.casting = null;
  c.index++;
  advanceCombat();
}

// ── The town (tasks 25–30) ─────────────────────────────────────
const TOWN_NAME = "Thornfield";
const TOWN_BUILDINGS = [
  { id: "armory", name: "The Armory", label: "Armory", x: 141, y: 24, w: 78, h: 50, color: "#6a4f3a", icon: "⚔" },
  { id: "temple", name: "The Temple of the Pale Dawn", label: "Temple", x: 286, y: 147, w: 48, h: 66, color: "#4a5a8a", icon: "✦" },
  { id: "guild", name: "The Adventurers' Guild", label: "Guild", x: 26, y: 147, w: 48, h: 66, color: "#3f6a4a", icon: "♜" },
  { id: "inn", name: "The Gilded Rest", label: "Inn", x: 141, y: 286, w: 78, h: 50, color: "#8a703a", icon: "☕" },
  { id: "dungeon", name: "The Catacombs", label: "Catacombs", x: 166, y: 166, w: 28, h: 28, color: "#3d3a55", icon: "↓" },
];

let itemCache = null;
function loadItems() {
  if (itemCache) return itemCache;
  const list = (root && root.item) ? root.item.selectAll : [];
  itemCache = list.map(i => ({
    id: i.id.evaluateItem,
    name: i.itemName.evaluateItem,
    type: i.type.evaluateItem,
    cost: Number(i.cost) || 1,
    attackBonus: i.attackBonus ? Number(i.attackBonus) : 0,
    acBonus: i.acBonus ? Number(i.acBonus) : 0,
    heal: i.heal ? Number(i.heal) : 0,
    mana: i.mana ? Number(i.mana) : 0,
    spell: i.spell ? i.spell.evaluateItem : null,
    desc: i.desc.evaluateItem,
  }));
  return itemCache;
}

let questCache = null;
function loadQuests() {
  if (questCache) return questCache;
  const list = (root && root.quest) ? root.quest.selectAll : [];
  questCache = list.map(q => ({
    id: q.id.evaluateItem,
    name: q.questName.evaluateItem,
    desc: q.desc.evaluateItem,
    metric: q.metric.evaluateItem,
    goal: Number(q.goal) || 1,
    reward: Number(q.reward) || 0,
  }));
  return questCache;
}

function itemStatText(it) {
  if (it.type === "weapon") return " +" + it.attackBonus + " attack";
  if (it.type === "armor" || it.type === "shield" || it.type === "head") return " +" + it.acBonus + " AC";
  if (it.type === "light") return " dispels the dark";
  if (it.type === "potion" && it.heal) return " restores " + it.heal + " HP";
  if (it.type === "potion" && it.mana) return " restores " + it.mana + " MP";
  if (it.type === "scroll") {
    const s = loadSpells().find(x => x.id === it.spell);
    return s ? " casts " + s.name : "";
  }
  return "";
}

function h3(t) { const e = document.createElement("h3"); e.textContent = t; return e; }
function pEl(t) { const e = document.createElement("p"); e.textContent = t; return e; }

function renderTown(state) {
  renderTownMap(state);
  renderTownPartyBar(state);
  renderTownPanel(state);
}

function renderTownMap(state) {
  const cv = document.getElementById("townCanvas");
  if (!cv) return;
  cv.width = 360;
  cv.height = 360;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0d0f1e";
  ctx.fillRect(0, 0, 360, 360);
  ctx.fillStyle = "#161b30";
  ctx.fillRect(162, 0, 36, 360);
  ctx.fillRect(0, 162, 360, 36);
  ctx.strokeStyle = "#3a3a5e";
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 340, 340);
  ctx.strokeStyle = "#2a2a48";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 324, 324);
  ctx.fillStyle = "#141930";
  ctx.fillRect(140, 140, 80, 80);

  for (const b of TOWN_BUILDINGS) {
    const sel = state.town.location === b.id;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = sel ? "#e8c35a" : "#3a3358";
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "#e8ddc0";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "12px Georgia, serif";
    ctx.fillText(b.icon, b.x + b.w / 2, b.y + b.h / 2 - 7);
    ctx.font = "11px Georgia, serif";
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 10);
  }

  ctx.strokeStyle = "#4a5a8a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(180, 132, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#3a4a6a";
  ctx.fillRect(177, 120, 6, 8);

  const sel = TOWN_BUILDINGS.find(b => b.id === state.town.location);
  const mx = sel ? sel.x + sel.w / 2 : 180;
  const my = sel ? sel.y + sel.h + 8 : 180;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(mx, my, 4, 0, Math.PI * 2);
  ctx.fill();
}

function renderTownPartyBar(state) {
  const el = document.getElementById("townPartyBar");
  if (!el) return;
  el.innerHTML =
    '<div class="gold-line">Gold <b>' + state.gold + '</b> · Keys ' + state.keys + ' · Catacombs floor ' + state.floor + '</div>' +
    state.party.map(m =>
      '<div class="pcard"><span class="pname">' + m.name + ' <em>' + m.className + '</em></span>' +
      '<span class="pv">HP <b>' + m.hp + '/' + m.maxHp + '</b> · MP <b>' + m.mana + '/' + m.maxMana + '</b> · AC <b>' + m.ac + '</b></span></div>'
    ).join("");
}

function renderTownPanel(state) {
  const el = document.getElementById("townPanel");
  const loc = state.town.location || "plaza";
  el.innerHTML = "";
  if (loc === "plaza") {
    el.appendChild(h3(TOWN_NAME + " — The Plaza"));
    el.appendChild(pEl("Torches gutter around the square. The well is deep and dry, and the cellar hatch at the center of the plaza gapes down into the catacombs."));
    el.appendChild(pEl("Click a building to trade, pray, rest, or take a quest. Old hands mutter of a tenth floor beneath the catacombs, where the darkness hums with a single held note."));
  } else if (loc === "armory") renderArmory(state, el);
  else if (loc === "temple") renderTemple(state, el);
  else if (loc === "inn") renderInn(state, el);
  else if (loc === "guild") renderGuild(state, el);
  else if (loc === "dungeon") {
    el.appendChild(h3("The Catacombs"));
    el.appendChild(pEl("The hatch swings open on cold stone stairs. The dark below is patient. When you are ready, descend."));
  }
}

function renderArmory(state, el) {
  el.appendChild(h3("The Armory — Stock"));
  el.appendChild(pEl("Steel and leather for the living. The smith haggles fairly."));
  for (const it of loadItems()) {
    const row = document.createElement("div");
    row.className = "shop-row";
    row.innerHTML = '<span><b>' + it.name + '</b> <em class="shop-sub">' + it.type + itemStatText(it) + '</em></span>' +
      '<span class="cost">' + it.cost + 'g</span>' +
      '<button class="cbtn" ' + (state.gold < it.cost ? "disabled" : "") + '>Buy</button>';
    row.querySelector("button").addEventListener("click", () => {
      if (state.gold < it.cost) return;
      state.gold -= it.cost;
      state.inventory.push({ id: it.id, name: it.name, type: it.type, cost: it.cost, attackBonus: it.attackBonus, acBonus: it.acBonus, heal: it.heal, mana: it.mana, spell: it.spell, desc: it.desc });
      addMessage(state, "Bought " + it.name + " for " + it.cost + " gold.");
      sfx.buy();
      renderTown(state);
    });
    el.appendChild(row);
  }
  el.appendChild(h3("Your Bag — " + state.inventory.length + " item" + (state.inventory.length === 1 ? "" : "s")));
  if (!state.inventory.length) el.appendChild(pEl("Nothing yet. The smith eyes your purse."));
  state.inventory.forEach((it, idx) => {
    const sell = Math.max(1, Math.floor(it.cost / 2));
    const row = document.createElement("div");
    row.className = "shop-row";
    row.innerHTML = '<span><b>' + it.name + '</b> <em class="shop-sub">' + it.type + itemStatText(it) + '</em></span>' +
      '<span class="cost">sell ' + sell + 'g</span>' +
      '<button class="cbtn">Sell</button>';
    row.querySelector("button").addEventListener("click", () => {
      state.gold += sell;
      state.inventory.splice(idx, 1);
      addMessage(state, "Sold " + it.name + " for " + sell + " gold.");
      sfx.buy();
      renderTown(state);
    });
    el.appendChild(row);
  });
}

function renderTemple(state, el) {
  el.appendChild(h3("The Temple of the Pale Dawn"));
  el.appendChild(pEl("Candles and incense. The priests tend the wounded and raise the fallen — for a donation."));
  const healCost = 15;
  const healBtn = document.createElement("button");
  healBtn.className = "primary";
  healBtn.textContent = "Heal All — " + healCost + "g";
  healBtn.disabled = state.gold < healCost;
  healBtn.addEventListener("click", () => {
    if (state.gold < healCost) return;
    state.gold -= healCost;
    for (const m of state.party) if (m.hp > 0) m.hp = m.maxHp;
    addMessage(state, "The priests lay hands on the party — wounds close.");
    sfx.heal();
    renderTown(state);
  });
  el.appendChild(healBtn);
  const fallen = state.party.filter(m => m.hp <= 0);
  if (fallen.length) {
    el.appendChild(h3("The Fallen"));
    for (const m of fallen) {
      const resCost = 25;
      const row = document.createElement("div");
      row.className = "shop-row";
      row.innerHTML = '<span><b>' + m.name + '</b> <em class="shop-sub">' + m.className + ' — fallen</em></span>' +
        '<button class="cbtn" ' + (state.gold < resCost ? "disabled" : "") + '>Resurrect ' + resCost + 'g</button>';
      row.querySelector("button").addEventListener("click", () => {
        if (state.gold < resCost) return;
        state.gold -= resCost;
        m.hp = m.maxHp;
        m.mana = m.maxMana;
        addMessage(state, m.name + " gasps back to life, whole again.");
        sfx.heal();
        renderTown(state);
      });
      el.appendChild(row);
    }
  } else {
    el.appendChild(pEl("All the living stand — for now."));
  }
}

function renderInn(state, el) {
  el.appendChild(h3("The Gilded Rest"));
  el.appendChild(pEl("Warm hearth, cold ale, and beds that remember you by name."));
  const living = state.party.filter(m => m.hp > 0);
  const restCost = living.length * 5;
  const restBtn = document.createElement("button");
  restBtn.className = "primary";
  restBtn.textContent = "Rest the Night — " + restCost + "g";
  restBtn.disabled = !living.length || state.gold < restCost;
  restBtn.addEventListener("click", () => {
    if (!living.length || state.gold < restCost) return;
    state.gold -= restCost;
    for (const m of state.party) {
      if (m.hp <= 0) continue;
      m.hp = m.maxHp;
      m.mana = m.maxMana;
    }
    addMessage(state, "A hot meal, a soft bed — the party is restored.");
    sfx.rest();
    renderTown(state);
  });
  el.appendChild(restBtn);
  const recruitBtn = document.createElement("button");
  recruitBtn.className = "ghost";
  recruitBtn.textContent = "Recruit an Adventurer";
  recruitBtn.style.marginLeft = "10px";
  recruitBtn.disabled = state.party.length >= 4;
  recruitBtn.addEventListener("click", () => {
    recruitMode = true;
    buildCreateScreen();
    show("create");
  });
  el.appendChild(recruitBtn);
  el.appendChild(pEl("The innkeeper can also find you fresh company — up to four in arms."));
}

function renderGuild(state, el) {
  el.appendChild(h3("The Adventurers' Guild"));
  el.appendChild(pEl("The quest board creaks under parchments. Claim your rewards here."));
  for (const q of loadQuests()) {
    const cur = state.stats[q.metric] || 0;
    const done = !!state.quests.done[q.id];
    const box = document.createElement("div");
    box.className = "qrow" + (done ? " done" : "");
    const claimable = !done && cur >= q.goal;
    box.innerHTML =
      '<h4>' + q.name + ' <span class="reward">(' + q.reward + 'g)</span></h4>' +
      '<div class="prog">' + q.desc + ' — ' + Math.min(cur, q.goal) + "/" + q.goal +
      (done ? " · claimed" : claimable ? " · ready to claim!" : "") + "</div>";
    if (claimable) {
      const btn = document.createElement("button");
      btn.className = "cbtn";
      btn.textContent = "Claim " + q.reward + "g";
      btn.addEventListener("click", () => {
        state.quests.done[q.id] = true;
        state.gold += q.reward;
        addMessage(state, "Quest complete: " + q.name + "! You earn " + q.reward + " gold.");
        renderTown(state);
      });
      box.appendChild(btn);
    }
    el.appendChild(box);
  }
  el.appendChild(pEl(state.stats.floorsCleared >= 1
    ? "The guildmaster nods: you have descended past the first floor. The deep is yours."
    : "The guildmaster watches the hatch: 'Come back when you've seen the floor below.'"));
}

const townCanvas = document.getElementById("townCanvas");
if (townCanvas) {
  townCanvas.addEventListener("click", (e) => {
    const rect = townCanvas.getBoundingClientRect();
    const lx = (e.clientX - rect.left) * (360 / rect.width);
    const ly = (e.clientY - rect.top) * (360 / rect.height);
    for (const b of TOWN_BUILDINGS) {
      if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) {
        state.town.location = b.id;
        renderTown(state);
        return;
      }
    }
    state.town.location = "plaza";
    renderTown(state);
  });
}

document.getElementById("townDescendBtn").addEventListener("click", () => {
  if (!state.party.length) return;
  if (!state.running) enterDungeon(state);
  show("dungeon");
});
document.getElementById("townCampBtn").addEventListener("click", () => {
  buildRosterScreen();
  show("roster");
});

// ── Riddle gates (task 39) ──────────────────────────────────────
const gateModal = document.getElementById("gateModal");
const gateRiddleEl = document.getElementById("gateRiddleEl");
const gateAnswerInput = document.getElementById("gateAnswerInput");
let currentGateRiddle = null;

function openGatePrompt() {
  const list = (root && root.riddle) ? root.riddle.selectAll : [];
  if (!list.length) { addMessage(state, "The gate is blank and silent."); return; }
  const riddles = list.map(r => ({
    text: r.riddle.evaluateItem,
    answer: String(r.answer.evaluateItem).toLowerCase(),
  }));
  currentGateRiddle = riddles[Math.floor(Math.random() * riddles.length)];
  gateRiddleEl.textContent = currentGateRiddle.text;
  gateAnswerInput.value = "";
  gateModal.hidden = false;
  gateAnswerInput.focus();
}

function submitGateAnswer() {
  const ans = gateAnswerInput.value.trim().toLowerCase();
  gateModal.hidden = true;
  if (!currentGateRiddle) return;
  const grid = state.currentMap.grid;
  const ax = state.player.x + DX[state.player.facing];
  const ay = state.player.y + DY[state.player.facing];
  if (ans === currentGateRiddle.answer) {
    let opened = false;
    if (grid[ay] && grid[ay][ax] === TILE_GATE) {
      grid[ay][ax] = TILE_FLOOR;
      revealAround(state, ax, ay);
      opened = true;
    }
    if (opened) {
      state.gold += 5;
      addMessage(state, "The gate grinds open. Coins spill from its workings (+5 gold).");
    } else {
      addMessage(state, "You know the answer... but the gate is no longer before you.");
    }
  } else {
    addMessage(state, "The gate booms: \"Wrong.\" The stone stays shut.");
  }
  currentGateRiddle = null;
}

gateModal.addEventListener("click", (e) => {
  if (e.target === gateModal) gateModal.hidden = true;
});
document.getElementById("gateSubmitBtn").addEventListener("click", submitGateAnswer);
document.getElementById("gateCancelBtn").addEventListener("click", () => { gateModal.hidden = true; currentGateRiddle = null; });
gateAnswerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); submitGateAnswer(); }
});

// ── Help & instructions (?) ─────────────────────────────────────
const helpModal = document.getElementById("helpModal");
function openHelp() { helpModal.hidden = false; }
document.getElementById("helpBtn").addEventListener("click", openHelp);
document.getElementById("helpBtnHud").addEventListener("click", openHelp);
document.getElementById("helpCloseBtn").addEventListener("click", () => { helpModal.hidden = true; });
helpModal.addEventListener("click", (e) => { if (e.target === helpModal) helpModal.hidden = true; });

// ── Inventory & equipment (tasks 31–34) ─────────────────────────
const invModal = document.getElementById("invModal");
let invSelected = 0;

function openInventory() {
  invSelected = Math.max(0, state.party.findIndex(m => m.hp > 0));
  invModal.hidden = false;
  renderInventory();
}

function renderInventory() {
  const tabs = document.getElementById("invTabs");
  const charPanel = document.getElementById("invCharPanel");
  const bagEl = document.getElementById("invBag");
  const bagCount = document.getElementById("invBagCount");

  tabs.innerHTML = state.party.map((mem, i) =>
    '<button class="invTab' + (i === invSelected ? " active" : "") + '" data-i="' + i + '">' + mem.name + "</button>"
  ).join("");
  tabs.querySelectorAll(".invTab").forEach(b => b.addEventListener("click", () => {
    invSelected = Number(b.dataset.i);
    renderInventory();
  }));

  const m = state.party[invSelected];
  if (m) {
    charPanel.innerHTML =
      '<div class="inv-char-head"><b>' + m.name + '</b> ' + m.className + ' · AC <b>' + effectiveAc(m) +
      '</b> · Atk <b>+' + effectiveAttack(m) + "</b></div>" +
      ([["head", "Head"], ["body", "Body"], ["weapon", "Weapon"], ["offhand", "Off-Hand"], ["light", "Light"]].map(([slot, label]) => {
        const it = (m.equipment || {})[slot];
        return '<div class="inv-slot"><span>' + label + '</span>' +
          (it
            ? '<b>' + it.name + '</b><button class="cbtn" data-uneq="' + slot + '">Unequip</button>'
            : "<em>empty</em>") +
          "</div>";
      }).join(""));
    charPanel.querySelectorAll("[data-uneq]").forEach(b => b.addEventListener("click", () => {
      unequipItem(invSelected, b.dataset.uneq);
      renderInventory();
    }));
  } else {
    charPanel.innerHTML = "<p>No adventurers in the party.</p>";
  }

  bagCount.textContent = state.inventory.length;
  if (!state.inventory.length) {
    bagEl.innerHTML = '<p class="inv-empty">Your bag is empty. The armory sells gear.</p>';
    return;
  }
  bagEl.innerHTML = state.inventory.map((it, idx) => {
    const slotFor = it.type === "weapon" ? "weapon"
      : it.type === "shield" ? "offhand"
      : it.type === "armor" ? "body"
      : it.type === "head" ? "head"
      : it.type === "light" ? "light" : null;
    const consumable = it.type === "potion" || it.type === "scroll";
    return '<div class="inv-item" data-idx="' + idx + '">' +
      '<span class="inv-item-name"><b>' + it.name + '</b> <em>' + it.type + itemStatText(it) + "</em></span>" +
      (consumable ? '<button class="cbtn" data-use="' + idx + '">Use</button>' : "") +
      (slotFor ? '<button class="cbtn" data-equip="' + idx + '" data-slot="' + slotFor + '">Equip</button>' : "") +
      "</div>";
  }).join("");
  bagEl.querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", () => {
    const it = state.inventory[Number(b.dataset.use)];
    if (it && it.type === "scroll") { addMessage(state, "Scrolls only crackle to life in battle."); return; }
    useItemFromBag(Number(b.dataset.use), state.party[invSelected]);
    renderInventory();
  }));
  bagEl.querySelectorAll("[data-equip]").forEach(b => b.addEventListener("click", () => {
    equipItem(Number(b.dataset.equip), b.dataset.slot);
    renderInventory();
  }));
}

function equipItem(idx, slot) {
  const it = state.inventory[idx];
  const m = state.party[invSelected];
  if (!it || !m) return;
  if (!m.equipment) m.equipment = {};
  const prev = m.equipment[slot] || null;
  m.equipment[slot] = it;
  state.inventory.splice(idx, 1);
  if (prev) state.inventory.push(prev);
  addMessage(state, (prev ? "Swapped " : "Equipped ") + it.name + (prev ? " for " + prev.name : " on " + m.name) + ".");
}

function unequipItem(memberIdx, slot) {
  const m = state.party[memberIdx];
  if (!m || !m.equipment || !m.equipment[slot]) return;
  state.inventory.push(m.equipment[slot]);
  addMessage(state, "Unequipped " + m.equipment[slot].name + " from " + m.name + ".");
  m.equipment[slot] = null;
}

invModal.addEventListener("click", (e) => {
  if (e.target === invModal || e.target.closest("#invCloseBtn")) invModal.hidden = true;
});
document.getElementById("invBtn").addEventListener("click", openInventory);

// ── Save / load (task 40) ───────────────────────────────────────
const SAVE_KEY = "abardsTaleSave";

async function saveGame() {
  if (!root.kv) { addMessage(state, "Saving is unavailable right now."); return false; }
  try {
    await root.kv.abardsTale.set(SAVE_KEY, serializeState(state));
    addMessage(state, "Game saved.");
    return true;
  } catch (e) {
    addMessage(state, "The save failed.");
    return false;
  }
}

async function loadGame() {
  if (!root.kv) return false;
  const raw = await root.kv.abardsTale.get(SAVE_KEY);
  if (!raw) return false;
  const loaded = deserializeState(raw);
  if (!loaded) return false;
  Object.assign(state, loaded);
  return true;
}

async function hasSave() {
  if (!root.kv) return false;
  const raw = await root.kv.abardsTale.get(SAVE_KEY);
  return !!raw;
}

async function checkSaveForContinue() {
  const contBtn = document.getElementById("continueBtn");
  if (!contBtn) return;
  try {
    if (await hasSave()) contBtn.hidden = false;
  } catch (e) { /* kv not ready — hide continue */ }
}

document.getElementById("saveBtn").addEventListener("click", () => { saveGame(); });
document.getElementById("rosterSaveBtn").addEventListener("click", () => { saveGame(); });

document.getElementById("continueBtn").addEventListener("click", async () => {
  if (await loadGame()) {
    buildRosterScreen();
    if (state.running) { show("dungeon"); }
    else { show("roster"); }
  }
});

checkSaveForContinue();

// ── Demo mode (?demo=1) and debug hooks ─────────────────────────
function makeDemoParty() {
  const picks = [
    { race: "human", cls: "warrior" },
    { race: "elf", cls: "conjurer" },
    { race: "dwarf", cls: "paladin" },
    { race: "halfling", cls: "rogue" },
  ];
  const used = new Set();
  const party = [];
  for (const p of picks) {
    let name = NAMES[Math.floor(Math.random() * NAMES.length)];
    while (used.has(name)) name = NAMES[Math.floor(Math.random() * NAMES.length)];
    used.add(name);
    party.push(createCharacter(name, p.race, p.cls, rollStats()));
  }
  return party;
}

// ── Victory & credits (task 47) ─────────────────────────────────
function mmss(t) {
  const s = Math.max(0, Math.floor(t));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function buildVictory() {
  const partyEl = document.getElementById("victoryPartyEl");
  partyEl.innerHTML = state.party.map(m =>
    '<div class="v-party"><b>' + m.name + '</b> <em>' + m.className + '</em> · level ' + m.level +
    ' · HP ' + m.hp + '/' + m.maxHp + '</div>'
  ).join("");
  const statsEl = document.getElementById("victoryStatsEl");
  statsEl.innerHTML =
    '<span>Floors descended <b>' + state.stats.floorsCleared + '</b></span>' +
    '<span>Monsters slain <b>' + state.stats.kills + '</b></span>' +
    '<span>Chests opened <b>' + state.stats.chestsOpened + '</b></span>' +
    '<span>Gold earned <b>' + state.stats.goldEarned + '</b></span>' +
    '<span>Time in the dark <b>' + mmss(state.stats.secondsPlayed) + '</b></span>';
  const creditsEl = document.getElementById("creditsEl");
  creditsEl.innerHTML =
    "<span class='cr-head'>A BARD'S TALE</span>" +
    "<span class='cr-sub'>a perchance.org homage to the classic dungeon crawlers of the 1980s</span>" +
    "<span>Song, steel, and spellcraft carried the day.</span>" +
    "<span class='cr-sep'>✦</span>" +
    "<span>Engine — a hand-rolled raycasting maze</span>" +
    "<span>Spells — eighteen original incantations in three schools</span>" +
    "<span>Bestiary — rats to golems, and the Nameless Dirge beyond them</span>" +
    "<span>Original score — tavern, catacomb, and boss themes</span>" +
    "<span class='cr-sep'>✦</span>" +
    "<span>The dark below is quiet now.</span>" +
    "<span>Until the next song begins.</span>";
}

function resetGame() {
  const fresh = createGameState();
  for (const k in fresh) state[k] = fresh[k];
  state.onMove = maybeEncounter;
  state.onSound = (st, label) => { if (sfx[label]) sfx[label](); };
  state.onExit = (st) => {
    if (st.floor >= st.bossFloor && !st.bossDefeated && !st.combat) { startBossFight(); return "handled"; }
    return "descend";
  };
  stopMusic();
  show("title");
}

if (document.getElementById("victoryContinueBtn")) {
  document.getElementById("victoryContinueBtn").addEventListener("click", () => show("town"));
}
if (document.getElementById("victoryAgainBtn")) {
  document.getElementById("victoryAgainBtn").addEventListener("click", () => {
    ensureAudio();
    sfx.click();
    resetGame();
  });
}

if (new URLSearchParams(location.search).get("demo") === "1") {
  state.party = makeDemoParty();
  enterDungeon(state);
  buildRosterScreen();
  show("dungeon");
}

window.game = {
  state,
  races,
  classes,
  monsters: loadMonsters(),
  rollStats,
  createCharacter,
  addPartyMember,
  removePartyMember,
  partySummary,
  tryMove,
  turn,
  interact,
  tileAhead,
  enterDungeon,
  generateMap,
  placePlayerAtStart,
  renderScene,
  spawnMonsters,
  spawnBoss,
  buildTurnQueue,
  computeHit,
  partyDamage,
  monsterDamageRoll,
  startCombat,
  startBossFight,
  endCombat,
  bossAct,
  partyAttack,
  partyAttackFirstTarget,
  partyFlee,
  castSpell,
  renderCombat,
  advanceCombat,
  resolveCombatEnd,
  monsterAct,
  loadSpells,
  getKnownSpells,
  spellTierForLevel,
  applySpellEffect,
  rest: doRest,
  descend,
  addGold,
  subGold,
  checkLevelUp,
  xpNeeded,
  swapPartyMembers,
  renderTown,
  loadItems,
  loadQuests,
  claimQuest(id) {
    const q = loadQuests().find(x => x.id === id);
    if (!q || state.quests.done[q.id]) return false;
    if ((state.stats[q.metric] || 0) < q.goal) return false;
    state.quests.done[q.id] = true;
    state.gold += q.reward;
    return true;
  },
  openCharacterSheet,
  openInventory,
  renderInventory,
  equipItem,
  unequipItem,
  useItem: useItemFromBag,
  useScrollFromBag,
  equipAttackBonus,
  equipAcBonus,
  effectiveAc,
  effectiveAttack,
  serializeState,
  deserializeState,
  saveGame,
  loadGame,
  hasSave,
  openGatePrompt,
  submitGateAnswer,
  TILE_DARK,
  TILE_PIT,
  TILE_VALVE,
  TILE_GATE,
  TILE_EXIT,
  TILE_FLOOR,
  sfx,
  playMusic,
  stopMusic,
  currentMusic,
  setMuted,
  toggleMute,
  isMuted,
  ensureAudio,
  buildVictory,
  resetGame,
  fxShake,
  fxFlash,
  mmss,
  set forceEncounter(v) { debugForceEncounter = !!v; },
  revealAll() {
    const g = state.currentMap.grid;
    for (let y = 0; y < g.length; y++)
      for (let x = 0; x < g[y].length; x++) {
        state.visited.add(x + "," + y);
        state.revealed.add(x + "," + y);
      }
  },
  get canvasInfo() { return canvasInfo; },
  get screen() { return screen; },
  show,
  doAction,
  makeDemoParty,
};
