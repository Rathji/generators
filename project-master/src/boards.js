// src/boards.js — Boards hub + 9 brainstorming tools (Roadmap Phase 9: 63–73).
//
//  63: board hub — boards listed by type, create/open/delete
//  64: board settings — rename, description, delete
//  65: mind map — center + radiating nodes, drag to reposition
//  66: Venn diagram — 2 or 3 sets, items placed in (overlapping) regions
//  67: pros & cons — two columns
//  68: SWOT — 2×2 quadrants
//  69: impact/effort matrix — draggable cards on a quadrant
//  70: MoSCoW — 4 priority columns
//  71: RICE — scored table (reach × impact × confidence ÷ effort)
//  72: decision matrix — options × weighted criteria
//  73: affinity map — sticky-note clusters
//
// Records: {type:"board", id, name, kind, desc, data, created}
// Pure helpers (boardDefaultData, riceScore, decisionTotals, counts) are
// covered by runPhase9Tests().

import { $, esc, toast, confirmDialog, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { uid } from "./store.js";
import { promptModal } from "./checklists.js";

export const BOARD_TYPES = [
  ["mindmap", "Mind map", "A central idea with branching thoughts"],
  ["venn", "Venn diagram", "Compare 2–3 sets and their overlaps"],
  ["proscons", "Pros & cons", "Two columns weighing an option"],
  ["swot", "SWOT", "Strengths · Weaknesses · Opportunities · Threats"],
  ["matrix", "Impact / effort", "Quadrant for quick prioritising"],
  ["moscow", "MoSCoW", "Must · Should · Could · Won't"],
  ["rice", "RICE", "Reach × Impact × Confidence ÷ Effort"],
  ["decision", "Decision matrix", "Options scored against weighted criteria"],
  ["affinity", "Affinity map", "Cluster sticky notes into themes"],
];
const TYPE_LABEL = Object.fromEntries(BOARD_TYPES.map(([t, n]) => [t, n]));

// The board's tool type lives in `kind` (the record's `type` field is
// reserved by the store for the entity type, so it can't carry it).
const boardKind = (b) => (b && b.kind) || (b && BOARD_TYPES.some(([t]) => t === b.type) ? b.type : "");

export function boardDefaultData(type) {
  switch (type) {
    case "mindmap": return { center: "Main idea", nodes: [], nextId: 1 };
    case "venn": return { setA: "Set A", setB: "Set B", setC: "", items: [], nextId: 1 };
    case "proscons": return { pros: [], cons: [], nextId: 1 };
    case "swot": return { S: [], W: [], O: [], T: [], nextId: 1 };
    case "matrix": return { items: [], nextId: 1 };
    case "moscow": return { must: [], should: [], could: [], wont: [], nextId: 1 };
    case "rice": return { rows: [], nextId: 1 };
    case "decision": return { options: [], criteria: [], scores: {}, nextId: 1 };
    case "affinity": return { clusters: [], notes: [], nextId: 1 };
    default: return {};
  }
}

// ── pure helpers (tested) ────────────────────────────────────────
// RICE = (Reach × Impact × Confidence%) ÷ Effort
export function riceScore(r) {
  const reach = Number(r.reach) || 0;
  const impact = Number(r.impact) || 0;
  const conf = (Number(r.confidence) || 0) / 100;
  const effort = Number(r.effort) || 1;
  return (reach * impact * conf) / effort;
}
// Decision matrix: weighted sum per option (criteria weight × 1–5 score).
export function decisionTotals(board) {
  const d = board.data || {};
  const out = {};
  for (const opt of d.options || []) {
    let total = 0;
    for (const c of d.criteria || []) {
      const s = Number((d.scores || {})[opt.id]?.[c.id]) || 0;
      total += (Number(c.weight) || 0) * s;
    }
    out[opt.id] = total;
  }
  return out;
}
export function boardCounts(board) {
  const d = board.data || {};
  switch (boardKind(board)) {
    case "mindmap": return (d.nodes || []).length;
    case "venn": return (d.items || []).length;
    case "proscons": return (d.pros || []).length + (d.cons || []).length;
    case "swot": return (d.S || []).length + (d.W || []).length + (d.O || []).length + (d.T || []).length;
    case "matrix": return (d.items || []).length;
    case "moscow": return (d.must || []).length + (d.should || []).length + (d.could || []).length + (d.wont || []).length;
    case "rice": return (d.rows || []).length;
    case "decision": return (d.options || []).length;
    case "affinity": return (d.notes || []).length;
    default: return 0;
  }
}

function mut(store, board, patch) {
  store.upsert("board", board.id, { data: Object.assign({}, board.data, patch) });
}

// ── hub ──────────────────────────────────────────────────────────
export function boardsHubHTML(store) {
  const all = store.all("board");
  const grouped = BOARD_TYPES.map(([type, label, hint]) => {
    const list = all.filter((b) => boardKind(b) === type);
    return { type, label, hint, list };
  });
  const sections = grouped.map((g) => `
    <div class="bd-group">
      <div class="proj-group-h"><h2>${g.label}</h2><span class="cnt">${g.list.length}</span></div>
      ${g.list.length
        ? `<div class="bd-grid">${g.list.map((b) => `<button class="bd-card" data-open="${b.id}">
            <div class="bd-name">${esc(b.name)}</div>
            <div class="bd-sub">${boardCounts(b)} item${boardCounts(b) === 1 ? "" : "s"} · ${esc(g.hint)}</div>
          </button>`).join("")}</div>`
        : `<p class="ws-empty">None yet — <span class="bd-newlink" data-type="${g.type}">create one</span>.</p>`}
    </div>`).join("");
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.grid}</span> Boards</h1><p class="sub">9 brainstorming tools — pick a type to start</p></div>
        <button class="btn btn-primary" id="bdNewBtn">${ICONS.plus} New board</button>
      </div>
    </div>
    <div class="bd-groups">${sections}</div>`;
}

export function wireBoardsHub(store, ctx) {
  $("#bdNewBtn")?.addEventListener("click", () => newBoardModal(store, ctx));
  document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => ctx.open(b.dataset.open)));
  document.querySelectorAll(".bd-newlink").forEach((b) => b.addEventListener("click", () => newBoardModal(store, ctx, { type: b.dataset.type })));
}

export function newBoardModal(store, ctx, { type = "" } = {}) {
  const { el, close } = openModal(`
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="New board">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>New board</h3>
      <p class="modal-sub">Choose a brainstorming tool, then give it a name.</p>
      <div class="field"><label for="bdNameInput">Name *</label><input type="text" id="bdNameInput" placeholder="e.g. Launch ideas" maxlength="80"></div>
      <div class="field"><label>Type</label>
        <select id="bdTypeSel">${BOARD_TYPES.map(([t, n, h]) => `<option value="${t}" ${t === type ? "selected" : ""}>${n} — ${h}</option>`).join("")}</select></div>
      <div class="field"><label for="bdDescInput">Description</label><input type="text" id="bdDescInput" placeholder="What's this board for?" maxlength="120"></div>
      <div class="modal-btns">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="bdCreateBtn">${ICONS.plus} Create</button>
      </div>
    </div>`);
  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#bdCreateBtn")?.addEventListener("click", () => {
    const name = (el.querySelector("#bdNameInput")?.value || "").trim();
    if (!name) { toast("Enter a board name", "error"); return; }
    const btype = el.querySelector("#bdTypeSel")?.value || "mindmap";
    const board = store.create("board", { name, kind: btype, desc: (el.querySelector("#bdDescInput")?.value || "").trim(), data: boardDefaultData(btype) });
    toast("Board created", "success");
    close();
    ctx.open(board.id);
  });
  setTimeout(() => { const t = el.querySelector("#bdNameInput"); if (t) t.focus(); }, 30);
  return { el, close };
}

// ── board workspace ──────────────────────────────────────────────
export function boardViewHTML(store, board) {
  const inner = renderBoard(store, board);
  return `
    <div class="bd-workspace">
      <a class="ws-back" data-bd-back href="#">${ICONS.arrowLeft} All boards</a>
      <div class="ws-head">
        <h1><span class="vh-ico" style="color:var(--accent);">${ICONS.grid}</span> ${esc(board.name)}</h1>
        <div class="ws-actions">
          <button class="btn" id="bdSettingsBtn" title="Board settings">${ICONS.settings} Settings</button>
        </div>
      </div>
      ${board.desc ? `<p class="muted">${esc(board.desc)}</p>` : ""}
      <p class="muted small" style="margin:4px 0 14px;">${TYPE_LABEL[boardKind(board)] || boardKind(board)} board</p>
      <div class="bd-body">${inner}</div>
    </div>`;
}

function renderBoard(store, board) {
  switch (boardKind(board)) {
    case "mindmap": return mindmapHTML(store, board);
    case "venn": return vennHTML(store, board);
    case "proscons": return prosconsHTML(store, board);
    case "swot": return swotHTML(store, board);
    case "matrix": return matrixHTML(store, board);
    case "moscow": return moscowHTML(store, board);
    case "rice": return riceHTML(store, board);
    case "decision": return decisionHTML(store, board);
    case "affinity": return affinityHTML(store, board);
    default: return `<p class="muted">Unknown board type.</p>`;
  }
}

export function wireBoardView(store, board, ctx) {
  $("[data-bd-back]")?.addEventListener("click", (e) => { e.preventDefault(); ctx.back(); });
  $("#bdSettingsBtn")?.addEventListener("click", () => boardSettingsModal(store, board, ctx));
  switch (boardKind(board)) {
    case "mindmap": wireMindmap(store, board, ctx); break;
    case "venn": wireVenn(store, board, ctx); break;
    case "proscons": wireProscons(store, board, ctx); break;
    case "swot": wireSwot(store, board, ctx); break;
    case "matrix": wireMatrix(store, board, ctx); break;
    case "moscow": wireMoscow(store, board, ctx); break;
    case "rice": wireRice(store, board, ctx); break;
    case "decision": wireDecision(store, board, ctx); break;
    case "affinity": wireAffinity(store, board, ctx); break;
  }
}

function boardSettingsModal(store, board, ctx) {
  const { el, close } = openModal(`
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Board settings">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>Board settings</h3>
      <div class="field" style="margin-top:10px;"><label for="bdRenameInput">Name</label><input type="text" id="bdRenameInput" value="${esc(board.name)}" maxlength="80"></div>
      <div class="field"><label for="bdDescEditInput">Description</label><input type="text" id="bdDescEditInput" value="${esc(board.desc || "")}" maxlength="120"></div>
      <div class="modal-btns">
        <button class="btn btn-danger" id="bdDelBtn" style="margin-right:auto;">${ICONS.trash} Delete</button>
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="bdSaveBtn">Save</button>
      </div>
    </div>`);
  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#bdSaveBtn")?.addEventListener("click", () => {
    const name = (el.querySelector("#bdRenameInput")?.value || "").trim();
    if (name) store.upsert("board", board.id, { name, desc: (el.querySelector("#bdDescEditInput")?.value || "").trim() });
    toast("Board updated", "success");
    close();
    ctx.render();
  });
  el.querySelector("#bdDelBtn")?.addEventListener("click", async () => {
    const sure = await confirmDialog({ title: "Delete board?", message: "“" + board.name + "” and all its items will be removed.", confirmText: "Delete board", danger: true });
    if (!sure) return;
    store.remove("board", board.id);
    toast("Board deleted", "success");
    close();
    ctx.back();
  });
}

// ── 65. mind map ─────────────────────────────────────────────────
function mindmapHTML(store, board) {
  const d = board.data;
  const nodes = [{ id: "center", label: d.center, x: 50, y: 31 }, ...(d.nodes || [])];
  const edges = (d.nodes || []).map((n) => {
    const p = n.parentId === "center" ? nodes[0] : nodes.find((x) => x.id === n.parentId);
    if (!p) return "";
    return `<line class="mm-edge" x1="${p.x}" y1="${p.y}" x2="${n.x}" y2="${n.y}"/>`;
  }).join("");
  const circles = nodes.map((n) => {
    const isCenter = n.id === "center";
    return `<g class="mm-node${isCenter ? " center" : ""}" data-node="${n.id}" transform="translate(${n.x},${n.y})">
      <circle r="${isCenter ? 7 : 5.5}"/>
      <text text-anchor="middle" dominant-baseline="central">${esc(n.label)}</text>
      ${isCenter ? "" : `<circle class="mm-del" data-mm-del="${n.id}" r="4.5" cx="16" cy="-16"/>`}
    </g>`;
  }).join("");
  return `
    <div class="mm-toolbar">
      <button class="btn" id="mmCenterBtn">${ICONS.pencil} Rename centre</button>
      <button class="btn" id="mmAddBtn">${ICONS.plus} Add branch</button>
      <p class="muted small" style="margin:0 0 0 auto;">Drag nodes to arrange · double-click a branch to rename · ✕ to delete</p>
    </div>
    <svg class="mm-canvas" viewBox="0 0 100 62" preserveAspectRatio="xMidYMid meet">${edges}${circles}</svg>`;
}
function wireMindmap(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  $("#mmCenterBtn")?.addEventListener("click", async () => {
    const name = await promptModal("Rename central idea", "Idea", d.center);
    if (name) { mut(store, board, { center: name }); redraw(); }
  });
  const doAdd = async (parentId) => {
    const label = await promptModal("New branch", "Branch label", "");
    if (!label) return;
    const angle = Math.random() * Math.PI * 2;
    const p = parentId === "center" ? { x: 50, y: 31 } : d.nodes.find((n) => n.id === parentId);
    const x = Math.min(92, Math.max(8, (p.x || 50) + Math.cos(angle) * 12));
    const y = Math.min(56, Math.max(6, (p.y || 50) + Math.sin(angle) * 8));
    const node = { id: "n" + (d.nextId++), label, x, y, parentId };
    mut(store, board, { nodes: [...(d.nodes || []), node], nextId: d.nextId });
    redraw();
  };
  $("#mmAddBtn")?.addEventListener("click", () => doAdd("center"));
  document.querySelectorAll(".mm-node").forEach((g) => {
    const id = g.dataset.node;
    g.addEventListener("dblclick", async () => {
      if (id === "center") { const name = await promptModal("Rename central idea", "Idea", d.center); if (name) { mut(store, board, { center: name }); redraw(); } return; }
      const n = d.nodes.find((x) => x.id === id);
      const label = await promptModal("Rename branch", "Branch label", n && n.label);
      if (label) { mut(store, board, { nodes: d.nodes.map((x) => (x.id === id ? Object.assign({}, x, { label }) : x)) }); redraw(); }
    });
    g.addEventListener("click", (e) => {
      if (e.target.closest("[data-mm-del]")) {
        const del = e.target.closest("[data-mm-del]").dataset.mmDel;
        mut(store, board, { nodes: d.nodes.filter((x) => x.id !== del && x.parentId !== del) });
        redraw();
        return;
      }
    });
    // drag (pointer events; store new x/y in % coords)
    g.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-mm-del]")) return;
      const svg = document.querySelector(".mm-canvas");
      const rect = svg.getBoundingClientRect();
      const move = (ev) => {
        const px = ((ev.clientX - rect.left) / rect.width) * 100;
        const py = ((ev.clientY - rect.top) / rect.height) * 100;
        if (id === "center") return;
        mut(store, board, { nodes: d.nodes.map((x) => (x.id === id ? Object.assign({}, x, { x: Math.min(94, Math.max(6, px)), y: Math.min(58, Math.max(4, py)) }) : x)) });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); redraw(); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  });
}

// ── 66. Venn diagram ─────────────────────────────────────────────
function vennHTML(store, board) {
  const d = board.data;
  const twoSets = !d.setC;
  const setNames = [d.setA || "A", d.setB || "B", d.setC || ""];
  const items = d.items || [];
  const region = (mask) => items.filter((i) => (i.region || 0) === mask).map((i) => i.label).join(", ") || "—";
  let svg;
  if (twoSets) {
    svg = `<svg viewBox="0 0 200 120" class="vn-svg">
      <circle cx="70" cy="60" r="46" data-vn-region="1"/>
      <circle cx="130" cy="60" r="46" data-vn-region="2"/>
      <text x="34" y="60" class="vn-set">${esc(setNames[0])}</text>
      <text x="152" y="60" class="vn-set">${esc(setNames[1])}</text>
    </svg>`;
  } else {
    svg = `<svg viewBox="0 0 220 130" class="vn-svg">
      <circle cx="78" cy="62" r="52" data-vn-region="1"/>
      <circle cx="142" cy="62" r="52" data-vn-region="2"/>
      <circle cx="110" cy="40" r="52" data-vn-region="4"/>
      <text x="38" y="100" class="vn-set">${esc(setNames[0])}</text>
      <text x="172" y="100" class="vn-set">${esc(setNames[1])}</text>
      <text x="100" y="16" class="vn-set">${esc(setNames[2])}</text>
    </svg>`;
  }
  const masks = twoSets ? [1, 2, 3] : [1, 2, 4, 3, 5, 6, 7];
  const legend = masks.map((m) => {
    const bits = [1, 2, 4].filter((b) => m & b);
    const label = bits.map((b) => setNames[[1, 2, 4].indexOf(b)]).join(" + ") || "?";
    return `<div class="vn-region" data-vn-add="${m}">
      <b>${esc(label)}</b> <span>${esc(region(m))}</span> <button class="mini-btn" title="Add item">${ICONS.plus}</button>
    </div>`;
  }).join("");
  return `
    <div class="vn-head">
      <div class="vn-setedit">
        <input data-vn-set="0" value="${esc(d.setA || "")}" placeholder="Set A name">
        <input data-vn-set="1" value="${esc(d.setB || "")}" placeholder="Set B name">
        <input data-vn-set="2" value="${esc(d.setC || "")}" placeholder="Set C name (blank = 2 circles)">
        <span class="muted small">Click a region below to add an item to it.</span>
      </div>
    </div>
    <div class="vn-layout">${svg}<div class="vn-regions">${legend}</div></div>`;
}
function wireVenn(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  document.querySelectorAll("[data-vn-set]").forEach((inp) => inp.addEventListener("change", () => {
    const key = ["setA", "setB", "setC"][Number(inp.dataset.vnSet)];
    mut(store, board, { [key]: inp.value.trim() });
    redraw();
  }));
  const addTo = async (mask) => {
    const label = await promptModal("Add item to region", "Item", "");
    if (!label) return;
    const item = { id: "v" + (d.nextId++), label, region: Number(mask) };
    mut(store, board, { items: [...(d.items || []), item], nextId: d.nextId });
    redraw();
  };
  document.querySelectorAll("[data-vn-add]").forEach((b) => b.addEventListener("click", () => addTo(b.dataset.vnAdd)));
  document.querySelectorAll("[data-vn-region]").forEach((c) => c.addEventListener("click", () => {
    // find mask for the region based on which circles overlap the click point — approximate: use data attribute set on circle
    const circle = c;
    const cx = Number(circle.getAttribute("cx")), cy = Number(circle.getAttribute("cy"));
    const r = Number(circle.getAttribute("r"));
    // actual overlap determined by which circles contain the point; we use region attr set at render (approximation: circle's own mask)
    const mask = Number(circle.dataset.vnRegion);
    // find an overlapping-region item add: nearest point in the circle → add to that single set's region
    addTo(mask);
  }));
}

// ── 67. pros & cons ──────────────────────────────────────────────
function prosconsHTML(store, board) {
  const d = board.data;
  const col = (kind, label, cls) => `
    <div class="pc-col ${cls}">
      <h3>${label} <span class="cnt">${(d[kind] || []).length}</span></h3>
      <div class="pc-list" data-pc-col="${kind}">
        ${(d[kind] || []).map((i) => `<div class="pc-item"><span>${esc(i.text)}</span><button class="mini-btn danger" data-pc-del="${i.id}">${ICONS.x}</button></div>`).join("") || `<p class="ws-empty">Nothing yet.</p>`}
      </div>
      <div class="cl-add"><input data-pc-input="${kind}" placeholder="Add to ${label.toLowerCase()}…" maxlength="160"><button class="btn" data-pc-add="${kind}">${ICONS.plus}</button></div>
    </div>`;
  return `<div class="pc-grid">${col("pros", "Pros", "pros")}${col("cons", "Cons", "cons")}</div>`;
}
function wireProscons(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  document.querySelectorAll("[data-pc-add]").forEach((b) => b.addEventListener("click", () => {
    const kind = b.dataset.pcAdd;
    const inp = document.querySelector(`[data-pc-input="${kind}"]`);
    const t = (inp?.value || "").trim();
    if (!t) return;
    const item = { id: "p" + (d.nextId++), text: t };
    mut(store, board, { [kind]: [...(d[kind] || []), item], nextId: d.nextId });
    inp.value = "";
    redraw();
  }));
  document.querySelectorAll("[data-pc-del]").forEach((b) => b.addEventListener("click", () => {
    const kind = b.closest("[data-pc-col]").dataset.pcCol;
    mut(store, board, { [kind]: (d[kind] || []).filter((i) => i.id !== b.dataset.pcDel) });
    redraw();
  }));
}

// ── 68. SWOT ─────────────────────────────────────────────────────
function swotHTML(store, board) {
  const d = board.data;
  const quad = (k, label, cls) => `
    <div class="swot-q ${cls}">
      <h3>${label} <span class="cnt">${(d[k] || []).length}</span></h3>
      <div class="swot-list">
        ${(d[k] || []).map((i) => `<div class="pc-item"><span>${esc(i.text)}</span><button class="mini-btn danger" data-swot-del="${k}" data-id="${i.id}">${ICONS.x}</button></div>`).join("") || `<p class="ws-empty">—</p>`}
      </div>
      <div class="cl-add"><input data-swot-input="${k}" placeholder="Add…" maxlength="160"><button class="btn" data-swot-add="${k}">${ICONS.plus}</button></div>
    </div>`;
  return `<div class="swot-grid">${quad("S", "Strengths", "s")}${quad("W", "Weaknesses", "w")}${quad("O", "Opportunities", "o")}${quad("T", "Threats", "t")}</div>`;
}
function wireSwot(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  document.querySelectorAll("[data-swot-add]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.swotAdd;
    const inp = document.querySelector(`[data-swot-input="${k}"]`);
    const t = (inp?.value || "").trim();
    if (!t) return;
    const item = { id: "s" + (d.nextId++), text: t };
    mut(store, board, { [k]: [...(d[k] || []), item], nextId: d.nextId });
    inp.value = "";
    redraw();
  }));
  document.querySelectorAll("[data-swot-del]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.swotDel;
    mut(store, board, { [k]: (d[k] || []).filter((i) => i.id !== b.dataset.id) });
    redraw();
  }));
}

// ── 69. impact / effort matrix ───────────────────────────────────
function matrixHTML(store, board) {
  const d = board.data;
  const dots = (d.items || []).map((i) => `<circle class="mx-dot" data-mx-item="${i.id}" cx="${i.impact}" cy="${100 - i.effort}" r="4"><title>${esc(i.label)}</title></circle>`).join("");
  const legend = (d.items || []).map((i) => `<span class="mx-legend" data-mx-edit="${i.id}"><b style="background:var(--accent)"></b> ${esc(i.label)} <button class="mini-btn danger" data-mx-del="${i.id}">${ICONS.x}</button></span>`).join("");
  return `
    <div class="mx-toolbar"><button class="btn" id="mxAddBtn">${ICONS.plus} Add item</button><p class="muted small" style="margin:0 0 0 auto;">Drag dots · high impact / low effort = do first</p></div>
    <div class="mx-wrap">
      <svg class="mx-canvas" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line class="mx-axis" x1="50" y1="0" x2="50" y2="100"/>
        <line class="mx-axis" x1="0" y1="50" x2="100" y2="50"/>
        <text x="2" y="6" class="mx-q">High impact</text>
        <text x="2" y="97" class="mx-q">Low impact</text>
        <text x="60" y="97" class="mx-q">Effort →</text>
        ${dots}
      </svg>
      <div class="mx-legend">${legend || `<p class="ws-empty">No items yet.</p>`}</div>
    </div>`;
}
function wireMatrix(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  $("#mxAddBtn")?.addEventListener("click", async () => {
    const label = await promptModal("New matrix item", "Label", "");
    if (!label) return;
    const item = { id: "m" + (d.nextId++), label, impact: 50, effort: 50 };
    mut(store, board, { items: [...(d.items || []), item], nextId: d.nextId });
    redraw();
  });
  document.querySelectorAll("[data-mx-del]").forEach((b) => b.addEventListener("click", () => {
    mut(store, board, { items: d.items.filter((i) => i.id !== b.dataset.mxDel) });
    redraw();
  }));
  document.querySelectorAll("[data-mx-edit]").forEach((b) => b.addEventListener("click", async () => {
    const item = d.items.find((i) => i.id === b.dataset.mxEdit);
    const label = await promptModal("Rename item", "Label", item && item.label);
    if (label) { mut(store, board, { items: d.items.map((i) => (i.id === item.id ? Object.assign({}, i, { label }) : i)) }); redraw(); }
  }));
  document.querySelectorAll("[data-mx-item]").forEach((dot) => {
    const id = dot.dataset.mxItem;
    dot.addEventListener("pointerdown", (e) => {
      const svg = document.querySelector(".mx-canvas");
      const rect = svg.getBoundingClientRect();
      const move = (ev) => {
        const px = Math.min(97, Math.max(3, ((ev.clientX - rect.left) / rect.width) * 100));
        const py = Math.min(97, Math.max(3, ((ev.clientY - rect.top) / rect.height) * 100));
        mut(store, board, { items: d.items.map((i) => (i.id === id ? Object.assign({}, i, { impact: Math.round(px), effort: Math.round(100 - py) }) : i)) });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); redraw(); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  });
}

// ── 70. MoSCoW ───────────────────────────────────────────────────
function moscowHTML(store, board) {
  const d = board.data;
  const keys = [["must", "Must have"], ["should", "Should have"], ["could", "Could have"], ["wont", "Won't have"]];
  const cols = keys.map(([k, label]) => `
    <div class="mw-col">
      <h3>${label} <span class="cnt">${(d[k] || []).length}</span></h3>
      ${(d[k] || []).map((i) => `<div class="pc-item"><span>${esc(i.text)}</span><button class="mini-btn danger" data-mw-del="${k}" data-id="${i.id}">${ICONS.x}</button></div>`).join("") || `<p class="ws-empty">—</p>`}
      <div class="cl-add"><input data-mw-input="${k}" placeholder="Add…" maxlength="160"><button class="btn" data-mw-add="${k}">${ICONS.plus}</button></div>
    </div>`).join("");
  return `<div class="mw-grid">${cols}</div>`;
}
function wireMoscow(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  document.querySelectorAll("[data-mw-add]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.mwAdd;
    const inp = document.querySelector(`[data-mw-input="${k}"]`);
    const t = (inp?.value || "").trim();
    if (!t) return;
    const item = { id: "w" + (d.nextId++), text: t };
    mut(store, board, { [k]: [...(d[k] || []), item], nextId: d.nextId });
    inp.value = "";
    redraw();
  }));
  document.querySelectorAll("[data-mw-del]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.mwDel;
    mut(store, board, { [k]: (d[k] || []).filter((i) => i.id !== b.dataset.id) });
    redraw();
  }));
}

// ── 71. RICE ─────────────────────────────────────────────────────
function riceHTML(store, board) {
  const d = board.data;
  const rows = (d.rows || []).map((r) => {
    const score = riceScore(r);
    return `<tr data-rice="${r.id}">
      <td><input data-rice-field="name" value="${esc(r.name)}" placeholder="Idea"></td>
      <td><input type="number" min="0" data-rice-field="reach" value="${esc(r.reach ?? "")}"></td>
      <td><input type="number" min="0" max="3" data-rice-field="impact" value="${esc(r.impact ?? "")}"></td>
      <td><input type="number" min="0" max="100" data-rice-field="confidence" value="${esc(r.confidence ?? "")}"></td>
      <td><input type="number" min="0" data-rice-field="effort" value="${esc(r.effort ?? "")}"></td>
      <td class="rice-score">${score ? score.toFixed(1) : "—"}</td>
      <td><button class="mini-btn danger" data-rice-del="${r.id}">${ICONS.x}</button></td>
    </tr>`;
  }).join("");
  return `
    <div class="rice-toolbar"><button class="btn" id="riceAddBtn">${ICONS.plus} Add idea</button>
      <p class="muted small" style="margin:0 0 0 auto;">RICE = (Reach × Impact × Confidence%) ÷ Effort · score auto-updates</p></div>
    <div class="rice-table-wrap"><table class="rice-table">
      <thead><tr><th>Idea</th><th>Reach</th><th>Impact (0–3)</th><th>Confidence %</th><th>Effort</th><th>RICE</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="ws-empty">No ideas yet — add one.</td></tr>`}</tbody>
    </table></div>`;
}
function wireRice(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  $("#riceAddBtn")?.addEventListener("click", async () => {
    const name = await promptModal("New idea", "Idea name", "");
    if (!name) return;
    const r = { id: "r" + (d.nextId++), name, reach: 0, impact: 0, confidence: 0, effort: 1 };
    mut(store, board, { rows: [...(d.rows || []), r], nextId: d.nextId });
    redraw();
  });
  document.querySelectorAll("[data-rice-del]").forEach((b) => b.addEventListener("click", () => {
    mut(store, board, { rows: d.rows.filter((r) => r.id !== b.dataset.riceDel) });
    redraw();
  }));
  document.querySelectorAll("[data-rice]").forEach((tr) => {
    const id = tr.dataset.rice;
    tr.querySelectorAll("[data-rice-field]").forEach((inp) => inp.addEventListener("input", () => {
      const field = inp.dataset.riceField;
      const val = field === "name" ? inp.value : Number(inp.value) || 0;
      mut(store, board, { rows: d.rows.map((r) => (r.id === id ? Object.assign({}, r, { [field]: val }) : r)) });
      const sc = tr.querySelector(".rice-score");
      const updated = d.rows.find((r) => r.id === id);
      if (sc && updated) sc.textContent = riceScore(updated) ? riceScore(updated).toFixed(1) : "—";
    }));
  });
}

// ── 72. decision matrix ──────────────────────────────────────────
function decisionHTML(store, board) {
  const d = board.data;
  const totals = decisionTotals(board);
  const opts = (d.options || []).map((o) => `
    <tr data-dm-opt="${o.id}">
      <td><input data-dm-optname value="${esc(o.name)}" placeholder="Option"></td>
      ${(d.criteria || []).map((c) => `<td><select data-dm-score="${c.id}">
        ${[1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${Number((d.scores || {})[o.id]?.[c.id]) === v ? "selected" : ""}>${v}</option>`).join("")}
      </select></td>`).join("")}
      <td class="rice-score">${totals[o.id] ? totals[o.id].toFixed(1) : "—"}</td>
      <td><button class="mini-btn danger" data-dm-del="${o.id}">${ICONS.x}</button></td>
    </tr>`).join("");
  const critRow = `<tr class="dm-crit">
    <td></td>
    ${(d.criteria || []).map((c) => `<td><input type="number" min="0" step="0.5" class="dm-weight" data-dm-weight="${c.id}" value="${esc(c.weight ?? 1)}" title="Weight"></td>`).join("")}
    <td></td><td></td>
  </tr>`;
  return `
    <div class="dm-toolbar">
      <button class="btn" id="dmOptBtn">${ICONS.plus} Option</button>
      <button class="btn" id="dmCritBtn">${ICONS.plus} Criterion</button>
      <p class="muted small" style="margin:0 0 0 auto;">Score each option 1–5 per criterion; weights multiply in.</p>
    </div>
    <div class="rice-table-wrap"><table class="rice-table">
      <thead><tr><th>Option</th>${(d.criteria || []).map((c) => `<th>${esc(c.name)}</th>`).join("") || "<th></th>"}<th>Score</th><th></th></tr></thead>
      <tbody>${opts || `<tr><td colspan="${(d.criteria || []).length + 3}" class="ws-empty">Add options and criteria to start scoring.</td></tr>`}</tbody>
      ${d.criteria.length ? `<tfoot>${critRow}</tfoot>` : ""}
    </table></div>`;
}
function wireDecision(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  $("#dmOptBtn")?.addEventListener("click", async () => {
    const name = await promptModal("New option", "Option name", "");
    if (!name) return;
    const o = { id: "o" + (d.nextId++), name };
    const scores = Object.assign({}, d.scores);
    (d.criteria || []).forEach((c) => { scores[o.id] = Object.assign({}, scores[o.id], { [c.id]: 3 }); });
    mut(store, board, { options: [...(d.options || []), o], scores, nextId: d.nextId });
    redraw();
  });
  $("#dmCritBtn")?.addEventListener("click", async () => {
    const name = await promptModal("New criterion", "Criterion name", "");
    if (!name) return;
    const c = { id: "c" + (d.nextId++), name, weight: 1 };
    mut(store, board, { criteria: [...(d.criteria || []), c], nextId: d.nextId });
    redraw();
  });
  document.querySelectorAll("[data-dm-del]").forEach((b) => b.addEventListener("click", () => {
    mut(store, board, { options: d.options.filter((o) => o.id !== b.dataset.dmDel) });
    redraw();
  }));
  document.querySelectorAll("[data-dm-optname]").forEach((inp) => inp.addEventListener("change", () => {
    const tr = inp.closest("[data-dm-opt]");
    mut(store, board, { options: d.options.map((o) => (o.id === tr.dataset.dmOpt ? Object.assign({}, o, { name: inp.value.trim() || o.name }) : o)) });
  }));
  document.querySelectorAll("[data-dm-score]").forEach((sel) => sel.addEventListener("change", () => {
    const tr = sel.closest("[data-dm-opt]");
    const cid = sel.dataset.dmScore;
    const scores = Object.assign({}, d.scores);
    scores[tr.dataset.dmOpt] = Object.assign({}, scores[tr.dataset.dmOpt], { [cid]: Number(sel.value) });
    mut(store, board, { scores });
    redraw();
  }));
  document.querySelectorAll("[data-dm-weight]").forEach((inp) => inp.addEventListener("change", () => {
    const cid = inp.dataset.dmWeight;
    mut(store, board, { criteria: d.criteria.map((c) => (c.id === cid ? Object.assign({}, c, { weight: Number(inp.value) || 0 }) : c)) });
    redraw();
  }));
}

// ── 73. affinity map ─────────────────────────────────────────────
function affinityHTML(store, board) {
  const d = board.data;
  const cols = (d.clusters || []).map((c) => `
    <div class="af-col" data-af-cluster="${c.id}">
      <h3>${esc(c.name)} <span class="cnt">${(d.notes || []).filter((n) => n.clusterId === c.id).length}</span></h3>
      <div class="af-notes">
        ${(d.notes || []).filter((n) => n.clusterId === c.id).map((n) => `<div class="af-note" data-af-note="${n.id}"><span>${esc(n.text)}</span><button class="mini-btn danger" data-af-del="${n.id}">${ICONS.x}</button></div>`).join("") || `<p class="ws-empty">—</p>`}
      </div>
      <div class="cl-add"><input data-af-input="${c.id}" placeholder="Add note…" maxlength="160"><button class="btn" data-af-add="${c.id}">${ICONS.plus}</button></div>
    </div>`).join("");
  return `
    <div class="af-toolbar">
      <button class="btn" id="afClusterBtn">${ICONS.plus} Cluster</button>
      <button class="btn" id="afNoteBtn">${ICONS.plus} Note</button>
      <p class="muted small" style="margin:0 0 0 auto;">Notes live in a cluster — add one to a cluster, or drop it in the unclustered tray below.</p>
    </div>
    <div class="af-grid">${cols}</div>
    <div class="af-tray" id="afTray">
      <h3>Tray (unclustered)</h3>
      <div class="af-tray-notes">
        ${(d.notes || []).filter((n) => !n.clusterId).map((n) => `<span class="af-tray-note" data-af-note="${n.id}">${esc(n.text)} <button class="mini-btn danger" data-af-del="${n.id}">${ICONS.x}</button></span>`).join("") || `<p class="ws-empty">—</p>`}
      </div>
    </div>`;
}
function wireAffinity(store, board, ctx) {
  const redraw = () => ctx.render && ctx.render();
  const d = board.data;
  $("#afClusterBtn")?.addEventListener("click", async () => {
    const name = await promptModal("New cluster", "Cluster name", "");
    if (!name) return;
    const c = { id: "cl" + (d.nextId++), name };
    mut(store, board, { clusters: [...(d.clusters || []), c], nextId: d.nextId });
    redraw();
  });
  $("#afNoteBtn")?.addEventListener("click", async () => {
    const text = await promptModal("New note", "Note text", "");
    if (!text) return;
    const n = { id: "n" + (d.nextId++), text, clusterId: null };
    mut(store, board, { notes: [...(d.notes || []), n], nextId: d.nextId });
    redraw();
  });
  document.querySelectorAll("[data-af-add]").forEach((b) => b.addEventListener("click", () => {
    const cid = b.dataset.afAdd;
    const inp = document.querySelector(`[data-af-input="${cid}"]`);
    const t = (inp?.value || "").trim();
    if (!t) return;
    const n = { id: "n" + (d.nextId++), text: t, clusterId: cid };
    mut(store, board, { notes: [...(d.notes || []), n], nextId: d.nextId });
    inp.value = "";
    redraw();
  }));
  document.querySelectorAll("[data-af-del]").forEach((b) => b.addEventListener("click", () => {
    mut(store, board, { notes: d.notes.filter((n) => n.id !== b.dataset.afDel) });
    redraw();
  }));
  // drag a note onto a cluster (pointer-based)
  document.querySelectorAll("[data-af-note]").forEach((note) => {
    note.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-af-del]")) return;
      const id = note.dataset.afNote;
      const cols = [...document.querySelectorAll(".af-col")];
      const move = (ev) => {
        note.style.opacity = "0.4";
        cols.forEach((c) => c.classList.toggle("over", c.getBoundingClientRect().right > ev.clientX && c.getBoundingClientRect().left < ev.clientX && c.getBoundingClientRect().top < ev.clientY && c.getBoundingClientRect().bottom > ev.clientY));
      };
      const up = (ev) => {
        note.style.opacity = "";
        cols.forEach((c) => c.classList.remove("over"));
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const target = cols.find((c) => c.getBoundingClientRect().right > ev.clientX && c.getBoundingClientRect().left < ev.clientX && c.getBoundingClientRect().top < ev.clientY && c.getBoundingClientRect().bottom > ev.clientY);
        if (target) { mut(store, board, { notes: d.notes.map((n) => (n.id === id ? Object.assign({}, n, { clusterId: target.dataset.afCluster }) : n)) }); redraw(); }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  });
}
