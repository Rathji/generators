window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_SITES = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const D = window.CRM_DOMAIN;
  const MOD = "sites";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "planned", label: "Planned" },
    { id: "closed", label: "Closed" }
  ];

  function addrOf(raw) {
    const a = (raw && raw.address) || {};
    const out = {};
    ["street", "city", "region", "postalCode", "country"].forEach(k => {
      const v = String(a[k] || "").trim();
      if (v) out[k] = v;
    });
    return out;
  }

  function coordOrEmpty(v, min, max) {
    if (v === undefined || v === null || String(v).trim() === "") return "";
    const n = Number(v);
    return isFinite(n) && n >= min && n <= max ? n : "";
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    const name = String(raw && raw.name || "").trim();
    if (!name) errors.name = "Give the site a name — e.g. “Zurich HQ” or “Winterthur data centre”.";
    values.name = name;

    const companyId = String(raw && raw.companyId || "").trim();
    if (!companyId) errors.companyId = "Every site belongs to a company. Pick one.";
    values.companyId = companyId;

    values.siteType = D.isKnownSiteType(raw && raw.siteType) ? raw.siteType : "branch";
    const status = (raw && raw.status) || "active";
    values.status = D.SITE_STATUSES.some(s => s.id === status) ? status : "active";
    values.siteCode = String(raw && raw.siteCode || "").trim();
    values.timezone = String(raw && raw.timezone || "").trim();
    values.accessNotes = String(raw && raw.accessNotes || "").trim();
    values.owner = String(raw && raw.owner || "").trim();
    values.tags = R.parseTags(raw && raw.tags);
    values.notes = String(raw && raw.notes || "").trim();
    values.address = addrOf(raw);
    const lat = coordOrEmpty(raw && raw.lat, -90, 90);
    const lng = coordOrEmpty(raw && raw.lng, -180, 180);
    if (raw && raw.lat !== undefined && String(raw.lat).trim() !== "" && lat === "") errors.lat = "Latitude must be a number between -90 and 90.";
    if (raw && raw.lng !== undefined && String(raw.lng).trim() !== "" && lng === "") errors.lng = "Longitude must be a number between -180 and 180.";
    if (lat !== "" && lng === "" && !errors.lng) errors.lng = "Enter the longitude too, or clear the latitude.";
    if (lng !== "" && lat === "" && !errors.lat) errors.lat = "Enter the latitude too, or clear the longitude.";
    values.lat = lat;
    values.lng = lng;
    values.contactIds = Array.isArray(raw && raw.contactIds) ? raw.contactIds.map(String).filter(Boolean) : [];
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
    rec.companyId = values.companyId;
    rec.siteType = values.siteType || "branch";
    rec.status = values.status || "active";
    setOrDel("siteCode", values.siteCode);
    setOrDel("timezone", values.timezone);
    setOrDel("accessNotes", values.accessNotes);
    setOrDel("owner", values.owner);
    setOrDel("tags", values.tags);
    setOrDel("notes", values.notes);
    setOrDel("address", values.address);
    setOrDel("lat", values.lat);
    setOrDel("lng", values.lng);
    setOrDel("contactIds", values.contactIds);
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    return rec;
  }

  async function companyMap(store) {
    const m = new Map();
    try {
      const doc = await store.loadDoc("companies");
      if (doc && doc.content) for (const c of R.recordsOf(doc.content)) m.set(c.id, c);
    } catch (e) {}
    return m;
  }

  async function contactMap(store) {
    const m = new Map();
    try {
      const doc = await store.loadDoc("contacts");
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
      for (const rec of R.recordsOf(doc.content)) {
        if (rec && String(rec[key]) === s) out.push(rec);
      }
    } catch (e) {}
    return out;
  }

  async function countsFor(store, id) {
    const services = await recordsWhere(store, "services", "siteId", id);
    const assets = await recordsWhere(store, "assets", "siteId", id);
    let tickets = [];
    if (window.CRM_TICKETS) tickets = await recordsWhere(store, "tickets", "siteId", id);
    return { services, assets, tickets };
  }

  async function canDelete(store, id) {
    const refs = await R.findRefs(store, MOD, "siteId", id);
    return refs.length ? { allowed: false, refs } : { allowed: true, refs };
  }

  function statusBadgeEl(id) {
    return el("span", "badge " + D.siteStatusBadge(id), D.siteStatusLabel(id));
  }

  function segPredicate(rec, seg) {
    if (seg === "active") return rec.status === "active";
    if (seg === "planned") return rec.status === "planned";
    if (seg === "closed") return rec.status === "closed";
    return true;
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard("sites", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("sites", doc);
    const all = R.recordsOf(doc.content).slice();
    const cmap = await companyMap(store);
    const ccounts = new Map();
    try {
      const sdoc = await store.loadDoc("services");
      R.recordsOf(sdoc && sdoc.content).forEach(s => { if (s.siteId) ccounts.set(String(s.siteId), (ccounts.get(String(s.siteId)) || 0) + 1); });
    } catch (e) {}
    const wrap = el("div", "site-view");
    const banner = await U.statusBannerCard(store, MOD, "sites");
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "Sites & locations"));
    const hint = el("p", "hint", "Every place you serve — head office, branch, data centre, tower, cabinet or customer premises. Link services, assets and tickets to the site they belong to.");
    hint.style.marginTop = "3px";
    tBox.appendChild(hint);
    titleRow.appendChild(tBox);
    const chip = U.chip(all.length, "site", "sites");
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by name, city, code, tag…";
    search.dataset.siteQ = "1";
    const segBox = el("div", "seg-row");
    const quickSegs = el("div", "seg");
    quickSegs.dataset.siteFilt = "1";
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
    add.href = "#/sites/new";
    add.textContent = "＋ Add site";
    add.dataset.siteAdd = "1";
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
      return R.sortByName(recs, { activeLast: false });
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " site" + (rows.length === 1 ? "" : "s");
      listBox.innerHTML = "";
      if (!all.length) {
        listBox.appendChild(U.listStateEmpty(ICON, "No sites yet", "Add the locations you serve — offices, data centres, towers and customer premises — then link services, circuits, equipment and tickets to them.", "#/sites/new", "＋ Add site"));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(U.listStateNone(q ? `No sites match “${q}”.` : activeSaved ? `No sites match the “${activeSaved.name}” segment.` : "No sites in this view."));
        return;
      }
      rows.forEach(rec => {
        const row = document.createElement("a");
        row.className = "rec-row" + (rec.status === "closed" ? " inactive" : "");
        row.href = "#/sites/" + encodeURIComponent(rec.id);
        row.dataset.siteid = rec.id;
        const av = el("span", "rec-av", D.siteTypeShort(rec.siteType).slice(0, 2).toUpperCase());
        const main = el("span", "rec-main");
        const line1 = el("span", "rec-line1");
        line1.appendChild(el("span", "rec-name", rec.name || "(unnamed site)"));
        line1.appendChild(el("span", "badge " + D.siteStatusBadge(rec.status), D.siteStatusLabel(rec.status)));
        main.appendChild(line1);
        const co = rec.companyId && cmap.get(rec.companyId);
        const subs = [D.siteTypeLabel(rec.siteType)];
        if (co) subs.push(co.name);
        const addr = D.siteAddressOf(rec);
        if (addr) subs.push(addr);
        main.appendChild(el("span", "rec-sub", subs.join(" · ")));
        const side = el("span", "rec-side");
        const n = ccounts.get(String(rec.id)) || 0;
        if (n) side.appendChild(el("span", "site-count", n + " service" + (n === 1 ? "" : "s")));
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

  function linkList(items, opts) {
    opts = opts || {};
    const box = el("div", "link-list");
    if (!items.length) {
      box.appendChild(el("p", "hint muted-line", opts.emptyText || "Nothing linked yet."));
      return box;
    }
    items.forEach(it => {
      const row = document.createElement("a");
      row.className = "link-row";
      row.href = it.href;
      const main = el("span", "link-main");
      main.appendChild(el("span", "link-name", it.name));
      if (it.sub) main.appendChild(el("span", "link-sub", it.sub));
      row.appendChild(main);
      if (it.badge) row.appendChild(el("span", "badge " + it.badge.cls, it.badge.text));
      box.appendChild(row);
    });
    return box;
  }

  async function renderDetail(ctx) {
    const store = ctx.store;
    const id = ctx.params && ctx.params[0];
    if (!store) return U.storeCard("sites", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("sites", doc);
    const rec = R.getRecord(doc.content, id);
    if (!rec) return U.notFoundCard({ icon: ICON, title: "Site not found", what: "No site with id “" + (id || "") + "” exists in this document.", backHref: "#/sites", backLabel: "Back to sites" });
    const cmap = await companyMap(store);
    const ctmap = await contactMap(store);
    const company = rec.companyId ? cmap.get(rec.companyId) : null;
    const refs = await R.findRefs(store, MOD, "siteId", rec.id);
    const del = await canDelete(store, rec.id);
    const linked = await countsFor(store, rec.id);

    const wrap = el("div", "site-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/sites";
    back.textContent = "← Sites";
    wrap.appendChild(back);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", D.siteTypeShort(rec.siteType).slice(0, 2).toUpperCase());
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.name || "(unnamed site)"));
    const badges = el("span", "detail-badges");
    badges.appendChild(el("span", "badge owner", D.siteTypeLabel(rec.siteType)));
    badges.appendChild(statusBadgeEl(rec.status));
    if (company) badges.appendChild(el("span", "badge", company.name));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const bits = [D.siteAddressOf(rec) || "no address on file"];
    if (linked.services.length) bits.push(linked.services.length + " service" + (linked.services.length === 1 ? "" : "s"));
    if (linked.assets.length) bits.push(linked.assets.length + " asset" + (linked.assets.length === 1 ? "" : "s"));
    bits.push(rec.updatedAt ? "updated " + R.timeAgo(rec.updatedAt) : "created " + R.fmtDate(rec.createdAt));
    meta.textContent = bits.join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    if (company) {
      const logAct = document.createElement("a");
      logAct.className = "btn btn-ghost btn-sm";
      logAct.href = "#/activities/log/companies/" + encodeURIComponent(company.id);
      logAct.textContent = "＋ Log";
      logAct.dataset.siteLog = "1";
      acts.appendChild(logAct);
    }
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/sites/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit site";
    edit.dataset.siteEdit = "1";
    acts.appendChild(edit);
    const stateBtns = [];
    if (rec.status === "closed") stateBtns.push(["active", "Reopen site"]);
    else {
      stateBtns.push(["active", "Mark active"]);
      stateBtns.push(["closed", "Close site"]);
    }
    stateBtns.forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-ghost btn-sm";
      b.textContent = pair[1];
      b.dataset.siteState = pair[0];
      acts.appendChild(b);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.siteDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — close the site instead.";
    }
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Site details"));
    const items = [];
    if (company) {
      const a = document.createElement("a");
      a.href = "#/companies/" + encodeURIComponent(company.id);
      a.textContent = company.name;
      items.push({ label: "Company", v: a });
    } else if (rec.companyId) {
      items.push({ label: "Company", v: String(rec.companyId) + " (missing record)" });
    }
    items.push({ label: "Type", v: D.siteTypeLabel(rec.siteType) });
    items.push({ label: "Status", v: D.siteStatusLabel(rec.status) });
    if (rec.siteCode) items.push({ label: "Site code", v: el("span", "mono", rec.siteCode) });
    if (rec.timezone) items.push({ label: "Timezone", v: rec.timezone });
    if (rec.owner) items.push({ label: "Owner", v: rec.owner });
    if (Array.isArray(rec.tags) && rec.tags.length) items.push({ label: "Tags", v: U.tagsChips(rec.tags, 10) });
    if (rec.lat !== undefined && rec.lng !== undefined && isFinite(Number(rec.lat)) && isFinite(Number(rec.lng))) {
      items.push({ label: "Coordinates", v: el("span", "mono", Number(rec.lat).toFixed(5) + ", " + Number(rec.lng).toFixed(5)) });
    }
    items.push({ label: "Record id", v: rec.id });
    grid.appendChild(U.dlist(items));
    const addr = D.siteAddressOf(rec);
    const hasCoords = rec.lat !== undefined && rec.lng !== undefined && isFinite(Number(rec.lat)) && isFinite(Number(rec.lng));
    if (addr || hasCoords) {
      grid.appendChild(el("h2", null, "Address"));
      if (addr) grid.appendChild(el("p", "notes-box", addr));
      const links = el("div", "site-map-links");
      const viewMap = document.createElement("a");
      viewMap.className = "btn btn-ghost btn-sm";
      viewMap.href = "#/map";
      viewMap.textContent = "View on map";
      viewMap.dataset.siteViewMap = "1";
      links.appendChild(viewMap);
      if (addr) {
        const map = document.createElement("a");
        map.className = "btn btn-ghost btn-sm";
        map.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr);
        map.target = "_blank";
        map.rel = "noopener";
        map.textContent = "Open in Google Maps";
        links.appendChild(map);
      }
      grid.appendChild(links);
    }
    wrap.appendChild(grid);

    const contacts = (Array.isArray(rec.contactIds) ? rec.contactIds : []).map(cid => ctmap.get(cid)).filter(Boolean);
    if (contacts.length) {
      const cCard = el("section", "card");
      cCard.appendChild(el("h2", null, "Contacts on site"));
      cCard.appendChild(U.dlist(contacts.map(c => ({ label: c.role || c.name, v: (() => { const a = document.createElement("a"); a.href = "#/contacts/" + encodeURIComponent(c.id); a.textContent = c.name; return a; })() }))));
      wrap.appendChild(cCard);
    }

    if (rec.accessNotes) {
      const an = el("section", "card");
      an.appendChild(el("h2", null, "Access & opening hours"));
      an.appendChild(el("div", "notes-box", rec.accessNotes));
      wrap.appendChild(an);
    }

    const svcCard = el("section", "card");
    svcCard.appendChild(el("h2", null, "Services at this site"));
    svcCard.appendChild(linkList(linked.services.map(s => ({
      href: "#/services/" + encodeURIComponent(s.id),
      name: s.name || "(unnamed service)",
      sub: [D.categoryLabel(s.category), D.statusLabel(s.status)].join(" · "),
      badge: { cls: D.statusBadge(s.status), text: D.statusLabel(s.status) }
    })), { emptyText: "No services are linked to this site yet — open a service and set its site." }));
    wrap.appendChild(svcCard);

    if (linked.assets.length) {
      const aCard = el("section", "card");
      aCard.appendChild(el("h2", null, "Assets at this site"));
      aCard.appendChild(linkList(linked.assets.map(a => ({
        href: "#/assets/" + encodeURIComponent(a.id),
        name: a.name || D.assetKindIdLabel(a.kind) + " " + (a.identifier || ""),
        sub: [D.assetKindShort(a.kind), D.assetStatusLabel(a.status)].join(" · "),
        badge: { cls: D.assetStatusBadge(a.status), text: D.assetStatusLabel(a.status) }
      }))));
      wrap.appendChild(aCard);
    }

    if (window.CRM_TICKETS && window.CRM_TICKETS.listCard) {
      try {
        const tc = await window.CRM_TICKETS.listCard(store, { siteId: rec.id }, { title: "Tickets at this site", emptyText: "No tickets logged for this site." });
        if (tc) wrap.appendChild(tc.el);
      } catch (e) { console.error("site tickets card failed:", e); }
    }

    if (window.CRM_DOCUMENTS && window.CRM_DOCUMENTS.card) {
      try {
        const dc = await window.CRM_DOCUMENTS.card(store, { ownerType: "site", ownerId: rec.id, title: "Site documents", emptyText: "No contracts or documents filed for this site yet." });
        if (dc) wrap.appendChild(dc.el);
      } catch (e) { console.error("site documents card failed:", e); }
    }

    if (rec.notes) {
      const notes = el("section", "card");
      notes.appendChild(el("h2", null, "Internal notes"));
      notes.appendChild(el("div", "notes-box", rec.notes));
      wrap.appendChild(notes);
    }

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    rel.appendChild(el("p", "hint", "Records that reference this site by its stable id. Deleting is blocked while references exist — close the site instead."));
    const relBody = el("div", "rel-list");
    if (refs.length) {
      refs.forEach(ref => {
        const line = el("div", "rel-line");
        line.appendChild(el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)")));
        if (ref.id !== undefined) line.appendChild(el("span", "mono rel-id", "#" + ref.id));
        relBody.appendChild(line);
      });
    } else {
      relBody.appendChild(el("p", "hint muted-line", "No other records reference this site yet."));
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
      acts.querySelectorAll("[data-site-state]").forEach(b => { b.disabled = on; });
    }

    acts.querySelectorAll("[data-site-state]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.siteState;
        busyAll(true);
        const res = await R.persistUpdate(store, MOD, content => {
          const r = R.getRecord(content, rec.id);
          if (!r) return { changed: false };
          r.status = next;
          r.updatedAt = R.nowISO();
          return { changed: true, content };
        });
        if (res && res.ok) {
          window.CRM.toast("Site marked " + D.siteStatusLabel(next).toLowerCase() + ".");
          if (ctx.rerender) ctx.rerender();
        } else {
          showMsg("err", U.describeError(res, "sites"));
          busyAll(false);
        }
      });
    });

    let confirmDel = false;
    delBtn.addEventListener("click", async () => {
      const allowed = await canDelete(store, rec.id);
      if (!allowed.allowed) {
        showMsg("err", "This site is referenced by other records — close it instead of deleting.");
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
        window.CRM.toast("Site deleted.");
        ctx.navigate("sites");
      } else {
        showMsg("err", U.describeError(res, "sites"));
        busyAll(false);
        delBtn.textContent = "Delete";
        delBtn.classList.remove("armed");
      }
    });

    if (company) wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope: { companyId: company.id }, title: "Company timeline", hintText: "Calls, emails, meetings, notes, tasks and pipeline events for the account this site belongs to." }));

    return wrap;
  }

  function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(U.storeCard("sites", { detail: "The document store isn't ready yet." }));
    return Promise.all([store.loadDoc(MOD, { refresh: true }), companyMap(store), contactMap(store)]).then(triple => {
      const doc = triple[0];
      const cmap = triple[1];
      const ctmap = triple[2];
      if (!doc || doc.ok === false) return U.storeCard("sites", doc);
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return U.notFoundCard({ icon: ICON, title: "Site not found", what: "No site with id “" + (id || "") + "” exists in this document.", backHref: "#/sites", backLabel: "Back to sites" });

      const wrap = el("div", "site-view");
      const backHref = isNew ? "#/sites" : "#/sites/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← Sites" : "← Back to " + (rec.name || "site");
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New site" : "Edit site"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);
      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.siteForm = "1";

      const nameIn = document.createElement("input");
      nameIn.className = "inp";
      nameIn.type = "text";
      nameIn.maxLength = 160;
      nameIn.placeholder = "e.g. Zurich HQ";
      nameIn.value = (rec && rec.name) || "";
      nameIn.dataset.f = "name";
      form.appendChild(U.fld("text", "Site name", nameIn, { id: "st-name", required: true, full: true }));

      const coSel = document.createElement("select");
      coSel.className = "sel";
      coSel.dataset.f = "companyId";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "— Select a company —";
      coSel.appendChild(noneOpt);
      Array.from(cmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.name + (c.isCustomer ? " ★" : "");
        coSel.appendChild(o);
      });
      if (rec && rec.companyId) coSel.value = rec.companyId;
      form.appendChild(U.fld("select", "Company", coSel, { id: "st-company", required: true }));

      const typeSel = document.createElement("select");
      typeSel.className = "sel";
      typeSel.dataset.f = "siteType";
      D.SITE_TYPES.forEach(ty => {
        const o = document.createElement("option");
        o.value = ty.id;
        o.textContent = ty.label;
        typeSel.appendChild(o);
      });
      typeSel.value = (rec && rec.siteType) || "branch";
      form.appendChild(U.fld("select", "Site type", typeSel, { id: "st-type" }));

      const stSel = document.createElement("select");
      stSel.className = "sel";
      stSel.dataset.f = "status";
      D.SITE_STATUSES.forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.label;
        stSel.appendChild(o);
      });
      stSel.value = (rec && rec.status) || "active";
      form.appendChild(U.fld("select", "Status", stSel, { id: "st-status" }));

      const codeIn = document.createElement("input");
      codeIn.className = "inp";
      codeIn.type = "text";
      codeIn.maxLength = 40;
      codeIn.placeholder = "e.g. ZH-HQ";
      codeIn.value = (rec && rec.siteCode) || "";
      codeIn.dataset.f = "siteCode";
      form.appendChild(U.fld("text", "Site code", codeIn, { id: "st-code" }));

      const tzIn = document.createElement("input");
      tzIn.className = "inp";
      tzIn.type = "text";
      tzIn.maxLength = 60;
      tzIn.placeholder = "e.g. Europe/Zurich";
      tzIn.value = (rec && rec.timezone) || "";
      tzIn.dataset.f = "timezone";
      form.appendChild(U.fld("text", "Timezone", tzIn, { id: "st-tz" }));

      const addr = (rec && rec.address) || {};
      const addressDefs = [["street", "Street address", "st-street", true], ["city", "City", "st-city"], ["region", "State / region", "st-region"], ["postalCode", "Postal code", "st-postal"], ["country", "Country", "st-country"]];
      const addrInputs = {};
      addressDefs.forEach(d => {
        const inp = document.createElement("input");
        inp.className = "inp";
        inp.type = "text";
        inp.value = addr[d[0]] || "";
        inp.dataset.f = "a-" + d[0];
        addrInputs[d[0]] = inp;
        form.appendChild(U.fld("text", d[0] === "street" ? "Address — street" : d[1], inp, { id: d[2], full: !!d[3] }));
      });

      const latIn = document.createElement("input");
      latIn.className = "inp";
      latIn.type = "number";
      latIn.step = "0.000001";
      latIn.placeholder = "e.g. 47.3769";
      latIn.value = (rec && rec.lat !== undefined && rec.lat !== null) ? rec.lat : "";
      latIn.dataset.f = "lat";
      form.appendChild(U.fld("number", "Latitude", latIn, { id: "st-lat", hint: "Optional — or locate the site from the Map page." }));

      const lngIn = document.createElement("input");
      lngIn.className = "inp";
      lngIn.type = "number";
      lngIn.step = "0.000001";
      lngIn.placeholder = "e.g. 8.5417";
      lngIn.value = (rec && rec.lng !== undefined && rec.lng !== null) ? rec.lng : "";
      lngIn.dataset.f = "lng";
      form.appendChild(U.fld("number", "Longitude", lngIn, { id: "st-lng" }));

      const accessIn = document.createElement("textarea");
      accessIn.className = "txa";
      accessIn.rows = 3;
      accessIn.placeholder = "Door codes, escort required, opening hours, parking, rack/cabinet, escalation…";
      accessIn.value = (rec && rec.accessNotes) || "";
      accessIn.dataset.f = "accessNotes";
      form.appendChild(U.fld("textarea", "Access notes & hours", accessIn, { id: "st-access", full: true }));

      const ownerIn = document.createElement("input");
      ownerIn.className = "inp";
      ownerIn.type = "text";
      ownerIn.maxLength = 80;
      ownerIn.placeholder = "Account manager";
      ownerIn.value = (rec && rec.owner) || "";
      ownerIn.dataset.f = "owner";
      form.appendChild(U.fld("text", "Owner", ownerIn, { id: "st-owner" }));

      const tagsIn = document.createElement("input");
      tagsIn.className = "inp";
      tagsIn.type = "text";
      tagsIn.placeholder = "e.g. fibre, tier-3, multi-site";
      tagsIn.value = (rec && Array.isArray(rec.tags) ? rec.tags.join(", ") : "");
      tagsIn.dataset.f = "tags";
      form.appendChild(U.fld("text", "Tags", tagsIn, { id: "st-tags" }));

      const contactBox = el("div", "fld full");
      const cl = document.createElement("label");
      cl.appendChild(document.createTextNode("Contacts on site"));
      contactBox.appendChild(cl);
      const clWrap = el("div", "multi-check");
      clWrap.dataset.f = "contactIds";
      const selectedContacts = new Set(Array.isArray(rec && rec.contactIds) ? rec.contactIds.map(String) : []);
      const contactCbs = [];
      const contactList = Array.from(ctmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      contactList.forEach(c => {
        const lab = el("label", "check");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = c.id;
        cb.checked = selectedContacts.has(String(c.id));
        cb.dataset.contactCb = "1";
        contactCbs.push(cb);
        lab.appendChild(cb);
        const co = cmap.get(c.companyId);
        lab.appendChild(el("span", null, c.name + (co ? " — " + co.name : "")));
        clWrap.appendChild(lab);
      });
      if (!contactList.length) clWrap.appendChild(el("p", "hint muted-line", "No contacts yet — add contacts first to assign them to a site."));
      contactBox.appendChild(clWrap);
      form.appendChild(contactBox);

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 4;
      notesIn.placeholder = "Site-specific notes — power, connectivity, rack layout, key staff…";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(U.fld("textarea", "Internal notes", notesIn, { id: "st-notes", full: true }));

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create site" : "Save changes";
      save.dataset.siteSave = "1";
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
        const raw = {
          name: nameIn.value,
          companyId: coSel.value,
          siteType: typeSel.value,
          status: stSel.value,
          siteCode: codeIn.value,
          timezone: tzIn.value,
          accessNotes: accessIn.value,
          owner: ownerIn.value,
          tags: tagsIn.value,
          notes: notesIn.value,
          contactIds: contactCbs.filter(cb => cb.checked).map(cb => cb.value),
          address: {
            street: addrInputs.street.value,
            city: addrInputs.city.value,
            region: addrInputs.region.value,
            postalCode: addrInputs.postalCode.value,
            country: addrInputs.country.value
          },
          lat: latIn.value,
          lng: lngIn.value
        };
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
          window.CRM.toast(isNew ? "Site created." : "Site saved.");
          ctx.navigate("sites", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create site" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "sites") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "sites"));
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
    recordsWhere,
    countsFor,
    view,
    FILTERS
  };
})();

window.CRM_RENDERERS.sites = function (ctx) {
  return window.CRM_SITES.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
