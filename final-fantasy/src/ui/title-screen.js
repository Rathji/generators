// Task #207: Interactive title screen — New Game / Continue / Delete Save.
// The state machine lives in engine/title.js; this layer paints it into the
// existing #titleScreen overlay and drives the boot system through callbacks.
// Keyed for keyboard play (N/C/D, arrows, Enter, Esc, 1/2/3) as well as clicks.

import { TitleController, TITLE_ACTIONS } from "../engine/title.js";
import { SAVE_SLOT_NAMES } from "../engine/save-slots.js";

let title = null;
let ctl = null;
let wrap = null;
let menuEl = null;
let slotsEl = null;
let hintEl = null;
let onKey = null;

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function render() {
  if (!title) return;
  const inSlots = ctl.mode === "slots";
  menuEl.hidden = inSlots;
  slotsEl.hidden = !inSlots;

  const items = ctl.items();
  if (!inSlots) {
    wrap.querySelectorAll(".titleMenuItem").forEach((btn, i) => {
      const item = items[i];
      btn.classList.toggle("disabled", !item.enabled);
      btn.classList.toggle("cursor", ctl.cursor === i);
      // Task #166: the Continue row advertises the most recent save so the
      // player knows what they're resuming.
      if (btn.dataset.action === "continue") {
        const recent = item.recent ?? null;
        const label = btn.querySelector(".tslContinue");
        if (label) {
          label.textContent =
            recent && recent.meta
              ? `Continue — ${recent.meta.location} · Lv ${recent.meta.level}`
              : "Continue";
        }
      }
    });
  }

  if (inSlots) {
    wrap.querySelectorAll(".titleSlot").forEach((card, i) => {
      const s = items[i];
      const meta = s?.meta ?? null;
      const nameEl = card.querySelector(".tslName");
      const metaEl = card.querySelector(".tslMeta");
      const subEl = card.querySelector(".tslSub");
      nameEl.textContent = SAVE_SLOT_NAMES[s.slot] ?? s.slot;
      if (s.has && meta) {
        card.classList.remove("empty");
        metaEl.textContent = `Lv ${meta.level} \u00b7 ${meta.gold}g \u00b7 ${meta.location}${meta.completed ? " \u00b7 \u2605" : ""}`;
        subEl.textContent = `Cycle ${meta.cycle} \u00b7 ${fmtTime(meta.playTimeSec)}${meta.freeRoam ? " \u00b7 Free Roam" : ""}`;
      } else {
        card.classList.add("empty");
        metaEl.textContent = "No save";
        subEl.textContent = "\u2014";
      }
      card.classList.toggle("cursor", ctl.cursor === i);
      card.classList.toggle("armed", ctl.armed && ctl.cursor === i);
    });
  }

  hintEl.textContent = inSlots
    ? ctl.armed
      ? "Choose a save to DELETE \u2014 \u2191\u2193 / 1-3 + Enter \u00b7 Esc to cancel"
      : "Choose a save \u2014 \u2191\u2193 / 1-3 + Enter \u00b7 Esc back"
    : "N New Game \u00b7 C Continue \u00b7 D Delete \u00b7 \u2191\u2193 choose \u00b7 Enter confirm";
}

function build(callbacks) {
  wrap = document.createElement("div");
  wrap.id = "titleWrap";
  wrap.className = "titleWrap";
  wrap.innerHTML = `
    <div class="titleMenu" id="titleMenu">
      <button class="titleMenuItem" data-action="new"><span class="tsk">N</span> New Game</button>
      <button class="titleMenuItem" data-action="continue"><span class="tsk">C</span> <span class="tslContinue">Continue</span></button>
      <button class="titleMenuItem" data-action="delete"><span class="tsk">D</span> Delete Save</button>
    </div>
    <div class="titleSlots" id="titleSlots" hidden>
      <div class="titleSlot" data-slot="A"><div class="tsl tslName"></div><div class="tsl tslMeta"></div><div class="tsl tslSub"></div></div>
      <div class="titleSlot" data-slot="B"><div class="tsl tslName"></div><div class="tsl tslMeta"></div><div class="tsl tslSub"></div></div>
      <div class="titleSlot" data-slot="C"><div class="tsl tslName"></div><div class="tsl tslMeta"></div><div class="tsl tslSub"></div></div>
    </div>
    <div class="titleHint" id="titleHint"></div>
  `;
  title.appendChild(wrap);
  menuEl = wrap.querySelector("#titleMenu");
  slotsEl = wrap.querySelector("#titleSlots");
  hintEl = wrap.querySelector("#titleHint");

  ctl = new TitleController({ slots: window.ff?.slots ?? null });
  ctl.onSelect = (action, slot) => {
    if (action === TITLE_ACTIONS.NEW) callbacks.onNewGame?.();
    else if (action === TITLE_ACTIONS.CONTINUE && slot) callbacks.onContinue?.(slot);
  };

  wrap.querySelectorAll(".titleMenuItem").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = [...wrap.querySelectorAll(".titleMenuItem")].indexOf(btn);
      ctl.cursor = idx;
      const action = btn.dataset.action;
      if (action === "new") ctl.confirm();
      else if (action === "continue") ctl.openSlots(false);
      else if (action === "delete") ctl.openSlots(true);
      render();
    });
  });
  wrap.querySelectorAll(".titleSlot").forEach((card) => {
    card.addEventListener("click", () => {
      const idx = [...wrap.querySelectorAll(".titleSlot")].indexOf(card);
      ctl.cursor = idx;
      ctl.confirm();
      render();
    });
  });

  onKey = (e) => {
    if (title.hidden || !ctl) return;
    const key = e.key;
    if (key === "Escape") {
      if (ctl.back()) render();
      return;
    }
    if (key === "ArrowUp" || key === "w") {
      e.preventDefault();
      ctl.move(-1);
      render();
      return;
    }
    if (key === "ArrowDown" || key === "s") {
      e.preventDefault();
      ctl.move(1);
      render();
      return;
    }
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      ctl.confirm();
      render();
      return;
    }
    if (ctl.mode === "menu") {
      const k = key.toLowerCase();
      if (k === "n") { ctl.cursor = 0; ctl.confirm(); render(); return; }
      if (k === "c") { ctl.cursor = 1; ctl.confirm(); render(); return; }
      if (k === "d") { ctl.cursor = 2; ctl.confirm(); render(); return; }
    } else {
      const n = parseInt(key, 10);
      if (n >= 1 && n <= 3) { ctl.cursor = n - 1; ctl.confirm(); render(); }
    }
  };
  document.addEventListener("keydown", onKey);
}

// Build the interactive title screen once (idempotent).
export function mountTitleScreen(callbacks = {}) {
  title = document.getElementById("titleScreen");
  if (!title) return null;
  if (wrap) return { controller: ctl, render };
  build(callbacks);
  render();
  return { controller: ctl, render };
}

// Re-show the title screen from inside the game (Return to Title).
export function showTitleScreen() {
  if (!title) return false;
  title.hidden = false;
  ctl?.setMode("menu");
  render();
  return true;
}

export function destroyTitleScreen() {
  if (onKey) document.removeEventListener("keydown", onKey);
  if (wrap) wrap.remove();
  wrap = null;
  ctl = null;
  onKey = null;
  title = null;
}
