window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_COMPANIES = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const MOD = "companies";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M13 11h4a2 2 0 0 1 2 2v8"/><path d="M9 7v.01"/><path d="M9 11v.01"/><path d="M9 15v.01"/></svg>';

  const INDUSTRIES = [
    "Software / SaaS", "Manufacturing", "Retail / Consumer", "Healthcare",
    "Financial services", "Construction", "Logistics / Transport",
    "Professional services", "Education", "Hospitality", "Media / Marketing",
    "Energy / Utilities", "Agriculture", "Real estate", "Non-profit"
  ];

  const SIZE_BANDS = [
    { code: 10, label: "1–10" },
    { code: 50, label: "11–50" },
    { code: 200, label: "51–200" },
    { code: 500, label: "201–500" },
    { code: 1000, label: "501–1000" },
    { code: 5000, label: "1001–5000" },
    { code: 5001, label: "5000+" }
  ];

  const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 60", "Net 90", "Upon receipt", "Other"];

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
    { id: "customers", label: "Customers" }
  ];

  const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}([/?#]\S*)?$/i;

  function sizeLabel(n) {
    if (n === null || n === undefined || n === "") return "";
    if (typeof n === "number") {
      const b = SIZE_BANDS.find(x => x.code === n);
      if (b) return b.label + " employees";
      return n.toLocaleString() + " employees";
    }
    const band = SIZE_BANDS.find(x => String(x.code) === String(n));
    return band ? band.label + " employees" : String(n);
  }

  function addressParts(r) {
    const a = r && r.address && typeof r.address === "object" ? r.address : {};
    return { street: a.street, city: a.city, region: a.region, postalCode: a.postalCode, country: a.country };
  }

  function addressLine(r) {
    const p = addressParts(r);
    const mid = [p.city, p.region, p.postalCode].filter(Boolean).join(", ");
    return [p.street, mid, p.country].filter(Boolean).join("\n");
  }

  function cityOf(r) {
    const p = addressParts(r);
    return p.city || p.region || p.country || "";
  }

  function subtitleOf(r) {
    const parts = [];
    if (r && r.industry) parts.push(r.industry);
    const c = cityOf(r);
    if (c) parts.push(c);
    const sz = sizeLabel(r && r.employees);
    if (sz) parts.push(sz);
    if (!parts.length) {
      if (r && r.email) parts.push(r.email);
      else if (r && r.phone) parts.push(r.phone);
    }
    return parts.join(" · ");
  }

  function initials(name) {
    const s = String(name || "?").trim();
    const words = s.split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    const name = String(raw && raw.name || "").trim();
    if (!name) errors.name = "Company name is required.";
    values.name = name;
    const industry = String(raw && raw.industry || "").trim();
    values.industry = industry;
    let employees = raw && raw.employees;
    if (employees === "" || employees === null || employees === undefined) {
      employees = null;
    } else if (typeof employees === "string") {
      const num = Number(employees);
      employees = SIZE_BANDS.some(b => String(b.code) === employees) ? num : (isFinite(num) ? num : null);
    }
    values.employees = typeof employees === "number" && isFinite(employees) ? employees : null;
    const website = String(raw && raw.website || "").trim();
    if (website && !URL_RE.test(website)) errors.website = "Enter a valid website, e.g. acme.example or https://acme.example.";
    values.website = website;
    const taxId = String(raw && raw.taxId || "").trim();
    values.taxId = taxId;
    const paymentTerms = String(raw && raw.paymentTerms || "").trim();
    values.paymentTerms = paymentTerms;
    const notes = String(raw && raw.notes || "").trim();
    values.notes = notes;
    const tags = R.parseTags(raw && raw.tags);
    values.tags = tags;
    const addrIn = (raw && raw.address && typeof raw.address === "object") ? raw.address : {};
    const addr = {};
    for (const k of ["street", "city", "region", "postalCode", "country"]) {
      const v = String(addrIn[k] || "").trim();
      if (v) addr[k] = v;
    }
    values.address = addr;
    values.isCustomer = !!(raw && raw.isCustomer);
    values.active = raw && raw.active !== undefined ? !!raw.active : true;
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function applyForm(base, values) {
    const rec = Object.assign({}, base || {});
    const now = R.nowISO();
    if (rec.id === undefined) rec.id = R.newId(MOD);
    rec.name = values.name;
    const setOrDel = (key, v) => {
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && Object.keys(v).length === 0);
      if (empty) delete rec[key];
      else rec[key] = v;
    };
    setOrDel("industry", values.industry);
    setOrDel("employees", values.employees);
    setOrDel("website", values.website);
    setOrDel("taxId", values.taxId);
    setOrDel("paymentTerms", values.paymentTerms);
    setOrDel("notes", values.notes);
    setOrDel("tags", values.tags);
    setOrDel("address", values.address);
    rec.isCustomer = !!values.isCustomer;
    rec.active = values.active !== false;
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    return rec;
  }

  async function canDelete(store, id) {
    const refs = await R.findRefs(store, MOD, "companyId", id);
    return refs.length ? { allowed: false, refs } : { allowed: true, refs };
  }

  function storeErrorCard(message) {
    const card = el("div", "card");
    card.appendChild(el("p", "hint", message || "The document store is not available."));
    const go = document.createElement("a");
    go.className = "btn btn-ghost btn-sm";
    go.href = "#/dashboard";
    go.textContent = "Go to Dashboard";
    const row = el("div");
    row.style.marginTop = "14px";
    row.appendChild(go);
    card.appendChild(row);
    return card;
  }

  function notFoundCard(what) {
    const card = el("div", "card state state-empty");
    card.innerHTML = `<div class="state-icon">${ICON}</div>`;
    card.appendChild(el("p", "state-title", "Company not found"));
    card.appendChild(el("p", "state-msg", what || "That record no longer exists in this document."));
    const a = document.createElement("a");
    a.className = "btn btn-primary btn-sm";
    a.href = "#/companies";
    a.textContent = "Back to all companies";
    const acts = el("div", "state-actions");
    acts.appendChild(a);
    card.appendChild(acts);
    return card;
  }

  function statusBanner(store) {
    return store.statusInfo().then(info => {
      const st = info && info.modules && info.modules[MOD] ? info.modules[MOD].state : null;
      if (!st || (st !== "conflict" && st !== "pending")) return null;
      const b = el("div", "bkp-msg " + (st === "conflict" ? "err" : "warn"));
      b.setAttribute("role", "status");
      const txt = el("span", null, st === "conflict"
        ? "This module has an unresolved conflict — another device changed the same document. Nothing is lost; resolve it before making further changes."
        : "This module has changes waiting to sync — they will publish the next time the app reconciles.");
      b.appendChild(txt);
      const link = document.createElement("a");
      link.href = "#/dashboard";
      link.textContent = "Open Dashboard";
      link.style.marginLeft = "8px";
      link.style.fontWeight = "700";
      b.appendChild(link);
      return b;
    }).catch(() => null);
  }

  function tagChips(tags, max) {
    const out = el("span", "rec-tags");
    const arr = Array.isArray(tags) ? tags.slice(0, max || 5) : [];
    arr.forEach(t => out.appendChild(el("span", "tag-pill", t)));
    if (Array.isArray(tags) && tags.length > (max || 5)) {
      out.appendChild(el("span", "tag-pill more", "+" + (tags.length - (max || 5))));
    }
    return out;
  }

  function segPredicate(rec, seg) {
    if (seg === "active") return rec.active !== false;
    if (seg === "inactive") return rec.active === false;
    if (seg === "customers") return rec.isCustomer === true;
    return true;
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return storeErrorCard("The document store isn't ready yet. Try again in a moment.");
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) {
      return storeErrorCard((doc && doc.detail) || "The companies document could not be read.");
    }
    const all = R.recordsOf(doc.content).slice();

    const wrap = el("div", "cmp-view");
    const banner = await statusBanner(store);
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "All companies"));
    tBox.appendChild(el("p", "hint", "Each company keeps a stable record id, so renaming it updates every deal and activity that references it. New companies are stored under a 5 MB server document like every module."));
    tBox.querySelector(".hint").style.marginTop = "3px";
    titleRow.appendChild(tBox);
    const chip = el("span", "chip", all.length + " compan" + (all.length === 1 ? "y" : "ies"));
    chip.dataset.cmpCount = "1";
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by name, industry, city, tag…";
    search.dataset.cmpQ = "1";
    const seg = el("div", "seg");
    seg.dataset.cmpFilt = "1";
    const segBtns = {};
    FILTERS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.label;
      b.dataset.filt = f.id;
      if (f.id === "all") b.classList.add("on");
      segBtns[f.id] = b;
      seg.appendChild(b);
    });
    const add = document.createElement("a");
    add.className = "btn btn-primary btn-sm";
    add.href = "#/companies/new";
    add.textContent = "＋ Add company";
    add.dataset.cmpAdd = "1";
    toolbar.appendChild(search);
    toolbar.appendChild(seg);
    toolbar.appendChild(add);
    card.appendChild(toolbar);

    const listBox = el("div");
    card.appendChild(listBox);
    wrap.appendChild(card);

    let q = "";
    let segChoice = "all";

    function matching() {
      const byQ = R.filterRecords(all, q);
      return R.sortByName(byQ.filter(r => segPredicate(r, segChoice)));
    }

    function repaint() {
      chip.textContent = matching().length + " compan" + (matching().length === 1 ? "y" : "ies");
      listBox.innerHTML = "";
      if (!all.length) {
        const empty = el("div", "rec-empty");
        empty.innerHTML = `<div class="state-icon">${ICON}</div>`;
        empty.appendChild(el("p", "state-title", "No companies yet"));
        empty.appendChild(el("p", "state-msg", "Add your first company to start tracking accounts, industries and relationships."));
        const btn = document.createElement("a");
        btn.className = "btn btn-primary btn-sm";
        btn.href = "#/companies/new";
        btn.textContent = "＋ Add company";
        const acts = el("div", "state-actions");
        acts.appendChild(btn);
        empty.appendChild(acts);
        listBox.appendChild(empty);
        return;
      }
      const rows = matching();
      if (!rows.length) {
        const none = el("div", "rec-none");
        none.appendChild(el("p", null, q ? `No companies match “${q}”.` : "No companies in this view."));
        listBox.appendChild(none);
        return;
      }
      rows.forEach(rec => listBox.appendChild(rowFor(rec)));
    }

    function rowFor(rec) {
      const row = document.createElement("a");
      row.className = "rec-row" + (rec.active === false ? " inactive" : "");
      row.href = "#/companies/" + encodeURIComponent(rec.id);
      row.dataset.cid = rec.id;
      const av = el("span", "rec-av", initials(rec.name));
      const main = el("span", "rec-main");
      const line1 = el("span", "rec-line1");
      line1.appendChild(el("span", "rec-name", rec.name || "(unnamed company)"));
      if (rec.isCustomer === true) line1.appendChild(el("span", "badge customer", "Customer"));
      if (rec.active === false) line1.appendChild(el("span", "badge inactive", "Inactive"));
      const sub = subtitleOf(rec);
      main.appendChild(line1);
      if (sub) main.appendChild(el("span", "rec-sub", sub));
      const side = el("span", "rec-side");
      side.appendChild(tagChips(rec.tags, 3));
      row.appendChild(av);
      row.appendChild(main);
      row.appendChild(side);
      return row;
    }

    search.addEventListener("input", () => { q = search.value; repaint(); });
    Object.values(segBtns).forEach(b => b.addEventListener("click", () => {
      Object.values(segBtns).forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      segChoice = b.dataset.filt;
      repaint();
    }));

    repaint();
    return wrap;
  }

  function relLine(ref, cid) {
    const line = el("div", "rel-line");
    if (ref.module === "deals") {
      const a = document.createElement("a");
      a.className = "rel-name rel-link";
      a.href = cid ? "#/deals/company/" + encodeURIComponent(cid) : "#/deals/" + encodeURIComponent(ref.id);
      a.textContent = R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed deal)");
      line.appendChild(a);
      if (ref.id !== undefined) {
        const open = document.createElement("a");
        open.className = "btn btn-ghost btn-sm";
        open.href = "#/deals/" + encodeURIComponent(ref.id);
        open.textContent = "Open";
        open.dataset.cmpDealOpen = "1";
        line.appendChild(open);
      }
      return line;
    }
    const name = el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)"));
    line.appendChild(name);
    if (ref.id !== undefined) {
      const mono = el("span", "mono rel-id", "#" + ref.id);
      line.appendChild(mono);
    }
    return line;
  }

  async function renderDetail(ctx) {
    const store = ctx.store;
    const id = ctx.params && ctx.params[0];
    if (!store) return storeErrorCard("The document store isn't ready yet. Try again in a moment.");
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The companies document could not be read.");
    const rec = R.getRecord(doc.content, id);
    if (!rec) return notFoundCard("No company with id “" + (id || "") + "” exists in this document.");

    const refs = await R.findRefs(store, MOD, "companyId", rec.id);
    const del = await canDelete(store, rec.id);

    const wrap = el("div", "cmp-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/companies";
    back.textContent = "← All companies";
    wrap.appendChild(back);

    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", initials(rec.name));
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.name || "(unnamed company)"));
    const badges = el("span", "detail-badges");
    if (rec.isCustomer === true) badges.appendChild(el("span", "badge customer", "Customer"));
    if (rec.active === false) badges.appendChild(el("span", "badge inactive", "Inactive"));
    else badges.appendChild(el("span", "badge active", "Active"));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const created = rec.createdAt ? "created " + R.fmtDate(rec.createdAt) : null;
    const updated = rec.updatedAt ? "updated " + R.timeAgo(rec.updatedAt) : null;
    meta.textContent = [created, updated].filter(Boolean).join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    const logAct = document.createElement("a");
    logAct.className = "btn btn-ghost btn-sm";
    logAct.href = "#/activities/log/companies/" + encodeURIComponent(rec.id);
    logAct.textContent = "＋ Log";
    logAct.title = "Record a call, meeting, email, note or task for this company";
    logAct.dataset.cmpLog = "1";
    const emailAct = document.createElement("a");
    emailAct.className = "btn btn-ghost btn-sm";
    emailAct.href = "#/emails/compose/company/" + encodeURIComponent(rec.id);
    emailAct.textContent = "✉ Email";
    emailAct.dataset.cmpEmail = "1";
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/companies/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit company";
    edit.dataset.cmpEdit = "1";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost btn-sm";
    toggle.textContent = rec.active === false ? "Reactivate" : "Deactivate";
    toggle.dataset.cmpToggle = "1";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.cmpDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — deactivate instead.";
    }
    acts.appendChild(logAct);
    acts.appendChild(emailAct);
    acts.appendChild(edit);
    acts.appendChild(toggle);
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Details"));
    const dlist = el("div", "dlist");
    function item(key, k, vNode) {
      const box = el("div", "ditem");
      box.dataset.k = key;
      box.appendChild(el("span", "k", k));
      const vBox = el("div", "v");
      if (vNode instanceof Node) vBox.appendChild(vNode);
      else if (vNode !== undefined && vNode !== null && vNode !== "") vBox.textContent = vNode;
      else vBox.appendChild(el("span", "muted", "—"));
      box.appendChild(vBox);
      dlist.appendChild(box);
    }
    if (rec.industry) item("industry", "Industry", rec.industry);
    const sz = sizeLabel(rec.employees);
    if (sz) item("size", "Company size", sz);
    if (rec.website) {
      const a = document.createElement("a");
      a.href = /^https?:\/\//i.test(rec.website) ? rec.website : "https://" + rec.website;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = rec.website.replace(/^https?:\/\//i, "");
      item("website", "Website", a);
    }
    if (rec.taxId) item("taxId", "Tax id", rec.taxId);
    if (rec.paymentTerms) item("paymentTerms", "Payment terms", rec.paymentTerms);
    const addrText = addressLine(rec);
    if (addrText) {
      const pre = el("div", "addr", addrText);
      pre.style.whiteSpace = "pre-line";
      item("address", "Address", pre);
    }
    const tagsNode = Array.isArray(rec.tags) && rec.tags.length ? tagChips(rec.tags, 10) : null;
    if (tagsNode) item("tags", "Tags", tagsNode);
    item("record", "Record id", rec.id);
    grid.appendChild(dlist);
    wrap.appendChild(grid);

    if (rec.notes) {
      const notes = el("section", "card");
      notes.appendChild(el("h2", null, "Internal notes"));
      const box = el("div", "notes-box", rec.notes);
      box.style.whiteSpace = "pre-wrap";
      notes.appendChild(box);
      wrap.appendChild(notes);
    }

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    const relNote = el("p", "hint", "Other modules reference this company by its stable record id, so a rename here updates them automatically.");
    relNote.style.marginTop = "3px";
    rel.appendChild(relNote);
    const relBody = el("div", "rel-list");
    if (refs.length) {
      refs.forEach(ref => relBody.appendChild(relLine(ref, rec.id)));
      const sub = el("p", "hint", refs.length + " record" + (refs.length === 1 ? "" : "s") + " link" + (refs.length === 1 ? "s" : "") + " to this company.");
      relBody.appendChild(sub);
    } else {
      relBody.appendChild(el("p", "hint muted-line", "No other records reference this company yet."));
    }
    rel.appendChild(relBody);
    wrap.appendChild(rel);

    function showMsg(kind, text) {
      msg.className = "bkp-msg " + kind;
      msg.textContent = text;
      msg.hidden = false;
    }

    function busyAll(on) {
      toggle.disabled = on;
      delBtn.disabled = on || !del.allowed;
    }

    let confirmDel = false;
    delBtn.addEventListener("click", async () => {
      const allowed = await canDelete(store, rec.id);
      if (!allowed.allowed) {
        showMsg("err", "This company is referenced by other records — deactivate it instead of deleting.");
        return;
      }
      if (!confirmDel) {
        confirmDel = true;
        delBtn.textContent = "Confirm delete";
        delBtn.classList.add("armed");
        setTimeout(() => {
          if (confirmDel) {
            confirmDel = false;
            delBtn.textContent = "Delete";
            delBtn.classList.remove("armed");
          }
        }, 4000);
        return;
      }
      confirmDel = false;
      busyAll(true);
      const res = await R.persistUpdate(store, MOD, content => {
        const gone = R.removeRecord(content, rec.id);
        return { changed: gone.removed, content };
      });
      if (res && res.ok) {
        window.CRM.toast("Company deleted.");
        ctx.navigate("companies");
      } else {
        showMsg("err", describeError(res));
        busyAll(false);
        delBtn.textContent = "Delete";
        delBtn.classList.remove("armed");
      }
    });

    toggle.addEventListener("click", async () => {
      busyAll(true);
      const res = await R.persistUpdate(store, MOD, content => {
        const r = R.getRecord(content, rec.id);
        if (!r) return { changed: false };
        r.active = r.active === false ? true : false;
        r.updatedAt = R.nowISO();
        return { changed: true, content };
      });
      if (res && res.ok) {
        window.CRM.toast(rec.active === false ? "Company reactivated." : "Company deactivated.");
        if (ctx.rerender) ctx.rerender();
      } else {
        showMsg("err", describeError(res));
        busyAll(false);
      }
    });

    if (window.CRM_BUSUI && window.CRM_BUSUI.companyCard) {
      try {
        const busExt = await window.CRM_BUSUI.companyCard(store, rec);
        if (busExt) wrap.appendChild(busExt);
      } catch (e) {
        console.error("company pipeline card failed:", e);
      }
    }

    wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope: { companyId: rec.id }, title: "Timeline", hintText: "Calls, emails, meetings, notes, tasks and pipeline events for this company, newest first." }));

    return wrap;
  }

  function describeError(res) {
    if (!res) return "The change could not be saved.";
    const map = {
      conflict: "Another device changed this document while you were editing. Your version is kept safely — open the Dashboard to resolve the conflict.",
      no_edit_key: "This device has no write key for the companies document. Open Dashboard → Backup & restore and restore a downloaded backup to claim write access.",
      doc_too_large: "The companies document would exceed the storage ceiling. Open Dashboard → Capacity & archive to archive old records first.",
      doc_missing: "The companies document no longer exists on the server. Reload the page to recreate it.",
      server_lag: "The server is catching up after your last save — wait a moment and try again.",
      requires_saved_generator: "Save this generator first (via the editor) to enable cloud storage.",
      over_daily_allowance: "Today's storage allowance is used up. Try again tomorrow, or free space via Dashboard → Capacity & archive.",
      conflict_stale: "The document changed while saving; nothing was overwritten. Reload and try again.",
      corrupt_head: "The companies document is corrupt. Open Dashboard → Backup & restore to recover it."
    };
    const code = res && res.code;
    return map[code] || ((res && res.detail) || "The change could not be saved.");
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
    const err = el("div", "fld-err");
    err.dataset.errFor = opts.id;
    err.hidden = true;
    box.appendChild(err);
    return box;
  }

  function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(storeErrorCard("The document store isn't ready yet. Try again in a moment."));

    return store.loadDoc(MOD, { refresh: true }).then(doc => {
      if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The companies document could not be read.");
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return notFoundCard("No company with id “" + (id || "") + "” exists in this document.");
      const addr = addressParts(rec || {});

      const wrap = el("div", "cmp-view");
      const backHref = isNew ? "#/companies" : "#/companies/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← All companies" : "← Back to " + (rec.name || "company");
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New company" : "Edit company"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);

      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.cmpForm = "1";

      const nameIn = document.createElement("input");
      nameIn.className = "inp";
      nameIn.type = "text";
      nameIn.maxLength = 160;
      nameIn.placeholder = "e.g. Acme Industries";
      nameIn.value = (rec && rec.name) || "";
      nameIn.dataset.f = "name";
      form.appendChild(fld("text", "Company name", nameIn, { id: "cmp-name", required: true, full: true }));

      const industryIn = document.createElement("input");
      industryIn.className = "inp";
      industryIn.type = "text";
      industryIn.setAttribute("list", "cmp-industries");
      industryIn.placeholder = "Pick or type an industry";
      industryIn.value = (rec && rec.industry) || "";
      industryIn.dataset.f = "industry";
      form.appendChild(fld("text", "Industry", industryIn, { id: "cmp-industry" }));
      const dl = el("datalist", null);
      dl.id = "cmp-industries";
      INDUSTRIES.forEach(i => {
        const o = document.createElement("option");
        o.value = i;
        dl.appendChild(o);
      });
      form.appendChild(dl);

      const sizeIn = document.createElement("select");
      sizeIn.className = "sel";
      sizeIn.dataset.f = "employees";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "Not set";
      sizeIn.appendChild(noneOpt);
      SIZE_BANDS.forEach(b => {
        const o = document.createElement("option");
        o.value = String(b.code);
        o.textContent = b.label + " employees";
        sizeIn.appendChild(o);
      });
      if (rec && rec.employees !== undefined && rec.employees !== null) {
        sizeIn.value = String(rec.employees);
      }
      form.appendChild(fld("select", "Company size", sizeIn, { id: "cmp-size" }));

      const siteIn = document.createElement("input");
      siteIn.className = "inp";
      siteIn.type = "text";
      siteIn.inputMode = "url";
      siteIn.placeholder = "acme.example";
      siteIn.value = (rec && rec.website) || "";
      siteIn.dataset.f = "website";
      form.appendChild(fld("text", "Website", siteIn, { id: "cmp-site" }));

      const taxIn = document.createElement("input");
      taxIn.className = "inp";
      taxIn.type = "text";
      taxIn.placeholder = "VAT / tax registration";
      taxIn.value = (rec && rec.taxId) || "";
      taxIn.dataset.f = "taxId";
      form.appendChild(fld("text", "Tax id", taxIn, { id: "cmp-tax" }));

      const ptIn = document.createElement("select");
      ptIn.className = "sel";
      ptIn.dataset.f = "paymentTerms";
      const ptNone = document.createElement("option");
      ptNone.value = "";
      ptNone.textContent = "Not set";
      ptIn.appendChild(ptNone);
      for (const t of PAYMENT_TERMS) {
        const o = document.createElement("option");
        o.value = t;
        o.textContent = t;
        ptIn.appendChild(o);
      }
      if (rec && rec.paymentTerms) ptIn.value = rec.paymentTerms;
      form.appendChild(fld("select", "Payment terms", ptIn, { id: "cmp-pt" }));

      const streetIn = document.createElement("input");
      streetIn.className = "inp";
      streetIn.type = "text";
      streetIn.placeholder = "Street and number";
      streetIn.value = (addr.street || "");
      streetIn.dataset.f = "a-street";
      form.appendChild(fld("text", "Street", streetIn, { id: "cmp-street", full: true }));

      const cityIn = document.createElement("input");
      cityIn.className = "inp";
      cityIn.type = "text";
      cityIn.value = (addr.city || "");
      cityIn.dataset.f = "a-city";
      form.appendChild(fld("text", "City", cityIn, { id: "cmp-city" }));

      const regionIn = document.createElement("input");
      regionIn.className = "inp";
      regionIn.type = "text";
      regionIn.placeholder = "State / region";
      regionIn.value = (addr.region || "");
      regionIn.dataset.f = "a-region";
      form.appendChild(fld("text", "Region", regionIn, { id: "cmp-region" }));

      const zipIn = document.createElement("input");
      zipIn.className = "inp";
      zipIn.type = "text";
      zipIn.placeholder = "Postal code";
      zipIn.value = (addr.postalCode || "");
      zipIn.dataset.f = "a-postal";
      form.appendChild(fld("text", "Postal code", zipIn, { id: "cmp-zip" }));

      const countryIn = document.createElement("input");
      countryIn.className = "inp";
      countryIn.type = "text";
      countryIn.placeholder = "Country";
      countryIn.value = (addr.country || "");
      countryIn.dataset.f = "a-country";
      form.appendChild(fld("text", "Country", countryIn, { id: "cmp-country" }));

      const tagsIn = document.createElement("input");
      tagsIn.className = "inp";
      tagsIn.type = "text";
      tagsIn.placeholder = "e.g. partner, priority, vat-registered — comma separated";
      tagsIn.value = (rec && Array.isArray(rec.tags) ? rec.tags.join(", ") : "");
      tagsIn.dataset.f = "tags";
      form.appendChild(fld("text", "Tags", tagsIn, { id: "cmp-tags", full: true }));

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 4;
      notesIn.placeholder = "Internal notes — context for your team. This field is part of the public company document, so keep anything sensitive elsewhere.";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(fld("textarea", "Internal notes", notesIn, { id: "cmp-notes", full: true }));

      const checks = el("div", "frm-checks full");
      const c1 = el("label", "check");
      const custCb = document.createElement("input");
      custCb.type = "checkbox";
      custCb.checked = !!(rec && rec.isCustomer);
      custCb.dataset.f = "isCustomer";
      c1.appendChild(custCb);
      c1.appendChild(el("span", null, "This company is a customer"));
      const c2 = el("label", "check");
      const actCb = document.createElement("input");
      actCb.type = "checkbox";
      actCb.checked = !rec || rec.active !== false;
      actCb.dataset.f = "active";
      c2.appendChild(actCb);
      c2.appendChild(el("span", null, "Active (hide from lists instead of deleting)"));
      checks.appendChild(c1);
      checks.appendChild(c2);
      form.appendChild(checks);

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create company" : "Save changes";
      save.dataset.cmpSave = "1";
      const cancel = document.createElement("a");
      cancel.className = "btn btn-ghost";
      cancel.href = backHref;
      cancel.textContent = "Cancel";
      foot.appendChild(save);
      foot.appendChild(cancel);
      form.appendChild(foot);
      card.appendChild(form);
      wrap.appendChild(card);

      function showErr(kind, text) {
        topMsg.className = "bkp-msg " + kind;
        topMsg.textContent = text;
        topMsg.hidden = false;
        topMsg.scrollIntoView({ block: "nearest" });
      }

      function fieldErr(fname, text) {
        const control = form.querySelector('[data-f="' + fname + '"]');
        if (!control) return;
        control.classList.add("bad");
        const err = form.querySelector('[data-err-for="' + control.id + '"]');
        if (err) {
          err.textContent = text;
          err.hidden = false;
        }
      }

      function clearErrs() {
        form.querySelectorAll(".bad").forEach(n => n.classList.remove("bad"));
        form.querySelectorAll(".fld-err").forEach(n => { n.hidden = true; });
        topMsg.hidden = true;
      }

      form.addEventListener("submit", async ev => {
        ev.preventDefault();
        clearErrs();
        const raw = {
          name: nameIn.value,
          industry: industryIn.value,
          employees: sizeIn.value,
          website: siteIn.value,
          taxId: taxIn.value,
          paymentTerms: ptIn.value,
          tags: tagsIn.value,
          notes: notesIn.value,
          address: {
            street: streetIn.value,
            city: cityIn.value,
            region: regionIn.value,
            postalCode: zipIn.value,
            country: countryIn.value
          },
          isCustomer: custCb.checked,
          active: actCb.checked
        };
        const v = validate(raw);
        if (!v.ok) {
          Object.keys(v.errors).forEach(k => fieldErr(k === "address" ? "a-street" : k, v.errors[k]));
          return;
        }
        save.disabled = true;
        save.textContent = "Saving…";
        let savedId = null;
        const res = await R.persistUpdate(store, MOD, content => {
          let base = rec;
          if (!isNew) {
            const fresh = R.getRecord(content, id);
            if (!fresh) return { changed: false };
            base = fresh;
          }
          const built = applyForm(base, v.values);
          let attempts = 0;
          while (isNew && R.getRecord(content, built.id) && attempts < 6) {
            built.id = R.newId(MOD);
            attempts++;
          }
          if (isNew && attempts >= 6) return { changed: false };
          savedId = built.id;
          R.upsertRecord(content, built);
          return { changed: true, content };
        });
        if (res && res.ok) {
          window.CRM.toast(isNew ? "Company created." : "Company saved.");
          ctx.navigate("companies", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create company" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", describeError(res) + " Press Save again to retry.");
          return;
        }
        showErr("err", describeError(res));
        if (res && res.code === "conflict") {
          const link = document.createElement("a");
          link.href = "#/dashboard";
          link.style.marginLeft = "8px";
          link.style.fontWeight = "700";
          link.textContent = "Open Dashboard";
          topMsg.appendChild(link);
        }
      });

      return wrap;
    });
  }

  function view(ctx) {
    const params = ctx.params || [];
    if (params[0] === "new") return renderForm(ctx);
    if (params[0] && params[1] === "edit") return renderForm(ctx);
    if (params[0]) return renderDetail(ctx);
    return renderList(ctx);
  }

  return {
    MOD,
    SIZE_BANDS,
    PAYMENT_TERMS,
    validate,
    applyForm,
    canDelete,
    sizeLabel,
    renderList,
    renderDetail,
    renderForm,
    view
  };
})();

window.CRM_RENDERERS.companies = function (ctx) {
  return window.CRM_COMPANIES.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
