import { $, debounce, toast, fmtClock } from "./util.js";
import { createPlan, serialize, parsePlan, trimBrokenWires, nodeById } from "./model.js";
import { demoBoard } from "./content.js";
import { Editor } from "./editor.js";
import { init as initPanels, renderInspector, updateToolbar, updateStatus, isTyping, arrangePlan } from "./panels.js";

const AUTOSAVE_OPS = new Set(["add", "remove", "wire", "move", "duplicate", "edit", "arrange", "replace", "load"]);
const STORE_PREFIX = "sysplan:";

const kvFolder = () => {
  try {
    return (window.root && root.kv && root.kv.sysplan) || null;
  } catch {
    return null;
  }
};

async function storeGet(key) {
  const f = kvFolder();
  if (f) {
    try {
      const v = await f.get(key);
      if (v !== undefined && v !== null) return v;
    } catch (e) {
      /* fall through to localStorage */
    }
  }
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function storeSet(key, val) {
  const f = kvFolder();
  if (f) {
    try {
      await f.set(key, val);
      return true;
    } catch (e) {
      /* fall through */
    }
  }
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(val));
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const stage = $("#stage");
  if (!stage) return;

  /* ------- initial plan: autosave → demo ------- */
  let plan = null;
  try {
    const saved = await storeGet("autosave");
    if (saved && saved.text) plan = parsePlan(saved.text);
  } catch (e) {
    console.warn("autosave load failed", e);
  }
  const firstRun = !plan;
  if (!plan) plan = demoBoard();

  const editor = new Editor(stage, {
    plan,
    onHint: (t) => {
      const el = $("#statusHint");
      if (el) el.textContent = t;
    },
    onChange: (op) => onEditorChange(op),
  });

  /* ------- ctx shared by panels ------- */
  const ctx = {
    editor,
    lastSavedAt: null,
    slotsMap: {},
    slots: [],
    get slotNames() {
      return this.slots.map((s) => s.name);
    },

    refresh() {
      updateToolbar(this);
      updateStatus(this);
      renderInspector(this);
    },

    async flushSave() {
      await saveAutosave();
      toast("Saved");
    },

    /* ----- node fields ----- */
    liveNodeField(id, field, val) {
      const n = nodeById(editor.plan, id);
      if (!n) return;
      n[field] = val;
      editor.updateNodeView(id);
    },
    commitNodeField(id, field, val) {
      const n = nodeById(editor.plan, id);
      if (!n) return;
      n[field] = val;
      editor.record();
      editor.render();
      onEditorChange("edit");
    },
    commitNodeEdit(id, field, val) {
      this.commitNodeField(id, field, val);
    },
    setPort(id, side, i, patch) {
      const n = nodeById(editor.plan, id);
      if (!n || !n[side] || !n[side][i]) return;
      Object.assign(n[side][i], patch);
      editor.record();
      editor.render();
      onEditorChange("edit");
    },
    addPort(id, side) {
      const n = nodeById(editor.plan, id);
      if (!n || n.note) return;
      n[side] = n[side] || [];
      n[side].push({ label: "new", type: "data" });
      editor.record();
      editor.render();
      onEditorChange("edit");
      const rows = document.querySelectorAll("#inspectorBody .port-edit-row");
      const last = rows[rows.length - 1];
      if (last) {
        const inp = last.querySelector("input");
        if (inp) {
          inp.focus();
          inp.select();
        }
      }
    },
    removePort(id, side, i) {
      const n = nodeById(editor.plan, id);
      if (!n) return;
      n[side] = n[side].filter((_, k) => k !== i);
      trimBrokenWires(editor.plan);
      editor.record();
      editor.render();
      onEditorChange("edit");
    },

    /* ----- board ops ----- */
    duplicateSelection() {
      editor.duplicateSelection();
    },
    paletteAdd(cat, item, at) {
      if (!at) {
        const c = editor.screenCenter();
        at = editor.world(c.x, c.y);
        at.x -= 100;
        at.y -= 46;
      }
      editor.addNodeLike({ category: cat, ...item }, at);
    },
    quickNote() {
      const c = editor.screenCenter();
      const at = editor.world(c.x, c.y);
      at.x -= 80;
      at.y -= 40;
      editor.addNote(at);
    },
    autoArrange() {
      if (editor.plan.nodes.length < 2) return;
      arrangePlan(editor.plan);
      editor.record();
      editor.render();
      editor.fit();
      onEditorChange("arrange");
    },
    replaceWithPlan(plan, { fit = true, msg = null } = {}) {
      editor.replacePlan(plan);
      if (fit) editor.fit();
      if (msg) toast(msg);
    },
    newBlankPlan() {
      this.replaceWithPlan(createPlan(), { fit: true, msg: "New blank board — press Ctrl+Z to bring the old one back" });
    },
    addCluster(clusterPlan, { fit = true, msg = null } = {}) {
      if (!clusterPlan.nodes.length) return;
      const cur = editor.plan;
      let minX = Infinity, minY = Infinity;
      for (const n of clusterPlan.nodes) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
      }
      let maxX = -Infinity, maxY = -Infinity;
      for (const n of cur.nodes) {
        maxX = Math.max(maxX, n.x + (n.note ? 180 : 208));
        maxY = Math.max(maxY, n.y + 160);
      }
      const dx = 60 - minX;
      const dy = cur.nodes.length ? maxY + 220 - minY : 60 - minY;
      const idMap = new Map();
      const fresh = [];
      for (const n of clusterPlan.nodes) {
        const { id, ...rest } = n;
        const copy = { ...rest, x: n.x + dx, y: n.y + dy };
        const made = editor.addNodeQuiet(copy);
        idMap.set(id, made.id);
        fresh.push(made);
      }
      for (const w of clusterPlan.wires) {
        const a = idMap.get(w.src.n), b = idMap.get(w.dst.n);
        if (a != null && b != null) editor.addWireQuiet(a, w.src.o, b, w.dst.i);
      }
      editor.record();
      editor.render();
      editor.sel.clear();
      editor.selW.clear();
      for (const f of fresh) editor.sel.add(f.id);
      if (fit) editor.fit();
      onEditorChange("arrange");
      if (msg) toast(msg);
    },

    /* ----- files ----- */
    exportPlan() {
      const text = serialize(editor.plan);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
      a.href = url;
      a.download = `sys-plan-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Plan exported as JSON");
    },

    /* ----- slots ----- */
    async saveSlot(name) {
      const map = { ...ctx.slotsMap };
      map[name] = { ts: Date.now(), text: serialize(editor.plan) };
      const ok = await storeSet("slots", map);
      if (!ok) {
        toast("Couldn't save slot (storage unavailable).", true);
        return;
      }
      ctx.slotsMap = map;
      await refreshSlots();
      renderInspector(ctx);
      toast(`Saved slot “${name}”`);
    },
    async loadSlot(name) {
      const s = ctx.slotsMap[name];
      if (!s) return;
      try {
        const plan = parsePlan(s.text);
        editor.replacePlan(plan);
        editor.fit();
        toast(`Loaded “${name}”`);
      } catch (e) {
        toast("That slot failed to parse.", true);
      }
    },
    async deleteSlot(name) {
      const map = { ...ctx.slotsMap };
      delete map[name];
      const ok = await storeSet("slots", map);
      if (!ok) return;
      ctx.slotsMap = map;
      await refreshSlots();
      renderInspector(ctx);
      toast(`Deleted slot “${name}”`);
    },

    showDropHint(show) {
      const el = $("#stageDropHint");
      if (el) el.hidden = !show;
    },
  };

  /* ------- change plumbing ------- */
  const saveAutosave = async () => {
    const ok = await storeSet("autosave", { ts: Date.now(), text: serialize(editor.plan) });
    if (!ok) console.warn("autosave failed");
    ctx.lastSavedAt = Date.now();
    const line = $("#autosaveLine");
    if (line) {
      const sp = line.querySelector("span");
      if (sp) sp.textContent = "Autosaved " + fmtClock(ctx.lastSavedAt);
    }
  };
  const scheduleAutosave = debounce(saveAutosave, 900);

  const refreshSlots = async () => {
    const m = (await storeGet("slots")) || {};
    ctx.slotsMap = m;
    ctx.slots = Object.entries(m)
      .map(([name, s]) => {
        let n = "?";
        try {
          n = JSON.parse(s.text).plan.nodes.length;
        } catch {}
        return { name, ts: s.ts, nodes: n };
      })
      .sort((a, b) => b.ts - a.ts);
  };

  function onEditorChange(op) {
    if (op === "view") {
      updateToolbar(ctx);
      return;
    }
    if (AUTOSAVE_OPS.has(op)) scheduleAutosave();
    ctx.refresh();
  }

  editor.onChange = onEditorChange;

  /* ------- boot ------- */
  initPanels(ctx);
  editor.render();
  editor.setTool("select");
  if (firstRun) {
    /* show demo board nicely on first visit */
  }
  editor.fit();

  /* hide AI button if plugin is missing */
  if (!(window.root && typeof root.generateText === "function")) {
    const ai = $("#aiBtn");
    if (ai) ai.hidden = true;
  }

  /* toolrail active state defaults */
  if (ctx.setToolUi) ctx.setToolUi("select");

  await refreshSlots();
  ctx.refresh();
  ctx.scheduleAutosave = scheduleAutosave;

  if (firstRun) {
    editor.fit();
    ctx.lastSavedAt = null;
  }

  /* ------- keyboard ------- */
  document.addEventListener("keydown", (e) => {
    const modalOpen = !!document.querySelector(".modal-back");
    const typing = isTyping();
    if (typing) {
      if (e.key === "Escape") {
        document.activeElement.blur();
        e.preventDefault();
      }
      return;
    }
    if (modalOpen) return;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (k === "y") {
        e.preventDefault();
        editor.redo();
      } else if (k === "d") {
        e.preventDefault();
        editor.duplicateSelection();
      } else if (k === "a") {
        e.preventDefault();
        editor.selectAllNodes();
        ctx.refresh();
      } else if (k === "s") {
        e.preventDefault();
        ctx.flushSave();
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "delete" || k === "backspace") {
      e.preventDefault();
      editor.deleteSelection();
    } else if (k === "escape") {
      editor.cancelGesture();
      ctx.refresh();
    } else if (k === "v") {
      tool("select");
    } else if (k === "h") {
      tool("pan");
    } else if (k === "n") {
      tool("note");
    } else if (k === "f") {
      editor.fit();
    }
  });

  function tool(t) {
    editor.setTool(t);
    if (ctx.setToolUi) ctx.setToolUi(t);
    updateStatus(ctx);
  }

  /* make a debugging handle available */
  window.__sysplan = ctx;
})();
