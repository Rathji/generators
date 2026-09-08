import { $, toast, fmtClock } from "./util.js";
import { parsePlan, trimBrokenWires, nodeById, inWires, outWires, loopsOf } from "./model.js";
import { CATEGORIES, PORT_TYPES, PALETTE, THEMES, composeTheme } from "./content.js";
import { NODE_W } from "./editor.js";

const CAT_FALLBACK = { color: "#475569", dot: "#64748b" };
const TYPE_FALLBACK = { color: "#94a3b8" };
const catMeta = (c) => CATEGORIES[c] || CAT_FALLBACK;

/* ================= tiny DOM builder ================= */

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

/* ================= blueprint auto-arrange ================= */

const STEP = 168;
const PAD = 40;
const COLW = 244;
const COLS_MAX = 6;

export function arrangePlan(plan) {
  const nodes = plan.nodes;
  if (nodes.length < 2) return;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const comps = loopsOf(plan).sccs.map((ids) => ids.sort((a, b) => idx.get(a) - idx.get(b)));
  comps.sort((a, b) => idx.get(a[0]) - idx.get(b[0]));
  const compOf = new Map();
  comps.forEach((ids, ci) => ids.forEach((id) => compOf.set(id, ci)));
  const edges = new Set();
  for (const w of plan.wires) {
    const a = compOf.get(w.src.n), b = compOf.get(w.dst.n);
    if (a === undefined || b === undefined || a === b) continue;
    edges.add(a + ">" + b);
  }
  const adj = Array.from({ length: comps.length }, () => []);
  const indeg = new Array(comps.length).fill(0);
  for (const e of edges) {
    const [a, b] = e.split(">").map(Number);
    adj[a].push(b);
    indeg[b]++;
  }
  const ready = [];
  for (let i = 0; i < comps.length; i++) if (!indeg[i]) ready.push(i);
  const order = [];
  while (ready.length) {
    ready.sort((a, b) => idx.get(comps[a][0]) - idx.get(comps[b][0]));
    const c = ready.shift();
    order.push(c);
    for (const to of adj[c]) if (--indeg[to] === 0) ready.push(to);
  }
  for (const c of order) if (indeg[c] > 0) order.push(c);

  const assign = new Array(comps.length);
  let row = 0, col = 0;
  const rowExtent = new Map();
  for (const c of order) {
    if (col >= COLS_MAX) {
      col = 0;
      row++;
    }
    assign[c] = { row, col: col++ };
    const ext = Math.max(0, comps[c].length - 1) * STEP + 170;
    rowExtent.set(row, Math.max(rowExtent.get(row) || 0, ext));
  }
  let y = PAD;
  const rowTop = [];
  for (let r = 0; r <= row; r++) {
    rowTop[r] = y;
    y += rowExtent.get(r) || 170;
  }
  for (let c = 0; c < comps.length; c++) {
    const { row, col } = assign[c];
    const x = PAD + col * COLW;
    const baseY = rowTop[row] + (comps[c].length > 1 ? PAD : PAD + 14);
    comps[c].forEach((id, k) => {
      const n = nodes[idx.get(id)];
      n.x = x;
      n.y = baseY + k * STEP;
    });
  }
}

/* ================= modals ================= */

function openModal({ title, sub, wide, onBody, footButtons, onFoot, onClose }) {
  const back = h("div", { class: "modal-back" });
  const modal = h("div", { class: "modal" + (wide ? " wide" : "") });
  const head = h("div", { class: "modal-head" }, h("h3", {}, title));
  const x = h("button", { class: "icon-x", title: "Close", onpointerdown: (e) => e.stopPropagation() }, "✕");
  head.appendChild(x);
  modal.appendChild(head);
  if (sub) modal.appendChild(h("div", { class: "modal-sub" }, sub));
  const body = h("div", { class: "modal-body" });
  modal.appendChild(body);
  const foot = h("div", { class: "modal-foot" });
  modal.appendChild(foot);
  back.appendChild(modal);
  $("#modalRoot").appendChild(back);

  const close = () => {
    if (onClose) onClose();
    back.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);

  if (footButtons) footButtons(foot, close);
  if (onBody) onBody(body, close);
  back.addEventListener("pointerdown", (e) => {
    if (e.target === back) close();
  });
  x.addEventListener("click", close);
  return { close, back, body };
}

const btn = (label, opts = {}, onClick) =>
  h("button", { class: "btn" + (opts.cls ? " " + opts.cls : ""), onclick: onClick }, label);

export function confirmDialog({ title = "Are you sure?", body = "", ok = "OK", danger = false, cancel = "Cancel" }) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      resolve(v);
      m.close();
    };
    const m = openModal({
      title,
      onClose: () => fin(false),
      onBody: (b) => {
        if (body) b.append(h("div", { style: { lineHeight: "1.5" } }, body));
      },
      footButtons: (foot) => {
        foot.append(btn(cancel, {}, () => fin(false)));
        foot.append(h("span", { class: "foot-spacer" }));
        foot.append(btn(ok, { cls: danger ? "danger" : "primary" }, () => fin(true)));
      },
    });
    m.back.addEventListener("pointerdown", (e) => {
      if (e.target === m.back) fin(false);
    });
  });
}

/* ================= blueprint modal ================= */

export function openBlueprintModal(ctx) {
  const m = openModal({
    title: "Blueprint generator",
    sub: "Draft a whole starter diagram for a system idea — then refine it on the board. “Fresh board” replaces the current plan (undoable); “Add to board” drops it below what you already have.",
    wide: true,
    onBody: (body) => {
      for (const t of THEMES) {
        const meta = `${t.slots.length + t.connectors.length} parts · ${t.wires.length} wires`;
        const acts = h(
          "div",
          { class: "theme-acts" },
          btn("Open on fresh board", { cls: "primary sm" }, (e) => {
            e.stopPropagation();
            m.close();
            gen(ctx, t, "replace");
          }),
          btn("Add to current board", { cls: "sm" }, (e) => {
            e.stopPropagation();
            m.close();
            gen(ctx, t, "merge");
          })
        );
        const card = h(
          "div",
          {
            class: "theme-card",
            title: "Open on a fresh board",
            onclick: () => { m.close(); gen(ctx, t, "replace"); },
          },
          h("div", { class: "theme-tag", style: { background: t.color } }, t.emoji),
          h("div", { class: "theme-info" },
            h("div", { class: "t-name" }, t.name),
            h("div", { class: "t-about" }, t.blurb),
            acts
          ),
          h("div", { class: "theme-meta" }, meta, "starter")
        );
        body.appendChild(card);
      }
    },
    footButtons: (foot, close) => foot.append(h("span", { class: "foot-spacer" }), btn("Cancel", {}, close)),
  });

  function gen(ctx, theme, mode) {
    const plan = composeTheme(theme, { seed: (Math.random() * 1e9) | 0 });
    arrangePlan(plan);
    if (mode === "replace") {
      ctx.replaceWithPlan(plan, { fit: true, msg: `“${theme.name}” blueprint placed on the board` });
    } else {
      ctx.addCluster(plan, { msg: `“${theme.name}” parts added` });
    }
  }
}

/* ================= AI brainstorm modal ================= */

const AI_DEFAULT_PORTS = {
  electrical: { in: [["power", "power"]], out: [["out", "power"]] },
  electronics: { in: [["power", "power"], ["signal", "signal"]], out: [["signal", "signal"], ["data", "data"]] },
  software: { in: [["requests", "network"]], out: [["responses", "network"], ["events", "data"]] },
  data: { in: [["data", "data"]], out: [["data", "data"]] },
  network: { in: [["in", "network"]], out: [["out", "network"]] },
  mechanical: { in: [["drive", "motion"]], out: [["output", "motion"], ["pos", "status"]] },
  fluid: { in: [["in", "fluid"]], out: [["out", "fluid"]] },
  thermal: { in: [["in", "heat"]], out: [["out", "heat"]] },
  energy: { in: [["charge", "power"]], out: [["out", "power"], ["soc", "status"]] },
  control: { in: [["power", "power"], ["setpoint", "control"]], out: [["drive", "control"]] },
  human: { in: [["alerts", "status"]], out: [["actions", "control"]] },
};

export function openAiModal(ctx) {
  const genFn = window.root && root.generateText;
  if (typeof genFn !== "function") {
    toast("AI isn't available right now — no ai-text-plugin import.", true);
    return;
  }
  const existing = ctx.editor.plan.nodes.filter((n) => !n.note);
  const hasBoard = existing.length > 0;
  const m = openModal({
    title: "AI component brainstorm",
    sub: hasBoard
      ? "The AI sees what’s already on your board and suggests components that would fit it. Tap one to drop it in."
      : "Describe the system you’re planning and the AI will suggest concrete components to start the board with.",
    onBody: (body) => {
      body.append(h("div", { class: "ai-chat" },
        h("div", {}, h("label", { class: "field", style: { display: "block", fontWeight: 600, marginBottom: 4 } }, "Your system / question")),
        (() => {
          const ta = h("textarea", {
            placeholder: hasBoard
              ? "e.g. What am I missing? Suggest sensors, safety and output components for my robot."
              : "e.g. A small smart irrigation system for a greenhouse",
          });
          body._ta = ta;
          return ta;
        })()
      ));
      const ideas = h("div", { class: "ai-ideas" });
      body.appendChild(ideas);
      const statusRow = h("div", { style: { marginTop: 8, minHeight: 18, fontSize: 12, color: "#8a94a6" } });
      body.appendChild(statusRow);

      const sendBtn = btn("Suggest components", { cls: "primary" }, async () => {
        const q = (body._ta.value || "").trim();
        if (!q) { toast("Say something about your system first", true); return; }
        sendBtn.disabled = true;
        statusRow.innerHTML = "";
        const spin = h("span", { class: "spinner" });
        statusRow.append(spin, "  Asking the AI…");
        try {
          const list = existing.map((n) => `- ${n.title}${n.kind ? " (" + n.kind + ")" : ""}${n.category ? " [" + n.category + "]" : ""}`).join("\n");
          const cats = Object.keys(CATEGORIES).join(", ");
          const answer = await genFn({
            instruction:
              "You are helping design the system described by the user. The board already contains:\n" +
              (hasBoard ? list : "(empty board)\n") +
              "\nUser request: " + q +
              "\nSuggest up to 7 NEW components that fit naturally with this system and are useful additions. Do not include components already on the board. Reply with plain lines only, one component per line, in EXACTLY this format:\nTITLE | category | one-sentence purpose\n" +
              "Category must be one of: " + cats + ". No numbering, no markdown, no preamble.",
          });
          const text = typeof answer === "string" ? answer : (answer && answer.text) || "";
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          ideas.innerHTML = "";
          let usable = 0;
          for (const line of lines.slice(0, 7)) {
            const parts = line.split("|").map((p) => p.trim());
            if (parts.length < 2) continue;
            const title = parts[0].replace(/^[-*\d.\s)]+/, "");
            const catKey = parts[1].toLowerCase().trim();
            const cat = CATEGORIES[catKey] ? catKey : closestCat(catKey);
            const desc = parts[2] || "";
            const cm = catMeta(cat);
            const idea = h("div", { class: "ai-idea" },
              h("div", { class: "cat-tag", style: { background: cm.color } }, (cm.badge || "?").slice(0, 3)),
              h("div", { class: "i-text" },
                h("div", { class: "i-title" }, title),
                h("div", { class: "i-desc" }, desc)
              ),
              btn("Add", { cls: "sm primary" }, () => {
                idea.remove();
                const dp = AI_DEFAULT_PORTS[cat] || { in: [["in", "data"]], out: [["out", "data"]] };
                ctx.paletteAdd(cat, { t: [title], d: [desc], kind: "", in: dp.in, out: dp.out });
              })
            );
            ideas.appendChild(idea);
            usable++;
          }
          if (!usable) statusRow.textContent = "The AI didn't return usable suggestions — try rephrasing.";
          else statusRow.textContent = "";
        } catch (err) {
          console.error(err);
          statusRow.innerHTML = "";
          toast("AI call failed — try again.", true);
        } finally {
          sendBtn.disabled = false;
        }
      });
      body.append(h("div", { style: { marginTop: 6 } }, sendBtn));
    },
    footButtons: (foot, close) => foot.append(h("span", { class: "foot-spacer" }), btn("Done", {}, close)),
  });
}

function closestCat(key) {
  const k = key.toLowerCase();
  for (const c of Object.keys(CATEGORIES)) {
    if (CATEGORIES[c].label.toLowerCase().includes(k) || k.includes(c) || k.includes(CATEGORIES[c].label.toLowerCase())) return c;
  }
  return "software";
}

/* ================= palette ================= */

let itemPtr = null; // {cat, item, moved, cancelClick}

export function renderPalette(ctx, query = "") {
  const list = $("#paletteList");
  if (!list) return;
  list.innerHTML = "";
  const q = query.trim().toLowerCase();
  let any = false;
  for (const [cat, items] of Object.entries(PALETTE)) {
    const cm = catMeta(cat);
    const filtered = q
      ? items.filter((it) =>
          (it.t || []).concat(it.d || [], it.kind || "").join(" ").toLowerCase().includes(q)
        )
      : items;
    if (!filtered.length) continue;
    any = true;
    const block = h("div", { class: "cat-block", "data-cat": cat });
    block.appendChild(
      h("div", { class: "cat-block-head" },
        h("span", { class: "cat-swatch", style: { background: cm.color } }),
        CATEGORIES[cat].label,
        h("span", { class: "cat-count" }, q ? String(filtered.length) : String(items.length))
      )
    );
    for (const it of filtered) {
      const title = it.t[0];
      const palBtn = h("button", {
        class: "pal-item",
        title: (it.d && it.d[0]) || "",
        onclick: () => {
          if (palBtn._suppressClick) {
            palBtn._suppressClick = false;
            return;
          }
          ctx.paletteAdd(cat, it);
        },
      },
        h("span", { class: "p-dot", style: { background: cm.dot } }),
        h("span", { class: "p-name" }, title),
        h("span", { class: "p-add", title: "Add to board" }, "+")
      );
      palBtn.addEventListener("pointerdown", (e) => startPalDrag(e, ctx, cat, it, palBtn));
      block.appendChild(palBtn);
    }
    list.appendChild(block);
  }
  if (!any) list.append(h("div", { class: "palette-hint", style: { paddingTop: 8 } }, "No components match “" + query + "”."));
}

function startPalDrag(e, ctx, cat, it, btnEl) {
  if (e.button !== 0) return;
  const startX = e.clientX, startY = e.clientY;
  let dragging = false, ghost = null, overStage = false;
  btnEl._suppressClick = false;

  const move = (ev) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      dragging = true;
      btnEl._suppressClick = true;
      btnEl.classList.add("dragging");
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = it.t[0];
      document.body.appendChild(ghost);
    }
    ghost.style.left = ev.clientX + "px";
    ghost.style.top = ev.clientY + "px";
    const r = ctx.editor.stageEl.getBoundingClientRect();
    overStage = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    ctx.showDropHint(overStage);
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    ctx.showDropHint(false);
    if (ghost) ghost.remove();
    btnEl.classList.remove("dragging");
    if (dragging) {
      const r = ctx.editor.stageEl.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
        const at = ctx.editor.world(ev.clientX, ev.clientY);
        at.x -= NODE_W / 2;
        at.y -= 30;
        ctx.paletteAdd(cat, it, at);
      } else {
        btnEl._suppressClick = false;
      }
    } else {
      btnEl._suppressClick = false;
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* ================= inspector ================= */

export function isTyping() {
  const a = document.activeElement;
  return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable));
}

export function renderInspector(ctx) {
  const body = $("#inspectorBody");
  if (!body) return;
  if (isTyping()) return;
  body.innerHTML = "";
  const ed = ctx.editor;
  const nodes = ed.selNodes, wires = ed.selWires;

  if (!nodes.length && !wires.length) return renderBoardPanel(ctx, body);
  if (wires.length && !nodes.length) return renderWirePanel(ctx, body, wires[0]);
  if (nodes.length === 1) return renderNodePanel(ctx, body, nodes[0]);
  return renderGroupPanel(ctx, body, nodes);
}

function fieldWrap(label, el) {
  return h("div", { class: "field" }, h("label", {}, label), el);
}

function catSelect(ctx, node) {
  const sel = h("select", { value: node.category });
  for (const [k, v] of Object.entries(CATEGORIES)) {
    const o = h("option", { value: k }, v.label);
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => ctx.commitNodeField(node.id, "category", sel.value));
  sel.addEventListener("pointerdown", (e) => e.stopPropagation());
  return h("div", { class: "node-meta-line" },
    h("span", { class: "cat-swatch", style: { background: (catMeta(node.category)).color, width: 12, height: 12, borderRadius: 4, display: "inline-block" } }),
    sel
  );
}

function renderNodePanel(ctx, body, node) {
  const ed = ctx.editor;
  const isNote = !!node.note;
  body.append(h("div", { class: "insp-title" },
    h("span", { class: "cat-swatch", style: { background: catMeta(node.category).color } }),
    isNote ? "Sticky note" : "Component",
    h("span", { class: "foot-spacer", style: { flex: 1 } }),
    btn("Duplicate", { cls: "sm" }, () => ctx.duplicateSelection())
  ));

  if (isNote) {
    const sec = h("div", { class: "insp-section" }, h("h4", {}, "Note text"));
    const ta = h("textarea", { value: node.title || "" });
    ta.addEventListener("input", () => ctx.liveNodeField(node.id, "title", ta.value));
    ta.addEventListener("blur", () => ctx.commitNodeEdit(node.id, "title", ta.value));
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ta.blur(); });
    sec.appendChild(ta);
    body.appendChild(sec);
  } else {
    const g = h("div", { class: "insp-section" });
    g.append(h("h4", {}, "About"));
    g.append(
      fieldWrap("Category", catSelect(ctx, node)),
      fieldWrap("Name", (() => {
        const inp = h("input", { type: "text", value: node.title || "" });
        inp.addEventListener("input", () => ctx.liveNodeField(node.id, "title", inp.value));
        inp.addEventListener("blur", () => ctx.commitNodeEdit(node.id, "title", inp.value));
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
        return inp;
      })()),
      fieldWrap("Kind / role", (() => {
        const inp = h("input", { type: "text", value: node.kind || "", placeholder: "e.g. sensor, service, load…" });
        inp.addEventListener("input", () => ctx.liveNodeField(node.id, "kind", inp.value));
        inp.addEventListener("blur", () => ctx.commitNodeEdit(node.id, "kind", inp.value));
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
        return inp;
      })()),
      fieldWrap("Description", (() => {
        const ta = h("textarea", { value: node.desc || "", placeholder: "What does this component do?" });
        ta.addEventListener("input", () => ctx.liveNodeField(node.id, "desc", ta.value));
        ta.addEventListener("blur", () => ctx.commitNodeEdit(node.id, "desc", ta.value));
        return ta;
      })())
    );
    body.appendChild(g);

    const ps = h("div", { class: "insp-section" });
    ps.append(h("h4", {}, "Ports"));
    for (const side of ["inputs", "outputs"]) {
      const isIn = side === "inputs";
      ps.append(h("h4", { style: { marginTop: 8, color: isIn ? "#0e7490" : "#a16207" } }, isIn ? "Inputs" : "Outputs"));
      (node[side] || []).forEach((port, i) => {
        ps.appendChild(portEditRow(ctx, node, side, i, port));
      });
      ps.append(
        h("button", { class: "btn sm", style: { width: "100%", marginTop: 6 }, onclick: () => ctx.addPort(node.id, side) },
          "+ Add " + (isIn ? "input" : "output"))
      );
    }
    body.appendChild(ps);
  }

  const stats = h("div", { class: "insp-section" });
  stats.append(h("h4", {}, "Connections"));
  const iw = inWires(ed.plan, node.id).length;
  const ow = outWires(ed.plan, node.id).length;
  const chips = h("div", { class: "stat-grid" },
    h("span", { class: "stat-chip" }, h("span", { class: "dot", style: { background: "#10b981" } }), `${iw} in`),
    h("span", { class: "stat-chip" }, h("span", { class: "dot", style: { background: "#3b6fe0" } }), `${ow} out`)
  );
  stats.appendChild(chips);
  if (loopsOf(ed.plan).loopNodes.has(node.id)) {
    stats.append(h("div", { class: "loop-warn", style: { marginTop: 8 } },
      "Part of a feedback loop — a signal path returns to an earlier component. Loops are fine; they mean closed-loop control or state feedback."));
  }
  stats.append(h("div", { class: "row-btns", style: { marginTop: 10 } },
    btn("Delete component", { cls: "danger block" }, () => {
      ed.deleteSelection();
    })
  ));
  body.appendChild(stats);
}

function portEditRow(ctx, node, side, i, port) {
  const row = h("div", { class: "port-edit-row" });
  const labelInp = h("input", { type: "text", value: port.label, placeholder: "label" });
  labelInp.addEventListener("pointerdown", (e) => e.stopPropagation());
  labelInp.addEventListener("change", () => ctx.setPort(node.id, side, i, { label: labelInp.value }));
  const typeSel = h("select");
  for (const [k, v] of Object.entries(PORT_TYPES)) {
    typeSel.appendChild(h("option", { value: k }, v.label));
  }
  typeSel.value = port.type;
  typeSel.addEventListener("change", () => ctx.setPort(node.id, side, i, { type: typeSel.value }));
  row.append(
    labelInp,
    typeSel,
    h("button", { class: "icon-del", title: "Remove port", onclick: () => ctx.removePort(node.id, side, i) }, "✕")
  );
  return row;
}

function renderGroupPanel(ctx, body, nodes) {
  const ed = ctx.editor;
  body.append(h("div", { class: "insp-title" }, `${nodes.length} components selected`));
  const sec = h("div", { class: "insp-section" });
  const ul = h("div", { style: { fontSize: 12, lineHeight: 1.8, color: "#51607a" } });
  for (const n of nodes.slice(0, 40)) {
    const dot = h("span", { style: { background: catMeta(n.category).dot, width: 8, height: 8, borderRadius: "50%", display: "inline-block", marginRight: 6 } });
    ul.append(h("div", {}, dot, n.note ? "📌 " + (n.title || "Note") : n.title));
  }
  if (nodes.length > 40) ul.append(h("div", {}, `…and ${nodes.length - 40} more`));
  sec.appendChild(ul);
  body.appendChild(sec);
  body.append(h("div", { class: "row-btns" },
    btn("Duplicate", {}, () => ctx.duplicateSelection()),
    btn("Delete selected", { cls: "danger" }, () => ed.deleteSelection()),
    h("span", { class: "foot-spacer", style: { flex: 1 } }),
    btn("Deselect", { cls: "sm" }, () => { ed.clearSel(); ctx.refresh(); })
  ));
}

function renderWirePanel(ctx, body, wire) {
  const ed = ctx.editor;
  const src = nodeById(ed.plan, wire.src.n);
  const dst = nodeById(ed.plan, wire.dst.n);
  const sPort = src && src.outputs[wire.src.o];
  const dPort = dst && dst.inputs[wire.dst.i];
  const type = sPort && sPort.type;
  const tc = PORT_TYPES[type] || TYPE_FALLBACK;
  body.append(h("div", { class: "insp-title" },
    h("span", { class: "cat-swatch", style: { background: tc.color } }),
    "Connection"
  ));
  const sum = h("div", { class: "wire-summary" });
  sum.append(
    h("div", {}, "Outputs", h("b", {}, "  " + escLabel(sPort ? sPort.label : "?")), " of "),
    h("div", { style: { marginTop: 2 } }, h("b", {}, escLabel(src ? src.title : "(removed)")),
      type ? h("span", { style: { display: "inline-flex", alignItems: "center", gap: 5, marginLeft: 8, fontSize: 10.5, color: tc.color } },
        h("span", { class: "dot", style: { background: tc.color } }), PORT_TYPES[type].label) : ""),
    h("div", { style: { marginTop: 8 } }, "→ feeds ", h("b", {}, escLabel(dPort ? dPort.label : "?")), " of "),
    h("div", { style: { marginTop: 2 } }, h("b", {}, escLabel(dst ? dst.title : "(removed)")))
  );
  body.append(sum);
  body.append(h("div", { class: "row-btns" },
    btn("Delete connection", { cls: "danger block" }, () => {
      ed.deleteSelection();
    })
  ));
  body.append(h("div", { style: { fontSize: 10.5, color: "#97a1b0", marginTop: 12, lineHeight: 1.5 } },
    "Direction is output → input: “" + escLabel((sPort && sPort.label) || "?") + "” leaves the source and lands on “" + escLabel((dPort && dPort.label) || "?") + "”."));
}

const escLabel = (s) => (s == null ? "" : String(s));

function renderBoardPanel(ctx, body) {
  const ed = ctx.editor;
  const st = ed.stats();
  body.append(h("div", { class: "insp-title" }, "Board", h("span", { class: "foot-spacer", style: { flex: 1 } }),
    btn("Fit view", { cls: "sm" }, () => ed.fit())));

  const chips = h("div", { class: "stat-grid" },
    h("span", { class: "stat-chip" }, h("span", { class: "dot", style: { background: "#3b6fe0" } }), `${st.nodes} component${st.nodes === 1 ? "" : "s"}`),
    h("span", { class: "stat-chip" }, h("span", { class: "dot", style: { background: "#10b981" } }), `${st.wires} wire${st.wires === 1 ? "" : "s"}`),
    st.loops ? h("span", { class: "stat-chip" }, h("span", { class: "dot", style: { background: "#d97706" } }), `${st.loops} loop${st.loops === 1 ? "" : "s"}`) : null
  );
  body.append(chips);
  if (st.loops) {
    const any = [...st.loopNodes];
    body.append(h("div", { class: "loop-warn", style: { marginTop: 8 } },
      `${st.loops === 1 ? "A feedback loop" : "Feedback loops"} run through: ` +
      any.slice(0, 6).map((id) => { const n = nodeById(ed.plan, id); return n ? n.title : "?"; }).join(" → ") +
      (any.length > 6 ? "…" : "") +
      ". Closed loops are legal — they represent feedback or state."));
  }
  const act = h("div", { class: "row-btns", style: { marginTop: 10 } });
  act.append(
    btn("Auto-arrange", { cls: "sm" }, () => ctx.autoArrange()),
    btn("Add note", { cls: "sm" }, () => ctx.quickNote()),
    btn("Select all", { cls: "sm" }, () => { ed.selectAllNodes(); ctx.refresh(); })
  );
  if (st.nodes < 2) act.querySelectorAll("button")[0].disabled = true;
  body.append(act);

  const save = h("div", { class: "insp-section" });
  save.append(h("h4", {}, "Save & slots"));
  const autoLine = h("div", { class: "autosave-line", id: "autosaveLine" },
    h("span", {}, ctx.lastSavedAt ? "Autosaved " + fmtClock(ctx.lastSavedAt) : "Autosave on next change"),
    h("span", {}, ctx.slotNames ? `${ctx.slotNames.length} slot${ctx.slotNames.length === 1 ? "" : "s"}` : "")
  );
  save.appendChild(autoLine);
  const sr = h("div", { class: "save-row" });
  const nameInp = h("input", { type: "text", placeholder: "Slot name, e.g. Greenhouse v2" });
  sr.append(nameInp, btn("Save", {}, () => {
    const name = nameInp.value.trim();
    if (!name) { toast("Give the slot a name first", true); return; }
    ctx.saveSlot(name);
  }));
  save.appendChild(sr);
  const slotList = h("div", { class: "slot-list" });
  for (const s of (ctx.slots || [])) {
    slotList.appendChild(h("div", { class: "slot-item" },
      h("span", { class: "s-name", title: s.name }, s.name),
      h("span", { class: "s-meta" }, `${s.nodes} parts · ${fmtClock(s.ts)}`),
      btn("Load", { cls: "sm" }, () => ctx.loadSlot(s.name)),
      h("button", { class: "icon-del", title: "Delete slot", onclick: () => ctx.deleteSlot(s.name) }, "✕")
    ));
  }
  if (!(ctx.slots || []).length) slotList.append(h("div", { style: { color: "#9aa3b2", fontSize: 11 } }, "No saved slots yet — your board autosaves automatically."));
  save.appendChild(slotList);
  body.append(save);

  body.append(h("div", { style: { fontSize: 10.5, color: "#97a1b0", lineHeight: 1.6 } },
    "Drag from the Components list to drop a box anywhere. Ctrl+Z undo · Ctrl+D duplicate · Delete removes · V/H tools · F fits."));
}

/* ================= top toolbar & status ================= */

export function updateToolbar(ctx) {
  const ed = ctx.editor;
  const u = $("#undoBtn"), r = $("#redoBtn"), zl = $("#zoomLabel");
  if (u) u.disabled = !ed.canUndo();
  if (r) r.disabled = !ed.canRedo();
  if (zl) zl.textContent = Math.round(ed.view.zoom * 100) + "%";
}

export function updateStatus(ctx) {
  const el = $("#statusStats");
  if (!el) return;
  const ed = ctx.editor;
  const st = ed.stats();
  const selN = ed.sel.size, selW = ed.selW.size;
  const parts = [];
  if (selN || selW) parts.push(`${selN || selW} selected`);
  parts.push(`${st.nodes} component${st.nodes === 1 ? "" : "s"}`);
  parts.push(`${st.wires} wire${st.wires === 1 ? "" : "s"}`);
  if (st.loops) parts.push(`${st.loops} loop${st.loops === 1 ? "" : "s"}`);
  el.textContent = parts.join("  ·  ");
}

export function init(ctx) {
  const ed = ctx.editor;
  const stage = ed.stageEl;

  $("#undoBtn").addEventListener("click", () => ed.undo());
  $("#redoBtn").addEventListener("click", () => ed.redo());
  $("#zoomInBtn").addEventListener("click", () => ed.zoomIn());
  $("#zoomOutBtn").addEventListener("click", () => ed.zoomOut());
  $("#fitBtn").addEventListener("click", () => ed.fit());
  $("#genBtn").addEventListener("click", () => openBlueprintModal(ctx));
  $("#aiBtn").addEventListener("click", () => openAiModal(ctx));
  $("#exportBtn").addEventListener("click", () => ctx.exportPlan());
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#newBtn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Start a blank board?",
      body: "This clears the canvas. The current board is autosaved, and the change is undoable (Ctrl+Z).",
      ok: "Blank board",
      danger: false,
    });
    if (ok) ctx.newBlankPlan();
  });
  $("#noteQuickBtn").addEventListener("click", () => ctx.quickNote());

  $("#paletteSearch").addEventListener("input", (e) => renderPalette(ctx, e.target.value));
  for (const b of document.querySelectorAll(".rail-btn")) {
    b.addEventListener("click", () => {
      setToolUi(b.dataset.tool);
      ed.setTool(b.dataset.tool);
    });
  }
  const setToolUi = (tool) => {
    for (const b of document.querySelectorAll(".rail-btn")) b.classList.toggle("active", b.dataset.tool === tool);
  };
  ctx.setToolUi = setToolUi;

  $("#paletteToggleBtn").addEventListener("click", () => $("#palettePanel").classList.toggle("closed"));
  $("#inspectorToggleBtn").addEventListener("click", () => $("#inspectorPanel").classList.toggle("closed"));

  if (window.matchMedia && window.matchMedia("(max-width: 860px)").matches) {
    $("#palettePanel").classList.add("closed");
    $("#inspectorPanel").classList.add("closed");
  }

  const importFile = $("#importFile");
  importFile.addEventListener("change", () => {
    const f = importFile.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const plan = parsePlan(String(rd.result));
        ctx.replaceWithPlan(plan, { fit: true, msg: `Imported “${f.name}”` });
      } catch (err) {
        toast("That file doesn't look like a sys-plan export.", true);
        console.error(err);
      }
    };
    rd.readAsText(f);
    importFile.value = "";
  });

  renderPalette(ctx, "");
  updateToolbar(ctx);
  updateStatus(ctx);
  renderInspector(ctx);
}
