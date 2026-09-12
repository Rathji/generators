/* ============================================================
   BUSINESS ERP — shared UI toolkit
   Small render helpers every module uses so all screens share
   the same look: badges, tables, cards, stat cards, tabs, forms,
   a reusable modal, a promise-based confirm, money/date formatting,
   and delegated event binding. Pure strings + light DOM helpers —
   modules build their own HTML and attach their own listeners.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = (ERP.ui = {});

  const $ = (s, ctx) => (ctx || document).querySelector(s);
  ui.$ = $;

  const esc = (ui.esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  /* ─────────────────────────── formatting ─────────────────────────── */

  ui.CURRENCIES = { USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥", CHF: "CHF " };

  ui.fmt = function (n, d) {
    const v = Number(n);
    if (!isFinite(v)) return "—";
    const digits = d == null ? 2 : d;
    return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  ui.money = function (n, cur) {
    const v = Number(n);
    if (!isFinite(v)) return "—";
    const c = cur || "USD";
    const sym = ui.CURRENCIES[c] || c + " ";
    return sym + ui.fmt(v);
  };

  ui.pct = (n) => (Number(n) || 0) + "%";
  ui.qty = (n) => ui.fmt(n, 3);

  function fmtDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  ui.date = function (iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return esc(String(iso));
    return fmtDate(d);
  };
  ui.dateTime = function (iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return esc(String(iso));
    return fmtDate(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  };
  ui.today = () => fmtDate(new Date());
  ui.addDays = (d, n) => { const dt = new Date(d + "T12:00:00"); dt.setDate(dt.getDate() + n); return fmtDate(dt); };
  ui.diffDays = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
  ui.iso = (dateStr) => { const d = new Date(dateStr + "T12:00:00"); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); };
  ui.ageBucket = function (days) {
    const d = Number(days) || 0;
    if (d <= 0) return "current";
    if (d <= 30) return "1-30";
    if (d <= 60) return "31-60";
    if (d <= 90) return "61-90";
    return "90+";
  };

  /* ─────────────────────────── badges ─────────────────────────── */

  ui.badge = function (text, tone) {
    return '<span class="erp-badge' + (tone ? " tone-" + tone : "") + '">' + esc(text) + "</span>";
  };

  ui.statusBadge = function (state, map) {
    const d = (map && map[state]) || {};
    return ui.badge(d.label || state, d.tone || "muted");
  };

  /* ─────────────────────────── buttons ─────────────────────────── */

  /* Returns an <a> or <button> string. For JS actions pass o.act = "name"
     (bound via ui.bind with [data-act=...]) or o.click = fn + o.id to bind. */
  ui.btn = function (label, o) {
    o = o || {};
    const tone = o.tone || (o.primary ? "primary" : o.danger ? "danger" : "ghost");
    const cls = ["btn", tone !== "ghost" ? "btn-" + tone : "btn-ghost", o.small ? "btn-sm" : "", o.block ? "btn-block" : ""].join(" ");
    let attrs = "";
    if (o.act) attrs += ' data-act="' + esc(o.act) + '"';
    if (o.arg !== undefined) attrs += ' data-arg="' + esc(o.arg) + '"';
    if (o.title) attrs += ' title="' + esc(o.title) + '"';
    if (o.disabled) attrs += " disabled";
    for (const k in (o.attrs || {})) attrs += " " + k + '="' + esc(o.attrs[k]) + '"';
    if (o.id) attrs += ' id="' + esc(o.id) + '"';
    const icon = o.icon ? ERP.icon(o.icon, 16) : "";
    const inner = icon + "<span>" + esc(label) + "</span>";
    if (o.href) {
      return '<a class="' + cls + '" href="' + esc(o.href) + '"' + (o.download ? " download" : "") + attrs + ">" + inner + "</a>";
    }
    return '<button class="' + cls + '" type="' + (o.type || "button") + '"' + attrs + ">" + inner + "</button>";
  };

  /* ─────────────────────────── tables ─────────────────────────── */

  /* cols: [{key, label, align, render(row), width}]
     Cell values are treated as trusted HTML — callers wrap their own dynamic
     text in esc(). Columns with a render() return HTML directly. */
  ui.table = function (cols, rows, opts) {
    opts = opts || {};
    rows = rows || [];
    const thead =
      "<tr>" +
      cols.map((c) => '<th class="' + (c.align ? "align-" + c.align : "") + (c.width ? '" style="width:' + c.width : "") + '">' + esc(c.label || "") + "</th>").join("") +
      "</tr>";
    const body = rows.length
      ? rows.map((r) => "<tr>" + cols.map((c) => '<td class="' + (c.align ? "align-" + c.align : "") + '">' + (c.render ? c.render(r) : r[c.key] != null ? String(r[c.key]) : "") + "</td>").join("") + "</tr>").join("")
      : '<tr class="erp-empty-row"><td colspan="' + cols.length + '">' + esc(opts.emptyText || "No records to show.") + "</td></tr>";
    return (
      '<div class="erp-table-wrap' + (opts.scroll ? " scroll" : "") + '">' +
      '<table class="erp-table">' +
      (opts.caption ? "<caption>" + esc(opts.caption) + "</caption>" : "") +
      "<thead>" + thead + "</thead><tbody>" + body + "</tbody></table></div>"
    );
  };

  /* ─────────────────────────── cards / stats ─────────────────────────── */

  ui.card = function (title, bodyHtml, opts) {
    opts = opts || {};
    const head = title || opts.actions
      ? '<header class="erp-card-head"><h3>' + esc(title || "") + '</h3><div class="erp-card-actions">' + (opts.actions || "") + "</div></header>"
      : "";
    return '<section class="erp-card">' + head + '<div class="erp-card-body">' + bodyHtml + "</div></section>";
  };

  ui.statCard = function (o) {
    const val = o.href ? '<a class="erp-stat-value link" href="' + esc(o.href) + '">' + o.value + "</a>" : '<span class="erp-stat-value">' + o.value + "</span>";
    return (
      '<div class="erp-stat' + (o.tone ? " tone-" + o.tone : "") + '">' +
      '<span class="erp-stat-label">' + esc(o.label) + "</span>" +
      val +
      (o.sub ? '<span class="erp-stat-sub">' + o.sub + "</span>" : "") +
      "</div>"
    );
  };

  ui.grid = function (children, cls) {
    return '<div class="erp-grid ' + (cls || "") + '">' + children.join("") + "</div>";
  };

  /* ─────────────────────────── tabs ─────────────────────────── */

  /* defs: [{id, label, badge}]. Returns bar + panels container; bind via
     ui.bind(root,'click','[data-tab]', fn) and toggle .active + panels. */
  ui.tabs = function (defs, active) {
    const bar =
      '<div class="tabs erp-tabs" role="tablist">' +
      defs.map((d) => '<button class="tab' + (d.id === active ? " active" : "") + '" data-tab="' + esc(d.id) + '" role="tab">' + esc(d.label) +
        (d.badge ? " " + ui.badge(d.badge, "info") : "") + "</button>").join("") +
      "</div>";
    const panels = '<div class="erp-tabs-content">' + defs.map((d) => '<div class="erp-tab-panel' + (d.id === active ? " active" : "") + '" data-panel="' + esc(d.id) + '"></div>').join("") + "</div>";
    return { html: bar + panels, defs };
  };

  ui.showTab = function (root, id) {
    root.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === id));
    root.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === id));
  };

  /* ─────────────────────────── forms ─────────────────────────── */

  let fieldSeq = 0;
  /* Give a control an id (reusing an existing one) so its <label for> is
     programmatically associated. Returns the (possibly rewritten) control and
     the id, or a null id when the control has no labelable element. */
  function associatedControl(control) {
    const existing = /<(?:input|select|textarea)[^>]*\bid="([^"]+)"/.exec(control);
    if (existing) return { control: control, id: existing[1] };
    if (!/<(?:input|select|textarea)\b/.test(control)) return { control: control, id: null };
    const id = "erpf" + (++fieldSeq);
    return { control: control.replace(/<(input|select|textarea)\b/, (m) => m + ' id="' + id + '"'), id: id };
  }

  ui.field = function (label, control, hint, aria) {
    const c = associatedControl(control);
    let ctl = c.control;
    /* A control with no visible label (compact toolbars) can still be named
       for assistive tech via `aria`. */
    if (aria && !/\baria-label=/.test(ctl)) {
      ctl = ctl.replace(/<(input|select|textarea)\b/, (m) => m + ' aria-label="' + esc(aria) + '"');
    }
    const lab = c.id && label ? '<label for="' + c.id + '">' + esc(label) + "</label>" : '<label>' + esc(label || "") + "</label>";
    return '<div class="field">' + lab + ctl + (hint ? '<div class="hint">' + esc(hint) + "</div>" : "") + "</div>";
  };

  ui.text = function (name, label, val, ph, aria) {
    return ui.field(label, '<input type="text" name="' + esc(name) + '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '">', null, aria);
  };
  ui.number = function (name, label, val, o) {
    o = o || {};
    const step = o.step == null ? "any" : o.step;
    return ui.field(label, '<input type="number" step="' + esc(step) + '" name="' + esc(name) + '" value="' + (val == null ? "" : esc(val)) + '"' + (o.min != null ? ' min="' + esc(o.min) + '"' : "") + '>', o.hint, o.aria);
  };
  ui.select = function (name, label, opts, val, ph, aria) {
    const options = (opts || []).map((o) => {
      const v = typeof o === "object" ? o.value : o;
      const l = typeof o === "object" ? (o.label !== undefined ? o.label : o.value) : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? " selected" : "") + ">" + esc(l) + "</option>";
    }).join("");
    return ui.field(label, '<select name="' + esc(name) + '">' + (ph ? '<option value="">' + esc(ph) + "</option>" : "") + options + "</select>", null, aria);
  };
  ui.textarea = function (name, label, val, rows, aria) {
    return ui.field(label, '<textarea name="' + esc(name) + '" rows="' + (rows || 3) + '">' + esc(val || "") + "</textarea>", null, aria);
  };
  ui.dateInput = function (name, label, val, aria) {
    return ui.field(label, '<input type="date" name="' + esc(name) + '" value="' + esc(val || "") + '">', null, aria);
  };
  ui.check = function (name, label, checked) {
    return '<label class="erp-check"><input type="checkbox" name="' + esc(name) + '"' + (checked ? " checked" : "") + "> " + esc(label) + "</label>";
  };
  ui.radioGroup = function (name, options, val) {
    return '<div class="radio-group">' +
      options.map((o) => {
        const v = typeof o === "object" ? o.value : o;
        const l = typeof o === "object" ? o.label : o;
        return '<label><input type="radio" name="' + esc(name) + '" value="' + esc(v) + '"' + (String(v) === String(val) ? " checked" : "") + "> " + esc(l) + "</label>";
      }).join("") +
      "</div>";
  };

  /* Collect named inputs inside el into an object. Numbers→Number, checkboxes→bool. */
  ui.collect = function (el, fields) {
    const out = {};
    for (const f of fields) {
      const i = el.querySelector('[name="' + f + '"]');
      if (!i) { out[f] = undefined; continue; }
      if (i.type === "number") out[f] = i.value === "" ? null : Number(i.value);
      else if (i.type === "checkbox") out[f] = i.checked;
      else if (i.type === "radio") out[f] = i.checked ? i.value : undefined;
      else out[f] = i.value;
    }
    return out;
  };

  ui.form = function (fieldsHtml, foot) {
    return '<form class="erp-form" data-ui-form>' + fieldsHtml + (foot ? '<div class="erp-form-foot">' + foot + "</div>" : "") + "</form>";
  };

  /* ─────────────────────────── modal ─────────────────────────── */

  /* Opens the shared #uiModal with content. Returns the modal element. */
  ui.modal = function (o) {
    const m = $("#uiModal");
    if (!m) return null;
    m.className = "modal-back open" + (o.size === "lg" ? " ui-lg" : o.size === "sm" ? " ui-sm" : "");
    const title = $("#uiModalTitle", m), body = $("#uiModalBody", m), foot = $("#uiModalFoot", m);
    if (title) title.innerHTML = o.title ? esc(o.title) : "";
    if (body) body.innerHTML = o.body || "";
    if (foot) {
      if (o.foot) { foot.innerHTML = o.foot; foot.hidden = false; }
      else foot.hidden = true;
    }
    m.scrollTop = 0;
    return m;
  };
  ui.closeModal = function () {
    const m = $("#uiModal");
    if (m) { m.classList.remove("open"); m.className = "modal-back"; }
  };

  ui.confirm = function (o) {
    return new Promise((resolve) => {
      const m = ui.modal({
        title: o.title || "Are you sure?",
        body: '<p class="erp-modal-note">' + esc(o.message || "") + "</p>",
        foot: ui.btn("Cancel", { small: true, act: "confirm-no" }) + " " + ui.btn(o.okLabel || "Confirm", { small: true, danger: !!o.danger, primary: !o.danger, act: "confirm-yes" }),
      });
      const done = (v) => { ui.closeModal(); resolve(v); };
      m.querySelector("[data-act=confirm-no]").onclick = () => done(false);
      m.querySelector("[data-act=confirm-yes]").onclick = () => done(true);
    });
  };

  /* ─────────────────────────── event binding ─────────────────────────── */

  /* Bind a delegated listener on root (or document). `selector` may be
     "[data-act]" — then fn(el, e, act, arg) with data-act + data-arg. */
  ui.bind = function (root, evt, selector, fn) {
    (root || document).addEventListener(evt, (e) => {
      const t = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (!t) return;
      if (root && root !== document && !root.contains(t)) return;
      const act = t.getAttribute ? t.getAttribute("data-act") : null;
      const arg = t.getAttribute ? t.getAttribute("data-arg") : null;
      fn(t, e, act, arg);
    });
  };

  /* Shared modal close bindings (call once at boot). */
  ui.wireModal = function () {
    const m = $("#uiModal");
    if (!m) return;
    m.addEventListener("click", (e) => { if (e.target === m) ui.closeModal(); });
    ui.bind(m, "click", "[data-ui-close]", () => ui.closeModal());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && m.classList.contains("open")) ui.closeModal();
    });
  };

  /* ─────────────────────────── misc ─────────────────────────── */

  ui.stateEmpty = function (el, def) { ERP.states.empty(el, def); };
  ui.stateError = function (el, opts) { ERP.states.error(el, opts); };

  ui.pageHead = function (title, sub, actions) {
    return '<div class="erp-page-head"><div><h2>' + esc(title) + "</h2>" + (sub ? "<p>" + esc(sub) + "</p>" : "") + '</div><div class="erp-page-actions">' + (actions || "") + "</div></div>";
  };

  ui.summary = function (items) {
    return '<div class="erp-summary">' + items.map((it) => '<div class="erp-summary-item"><span>' + esc(it.label) + '</span><b>' + it.value + "</b></div>").join("") + "</div>";
  };

  ui.alert = function (msg, tone) {
    return '<div class="erp-alert' + (tone ? " tone-" + tone : "") + '">' + esc(msg) + "</div>";
  };

  ui.loading = function (el, label) { ERP.states.loading(el, label); };

  /* Wire the shared modal (backdrop click, close button, Escape) once. */
  ui.wireModal();
})();
