// src/psa/crud.js — generic list + form + detail CRUD used by every data
// module. A module config supplies a collection id, list columns, a form
// field schema and optional derived sections; this renders a searchable list,
// add/edit form modal, delete with confirmation, and a detail view that shows
// derived numbers (actuals, health, unbilled...) computed from the master core.

import store from "./store.js";
import { el, h, icon, pageHeader, moduleShell, modal, toast, confirmModal, loadingState } from "./core.js";
import hub from "./hub.js";

export function fieldLabel(f) {
  return f.label || (f.key.charAt(0).toUpperCase() + f.key.slice(1).replace(/([A-Z])/g, " $1"));
}

async function resolveOptions(f, formValue) {
  if (typeof f.options === "function") return f.options(formValue);
  return f.options || [];
}

function buildInput(f, value, formValue) {
  const v = value == null ? (f.default != null ? f.default : "") : value;
  const input = document.createElement(f.type === "textarea" ? "textarea" : "input");
  input.dataset.field = f.key;
  const set = { text: "text", email: "email", url: "url", number: "number", money: "number", date: "date", textarea: "textarea", select: "select", checkbox: "checkbox", tags: "text", readonly: "text" };
  input.type = set[f.type] || "text";
  if (f.type === "textarea") { input.rows = f.rows || 3; input.value = v; }
  else if (f.type === "checkbox") { input.type = "checkbox"; input.checked = !!v; }
  else if (f.type === "number" || f.type === "money") { input.step = f.step || "any"; input.value = v === "" ? "" : v; }
  else input.value = v;
  if (f.placeholder) input.placeholder = f.placeholder;
  if (f.required) input.required = true;
  if (f.readonly) input.readOnly = true;
  if (f.type === "date" && !input.value) input.value = f.defaultToday ? new Date().toISOString().slice(0, 10) : "";
  return input;
}

function buildField(f, value, formValue) {
  const v = value == null ? "" : value;
  const wrap = el("div", "psa-field" + (f.type === "checkbox" ? " psa-field-check" : ""));
  const lab = el("label", "psa-field-label", h(fieldLabel(f)));
  if (f.required) lab.appendChild(el("span", "psa-req", "*"));
  wrap.appendChild(lab);
  if (f.type === "select") {
    const sel = document.createElement("select");
    sel.dataset.field = f.key;
    const ph = el("option", "", h(f.placeholder || ("Select " + fieldLabel(f).toLowerCase())));
    ph.value = "";
    sel.appendChild(ph);
    sel.value = value == null ? "" : value;
    const load = async () => {
      const opts = await resolveOptions(f, formValue);
      const chosen = sel.value;
      sel.innerHTML = "";
      sel.appendChild(ph);
      for (const o of opts) {
        const opt = el("option", "", h(o.label != null ? o.label : o));
        opt.value = o.value != null ? o.value : o;
        sel.appendChild(opt);
      }
      if (chosen) sel.value = chosen;
    };
    load();
    wrap.appendChild(sel);
    if (f.readonly) sel.disabled = true;
  } else if (f.type === "multiselect") {
    const box = el("div", "psa-multi");
    const cur = Array.isArray(value) ? value : [];
    const load = async () => {
      const opts = await resolveOptions(f, formValue);
      box.innerHTML = "";
      for (const o of opts) {
        const val = o.value != null ? o.value : o;
        const labT = o.label != null ? o.label : o;
        const lab = el("label", "psa-chip-check");
        lab.innerHTML = '<input type="checkbox" value="' + h(val) + '"><span>' + h(labT) + "</span>";
        const cb = lab.querySelector("input");
        if (cur.includes(val)) cb.checked = true;
        box.appendChild(lab);
      }
    };
    load();
    wrap.appendChild(box);
  } else if (f.type === "tags") {
    const row = el("div", "psa-tags-row");
    const input = buildInput(f, Array.isArray(v) ? v.join(", ") : v, formValue);
    input.placeholder = f.placeholder || "comma-separated values";
    row.appendChild(input);
    wrap.appendChild(row);
  } else if (f.type === "lines") {
    const ta = document.createElement("textarea");
    ta.dataset.field = f.key;
    ta.rows = f.rows || 5;
    ta.value = linesToText(v);
    ta.placeholder = f.placeholder || "One item per line, columns split by |";
    if (f.readonly) ta.readOnly = true;
    wrap.appendChild(ta);
  } else {
    const input = buildInput(f, v, formValue);
    if (f.type === "money") {
      const row = el("div", "psa-money-row");
      const cur = el("span", "psa-money-cur", h(f.currency || ""));
      row.appendChild(cur);
      row.appendChild(input);
      wrap.appendChild(row);
    } else {
      wrap.appendChild(input);
    }
  }
  if (f.help) wrap.appendChild(el("p", "psa-field-help", h(f.help)));
  return wrap;
}

function linesToText(lines) {
  return (lines || []).map((l) => {
    if (typeof l === "string") return l;
    if (Array.isArray(l)) return l.join(" | ");
    return Object.values(l).join(" | ");
  }).join("\n");
}

function textToLines(text) {
  return text.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => s.split("|").map((x) => x.trim()));
}

export function buildForm(fields, record, opts = {}) {
  const form = el("form", "psa-form");
  form.noValidate = true;
  const formValue = record || {};
  const built = [];
  for (const f of fields) {
    if (f.depends && !f.depends(formValue)) continue;
    const wrap = buildField(f, record ? record[f.key] : undefined, formValue);
    built.push({ f, wrap });
    form.appendChild(wrap);
  }
  const live = Object.assign({}, formValue);
  function fieldValueOf(target) {
    if (target.type === "checkbox") return target.checked;
    if (target.type === "number") return target.value === "" ? "" : Number(target.value);
    return target.value;
  }
  function applyDepends() {
    for (const { f, wrap } of built) {
      if (!f.depends) continue;
      wrap.hidden = !f.depends(live);
    }
  }
  form.addEventListener("input", (e) => {
    if (!e.target.dataset) return;
    const key = e.target.dataset.field;
    if (key == null) return;
    live[key] = fieldValueOf(e.target);
    applyDepends();
  });
  form.addEventListener("change", (e) => {
    const key = e.target && e.target.dataset && e.target.dataset.field;
    if (key) live[key] = fieldValueOf(e.target);
    applyDepends();
  });
  applyDepends();
  const getValue = () => {
    const out = {};
    for (const f of fields) {
      if (f.depends && !f.depends(formValue)) continue;
      const inp = form.querySelector('[data-field="' + f.key + '"]');
      if (f.type === "multiselect") {
        out[f.key] = [...form.querySelectorAll(".psa-multi input:checked")].map((c) => c.value);
      } else if (f.type === "checkbox") {
        out[f.key] = inp ? inp.checked : !!record[f.key];
      } else if (f.type === "tags") {
        const raw = inp ? inp.value : "";
        out[f.key] = raw.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (f.type === "lines") {
        out[f.key] = textToLines(inp ? inp.value : "");
      } else if (f.type === "number" || f.type === "money") {
        const raw = inp ? inp.value : "";
        out[f.key] = raw === "" ? (f.required ? null : undefined) : Number(raw);
      } else {
        out[f.key] = inp ? inp.value : (record ? record[f.key] : undefined);
      }
    }
    return out;
  };
  const validate = () => {
    for (const f of fields) {
      if (f.depends && !f.depends(formValue)) continue;
      const v = getValue()[f.key];
      if (f.required && (v == null || v === "" || (Array.isArray(v) && !v.length))) {
        return "“" + fieldLabel(f) + "” is required.";
      }
      if ((f.type === "number" || f.type === "money") && v != null && isNaN(v)) {
        return "“" + fieldLabel(f) + "” must be a number.";
      }
    }
    return null;
  };
  return { form, getValue, validate };
}

function rowCell(col, rec) {
  const cell = el("div", "psa-cell");
  cell.dataset.label = col.label;
  let content;
  if (col.render) content = col.render(rec);
  else if (col.key) {
    const v = rec[col.key];
    content = Array.isArray(v) ? v.join(", ") : (v == null ? "" : String(v));
  } else content = "";
  if (content instanceof Node) cell.appendChild(content);
  else if (content != null && typeof content !== "object") cell.innerHTML = content;
  return cell;
}

export async function renderCrud(container, cfg) {
  const sec = container.classList && container.classList.contains("psa-module") ? container : moduleShell(cfg.moduleId || cfg.collection);
  if (sec !== container) container.appendChild(sec);
  const actions = [
    ...(cfg.toolbar || []),
    { label: cfg.newLabel || "Add " + (cfg.singular || "record"), icon: "plus", kind: "btn-primary", onClick: () => openForm(cfg, refreshAll) }
  ];
  sec.appendChild(pageHeader(cfg.title, cfg.subtitle, actions));
  const toolbar = el("div", "psa-crud-toolbar");
  let prefilterSelect = null;
  let prefilterValue = "";
  if (cfg.prefilter) {
    prefilterSelect = el("select", "psa-filter-select");
    prefilterSelect.setAttribute("aria-label", cfg.prefilter.allLabel || "Filter");
    toolbar.appendChild(prefilterSelect);
    prefilterSelect.addEventListener("change", () => { prefilterValue = prefilterSelect.value; renderList(); });
  }
  const search = el("input", "psa-search", "");
  search.type = "search";
  search.placeholder = cfg.searchPlaceholder || "Search…";
  toolbar.appendChild(search);
  const meta = el("span", "psa-crud-meta");
  toolbar.appendChild(meta);
  sec.appendChild(toolbar);
  const listHost = el("div", "psa-list");
  sec.appendChild(listHost);

  function refreshPrefilter() {
    if (!prefilterSelect) return;
    const prev = prefilterSelect.value;
    prefilterSelect.innerHTML = "";
    const all = el("option", "", h(cfg.prefilter.allLabel || "All"));
    all.value = "";
    prefilterSelect.appendChild(all);
    for (const o of cfg.prefilter.options) {
      const opt = el("option", "", h(o.label));
      opt.value = o.value;
      prefilterSelect.appendChild(opt);
    }
    prefilterSelect.value = prev;
  }

  const refreshAll = () => { refreshPrefilter(); renderList(); };

  async function renderList() {
    await store.ready();
    let recs = store.getAllRecords(cfg.collection);
    const q = search.value.trim().toLowerCase();
    if (q && cfg.searchKeys) {
      recs = recs.filter((r) => cfg.searchKeys.some((k) => {
        const v = r[k];
        if (v == null) return false;
        return String(Array.isArray(v) ? v.join(" ") : v).toLowerCase().includes(q);
      }));
    }
    if (cfg.prefilter && prefilterValue && cfg.prefilter.filter) {
      recs = recs.filter((r) => cfg.prefilter.filter(r, prefilterValue));
    }
    if (cfg.filter) recs = recs.filter((r) => cfg.filter(r));
    if (cfg.sortBy) recs = recs.slice().sort(cfg.sortBy);
    meta.textContent = recs.length + (recs.length === 1 ? " record" : " records");
    listHost.innerHTML = "";
    if (!recs.length) {
      const es = Object.assign({}, cfg.emptyState || {
        title: "Nothing here yet",
        message: "Add your first record to get started.",
      });
      if (!es.action) es.action = { label: cfg.newLabel || "Add" };
      es.action.onClick = es.action.onClick || (() => openForm(cfg, refreshAll));
      listHost.appendChild(emptyStateEl(es));
      return;
    }
    const head = el("div", "psa-row psa-row-head");
    for (const c of cfg.columns) head.appendChild(el("div", "psa-cell", h(c.label)));
    listHost.appendChild(head);
    for (const rec of recs) {
      const row = el("div", "psa-row" + (cfg.rowClass ? " " + cfg.rowClass(rec) : ""));
      row.dataset.id = rec.id;
      for (const c of cfg.columns) row.appendChild(rowCell(c, rec));
      if (cfg.columns.length) {
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        const open = () => (cfg.rowClick ? cfg.rowClick(rec, { refresh: refreshAll }) : openDetail(cfg, rec, refreshAll));
        row.addEventListener("click", open);
        row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      }
      listHost.appendChild(row);
    }
  }

  search.addEventListener("input", () => {
    clearTimeout(search.__t);
    search.__t = setTimeout(renderList, 120);
  });

  if (sec !== container) container.appendChild(sec);
  if (cfg.onReady) cfg.onReady(refreshAll);
  await renderList();
}

function emptyStateEl(opts) {
  const card = el("div", "state-card state-empty");
  const inner = el("div", "state-card-inner");
  const iconWrap = el("div", "state-icon");
  iconWrap.innerHTML = icon("box");
  inner.appendChild(iconWrap);
  inner.appendChild(el("h3", "state-title", h(opts.title || "Nothing here")));
  if (opts.message) inner.appendChild(el("p", "state-msg", h(opts.message)));
  if (opts.action) {
    const btn = el("button", "btn btn-primary", h(opts.action.label));
    btn.addEventListener("click", opts.action.onClick);
    inner.appendChild(btn);
  }
  card.appendChild(inner);
  return card;
}

function recordLabel(rec) {
  return rec.name || rec.title || rec.number || rec.id || "";
}

function baseRecord(cfg) {
  const r = { id: uid(cfg.collection) };
  for (const f of cfg.fields) {
    if (f.default != null) r[f.key] = f.default;
  }
  return r;
}

function uid(prefix) {
  return prefix.slice(0, 10) + "-" + Math.random().toString(36).slice(2, 10);
}

export function openForm(cfg, onSaved, record) {
  const isNew = !record;
  const rec = isNew ? baseRecord(cfg) : Object.assign({}, record);
  const { form, getValue, validate } = buildForm(cfg.fields, rec);
  const err = el("p", "psa-form-err");
  err.hidden = true;
  form.appendChild(err);
  let m = null;
  const doSave = async (btn) => {
    btn.disabled = true;
    const v = getValue();
    const verr = validate();
    const extraErr = cfg.validate ? cfg.validate(v, rec) : null;
    const errMsg = verr || extraErr;
    if (errMsg) {
      err.textContent = errMsg;
      err.hidden = false;
      btn.disabled = false;
      return;
    }
    const merged = Object.assign({}, rec, v, {
      updatedAt: new Date().toISOString(),
    });
    if (isNew) merged.createdAt = merged.createdAt || new Date().toISOString();
    try {
      if (cfg.onBeforeSave) {
        const stop = await cfg.onBeforeSave(merged, rec);
        if (stop) { btn.disabled = false; return; }
      }
      const action = cfg.authorizeAction || "edit." + cfg.collection;
      const label = recordLabel(merged);
      const auth = await hub.authorize(action, (isNew ? "created " : "edited ") + (cfg.singular || "record") + (label ? " — " + label : ""));
      if (!auth.ok) {
        err.textContent = auth.reason || "You don't have permission to do that.";
        err.hidden = false;
        btn.disabled = false;
        return;
      }
      await store.saveRecord(cfg.collection, merged);
      hub.recordAudit(action, (isNew ? "created " : "edited ") + (cfg.singular || "record") + (label ? " — " + label : ""), auth.actor).catch(() => {});
      if (cfg.onAfterSave) await cfg.onAfterSave(merged, rec);
      toast(isNew ? (cfg.singular || "Record") + " created" : "Changes saved");
      if (m) m.close();
      if (onSaved) await onSaved();
    } catch (e) {
      console.error("[psa] save failed:", e);
      err.textContent = e && e.message ? e.message : "Could not save.";
      err.hidden = false;
      btn.disabled = false;
    }
  };
  m = modal({
    title: (isNew ? "Add " : "Edit ") + (cfg.singular || "record"),
    body: form,
    wide: cfg.wideForm,
    actions: [
      { label: "Cancel", onClick: () => m && m.close() },
      { label: isNew ? "Create" : "Save changes", kind: "btn-primary", onClick: doSave }
    ]
  });
  if (cfg.afterOpen) cfg.afterOpen(form, getValue, rec);
}

export function openDetail(cfg, rec, refreshAll) {
  const body = el("div", "psa-detail");
  const current = { close: () => {} };
  renderDetail(body, cfg, rec, refreshAll);
  const actions = [];
  if (cfg.detailActions) {
    const extra = cfg.detailActions(rec, { refresh: () => renderDetail(body, cfg, rec, refreshAll) }) || [];
    for (const a of extra) {
      actions.push({ label: a.label, icon: a.icon, kind: a.kind || "btn-primary", className: a.className, onClick: (b) => a.onClick({ close: () => current.close(), refresh: () => renderDetail(body, cfg, rec, refreshAll), button: b }) });
    }
  }
  actions.push({ label: "Edit", icon: "plus", onClick: () => { current.close(); openForm(cfg, refreshAll, rec); } });
  actions.push({ label: "Delete", kind: "btn-danger", onClick: (b) => {
      if (cfg.canDelete && !cfg.canDelete(rec)) {
        toast(cfg.deleteBlocked || "This record can't be deleted.", "err");
        return;
      }
      confirmModal({
        title: "Delete this record?",
        message: "This permanently removes the record. This action cannot be undone here (a backup can restore it).",
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const action = cfg.authorizeDelete || "edit." + cfg.collection;
          const auth = await hub.authorize(action, "deleted " + (cfg.singular || "record") + (recordLabel(rec) ? " — " + recordLabel(rec) : ""));
          if (!auth.ok) {
            toast(auth.reason || "You don't have permission to delete this record.", "err");
            return;
          }
          await store.removeRecord(cfg.collection, rec.id);
          hub.recordAudit(action, "deleted " + (cfg.singular || "record") + (recordLabel(rec) ? " — " + recordLabel(rec) : ""), auth.actor).catch(() => {});
          if (cfg.onAfterDelete) await cfg.onAfterDelete(rec);
          toast("Record deleted");
          current.close();
          if (refreshAll) await refreshAll();
        }
      });
    } });
  const m = modal({ title: (cfg.singular || "Record"), body, wide: true, actions });
  current.close = m.close;
}

async function renderDetail(body, cfg, rec, refreshAll) {
  body.innerHTML = "";
  body.appendChild(el("h4", "psa-detail-title", h((rec.name || rec.title || rec.number || rec.id))));
  if (cfg.detailMeta) {
    const meta = cfg.detailMeta(rec);
    if (meta) body.appendChild(el("p", "psa-detail-meta", h(meta)));
  }
  if (cfg.derive) {
    const dr = cfg.derive(rec);
    if (dr && dr.html) body.appendChild(el("div", "psa-derive", dr.html));
  }
  const grid = el("dl", "psa-detail-grid");
  const shown = {};
  for (const f of cfg.fields) {
    const v = rec[f.key];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (shown[f.key]) continue;
    shown[f.key] = true;
    grid.appendChild(el("dt", "", h(fieldLabel(f))));
    let display = Array.isArray(v) ? v.join(", ") : String(v);
    if (f.type === "money") display = Number(v).toLocaleString(undefined, { style: "currency", currency: (cfg.currency || "USD") });
    else if (f.type === "date" && v) {
      try { display = new Date(v).toLocaleDateString(); } catch (e) {}
    }
    grid.appendChild(el("dd", "", h(display)));
  }
  body.appendChild(grid);
  if (cfg.detailSections) {
    for (const sec of cfg.detailSections) {
      try {
        const node = await sec(rec, { refresh: () => renderDetail(body, cfg, rec, refreshAll) });
        if (node) body.appendChild(node);
      } catch (e) { console.error("[psa] detail section failed:", e); }
    }
  }
}
