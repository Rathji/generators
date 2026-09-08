// ============================================================================
// PROJECTS — Phase 10, Task 83
// window.Projects — the OS-wide task/todo data layer, persisted in the kv-plugin
// (root.kv.webuntuProjects). Used by the Projects app itself and by the AI
// assistant's `tasks` / `nexttask` tools. Task shape:
//   { id, title, status:"todo"|"doing"|"done", priority:0|1|2, notes:"",
//     pomodoros:0, createdAt, doneAt }
// window.AppContent["projects"] — the Projects app (Start menu → Developer):
// a project list, a 3-column kanban board, a pomodoro timer (25/5/15, one 🍅
// added to the task in progress per completed focus phase), and backlog export
// to the virtual FS at /home/user/Projects/<slug>.md (and import back).
// ============================================================================
(function () {
  "use strict";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function toast(title, body, icon) {
    if (window.Notify && window.Notify.toast) window.Notify.toast(title, body, { icon: icon || "🗂️", app: "Projects" });
  }
  function play(name) {
    if (window.Sounds && window.Sounds.play) { try { window.Sounds.play(name); } catch (e) {} }
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const PRIO = [["🔵", "Low"], ["🟡", "Medium"], ["⚡", "High"]];
  const STATUS_ORDER = ["todo", "doing", "done"];

  // ---- storage (kv with in-memory fallback) --------------------------------
  const memory = {};
  async function kvFolder() {
    const root = window.root;
    if (root && root.kv && root.kv.webuntuProjects) return root.kv.webuntuProjects;
    return null;
  }
  async function kget(key) {
    const kv = await kvFolder();
    if (kv) { try { return await kv.get(key); } catch (e) {} }
    return key in memory ? memory[key] : null;
  }
  async function kset(key, val) {
    memory[key] = val;
    const kv = await kvFolder();
    if (kv) { try { await kv.set(key, val); } catch (e) {} }
  }
  async function kdel(key) {
    delete memory[key];
    const kv = await kvFolder();
    if (kv) { try { await kv.delete(key); } catch (e) {} }
  }

  // ---- project helpers ------------------------------------------------------
  function newProject(name, icon) {
    const now = Date.now();
    return { id: uid(), name: name || "Untitled project", icon: icon || "📁", createdAt: now, updatedAt: now };
  }
  async function ensureSeeded() {
    let list = (await kget("list")) || null;
    if (list && typeof list === "object" && Object.keys(list).length) return list;
    const p = newProject("Getting Started", "🚀");
    list = { [p.id]: p };
    await kset("list", list);
    await kset("active", p.id);
    const now = Date.now();
    await kset("tasks:" + p.id, [
      { id: uid(), title: "Move tasks between columns with ◀ ▶", status: "doing", priority: 2, notes: "", pomodoros: 0, createdAt: now, doneAt: null },
      { id: uid(), title: "Run a pomodoro to get a 🍅", status: "todo", priority: 1, notes: "25 minutes of focus, then a break.", pomodoros: 0, createdAt: now, doneAt: null },
      { id: uid(), title: "Export the backlog to the file system", status: "todo", priority: 0, notes: "", pomodoros: 0, createdAt: now, doneAt: null },
    ]);
    return list;
  }
  async function touch(projId) {
    const list = await ensureSeeded();
    if (list[projId]) { list[projId].updatedAt = Date.now(); await kset("list", list); }
  }

  // ---- window.Projects data layer ------------------------------------------
  const Projects = {
    async listProjects() { return ensureSeeded(); },
    async getProject(id) {
      const list = await ensureSeeded();
      return list[id] || null;
    },
    async getActiveId() {
      await ensureSeeded();
      let a = await kget("active");
      const list = await kget("list") || {};
      if (!a || !list[a]) { a = Object.keys(list)[0] || null; if (a) await kset("active", a); }
      return a;
    },
    async setActive(id) { await kset("active", id); return id; },
    async createProject(name, icon) {
      const list = await ensureSeeded();
      const iconPool = ["🚀", "📁", "🧪", "📚", "🎨", "💡", "🌱", "🗺️"];
      const p = newProject(name, icon || iconPool[Object.keys(list).length % iconPool.length]);
      list[p.id] = p;
      await kset("list", list);
      await kset("tasks:" + p.id, []);
      await kset("active", p.id);
      return p;
    },
    async renameProject(id, name, icon) {
      const list = await ensureSeeded();
      const p = list[id];
      if (!p) return null;
      if (name) p.name = name;
      if (icon) p.icon = icon;
      await kset("list", list);
      return p;
    },
    async deleteProject(id) {
      const list = await ensureSeeded();
      if (!list[id]) return false;
      delete list[id];
      await kset("list", list);
      await kdel("tasks:" + id);
      if ((await kget("active")) === id) {
        const next = Object.keys(list)[0] || null;
        await kset("active", next);
      }
      return true;
    },
    async loadTasks(projId) {
      const t = await kget("tasks:" + projId);
      return Array.isArray(t) ? t : [];
    },
    async saveTasks(projId, tasks) {
      await kset("tasks:" + projId, tasks);
      await touch(projId);
      return tasks;
    },
    async addTask(projId, title, opts) {
      opts = opts || {};
      title = String(title || "").trim();
      if (!title) return null;
      const t = await Projects.loadTasks(projId);
      const task = {
        id: uid(),
        title: title.replace(/^-\s*\[\s*\]\s*/, ""),
        status: opts.status || "todo",
        priority: Math.max(0, Math.min(2, opts.priority == null ? 1 : opts.priority)),
        notes: opts.notes || "",
        pomodoros: 0,
        createdAt: Date.now(),
        doneAt: (opts.status || "todo") === "done" ? Date.now() : null,
      };
      t.unshift(task);
      await Projects.saveTasks(projId, t);
      return task;
    },
    async moveTask(projId, id, delta) {
      const t = await Projects.loadTasks(projId);
      const i = t.findIndex(x => x.id === id);
      if (i < 0) return null;
      const task = t[i];
      const cur = STATUS_ORDER.indexOf(task.status);
      const next = Math.max(0, Math.min(2, cur + (delta || 1)));
      if (next === cur) return task;
      task.status = STATUS_ORDER[next];
      task.doneAt = next === 2 ? (task.doneAt || Date.now()) : null;
      await Projects.saveTasks(projId, t);
      return task;
    },
    async setStatus(projId, id, status) {
      const t = await Projects.loadTasks(projId);
      const i = t.findIndex(x => x.id === id);
      if (i < 0) return null;
      const task = t[i];
      task.status = status;
      task.doneAt = status === "done" ? (task.doneAt || Date.now()) : null;
      await Projects.saveTasks(projId, t);
      return task;
    },
    async deleteTask(projId, id) {
      const t = await Projects.loadTasks(projId);
      const next = t.filter(x => x.id !== id);
      if (next.length !== t.length) await Projects.saveTasks(projId, next);
      return next;
    },
    async setPriority(projId, id, priority) {
      const t = await Projects.loadTasks(projId);
      const i = t.findIndex(x => x.id === id);
      if (i < 0) return null;
      t[i].priority = Math.max(0, Math.min(2, priority));
      await Projects.saveTasks(projId, t);
      return t[i];
    },
    async bumpPomodoro(projId, id) {
      const t = await Projects.loadTasks(projId);
      const i = t.findIndex(x => x.id === id);
      if (i < 0) return null;
      t[i].pomodoros = (t[i].pomodoros || 0) + 1;
      await Projects.saveTasks(projId, t);
      return t[i];
    },
    // The single most useful task: the task currently in progress, else the
    // highest-priority oldest open task, else null.
    async nextTask(projId) {
      const pid = projId || (await Projects.getActiveId());
      if (!pid) return null;
      const t = await Projects.loadTasks(pid);
      const doing = t.filter(x => x.status === "doing").sort((a, b) => ((b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)));
      if (doing.length) return { project: pid, task: doing[0], reason: "in progress" };
      const todos = t.filter(x => x.status === "todo").sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt));
      if (todos.length) return { project: pid, task: todos[0], reason: "next up" };
      return null;
    },
    // Export the project's tasks to /home/user/Projects/<slug>.md on the
    // virtual file system (GitHub-style checklist, priority + 🍅 tags).
    async saveBacklog(projId) {
      const pid = projId || (await Projects.getActiveId());
      const proj = await Projects.getProject(pid);
      if (!proj) return { ok: false, error: "no such project" };
      const FS = window.FS, FSPath = window.FSPath;
      if (!FS || !FSPath) return { ok: false, error: "file system unavailable" };
      try {
        const folder = "/home/user/Projects";
        if (!FS.isFolder(FS.resolve(folder))) {
          FS.create("/home/user", { name: "Projects", type: "folder", icon: "🗂️", meta: {} });
        }
        const md = buildMarkdown(proj, await Projects.loadTasks(pid));
        const path = FSPath.childPath(folder, slugify(proj.name) + ".md");
        const bytes = new TextEncoder().encode(md).length;
        const existing = FS.resolve(path);
        if (existing && FS.isFile(existing)) {
          existing.meta = existing.meta || {};
          existing.meta.content = md;
          existing.meta.size = bytes;
          existing.meta.modified = Date.now();
        } else {
          FS.create(folder, { name: slugify(proj.name) + ".md", type: "file", icon: "📄", meta: { content: md, size: bytes, modified: Date.now() } });
        }
        return { ok: true, path };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    },
    // Read the project's .md backlog back in and add any tasks that aren't
    // already present (matched by title). Returns { ok, added, path }.
    async importBacklog(projId) {
      const pid = projId || (await Projects.getActiveId());
      const proj = await Projects.getProject(pid);
      if (!proj) return { ok: false, error: "no such project" };
      const FS = window.FS, FSPath = window.FSPath;
      if (!FS || !FSPath) return { ok: false, error: "file system unavailable" };
      try {
        const path = FSPath.childPath("/home/user/Projects", slugify(proj.name) + ".md");
        const node = FS.resolve(path);
        if (!node || !FS.isFile(node) || !node.meta || node.meta.content == null) {
          return { ok: false, error: "no backlog file at " + path, path };
        }
        const tasks = await Projects.loadTasks(pid);
        const known = new Set(tasks.map(x => x.title.trim().toLowerCase()));
        const statusMap = { " ": "todo", "~": "doing", "x": "done" };
        let added = 0;
        for (const line of String(node.meta.content).split("\n")) {
          const m = line.match(/^\s*-\s*\[([ x~])\]\s*(.+)$/);
          if (!m) continue;
          let title = m[2].trim();
          let priority = 1;
          if (title.includes("⚡")) priority = 2; else if (title.includes("🔵")) priority = 0;
          title = title.replace(/[⚡🟡🔵].*$/, "").trim();
          if (!title || known.has(title.toLowerCase())) continue;
          const st = statusMap[m[1]] || "todo";
          tasks.unshift({ id: uid(), title, status: st, priority, notes: "", pomodoros: 0, createdAt: Date.now(), doneAt: st === "done" ? Date.now() : null });
          known.add(title.toLowerCase());
          added++;
        }
        if (added) await Projects.saveTasks(pid, tasks);
        return { ok: true, added, path };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      }
    },
  };

  function slugify(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  }
  function buildMarkdown(proj, tasks) {
    const lines = ["# " + proj.name, "", "Last updated: " + new Date().toLocaleString(), ""];
    const secs = [["todo", "To do"], ["doing", "Doing"], ["done", "Done"]];
    for (const [st, label] of secs) {
      const group = tasks.filter(t => t.status === st);
      lines.push("## " + label);
      if (!group.length) lines.push("_none_");
      for (const t of group) {
        const box = st === "done" ? "x" : (st === "doing" ? "~" : " ");
        const prio = t.priority === 2 ? " ⚡" : (t.priority === 0 ? " 🔵" : " 🟡");
        lines.push("- [" + box + "] " + t.title + prio + (t.pomodoros ? " 🍅" + t.pomodoros : ""));
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  // ---- pomodoro ------------------------------------------------------------
  const DUR = { work: 25 * 60, short: 5 * 60, long: 15 * 60 };
  const PHASE_LABEL = { work: "Focus", short: "Short break", long: "Long break" };
  const pomo = { phase: "work", running: false, left: DUR.work, cycle: 0, targetId: null, timer: null };
  const pomoRefs = {};
  let state = { pid: null, tasks: [] };

  function fmtClock(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  // startTimer/stopTimer/tick/completePhase/skipPhase/renderPomo live inside
  // build() — they touch the app's DOM refs.

  // ==========================================================================
  // APP
  // ==========================================================================
  function build() {
    const view = el("div", "prj");

    // --- header ---
    const top = el("div", "prj-top");
    const title = el("div", "prj-name", "🗂️ ");
    title.appendChild(el("b", "", "Projects"));
    top.appendChild(title);

    pomoRefs.phase = el("div", "prj-pomo-phase", "Focus");
    pomoRefs.clock = el("div", "prj-pomo-clock", "25:00");
    const bar = el("div", "prj-pomo-bar");
    pomoRefs.bar = el("i");
    bar.appendChild(pomoRefs.bar);
    pomoRefs.cycle = el("div", "prj-pomo-cycle", "");
    pomoRefs.start = el("button", "prj-pomo-btn", "▶ Start");
    pomoRefs.skip = el("button", "prj-pomo-btn", "⏭ Skip");
    const pomoBox = el("div", "prj-pomo");
    pomoBox.append(pomoRefs.phase, pomoRefs.clock, bar, pomoRefs.cycle, pomoRefs.start, pomoRefs.skip);
    top.appendChild(pomoBox);
    view.appendChild(top);

    // --- body ---
    const body = el("div", "prj-body");

    // sidebar
    const side = el("div", "prj-side");
    const sideHdr = el("div", "prj-side-hdr");
    sideHdr.appendChild(el("span", "", "PROJECTS"));
    const sideAdd = el("button", "prj-side-add", "＋");
    sideAdd.title = "New project";
    sideHdr.appendChild(sideAdd);
    side.appendChild(sideHdr);
    const sideList = el("div", "prj-side-list");
    side.appendChild(sideList);
    const sideFoot = el("div", "prj-side-foot");
    const bkSave = el("button", "prj-bkbtn", "📄 Save backlog");
    const bkLoad = el("button", "prj-bkbtn", "📥 Load backlog");
    bkSave.title = "Write the active project as a checklist to the file system";
    bkLoad.title = "Read tasks back in from the file system";
    sideFoot.append(bkSave, bkLoad);
    sideFoot.appendChild(el("div", "prj-bkhint", "Backlog ↔ /home/user/Projects/<name>.md"));
    side.appendChild(sideFoot);
    body.appendChild(side);

    // main
    const main = el("div", "prj-main");
    const next = el("div", "prj-next");
    next.appendChild(el("span", "", "🤖"));
    const nextTxt = el("div", "prj-next-txt");
    next.appendChild(nextTxt);
    const nextDone = el("button", "prj-next-btn", "✓ Done");
    const nextFocus = el("button", "prj-next-btn", "▶ Focus 25");
    next.append(nextDone, nextFocus);
    main.appendChild(next);

    const board = el("div", "prj-board");
    main.appendChild(board);
    body.appendChild(main);
    view.appendChild(body);

    // ---- modals (no native dialogs) ----
    function modalPrompt(title, opts) {
      opts = opts || {};
      return new Promise(res => {
        const overlay = el("div", "prj-modal");
        const box = el("div", "prj-modal-box");
        box.appendChild(el("div", "prj-modal-title", title));
        const input = el("input", "prj-modal-input");
        input.placeholder = opts.placeholder || "";
        input.value = opts.value || "";
        const row = el("div", "prj-modal-row");
        const ok = el("button", "prj-modal-btn go", opts.okLabel || "OK");
        const cancel = el("button", "prj-modal-btn", "Cancel");
        row.append(cancel, ok);
        box.append(input, row);
        overlay.appendChild(box);
        view.appendChild(overlay);
        function done(val) { overlay.remove(); res(val); }
        ok.onclick = () => done((input.value || "").trim() || null);
        cancel.onclick = () => done(null);
        overlay.addEventListener("click", e => { if (e.target === overlay) done(null); });
        input.addEventListener("keydown", e => {
          if (e.key === "Enter") ok.click();
          if (e.key === "Escape") cancel.click();
        });
        setTimeout(() => input.focus(), 0);
      });
    }
    function modalConfirm(title, message) {
      return new Promise(res => {
        const overlay = el("div", "prj-modal");
        const box = el("div", "prj-modal-box");
        box.appendChild(el("div", "prj-modal-title", title));
        box.appendChild(el("div", "prj-modal-msg", message));
        const row = el("div", "prj-modal-row");
        const no = el("button", "prj-modal-btn", "Cancel");
        const yes = el("button", "prj-modal-btn danger", "Delete");
        row.append(no, yes);
        box.appendChild(row);
        overlay.appendChild(box);
        view.appendChild(overlay);
        function done(v) { overlay.remove(); res(v); }
        yes.onclick = () => done(true);
        no.onclick = () => done(false);
        overlay.addEventListener("click", e => { if (e.target === overlay) done(false); });
      });
    }

    // ---- rendering ----
    async function loadActive() {
      state.pid = await Projects.getActiveId();
      state.tasks = await Projects.loadTasks(state.pid);
    }
    function openCount() {
      return state.tasks.filter(t => t.status !== "done").length;
    }
    // ---- pomodoro ----
    function renderPomo() {
      pomoRefs.phase.textContent = PHASE_LABEL[pomo.phase];
      pomoRefs.clock.textContent = fmtClock(Math.max(0, pomo.left));
      pomoRefs.bar.style.width = Math.max(0, Math.min(100, (pomo.left / DUR[pomo.phase]) * 100)) + "%";
      pomoRefs.bar.style.background = pomo.phase === "work" ? "var(--accent, #7c6cff)" : "#34d399";
      pomoRefs.cycle.textContent = pomo.cycle ? "🍅 " + ((pomo.cycle % 4) || 4) + "/4" : "";
      pomoRefs.start.textContent = pomo.running ? "⏸ Pause" : "▶ " + (pomo.phase === "work" && pomo.left >= DUR.work ? "Start" : "Resume");
      pomoRefs.start.disabled = false;
    }
    function startTimer() {
      pomo.running = true;
      if (!pomo.timer) pomo.timer = setInterval(tick, 1000);
      renderPomo();
    }
    function stopTimer() {
      pomo.running = false;
      if (pomo.timer) { clearInterval(pomo.timer); pomo.timer = null; }
    }
    function tick() {
      if (!pomo.running) return;
      pomo.left--;
      if (pomo.left <= 0) { completePhase(); } else { renderPomo(); }
    }
    async function completePhase() {
      if (pomo.phase !== "work") {
        play("done");
        toast("Break over", "Back to work whenever you're ready.", "☕");
        pomo.phase = "work";
        pomo.left = DUR.work;
        stopTimer();
        renderPomo();
        return;
      }
      pomo.cycle++;
      let bumped = null;
      if (pomo.targetId) bumped = await Projects.bumpPomodoro(state.pid, pomo.targetId);
      if (!bumped) {
        const n = await Projects.nextTask(state.pid);
        if (n && n.task && n.task.status === "doing") bumped = await Projects.bumpPomodoro(state.pid, n.task.id);
      }
      pomo.targetId = null;
      play("done");
      const who = bumped ? "✓ \"" + bumped.title + "\"" : "Nice work";
      pomo.phase = (pomo.cycle % 4 === 0) ? "long" : "short";
      pomo.left = DUR[pomo.phase];
      toast("Pomodoro complete", who + " — taking a " + fmtClock(DUR[pomo.phase]) + " break.", "🍅");
      startTimer();
      renderBoard();
      renderSuggestion();
    }
    function skipPhase() {
      pomo.phase = pomo.phase === "work" ? "short" : "work";
      pomo.left = DUR[pomo.phase];
      pomo.targetId = null;
      stopTimer();
      renderPomo();
    }
    function renderTitle() {
      const proj = state.pid && window.Projects ? null : null;
      (async () => {
        const p = await Projects.getProject(state.pid);
        title.innerHTML = "";
        title.appendChild(el("span", "", "🗂️ "));
        const b = el("b", "", p ? p.name : "Projects");
        title.appendChild(b);
        title.appendChild(el("small", "", " · " + openCount() + " open"));
      })();
    }
    function renderSide() {
      sideList.innerHTML = "";
      (async () => {
        const list = await Projects.listProjects();
        const ids = Object.keys(list).sort((a, b) => list[b].updatedAt - list[a].updatedAt);
        for (const id of ids) {
          const p = list[id];
          const btn = el("button", "prj-proj" + (id === state.pid ? " on" : ""));
          btn.appendChild(el("span", "prj-proj-ico", p.icon || "📁"));
          btn.appendChild(el("span", "prj-proj-name", p.name));
          const r = el("button", "prj-proj-x", "✎");
          r.title = "Rename project";
          r.onclick = async e => {
            e.stopPropagation();
            const name = await modalPrompt("Rename project", { value: p.name, okLabel: "Save" });
            if (name && name !== p.name) {
              await Projects.renameProject(id, name);
              await refreshAll();
            }
          };
          btn.appendChild(r);
          const x = el("button", "prj-proj-x", "✕");
          x.title = "Delete project";
          x.onclick = async e => {
            e.stopPropagation();
            if (await modalConfirm("Delete \"" + p.name + "\"?", "Its tasks will be removed too.")) {
              await Projects.deleteProject(id);
              await refreshAll();
            }
          };
          btn.appendChild(x);
          btn.onclick = async () => {
            if (id === state.pid) return;
            await Projects.setActive(id);
            await refreshAll();
          };
          sideList.appendChild(btn);
        }
      })();
    }
    function addRow(colStatus) {
      const row = el("div", "prj-col-addrow");
      row.hidden = true;
      const input = el("input", "prj-col-input");
      input.placeholder = "New task… (Enter to add)";
      const okBtn = el("button", "prj-col-ok", "✓");
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") okBtn.click();
        if (e.key === "Escape") { row.hidden = true; input.value = ""; }
      });
      okBtn.onclick = async () => {
        const val = input.value.trim();
        if (!val) return;
        input.disabled = true;
        await Projects.addTask(state.pid, val, { status: colStatus });
        input.value = "";
        input.disabled = false;
        row.hidden = true;
        await refreshAll();
      };
      row.append(input, okBtn);
      return row;
    }
    function renderBoard() {
      board.innerHTML = "";
      const projId = state.pid;
      const COLS = [
        { status: "todo", label: "📋 To do" },
        { status: "doing", label: "🔥 Doing" },
        { status: "done", label: "✅ Done" },
      ];
      for (const col of COLS) {
        const colEl = el("div", "prj-col");
        const hdr = el("div", "prj-col-hdr");
        hdr.appendChild(el("span", "", col.label));
        hdr.appendChild(el("span", "prj-col-count", String(state.tasks.filter(t => t.status === col.status).length)));
        const addBtn = el("button", "prj-col-add", "＋");
        addBtn.title = "Add task to " + col.label;
        hdr.appendChild(addBtn);
        colEl.appendChild(hdr);
        const rowEl = addRow(col.status);
        colEl.appendChild(rowEl);
        addBtn.onclick = () => {
          rowEl.hidden = !rowEl.hidden;
          if (!rowEl.hidden) { const inp = rowEl.querySelector("input"); if (inp) inp.focus(); }
        };
        const cards = el("div", "prj-cards");
        colEl.appendChild(cards);
        const items = state.tasks.filter(t => t.status === col.status);
        if (!items.length) {
          cards.appendChild(el("div", "prj-empty", "Nothing here — add a task."));
        }
        for (const task of items) {
          cards.appendChild(buildCard(task, projId));
        }
        board.appendChild(colEl);
      }
    }
    function buildCard(task, projId) {
      const card = el("div", "prj-card" + (task.status === "done" ? " done" : (task.status === "doing" ? " doing" : "")));
      const topRow = el("div", "prj-card-top");
      const sel = el("select", "prj-prio");
      sel.title = "Priority";
      for (let p = 0; p < 3; p++) {
        const opt = el("option", "", PRIO[p][0]);
        opt.value = String(p);
        if (p === task.priority) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = async () => {
        await Projects.setPriority(projId, task.id, Number(sel.value));
        await refreshAll();
      };
      const titleEl = el("div", "prj-card-title", task.title);
      topRow.append(sel, titleEl);
      card.appendChild(topRow);

      const meta = el("div", "prj-card-meta");
      meta.appendChild(el("span", "prj-pomo-count", task.pomodoros ? "🍅 " + task.pomodoros : ""));
      const btns = el("div", "prj-card-btns");
      const cur = STATUS_ORDER.indexOf(task.status);
      const mvL = el("button", "prj-move", "◀");
      mvL.title = "Move back";
      mvL.disabled = cur === 0;
      mvL.onclick = async () => { await Projects.moveTask(projId, task.id, -1); await refreshAll(); };
      const mvR = el("button", "prj-move", "▶");
      mvR.title = "Move forward";
      mvR.disabled = cur === 2;
      mvR.onclick = async () => { await Projects.moveTask(projId, task.id, 1); await refreshAll(); };
      const del = el("button", "prj-del", "✕");
      del.title = "Delete task";
      del.onclick = async () => {
        if (await modalConfirm("Delete task?", "\"" + task.title + "\"")) {
          await Projects.deleteTask(projId, task.id);
          await refreshAll();
        }
      };
      btns.append(mvL, mvR, del);
      meta.appendChild(btns);
      card.appendChild(meta);
      return card;
    }
    async function renderSuggestion() {
      const n = await Projects.nextTask(state.pid);
      nextTxt.innerHTML = "";
      if (!n || !n.task) {
        nextTxt.appendChild(el("span", "", "No open tasks in "));
        const p = await Projects.getProject(state.pid);
        nextTxt.appendChild(el("b", "", (p ? p.name : "this project") + " — add one below or ask the assistant."));
        nextDone.disabled = true;
        nextFocus.disabled = true;
        return;
      }
      const b = el("b", "", n.task.title);
      nextTxt.appendChild(b);
      nextTxt.appendChild(el("span", "", "  ·  " + (n.reason === "in progress" ? "in progress" : "highest priority open task")));
      nextDone.disabled = false;
      nextFocus.disabled = false;
      nextDone.onclick = async () => {
        await Projects.setStatus(n.project, n.task.id, "done");
        await refreshAll();
      };
      nextFocus.onclick = async () => {
        pomo.targetId = n.task.id;
        pomo.phase = "work";
        pomo.left = DUR.work;
        startTimer();
      };
    }
    async function refreshAll() {
      await loadActive();
      renderTitle();
      renderSide();
      renderBoard();
      renderSuggestion();
      renderPomo();
    }

    // ---- sidebar actions ----
    sideAdd.onclick = async () => {
      const name = await modalPrompt("New project", { placeholder: "Project name" });
      if (!name) return;
      const p = await Projects.createProject(name);
      toast("Project created", "\"" + p.name + "\" is now active.", "🗂️");
      await refreshAll();
    };
    bkSave.onclick = async () => {
      bkSave.disabled = true;
      const r = await Projects.saveBacklog(state.pid);
      bkSave.disabled = false;
      if (r.ok) toast("Backlog saved", "Exported to " + r.path, "📄");
      else toast("Backlog save failed", r.error || "unknown error", "⚠️");
    };
    bkLoad.onclick = async () => {
      bkLoad.disabled = true;
      const r = await Projects.importBacklog(state.pid);
      bkLoad.disabled = false;
      if (r.ok) {
        toast("Backlog loaded", r.added ? r.added + " task" + (r.added === 1 ? "" : "s") + " imported from " + r.path : "No new tasks found in " + r.path, "📥");
        await refreshAll();
      } else {
        toast("Backlog load failed", r.error || "unknown error", "⚠️");
      }
    };
    pomoRefs.start.onclick = () => {
      if (pomo.running) stopTimer(); else startTimer();
      renderPomo();
    };
    pomoRefs.skip.onclick = () => { skipPhase(); };

    // narrow-window layout: the app stacks vertically when its own width drops
    // below 780px (independent of the page viewport, so a small window on a
    // desktop behaves like a phone).
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => { view.classList.toggle("narrow", view.clientWidth < 780); });
      ro.observe(view);
    }

    refreshAll();
    return { root: view, onClose() { stopTimer(); if (ro) ro.disconnect(); } };
  }

  window.Projects = Projects;

  window.AppContent = window.AppContent || {};
  window.AppContent["projects"] = function () {
    const built = build();
    return { content: built.root, w: 980, h: 620, minW: 340, minH: 400, onCloseRequest: built.onClose };
  };
})();
