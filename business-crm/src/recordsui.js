window.RECORDUI = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;

  const ERR_MAP = {
    conflict: "Another device changed this document while you were editing. Your version is kept safely — open the Dashboard to resolve the conflict.",
    no_edit_key: "This device has no write key for this document. Open Dashboard → Backup & restore and restore a downloaded backup to claim write access.",
    doc_too_large: "This document would exceed the storage ceiling. Open Dashboard → Capacity & archive to archive old records first.",
    doc_missing: "The document no longer exists on the server. Reload the page to recreate it.",
    server_lag: "The server is catching up after your last save — wait a moment and try again.",
    requires_saved_generator: "Save this generator first (via the editor) to enable cloud storage.",
    over_daily_allowance: "Today's storage allowance is used up. Try again tomorrow, or free space via Dashboard → Capacity & archive.",
    conflict_stale: "The document changed while saving; nothing was overwritten. Reload and try again.",
    corrupt_head: "The document is corrupt. Open Dashboard → Backup & restore to recover it.",
    schema_mismatch: "This document was created by a different version of the app, so it can't be written safely. Open Dashboard → Backup & restore to download what's readable, then reload the page.",
    corrupt_part: "Part of this document is unreadable. Open Dashboard → Backup & restore to recover the readable remainder.",
    corrupt_sha: "This document failed its integrity check. Open Dashboard → Backup & restore to recover it.",
    file_too_big: "This document is too large for a single upload. Open Dashboard → Capacity & archive to archive old records, then save again.",
    editable_error: "The upload service rejected the write. Check your connection and try again — if it persists, open Dashboard → Backup & restore.",
    unreadable_modules: "Some documents could not be read, so this is not a complete backup. Open Dashboard → Backup & restore to see which ones, then retry.",
    pending_changes: "Finish the pending sync items on the Dashboard first, so a restore cannot discard unsaved changes.",
    merge_failed: "The merge could not be completed and nothing was changed. Try the merge again — if it persists, resolve pending sync conflicts on the Dashboard first.",
    load_failed: "The document could not be read from the server. Check your connection and try again.",
    update_failed: "The change could not be applied. Try again.",
    save_failed: "The change could not be written to the server. Try again.",
    read_only: "Your role is read-only — only owners and managers can make changes. Ask the hub owner to change your role or make the change for you."
  };

  function describeError(res, label) {
    if (!res) return "The change could not be saved.";
    const code = res && res.code;
    let msg = ERR_MAP[code];
    if (msg && label) msg = msg.replace(/this document|the document/g, "the " + label + " document");
    return msg || (res && res.detail) || "The change could not be saved.";
  }

  function banner(kind, text) {
    const b = el("div", "bkp-msg " + kind);
    b.setAttribute("role", "status");
    if (text instanceof Node) b.appendChild(text);
    else b.textContent = text;
    return b;
  }

  async function statusBannerCard(store, module, label) {
    let info = null;
    try { info = await store.statusInfo(); } catch (e) { return null; }
    const st = info && info.modules && info.modules[module] ? info.modules[module].state : null;
    if (!st || (st !== "conflict" && st !== "pending")) return null;
    const b = banner(st === "conflict" ? "err" : "warn",
      st === "conflict"
        ? "This module has an unresolved conflict — another device changed the same document. Nothing is lost; resolve it before making further changes. "
        : "This module has changes waiting to sync — they will publish the next time the app reconciles. ");
    const link = document.createElement("a");
    link.href = "#/dashboard";
    link.textContent = "Open Dashboard";
    link.style.marginLeft = "8px";
    link.style.fontWeight = "700";
    b.appendChild(link);
    return b;
  }

  function storeCard(label, res) {
    const card = el("div", "card");
    card.appendChild(el("p", "hint", res && res.detail ? res.detail : ("The " + label + " document could not be read.")));
    const row = el("div");
    row.style.marginTop = "14px";
    const go = document.createElement("a");
    go.className = "btn btn-ghost btn-sm";
    go.href = "#/dashboard";
    go.textContent = "Go to Dashboard";
    row.appendChild(go);
    card.appendChild(row);
    return card;
  }

  function notFoundCard(opts) {
    opts = opts || {};
    const card = el("div", "card state state-empty");
    card.innerHTML = `<div class="state-icon">${opts.icon || ""}</div>`;
    card.appendChild(el("p", "state-title", opts.title || "Record not found"));
    card.appendChild(el("p", "state-msg", opts.what || "That record no longer exists in this document."));
    const a = document.createElement("a");
    a.className = "btn btn-primary btn-sm";
    a.href = opts.backHref || "#/";
    a.textContent = opts.backLabel || "Back to the list";
    const acts = el("div", "state-actions");
    acts.appendChild(a);
    card.appendChild(acts);
    return card;
  }

  function chip(count, one, many) {
    const c = el("span", "chip");
    c.textContent = count + " " + (count === 1 ? one : many);
    return c;
  }

  function segGroup(list, current, onPick) {
    const seg = el("div", "seg");
    list.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.label;
      b.dataset.filt = f.id;
      if (f.id === current) b.classList.add("on");
      b.addEventListener("click", () => onPick(f.id, b));
      seg.appendChild(b);
    });
    return seg;
  }

  function fld(kind, labelText, control, opts) {
    opts = opts || {};
    const box = el("div", "fld" + (opts.full ? " full" : ""));
    const lab = document.createElement("label");
    lab.htmlFor = opts.id;
    lab.appendChild(document.createTextNode(labelText));
    if (opts.required) lab.appendChild(el("span", "req", " *"));
    box.appendChild(lab);
    control.id = opts.id;
    box.appendChild(control);
    if (opts.hint) {
      const sm = el("small", "fld-hint");
      sm.textContent = opts.hint;
      box.appendChild(sm);
    }
    const err = el("div", "fld-err");
    err.dataset.errFor = opts.id;
    err.hidden = true;
    box.appendChild(err);
    return box;
  }

  function checkRow(text, checked, onToggle, hint) {
    const lab = el("label", "check");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    lab.appendChild(cb);
    const span = el("span");
    span.textContent = text;
    if (hint) {
      const sm = el("small", "check-hint");
      sm.textContent = " " + hint;
      span.appendChild(sm);
    }
    lab.appendChild(span);
    if (onToggle) cb.addEventListener("change", () => onToggle(cb.checked));
    return lab;
  }

  function initials(name) {
    const s = String(name || "?").trim();
    const words = s.split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function tagsChips(tags, max) {
    const out = el("span", "rec-tags");
    const arr = Array.isArray(tags) ? tags.slice(0, max || 5) : [];
    arr.forEach(t => out.appendChild(el("span", "tag-pill", t)));
    if (Array.isArray(tags) && tags.length > (max || 5)) {
      out.appendChild(el("span", "tag-pill more", "+" + (tags.length - (max || 5))));
    }
    return out;
  }

  function fmtMoney(n) {
    const x = Number(n);
    if (x === null || x === undefined || !isFinite(x)) return "—";
    if (Math.abs(x) >= 1000000) return "$" + (x / 1000000).toFixed(x % 1000000 === 0 ? 0 : 1) + "M";
    return "$" + Math.round(x).toLocaleString("en-US");
  }

  function fmtNum(n) {
    const x = Number(n);
    if (x === null || x === undefined || !isFinite(x)) return "—";
    return x.toLocaleString("en-US");
  }

  function money(n, showZero) {
    if ((!n && n !== 0) || (n === 0 && !showZero)) return "—";
    return fmtMoney(n);
  }

  function dlist(items) {
    const grid = el("div", "dlist");
    for (const it of items) {
      const box = el("div", "ditem");
      if (it.key) box.dataset.k = it.key;
      box.appendChild(el("span", "k", it.label));
      const vBox = el("div", "v");
      const v = it.v;
      if (v instanceof Node) vBox.appendChild(v);
      else if (v !== undefined && v !== null && v !== "") vBox.textContent = v;
      else vBox.appendChild(el("span", "muted", "—"));
      box.appendChild(vBox);
      grid.appendChild(box);
    }
    return grid;
  }

  function clearFieldErrs(form) {
    form.querySelectorAll(".bad").forEach(n => n.classList.remove("bad"));
    form.querySelectorAll(".fld-err").forEach(n => { n.hidden = true; });
  }

  function fieldErr(form, fname, text) {
    const control = form.querySelector('[data-f="' + fname + '"]');
    if (!control) return;
    control.classList.add("bad");
    const err = form.querySelector('[data-err-for="' + control.id + '"]');
    if (err) {
      err.textContent = text;
      err.hidden = false;
    }
  }

  function listStateEmpty(icon, title, message, addHref, addLabel) {
    const empty = el("div", "rec-empty");
    empty.innerHTML = `<div class="state-icon">${icon}</div>`;
    empty.appendChild(el("p", "state-title", title));
    empty.appendChild(el("p", "state-msg", message));
    if (addHref) {
      const btn = document.createElement("a");
      btn.className = "btn btn-primary btn-sm";
      btn.href = addHref;
      btn.textContent = addLabel;
      const acts = el("div", "state-actions");
      acts.appendChild(btn);
      empty.appendChild(acts);
    }
    return empty;
  }

  function listStateNone(text) {
    const none = el("div", "rec-none");
    none.appendChild(el("p", null, text));
    return none;
  }

  return {
    describeError,
    banner,
    statusBannerCard,
    storeCard,
    notFoundCard,
    chip,
    segGroup,
    fld,
    checkRow,
    initials,
    tagsChips,
    fmtMoney,
    fmtNum,
    money,
    dlist,
    clearFieldErrs,
    fieldErr,
    listStateEmpty,
    listStateNone
  };
})();
