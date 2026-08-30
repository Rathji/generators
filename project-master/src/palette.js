// src/palette.js — global search palette (Ctrl/Cmd+K)
// (Roadmap tasks 11, 12, 13)
//  - fuzzy-matches tasks, notes, events, checklists, projects, boards by
//    title/tags; arrow-key navigation, Enter opens, Esc closes.
//  - shows each item's tags as chips; clicking a chip filters to that tag.
//  - typing "/" switches to command mode (new task/note/event/project/
//    checklist/habit, start focus, toggle theme).

import { $, esc, toast } from "./ui.js";
import { ICONS } from "./icons.js";

const SEARCHABLE = ["task", "note", "event", "checklist", "project", "board"];
const TYPE_ICON = { task: "check", note: "file", event: "calendar", checklist: "checkSquare", project: "folder", board: "grid" };
const VIEW_FOR = { task: "tasks", note: "notes", event: "calendar", checklist: "checklists", project: "projects", board: "boards" };

// Lightweight fuzzy score: subsequence match, prefers start/prefix/consecutive.
export function fuzzyScore(q, s) {
  if (!q) return 0;
  s = String(s || "").toLowerCase();
  q = String(q).toLowerCase();
  if (!s) return -1;
  if (s === q) return 1000;
  if (s.startsWith(q)) return 900 + q.length;
  let qi = 0, score = 0, streak = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) { qi++; streak++; score += 1 + streak; } else streak = 0;
  }
  return qi === q.length ? score : -1;
}

function itemTitle(type, r) {
  if (type === "project") return r.name || "";
  if (type === "checklist") return r.name || "";
  return r.title || "";
}

function itemTags(type, r) {
  const t = (r.tags || r.tag || [] );
  return Array.isArray(t) ? t : t ? [t] : [];
}

export class Palette {
  constructor(store, handlers) {
    this.store = store;
    this.handlers = handlers; // { navigate(view), cycleTheme(), openItem(type, rec) }
    this.open = false;
    this.tagFilter = null;
    this.items = [];   // current result rows
    this.sel = 0;      // selected index
    this.ctn = $("#paletteRoot");
    this.input = null;
    this.list = null;
    this.hint = null;
  }

  isOpen() { return this.open; }
  toggle() { this.open ? this.close() : this.openPalette(); }

  openPalette() {
    this.open = true;
    this.tagFilter = null;
    const back = document.createElement("div");
    back.className = "palette-backdrop";
    back.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="Search">
        <input type="text" placeholder="Search tasks, notes, events, checklists, projects, boards…   (  /  = commands)" autocomplete="off" spellcheck="false">
        <div class="pal-list"></div>
        <div class="pal-hint"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span><span>click a tag chip to filter</span></div>
      </div>`;
    this.ctn.appendChild(back);
    this.backdrop = back;
    this.input = back.querySelector("input");
    this.list = back.querySelector(".pal-list");
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    back.addEventListener("mousedown", (e) => { if (e.target === back) this.close(); });
    this.render();
    this.input.focus();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.backdrop?.remove();
    this.backdrop = null; this.input = null; this.list = null;
  }

  query() { return this.input ? this.input.value.trim() : ""; }

  onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this.sel = Math.min(this.sel + 1, this.items.length - 1); this.paint(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); this.sel = Math.max(this.sel - 1, 0); this.paint(); return; }
    if (e.key === "Enter") { e.preventDefault(); this.activate(); return; }
  }

  // ── commands (task 13) ─────────────────────────────────────────
  cmdDefsList() {
    return [
      { id: "task", label: "new task", aliases: ["new task", "task"], icon: "check", hint: "create a task" },
      { id: "note", label: "new note", aliases: ["new note", "note"], icon: "file", hint: "create a note" },
      { id: "event", label: "new event", aliases: ["new event", "event"], icon: "calendar", hint: "create an event" },
      { id: "project", label: "new project", aliases: ["new project", "project"], icon: "folder", hint: "create a project" },
      { id: "checklist", label: "new checklist", aliases: ["new checklist", "checklist"], icon: "checkSquare", hint: "create a checklist" },
      { id: "habit", label: "new habit", aliases: ["new habit", "habit"], icon: "zap", hint: "create a habit" },
      { id: "focus", label: "start focus", aliases: ["start focus", "focus"], icon: "timer", hint: "open the focus timer" },
      { id: "theme", label: "toggle theme", aliases: ["toggle theme", "theme"], icon: "moon", hint: "cycle light → dark → system" },
    ];
  }

  commandDefs() {
    const q = this.query();
    if (!q.startsWith("/")) return null;
    const rest = q.slice(1).trim();
    const lower = rest.toLowerCase();
    const cmds = this.cmdDefsList();
    // exact: longest alias prefix match ("/new task Buy milk" → new task + text)
    let best = null, bestLen = 0;
    for (const cm of cmds) {
      for (const a of cm.aliases) {
        if (lower === a || lower.startsWith(a + " ")) {
          if (a.length > bestLen) { best = cm; bestLen = a.length; }
        }
      }
    }
    if (best) return { exact: best, text: rest.slice(bestLen).trim() };
    // partial list while typing ("/new", "/n", "/focus")
    const partial = cmds.filter((c) => (c.label + " " + c.hint).toLowerCase().includes(lower));
    return { partial };
  }

  runCommand(cmd, text) {
    const s = this.store;
    const today = new Date().toISOString().slice(0, 10);
    const colors = ["#8b5cf6", "#22d3ee", "#ec4899", "#22c55e", "#f59e0b"];
    switch (cmd.id) {
      case "task": s.create("task", { title: text || "New task", priority: "low", status: "Active", due: "", tags: [], notes: "", projectId: null }); toast("Task “" + (text || "New task") + "” created"); this.handlers.navigate("tasks"); break;
      case "note": s.create("note", { title: text || "New note", body: "", pinned: false, tags: [] }); toast("Note “" + (text || "New note") + "” created"); this.handlers.navigate("notes"); break;
      case "event": s.create("event", { title: text || "New event", date: today, startTime: "09:00", endTime: "10:00", color: colors[Math.floor(Math.random() * colors.length)], notes: "" }); toast("Event “" + (text || "New event") + "” created"); this.handlers.navigate("calendar"); break;
      case "project": s.create("project", { name: text || "New project", color: colors[Math.floor(Math.random() * colors.length)], status: "Active", description: "", targetDate: "" }); toast("Project “" + (text || "New project") + "” created"); this.handlers.navigate("projects"); break;
      case "checklist": s.create("checklist", { name: text || "New checklist", items: [] }); toast("Checklist “" + (text || "New checklist") + "” created"); this.handlers.navigate("checklists"); break;
      case "habit": s.create("habit", { name: text || "New habit", icon: "⭐", color: colors[Math.floor(Math.random() * colors.length)], history: {} }); toast("Habit “" + (text || "New habit") + "” created"); this.handlers.navigate("habits"); break;
      case "focus": this.handlers.navigate("focus"); break;
      case "theme": this.handlers.cycleTheme(); break;
    }
    this.close();
  }

  // ── rendering ──────────────────────────────────────────────────
  collect() {
    const q = this.query();
    if (q.startsWith("/")) {
      const c = this.commandDefs();
      if (c.exact) {
        return [{ kind: "cmd", cmd: c.exact, text: c.text, label: "/" + c.exact.label, icon: c.exact.icon, hint: c.text ? "create with title “" + c.text + "”" : c.exact.hint }];
      }
      return (c.partial || []).map((cm) => ({ kind: "cmd", cmd: cm, text: "", label: "/" + cm.label, icon: cm.icon, hint: cm.hint }));
    }
    if (!q && !this.tagFilter) {
      // empty state: show recent-ish items across types, newest first
      const rows = [];
      for (const type of SEARCHABLE) {
        for (const r of this.store.all(type)) {
          if (this.tagFilter && !itemTags(type, r).includes(this.tagFilter)) continue;
          rows.push({ type, rec: r, score: 1, tags: itemTags(type, r) });
        }
      }
      rows.sort((a, b) => (b.rec.created || 0) - (a.rec.created || 0));
      return rows.slice(0, 12);
    }
    const rows = [];
    for (const type of SEARCHABLE) {
      for (const r of this.store.all(type)) {
        if (this.tagFilter && !itemTags(type, r).includes(this.tagFilter)) continue;
        const title = itemTitle(type, r);
        const score = Math.max(fuzzyScore(q, title), ...itemTags(type, r).map((t) => fuzzyScore(q, t) - 40));
        if (score < 0) continue;
        rows.push({ type, rec: r, score, tags: itemTags(type, r) });
      }
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 14);
  }

  render() {
    this.sel = 0;
    this.items = this.collect();
    this.paint();
  }

  paint() {
    if (!this.list) return;
    const q = this.query();
    const isCmd = q.startsWith("/");
    if (!this.items.length) {
      this.list.innerHTML = `<div class="pal-empty">${isCmd ? "No matching command" : this.tagFilter ? "Nothing found with the tag “" + esc(this.tagFilter) + "”" : "No results"}</div>`;
      return;
    }
    let html = "";
    this.items.forEach((it, i) => {
      if (it.kind === "cmd") {
        html += `<div class="pal-item ${i === this.sel ? "sel" : ""}" data-i="${i}">
          <span class="ico">${ICONS[it.icon] || ""}</span>
          <div><div class="ttl"><span class="pal-cmd">${esc(it.label)}</span></div><div class="sub">${esc(it.hint)}</div></div>
        </div>`;
      } else {
        const title = itemTitle(it.type, it.rec);
        const chips = it.tags.map((t) => `<span class="chip" data-tag="${esc(t)}">#${esc(t)}</span>`).join("");
        const sub = this.store.get(it.type, it.rec.id) ? subText(it) : "";
        html += `<div class="pal-item ${i === this.sel ? "sel" : ""}" data-i="${i}">
          <span class="ico">${ICONS[TYPE_ICON[it.type]] || ""}</span>
          <div class="pal-main"><div class="ttl">${esc(title)}</div><div class="sub">${esc(sub)}</div></div>
          ${chips ? `<div class="chips">${chips}</div>` : ""}
        </div>`;
      }
    });
    this.list.innerHTML = html;
    this.list.querySelectorAll(".pal-item").forEach((row) => {
      const i = parseInt(row.dataset.i, 10);
      row.addEventListener("mousemove", () => { this.sel = i; this.paintSel(); });
      row.addEventListener("click", () => { this.sel = i; this.activate(); });
    });
    this.list.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = chip.dataset.tag;
        this.tagFilter = this.tagFilter === t ? null : t;
        this.render();
      });
    });
    this.paintSel();
  }

  paintSel() {
    this.list.querySelectorAll(".pal-item").forEach((row, i) => row.classList.toggle("sel", i === this.sel));
    const sel = this.list.querySelector(".pal-item.sel");
    sel?.scrollIntoView({ block: "nearest" });
  }

  activate() {
    const it = this.items[this.sel];
    if (!it) return;
    if (it.kind === "cmd") { this.runCommand(it.cmd, it.text); return; }
    this.close();
    if (this.handlers.openItem) this.handlers.openItem(it.type, it.rec);
    else this.handlers.navigate(VIEW_FOR[it.type]);
  }
}

function subText(it) {
  const r = it.rec;
  if (it.type === "task") { const due = r.due ? " · due " + r.due : ""; return (r.status || "Active") + due; }
  if (it.type === "event") return (r.date || "") + (r.startTime ? " " + r.startTime : "");
  if (it.type === "project") return (r.status || "Active") + (r.targetDate ? " · target " + r.targetDate : "");
  if (it.type === "checklist") { const items = r.items || []; const done = items.filter((i) => i.done).length; return items.length ? done + "/" + items.length + " done" : "empty"; }
  if (it.type === "note") return r.body ? (r.body.slice(0, 40) + (r.body.length > 40 ? "…" : "")) : "empty note";
  if (it.type === "board") { const bt = r.type || "mindmap"; const n = (r.items || []).length; return bt + " · " + n + " item" + (n === 1 ? "" : "s"); }
  return "";
}
