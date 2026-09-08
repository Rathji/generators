/* ============================================================
   BI UI — shared presentation primitives.
   Every module renders through these so empty / loading / error
   states, page headers and cards stay visually consistent.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const ui = BI.ui;

  function defaultTitle(type) {
    if (type === "loading") return "Loading…";
    if (type === "error") return "Something went wrong";
    return "Nothing here yet";
  }

  /* ---------- state block (empty | loading | error) ---------- */
  ui.state = function (opts) {
    opts = opts || {};
    const type = opts.type || "empty";
    const el = document.createElement("div");
    el.className = "bi-state bi-state--" + type;

    const iconWrap = document.createElement("div");
    iconWrap.className = "bi-state-icon";
    if (type === "loading") {
      const sp = document.createElement("span");
      sp.className = "bi-spinner";
      iconWrap.appendChild(sp);
    } else {
      const iconName = opts.icon || (type === "error" ? "error" : "inbox");
      iconWrap.innerHTML = BI.icon(iconName, 26);
    }
    el.appendChild(iconWrap);

    const title = document.createElement("h3");
    title.className = "bi-state-title";
    title.textContent = opts.title || defaultTitle(type);
    el.appendChild(title);

    if (opts.message) {
      const msg = document.createElement("p");
      msg.className = "bi-state-msg";
      msg.textContent = opts.message;
      el.appendChild(msg);
    }
    if (opts.hint) {
      const hint = document.createElement("p");
      hint.className = "bi-state-hint";
      hint.textContent = opts.hint;
      el.appendChild(hint);
    }
    if (opts.actions && opts.actions.length) {
      const actions = document.createElement("div");
      actions.className = "bi-state-actions";
      for (const a of opts.actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bi-btn " + (a.kind === "ghost" ? "bi-btn-ghost" : a.kind === "danger" ? "bi-btn-danger" : "bi-btn-primary");
        btn.textContent = a.label;
        if (a.onClick) btn.addEventListener("click", (e) => a.onClick(e, btn));
        actions.appendChild(btn);
      }
      el.appendChild(actions);
    }
    return el;
  };

  /* ---------- page header ---------- */
  ui.pageHead = function (opts) {
    const el = document.createElement("div");
    el.className = "bi-page-head";
    const left = document.createElement("div");
    const title = document.createElement("h1");
    title.className = "bi-page-title";
    title.textContent = opts.title;
    left.appendChild(title);
    if (opts.description) {
      const d = document.createElement("p");
      d.className = "bi-page-desc";
      d.textContent = opts.description;
      left.appendChild(d);
    }
    el.appendChild(left);
    if (opts.actions && opts.actions.length) {
      const right = document.createElement("div");
      right.className = "bi-page-actions";
      for (const a of opts.actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bi-btn " + (a.kind === "ghost" ? "bi-btn-ghost" : "bi-btn-primary");
        btn.textContent = a.label;
        if (a.onClick) btn.addEventListener("click", (e) => a.onClick(e, btn));
        right.appendChild(btn);
      }
      el.appendChild(right);
    }
    return el;
  };

  /* ---------- card ---------- */
  ui.card = function (opts) {
    const el = document.createElement("div");
    el.className = "bi-card" + (opts.className ? " " + opts.className : "");
    if (opts.header) {
      const h = document.createElement("div");
      h.className = "bi-card-h";
      const t = document.createElement("div");
      t.className = "bi-card-title";
      t.textContent = opts.header;
      h.appendChild(t);
      if (opts.headerActions) h.appendChild(opts.headerActions);
      el.appendChild(h);
    }
    if (opts.body) {
      const b = document.createElement("div");
      b.className = "bi-card-b";
      if (typeof opts.body === "string") b.innerHTML = opts.body;
      else b.appendChild(opts.body);
      el.appendChild(b);
    }
    return el;
  };

  /* ---------- badge ---------- */
  ui.badge = function (text, kind) {
    const s = document.createElement("span");
    s.className = "bi-badge" + (kind ? " bi-badge--" + kind : "");
    s.textContent = text;
    return s;
  };

  /* ---------- form controls ---------- */
  ui.textInput = function (value, placeholder) {
    const i = document.createElement("input");
    i.type = "text";
    i.className = "bi-input";
    i.value = value || "";
    i.placeholder = placeholder || "";
    return i;
  };
  ui.select = function (options, value) {
    const s = document.createElement("select");
    s.className = "bi-select";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  };
  ui.checkbox = function (label, checked) {
    const w = document.createElement("label");
    w.className = "bi-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    const span = document.createElement("span");
    span.textContent = label;
    w.appendChild(cb);
    w.appendChild(span);
    w._cb = cb;
    return w;
  };
  ui.field = function (label, control, hint) {
    const w = document.createElement("div");
    w.className = "bi-field";
    const l = document.createElement("label");
    l.className = "bi-field-label";
    l.textContent = label;
    w.appendChild(l);
    w.appendChild(control);
    if (hint) {
      const h = document.createElement("div");
      h.className = "bi-field-hint";
      h.textContent = hint;
      w.appendChild(h);
    }
    return w;
  };

  /* ---------- modal ---------- */
  ui.modal = function (opts) {
    opts = opts || {};
    const overlay = document.createElement("div");
    overlay.className = "bi-modal-overlay";
    const box = document.createElement("div");
    box.className = "bi-modal" + (opts.width ? " bi-modal--" + opts.width : "");
    const head = document.createElement("div");
    head.className = "bi-modal-h";
    const t = document.createElement("div");
    t.className = "bi-modal-title";
    t.textContent = opts.title || "";
    head.appendChild(t);
    const closeX = document.createElement("button");
    closeX.type = "button";
    closeX.className = "bi-iconbtn bi-iconbtn--sm";
    closeX.innerHTML = BI.icon("error", 15);
    closeX.title = "Close";
    closeX.setAttribute("aria-label", "Close");
    closeX.addEventListener("click", () => close());
    head.appendChild(closeX);
    box.appendChild(head);
    const body = document.createElement("div");
    body.className = "bi-modal-b";
    if (opts.bodyEl) body.appendChild(opts.bodyEl);
    else if (typeof opts.body === "string") body.innerHTML = opts.body;
    box.appendChild(body);
    if (opts.actions && opts.actions.length) {
      const foot = document.createElement("div");
      foot.className = "bi-modal-f";
      for (const a of opts.actions) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bi-btn " + (a.kind === "ghost" ? "bi-btn-ghost" : a.kind === "danger" ? "bi-btn-danger" : "bi-btn-primary");
        b.textContent = a.label;
        if (a.onClick) b.addEventListener("click", (e) => a.onClick(e, close));
        foot.appendChild(b);
      }
      box.appendChild(foot);
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    function close() {
      if (opts.onClose) opts.onClose();
      overlay.remove();
    }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    const f = overlay.querySelector(".bi-input, .bi-select, .bi-modal-b input, .bi-modal-b textarea");
    if (f) setTimeout(() => f.focus(), 30);
    return { overlay, box, body, close };
  };

  /* ---------- small toast-friendly confirm (non-blocking) ---------- */
  ui.confirm = function (opts, cb) {
    const m = ui.modal({
      title: opts.title || "Are you sure?",
      body: "<p class=\"bi-modal-msg\">" + BI.esc(opts.message || "") + "</p>",
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (e, close) => { close(); if (cb) cb(false); } },
        { label: opts.confirmLabel || "Confirm", kind: opts.danger ? "danger" : "primary", onClick: (e, close) => { close(); if (cb) cb(true); } },
      ],
    });
    return m;
  };

  /* ---------- toast ---------- */
  let toastTimer = null;
  ui.toast = function (msg, kind) {
    let ctn = BI.$("#toastCtn");
    if (!ctn) {
      ctn = document.createElement("div");
      ctn.id = "toastCtn";
      ctn.className = "toast-ctn";
      document.body.appendChild(ctn);
    }
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    ctn.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.style.opacity = "0";
      t.style.transition = "opacity .3s";
      setTimeout(() => t.remove(), 320);
    }, 2600);
  };
})();
