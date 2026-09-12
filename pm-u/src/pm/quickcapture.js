// src/quickcapture.js — Quick capture (Roadmap task 91).
//
// A floating "Add anything" input (bottom-right, on every view) plus the `N`
// hotkey. Type a phrase + Enter and it's routed by its prefix:
//
//   (default)  "pay rent tomorrow @home p:high #bills"   → task, due tomorrow,
//                                                        project @home, priority high, tag #bills
//   note:      "n: idea for the landing page #ideas"     → note
//   event:     "e: dentist 09:30 tomorrow"               → event today/tomorrow at 09:30
//   task:      "t: ..."                                  → explicit task
//
// Other mini-syntax: @project → project (by name), #tag → tags,
// p:high|med|low (or leading !high) → priority, and a date word
// (today / tomorrow / in 2d / next monday / YYYY-MM-DD) → due date.
//
// parseQuickInput is pure + tested; initQuickCapture mounts the UI.

import { toast } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, addDays, parseIso } from "./dates.js";

const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const PRIORITIES = ["high", "med", "low"];

// Parse a date word into an ISO day. Pure.
export function parseDateWord(word, today = todayLocal()) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  if (w === "today") return today;
  if (w === "tomorrow" || w === "tmr") return addDays(today, 1);
  let m = w.match(/^in\s+(\d+)\s*(d|day|days)?$/);
  if (m) return addDays(today, Math.max(1, Number(m[1])));
  m = w.match(/^next\s+(sun|mon|tue|wed|thu|fri|sat)(day)?$/);
  if (m) {
    const target = WEEKDAY[m[1]];
    const cur = parseIso(today).getDay();
    let delta = (target - cur + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(today, delta);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  return null;
}

// Parse "quick capture" text into an entity draft. Pure. Returns null for
// empty input. draft = {type:"task"|"note"|"event", title, tags, project,
// priority, due, date, startTime}.
export function parseQuickInput(text) {
  const out = { type: "task", title: "", tags: [], project: "", priority: "med", due: null, date: null, startTime: "" };
  let body = String(text || "").trim();
  if (!body) return null;

  // type prefix: full word or single letter + colon
  let tm = body.match(/^(note|event|task)\s*:\s*(.*)$/i) || body.match(/^([nte]):\s*(.*)$/i);
  if (tm) {
    const t = tm[1].toLowerCase();
    out.type = t === "n" ? "note" : t === "e" ? "event" : t === "t" ? "task" : t;
    body = tm[2].trim();
  }

  // @project
  const pm = body.match(/@([^\s]+)/);
  if (pm) { out.project = pm[1]; body = body.replace(/@[^\s]+/, "").trim(); }

  // #tags
  body = body.replace(/#([\w-]+)/g, (mm, tag) => { if (tag) out.tags.push(tag); return " "; });

  // p:high|med|low or a leading !high/!med/!low
  let prm = body.match(/\bp:(high|med|low)\b/i) || body.match(/^!(high|med|low)\b/i);
  if (prm) {
    out.priority = prm[1].toLowerCase();
    body = body.replace(/\bp:(high|med|low)\b/i, " ").replace(/^!(high|med|low)\b/i, " ").trim();
  }

  // date word (events also pick up an explicit HH:MM start time)
  const words = body.split(/\s+/);
  let dateWord = null, dateIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const d = parseDateWord(words[i]);
    if (d && dateIdx < 0) { dateWord = d; dateIdx = i; }
  }
  if (dateWord) { out.due = dateWord; words.splice(dateIdx, 1); }
  body = words.join(" ").replace(/\s+/g, " ").trim();

  if (out.type === "event") {
    const etm = body.match(/\b(\d{1,2}):(\d{2})\b/);
    if (etm) { out.startTime = etm[0]; body = body.replace(/\b\d{1,2}:\d{2}\b/, " ").replace(/\s+/g, " ").trim(); }
    out.date = out.due || todayLocal();
  }

  out.title = body;
  if (!out.title) return null;
  return out;
}

function resolveProject(store, name) {
  if (!name) return null;
  const n = name.toLowerCase();
  const p = store.all("project").find((x) => (x.name || "").toLowerCase() === n);
  return p ? p.id : null;
}

// Create the entity from a parsed draft. Pure-ish (writes to the store).
export function commitQuickCapture(store, draft) {
  if (!draft || !draft.title) return null;
  if (draft.type === "note") {
    return store.create("note", { title: draft.title, body: "", pinned: false, tags: draft.tags, projectId: resolveProject(store, draft.project) });
  }
  if (draft.type === "event") {
    return store.create("event", { title: draft.title, date: draft.date || todayLocal(), startTime: draft.startTime || "", endTime: "", color: "#8b5cf6", notes: "" });
  }
  return store.create("task", {
    title: draft.title,
    projectId: resolveProject(store, draft.project),
    priority: PRIORITIES.includes(draft.priority) ? draft.priority : "med",
    status: "Active",
    due: draft.due || null,
    tags: draft.tags,
    notes: "",
  });
}

// Mount the floating quick-capture pill + bind the N hotkey. Idempotent.
export function initQuickCapture(store) {
  if (document.querySelector("#qcWrap")) return;
  const wrap = document.createElement("div");
  wrap.id = "qcWrap";
  wrap.innerHTML = `
    <div class="qc-pill">
      <span class="qc-ico">${ICONS.plus}</span>
      <input id="qcInput" type="text" placeholder="Quick capture…  e.g. “pay rent tomorrow @home p:high #bills”" maxlength="200" autocomplete="off" aria-label="Quick capture">
      <button class="qc-btn" id="qcBtn" title="Add" aria-label="Add">${ICONS.send}</button>
    </div>
    <div class="qc-hint">press <b>N</b> to capture · <b>t:</b> task · <b>n:</b> note · <b>e:</b> event · <b>@</b> project · <b>#</b> tag · <b>p:</b> priority</div>`;
  document.body.appendChild(wrap);

  const input = wrap.querySelector("#qcInput");
  const submit = () => {
    const draft = parseQuickInput(input.value);
    if (!draft) { toast("Type something first — e.g. “call the bank tomorrow”", "error"); return; }
    commitQuickCapture(store, draft);
    const label = draft.type === "note" ? "Note" : draft.type === "event" ? "Event" : "Task";
    toast(label + " added — “" + draft.title + "”", "success");
    input.value = "";
    input.focus();
  };
  wrap.querySelector("#qcBtn")?.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") input.blur();
  });

  const isTyping = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (document.querySelector(".modal-backdrop")) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
}
