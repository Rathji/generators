window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_ASSETS = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const D = window.CRM_DOMAIN;
  const MOD = "assets";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "available", label: "Available" },
    { id: "assigned", label: "Assigned" },
    { id: "reserved", label: "Reserved" },
    { id: "repair", label: "In repair" },
    { id: "retired", label: "Retired" }
  ];

  const FLOW = {
    available: [["reserved", "Reserve"], ["assigned", "Assign"], ["in-repair", "Send for repair"], ["retired", "Retire"]],
    assigned: [["available", "Release"], ["reserved", "Reserve"], ["in-repair", "Send for repair"], ["retired", "Retire"]],
    reserved: [["assigned", "Assign"], ["available", "Release"], ["retired", "Retire"]],
    "in-repair": [["available", "Return to stock"], ["retired", "Retire"]],
    retired: [["available", "Return to service"]]
  };

  function numOrNull(v) {
    const s = String(v === undefined || v === null ? "" : v).trim();
    if (!s) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  function dateOnly(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function assetName(rec) {
    if (!rec) return "";
    if (rec.name) return rec.name;
    const ident = String(rec.identifier || "").trim();
    if (ident) return D.assetKindShort(rec.kind) + " · " + ident;
    return "(" + D.assetKindShort(rec.kind) + ")";
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    const kind = D.isKnownAssetKind(raw && raw.kind) ? raw.kind : "cpe";
    values.kind = kind;

    const identifier = String(raw && raw.identifier || "").trim();
    if (!identifier) errors.identifier = "Enter the asset's " + D.assetKindIdLabel(kind).toLowerCase() + ".";
    values.identifier = identifier;

    values.name = String(raw && raw.name || "").trim();
    values.companyId = String(raw && raw.companyId || "").trim();
    values.siteId = String(raw && raw.siteId || "").trim();
    values.serviceId = String(raw && raw.serviceId || "").trim();
    values.contactId = String(raw && raw.contactId || "").trim();

    const status = (raw && raw.status) || "available";
    values.status = D.ASSET_STATUSES.some(s => s.id === status) ? status : "available";

    D.assetKindFields(kind).forEach(f => {
      const v = raw ? raw[f.key] : "";
      if (f.type === "number") {
        const n = numOrNull(v);
        if (n !== null && n < 0) errors[f.key] = f.label + " cannot be negative.";
        values[f.key] = n === null ? "" : n;
      } else if (f.type === "date") {
        const d = dateOnly(v);
        if (v && !d) errors[f.key] = "Use a valid date (YYYY-MM-DD).";
        values[f.key] = d;
      } else {
        values[f.key] = String(v || "").trim();
      }
    });

    values.owner = String(raw && raw.owner || "").trim();
    values.tags = R.parseTags(raw && raw.tags);
    values.notes = String(raw && raw.notes || "").trim();
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function applyForm(base, values) {
    const rec = Object.assign({}, base || {});
    const now = R.nowISO();
    if (rec.id === undefined) rec.id = R.newId(MOD);
    rec.kind = values.kind || "cpe";
    rec.identifier = values.identifier;
    const setOrDel = (key, v) => {
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) delete rec[key];
      else rec[key] = v;
    };
    setOrDel("name", values.name);
    setOrDel("companyId", values.companyId);
    setOrDel("siteId", values.siteId);
    setOrDel("serviceId", values.serviceId);
    setOrDel("contactId", values.contactId);
    rec.status = values.status || "available";
    D.assetKindFields(rec.kind).forEach(f => setOrDel(f.key, values[f.key]));
    setOrDel("owner", values.owner);
    setOrDel("tags", values.tags);
    setOrDel("notes", values.notes);
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    return rec;
  }

  async function moduleMap(store, module) {
    const m = new Map();
    try {
      const doc = await store.loadDoc(module);
      if (doc && doc.content) for (const c of R.recordsOf(doc.content)) m.set(c.id, c);
    } catch (e) {}
    return m;
  }

  async function recordsWhere(store, module, key, id) {
    const out = [];
    try {
      const doc = await store.loadDoc(module);
      if (!doc || !doc.content) return out;
      const s = String(id);
      for (const rec of R.recordsOf(doc.content)) if (rec && String(rec[key]) === s) out.push(rec);
    } catch (e) {}
    return out;
  }

  async function canDelete(store, id) {
    const refs = await R.findRefs(store, MOD, "assetId", id);
    return refs.length ? { allowed: false, refs } : { allowed: true, refs };
  }

  function segPredicate(rec, seg) {
    if (seg === "available") return rec.status === "available";
    if (seg === "assigned") return rec.status === "assigned";
    if (seg === "reserved") return rec.status === "reserved";
    if (seg === "repair") return rec.status === "in-repair";
    if (seg === "retired") return rec.status === "retired";
    return true;
  }

  function keyField(rec) {
    const kind = rec && rec.kind;
    if (kind === "did") return { label: "Number", v: rec.identifier };
    if (kind === "circuit") return { label: "Circuit id", v: rec.identifier };
    if (kind === "ip-block") return { label: "Block", v: rec.identifier };
    if (kind === "cpe") return { label: "Asset tag", v: rec.identifier };
    if (kind === "sim") return { label: "ICCID", v: rec.identifier };
    if (kind === "license") return { label: "Licence ref", v: rec.identifier };
    return { label: D.assetKindIdLabel(kind), v: rec.identifier };
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard("assets", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("assets", doc);
    const all = R.recordsOf(doc.content).slice();
    const cmap = await moduleMap(store, "companies");
    const smap = await moduleMap(store, "sites");
    const wrap = el("div", "asset-view");
    const banner = await U.statusBannerCard(store, MOD, "assets");
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "Asset & number inventory"));
    const hint = el("p", "hint", "DIDs and phone numbers, IP blocks, circuits, CPE and hardware, SIMs and licences — what you own or manage, who has it, and where it sits.");
    hint.style.marginTop = "3px";
    tBox.appendChild(hint);
    titleRow.appendChild(tBox);
    const chip = U.chip(all.length, "asset", "assets");
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by number, serial, ICCID, circuit, tag…";
    search.dataset.assetQ = "1";
    const segBox = el("div", "seg-row");
    const quickSegs = el("div", "seg");
    quickSegs.dataset.assetFilt = "1";
    const segBtns = {};
    FILTERS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.label;
      b.dataset.filt = f.id;
      if (f.id === "all") b.classList.add("on");
      segBtns[f.id] = b;
      quickSegs.appendChild(b);
    });
    const savedWrap = el("span");
    const segCtl = window.CRM_SEGMENTS.savedSegControl(store, MOD, { onPick: seg => { activeSaved = seg; repaint(); } });
    savedWrap.appendChild(segCtl);
    const add = document.createElement("a");
    add.className = "btn btn-primary btn-sm";
    add.href = "#/assets/new";
    add.textContent = "＋ Add asset";
    add.dataset.assetAdd = "1";
    toolbar.appendChild(search);
    segBox.appendChild(quickSegs);
    segBox.appendChild(savedWrap);
    toolbar.appendChild(segBox);
    toolbar.appendChild(add);
    card.appendChild(toolbar);
    const listBox = el("div");
    card.appendChild(listBox);
    wrap.appendChild(card);

    let q = "";
    let quickChoice = "all";
    let activeSaved = null;

    function matching() {
      let recs = R.filterRecords(all, q);
      recs = recs.filter(r => activeSaved ? window.CRM_SEGMENTS.segMatches(activeSaved, r, null) : segPredicate(r, quickChoice));
      recs.sort((a, b) => String(assetName(a)).toLowerCase() < String(assetName(b)).toLowerCase() ? -1 : 1);
      return recs;
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " asset" + (rows.length === 1 ? "" : "s");
      listBox.innerHTML = "";
      if (!all.length) {
        listBox.appendChild(U.listStateEmpty(ICON, "No assets yet", "Track the numbers, IP blocks, circuits, equipment, SIMs and licences you provide or manage — assign each one to an account, site or service.", "#/assets/new", "＋ Add asset"));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(U.listStateNone(q ? `No assets match “${q}”.` : activeSaved ? `No assets match the “${activeSaved.name}” segment.` : "No assets in this view."));
        return;
      }
      rows.forEach(rec => {
        const row = document.createElement("a");
        row.className = "rec-row" + (rec.status === "retired" ? " inactive" : "");
        row.href = "#/assets/" + encodeURIComponent(rec.id);
        row.dataset.assetid = rec.id;
        const av = el("span", "rec-av", D.assetKindShort(rec.kind).slice(0, 2).toUpperCase());
        const main = el("span", "rec-main");
        const line1 = el("span", "rec-line1");
        line1.appendChild(el("span", "rec-name", assetName(rec)));
        line1.appendChild(el("span", "badge " + D.assetStatusBadge(rec.status), D.assetStatusLabel(rec.status)));
        main.appendChild(line1);
        const co = rec.companyId && cmap.get(rec.companyId);
        const site = rec.siteId && smap.get(rec.siteId);
        const subs = [D.assetKindShort(rec.kind)];
        if (co) subs.push(co.name);
        if (site) subs.push(site.name);
        main.appendChild(el("span", "rec-sub", subs.join(" · ")));
        const side = el("span", "rec-side");
        if (rec.identifier && rec.name) side.appendChild(el("span", "asset-id mono", rec.identifier));
        side.appendChild(U.tagsChips(rec.tags, 2));
        row.appendChild(av);
        row.appendChild(main);
        row.appendChild(side);
        listBox.appendChild(row);
      });
    }

    search.addEventListener("input", () => { q = search.value; repaint(); });
    Object.values(segBtns).forEach(b => b.addEventListener("click", () => {
      Object.values(segBtns).forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      quickChoice = b.dataset.filt;
      activeSaved = null;
      repaint();
    }));
    repaint();
    return wrap;
  }

  async function renderDetail(ctx) {
    const store = ctx.store;
    const id = ctx.params && ctx.params[0];
    if (!store) return U.storeCard("assets", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("assets", doc);
    const rec = R.getRecord(doc.content, id);
    if (!rec) return U.notFoundCard({ icon: ICON, title: "Asset not found", what: "No asset with id “" + (id || "") + "” exists in this document.", backHref: "#/assets", backLabel: "Back to assets" });
    const cmap = await moduleMap(store, "companies");
    const smap = await moduleMap(store, "sites");
    const svmap = await moduleMap(store, "services");
    const ctmap = await moduleMap(store, "contacts");
    const company = rec.companyId ? cmap.get(rec.companyId) : null;
    const site = rec.siteId ? smap.get(rec.siteId) : null;
    const service = rec.serviceId ? svmap.get(rec.serviceId) : null;
    const contact = rec.contactId ? ctmap.get(rec.contactId) : null;
    const refs = await R.findRefs(store, MOD, "assetId", rec.id);
    const del = await canDelete(store, rec.id);

    const wrap = el("div", "asset-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/assets";
    back.textContent = "← Assets";
    wrap.appendChild(back);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", D.assetKindShort(rec.kind).slice(0, 2).toUpperCase());
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, assetName(rec)));
    const badges = el("span", "detail-badges");
    badges.appendChild(el("span", "badge owner", D.assetKindLabel(rec.kind)));
    badges.appendChild(el("span", "badge " + D.assetStatusBadge(rec.status), D.assetStatusLabel(rec.status)));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const bits = [keyField(rec).label + ": " + (rec.identifier || "—")];
    if (company) bits.push(company.name);
    if (site) bits.push(site.name);
    if (rec.warrantyEnd) {
      const days = D.daysUntilDate(rec.warrantyEnd);
      if (days !== null) bits.push(days < 0 ? "warranty expired" : "warranty " + Math.round(days) + " days left");
    }
    bits.push(rec.updatedAt ? "updated " + R.timeAgo(rec.updatedAt) : "created " + R.fmtDate(rec.createdAt));
    meta.textContent = bits.join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/assets/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit asset";
    edit.dataset.assetEdit = "1";
    acts.appendChild(edit);
    (FLOW[rec.status] || FLOW.available).forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-ghost btn-sm";
      b.textContent = pair[1];
      b.dataset.assetState = pair[0];
      acts.appendChild(b);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.assetDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — retire the asset instead.";
    }
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Asset details"));
    const items = [{ label: "Kind", v: D.assetKindLabel(rec.kind) }];
    items.push({ label: keyField(rec).label, v: el("span", "mono", rec.identifier || "—") });
    items.push({ label: "Status", v: D.assetStatusLabel(rec.status) });
    if (company) {
      const a = document.createElement("a");
      a.href = "#/companies/" + encodeURIComponent(company.id);
      a.textContent = company.name;
      items.push({ label: "Assigned account", v: a });
    } else if (rec.companyId) {
      items.push({ label: "Assigned account", v: String(rec.companyId) + " (missing record)" });
    }
    if (site) {
      const a = document.createElement("a");
      a.href = "#/sites/" + encodeURIComponent(site.id);
      a.textContent = site.name;
      items.push({ label: "Location", v: a });
    } else if (rec.siteId) {
      items.push({ label: "Location", v: String(rec.siteId) + " (missing record)" });
    }
    if (service) {
      const a = document.createElement("a");
      a.href = "#/services/" + encodeURIComponent(service.id);
      a.textContent = service.name;
      items.push({ label: "Service", v: a });
    } else if (rec.serviceId) {
      items.push({ label: "Service", v: String(rec.serviceId) + " (missing record)" });
    }
    if (contact) {
      const a = document.createElement("a");
      a.href = "#/contacts/" + encodeURIComponent(contact.id);
      a.textContent = contact.name;
      items.push({ label: "Assigned to", v: a });
    }
    D.assetKindFields(rec.kind).forEach(f => {
      const v = rec[f.key];
      if (v === undefined || v === null || v === "") return;
      let display = v;
      if (f.type === "date") display = R.fmtDate(v);
      if (f.key === "purchaseCost") display = U.fmtMoney(v);
      if (f.key === "bandwidth") display = v + " Mbps";
      items.push({ label: f.label, v: f.key === "mac" || f.key === "serial" || f.key === "msisdn" ? el("span", "mono", display) : display });
    });
    if (rec.warrantyEnd) {
      const days = D.daysUntilDate(rec.warrantyEnd);
      items.push({ label: "Warranty / support", v: R.fmtDate(rec.warrantyEnd) + (days === null ? "" : days < 0 ? " · expired" : " · " + Math.round(days) + " days left") });
    }
    if (rec.owner) items.push({ label: "Owner", v: rec.owner });
    if (Array.isArray(rec.tags) && rec.tags.length) items.push({ label: "Tags", v: U.tagsChips(rec.tags, 10) });
    items.push({ label: "Record id", v: rec.id });
    grid.appendChild(U.dlist(items));
    wrap.appendChild(grid);

    if (window.CRM_TICKETS && window.CRM_TICKETS.listCard) {
      try {
        const tc = await window.CRM_TICKETS.listCard(store, { assetId: rec.id }, { title: "Tickets for this asset", emptyText: "No tickets reference this asset." });
        if (tc) wrap.appendChild(tc.el);
      } catch (e) { console.error("asset tickets card failed:", e); }
    }

    if (window.CRM_DOCUMENTS && window.CRM_DOCUMENTS.card) {
      try {
        const dc = await window.CRM_DOCUMENTS.card(store, { ownerType: "asset", ownerId: rec.id, title: "Asset documents", emptyText: "No contracts or documents filed for this asset yet." });
        if (dc) wrap.appendChild(dc.el);
      } catch (e) { console.error("asset documents card failed:", e); }
    }

    if (rec.notes) {
      const notes = el("section", "card");
      notes.appendChild(el("h2", null, "Internal notes"));
      notes.appendChild(el("div", "notes-box", rec.notes));
      wrap.appendChild(notes);
    }

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    rel.appendChild(el("p", "hint", "Records that reference this asset by its stable id. Deleting is blocked while references exist — retire the asset instead."));
    const relBody = el("div", "rel-list");
    if (refs.length) {
      refs.forEach(ref => {
        const line = el("div", "rel-line");
        line.appendChild(el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)")));
        if (ref.id !== undefined) line.appendChild(el("span", "mono rel-id", "#" + ref.id));
        relBody.appendChild(line);
      });
    } else {
      relBody.appendChild(el("p", "hint muted-line", "No other records reference this asset yet."));
    }
    rel.appendChild(relBody);
    wrap.appendChild(rel);

    function showMsg(kind, text) {
      msg.className = "bkp-msg " + kind;
      msg.textContent = text;
      msg.hidden = false;
    }
    function busyAll(on) {
      delBtn.disabled = on || !del.allowed;
      acts.querySelectorAll("[data-asset-state]").forEach(b => { b.disabled = on; });
    }

    acts.querySelectorAll("[data-asset-state]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.assetState;
        busyAll(true);
        const res = await R.persistUpdate(store, MOD, content => {
          const r = R.getRecord(content, rec.id);
          if (!r) return { changed: false };
          r.status = next;
          if (next === "assigned") r.assignedAt = R.nowISO();
          r.updatedAt = R.nowISO();
          return { changed: true, content };
        });
        if (res && res.ok) {
          window.CRM.toast("Asset marked " + D.assetStatusLabel(next).toLowerCase() + ".");
          if (ctx.rerender) ctx.rerender();
        } else {
          showMsg("err", U.describeError(res, "assets"));
          busyAll(false);
        }
      });
    });

    let confirmDel = false;
    delBtn.addEventListener("click", async () => {
      const allowed = await canDelete(store, rec.id);
      if (!allowed.allowed) {
        showMsg("err", "This asset is referenced by other records — retire it instead of deleting.");
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
        window.CRM.toast("Asset deleted.");
        ctx.navigate("assets");
      } else {
        showMsg("err", U.describeError(res, "assets"));
        busyAll(false);
        delBtn.textContent = "Delete";
        delBtn.classList.remove("armed");
      }
    });

    if (company) wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope: { companyId: company.id }, title: "Account timeline", hintText: "Calls, emails, meetings, notes, tasks and pipeline events for the account this asset belongs to." }));

    return wrap;
  }

  function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(U.storeCard("assets", { detail: "The document store isn't ready yet." }));
    return Promise.all([store.loadDoc(MOD, { refresh: true }), moduleMap(store, "companies"), moduleMap(store, "sites"), moduleMap(store, "services"), moduleMap(store, "contacts")]).then(res => {
      const doc = res[0];
      const cmap = res[1];
      const smap = res[2];
      const svmap = res[3];
      const ctmap = res[4];
      if (!doc || doc.ok === false) return U.storeCard("assets", doc);
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return U.notFoundCard({ icon: ICON, title: "Asset not found", what: "No asset with id “" + (id || "") + "” exists in this document.", backHref: "#/assets", backLabel: "Back to assets" });

      const wrap = el("div", "asset-view");
      const backHref = isNew ? "#/assets" : "#/assets/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← Assets" : "← Back to " + assetName(rec);
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New asset" : "Edit asset"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);
      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.assetForm = "1";

      const kindSel = document.createElement("select");
      kindSel.className = "sel";
      kindSel.dataset.f = "kind";
      D.ASSET_KINDS.forEach(k => {
        const o = document.createElement("option");
        o.value = k.id;
        o.textContent = k.label;
        kindSel.appendChild(o);
      });
      kindSel.value = (rec && rec.kind) || "cpe";
      form.appendChild(U.fld("select", "Asset kind", kindSel, { id: "as-kind", hint: "Changing the kind swaps in the fields that matter for it." }));

      const stSel = document.createElement("select");
      stSel.className = "sel";
      stSel.dataset.f = "status";
      D.ASSET_STATUSES.forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.label;
        stSel.appendChild(o);
      });
      stSel.value = (rec && rec.status) || "available";
      form.appendChild(U.fld("select", "Status", stSel, { id: "as-status" }));

      const nameIn = document.createElement("input");
      nameIn.className = "inp";
      nameIn.type = "text";
      nameIn.maxLength = 120;
      nameIn.placeholder = "Optional friendly name";
      nameIn.value = (rec && rec.name) || "";
      nameIn.dataset.f = "name";
      form.appendChild(U.fld("text", "Name (optional)", nameIn, { id: "as-name", hint: "Leave blank to label it by its kind and identifier." }));

      const idIn = document.createElement("input");
      idIn.className = "inp";
      idIn.type = "text";
      idIn.maxLength = 120;
      idIn.value = (rec && rec.identifier) || "";
      idIn.dataset.f = "identifier";
      const idFld = U.fld("text", D.assetKindIdLabel(kindSel.value), idIn, { id: "as-identifier", required: true });
      form.appendChild(idFld);

      const extrasBox = el("div", "asset-extras full");
      form.appendChild(extrasBox);

      const coSel = document.createElement("select");
      coSel.className = "sel";
      coSel.dataset.f = "companyId";
      form.appendChild(U.fld("select", "Assigned account", coSel, { id: "as-company" }));

      const siteSel = document.createElement("select");
      siteSel.className = "sel";
      siteSel.dataset.f = "siteId";
      form.appendChild(U.fld("select", "Location / site", siteSel, { id: "as-site" }));

      const svcSel = document.createElement("select");
      svcSel.className = "sel";
      svcSel.dataset.f = "serviceId";
      form.appendChild(U.fld("select", "Linked service", svcSel, { id: "as-service" }));

      const ctSel = document.createElement("select");
      ctSel.className = "sel";
      ctSel.dataset.f = "contactId";
      form.appendChild(U.fld("select", "Assigned contact", ctSel, { id: "as-contact" }));

      const ownerIn = document.createElement("input");
      ownerIn.className = "inp";
      ownerIn.type = "text";
      ownerIn.maxLength = 80;
      ownerIn.placeholder = "Responsible person";
      ownerIn.value = (rec && rec.owner) || "";
      ownerIn.dataset.f = "owner";
      form.appendChild(U.fld("text", "Owner", ownerIn, { id: "as-owner" }));

      const tagsIn = document.createElement("input");
      tagsIn.className = "inp";
      tagsIn.type = "text";
      tagsIn.placeholder = "e.g. spare, loan, tier-3";
      tagsIn.value = (rec && Array.isArray(rec.tags) ? rec.tags.join(", ") : "");
      tagsIn.dataset.f = "tags";
      form.appendChild(U.fld("text", "Tags", tagsIn, { id: "as-tags" }));

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 4;
      notesIn.placeholder = "Configuration, port assignments, exposure, history…";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(U.fld("textarea", "Internal notes", notesIn, { id: "as-notes", full: true }));

      function opt(sel, value, label, extra) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        if (extra) o.dataset.company = extra;
        sel.appendChild(o);
        return o;
      }

      function fillCompany() {
        coSel.innerHTML = "";
        opt(coSel, "", "— Unassigned —", "");
        Array.from(cmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => opt(coSel, c.id, c.name + (c.isCustomer ? " ★" : ""), c.id));
        if (rec && rec.companyId) coSel.value = rec.companyId;
      }

      function fillDependent() {
        const co = coSel.value;
        const keepSite = siteSel.value;
        const keepSvc = svcSel.value;
        siteSel.innerHTML = "";
        opt(siteSel, "", "— No site —", "");
        Array.from(smap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(s => {
          if (co && s.companyId && s.companyId !== co) return;
          opt(siteSel, s.id, s.name + (cmap.get(s.companyId) ? " — " + cmap.get(s.companyId).name : ""));
        });
        siteSel.value = Array.from(siteSel.options).some(o => o.value === keepSite) ? keepSite : ((rec && rec.siteId) || "");
        svcSel.innerHTML = "";
        opt(svcSel, "", "— No service —", "");
        Array.from(svmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(s => {
          if (co && s.companyId && s.companyId !== co) return;
          opt(svcSel, s.id, s.name + " — " + D.categoryShort(s.category));
        });
        svcSel.value = Array.from(svcSel.options).some(o => o.value === keepSvc) ? keepSvc : ((rec && rec.serviceId) || "");
        const keepCt = ctSel.value;
        ctSel.innerHTML = "";
        opt(ctSel, "", "— No contact —", "");
        Array.from(ctmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => {
          if (co && c.companyId && c.companyId !== co) return;
          opt(ctSel, c.id, c.name + (cmap.get(c.companyId) ? " — " + cmap.get(c.companyId).name : ""));
        });
        ctSel.value = Array.from(ctSel.options).some(o => o.value === keepCt) ? keepCt : ((rec && rec.contactId) || "");
      }

      const kindInputs = {};
      const draft = {};
      function captureExtras() {
        Object.keys(kindInputs).forEach(k => { draft[k] = kindInputs[k].value; });
      }
      function renderKindFields() {
        captureExtras();
        Object.keys(kindInputs).forEach(k => delete kindInputs[k]);
        extrasBox.innerHTML = "";
        const kind = kindSel.value;
        idFld.querySelector("label").textContent = D.assetKindIdLabel(kind);
        idIn.placeholder = D.assetKindIdPlaceholder(kind);
        const fields = D.assetKindFields(kind);
        fields.forEach(f => {
          const inp = document.createElement("input");
          inp.className = "inp";
          inp.type = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
          if (f.type === "number") { inp.min = "0"; inp.step = "0.01"; }
          inp.placeholder = f.placeholder || "";
          const initial = (rec && rec[f.key] !== undefined && rec[f.key] !== null) ? String(rec[f.key]).slice(0, 10) : "";
          inp.value = draft[f.key] !== undefined ? draft[f.key] : initial;
          inp.dataset.f = f.key;
          kindInputs[f.key] = inp;
          extrasBox.appendChild(U.fld("text", f.label, inp, { id: "as-" + f.key, hint: f.hint }));
        });
        if (!fields.length) extrasBox.appendChild(el("p", "hint muted-line", "No extra fields for this asset kind."));
      }

      fillCompany();
      fillDependent();
      renderKindFields();
      coSel.addEventListener("change", fillDependent);
      kindSel.addEventListener("change", renderKindFields);

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create asset" : "Save changes";
      save.dataset.assetSave = "1";
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

      form.addEventListener("submit", async ev => {
        ev.preventDefault();
        U.clearFieldErrs(form);
        topMsg.hidden = true;
        captureExtras();
        const raw = {
          kind: kindSel.value,
          status: stSel.value,
          name: nameIn.value,
          identifier: idIn.value,
          companyId: coSel.value,
          siteId: siteSel.value,
          serviceId: svcSel.value,
          contactId: ctSel.value,
          owner: ownerIn.value,
          tags: tagsIn.value,
          notes: notesIn.value
        };
        Object.keys(kindInputs).forEach(k => { raw[k] = kindInputs[k].value; });
        const v = validate(raw);
        if (!v.ok) {
          Object.keys(v.errors).forEach(k => U.fieldErr(form, k, v.errors[k]));
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
          window.CRM.toast(isNew ? "Asset created." : "Asset saved.");
          ctx.navigate("assets", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create asset" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "assets") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "assets"));
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
    validate,
    applyForm,
    canDelete,
    assetName,
    recordsWhere,
    view,
    FILTERS
  };
})();

window.CRM_RENDERERS.assets = function (ctx) {
  return window.CRM_ASSETS.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
