window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_DOCUMENTS = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const D = window.CRM_DOMAIN;
  const MOD = "documents";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>';

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "In force" },
    { id: "draft", label: "Draft" },
    { id: "expiring", label: "Expiring" },
    { id: "expired", label: "Expired" },
    { id: "archived", label: "Archived" }
  ];

  const OWNER_MODULES = ["companies", "contacts", "services", "sites", "assets"];

  function displayName(module, rec) {
    if (!rec) return "";
    if (module === "assets" && window.CRM_ASSETS && window.CRM_ASSETS.assetName) return window.CRM_ASSETS.assetName(rec);
    return R.recordName(rec) || rec.identifier || rec.id;
  }

  function ownerHref(module, id) {
    return "#/" + module + "/" + encodeURIComponent(id);
  }

  function ownerMaps(store) {
    const out = {};
    const tasks = OWNER_MODULES.map(async mod => {
      const m = new Map();
      try {
        const doc = await store.loadDoc(mod);
        R.recordsOf(doc && doc.content).forEach(r => { if (r && r.id !== undefined) m.set(String(r.id), r); });
      } catch (e) {}
      out[mod] = m;
    });
    return Promise.all(tasks).then(() => out);
  }

  function ownerRef(maps, type, id) {
    const mod = D.docOwnerModule(type);
    if (!mod || !id) return null;
    const m = maps && maps[mod];
    const rec = m ? m.get(String(id)) : null;
    if (!rec) return null;
    return { module: mod, id: rec.id, name: displayName(mod, rec), href: ownerHref(mod, rec.id), rec: rec };
  }

  function coerceCoord(v) {
    const n = Number(v);
    return isFinite(n) && v !== "" && v !== null && v !== undefined ? n : null;
  }

  function numOrEmpty(v) {
    if (v === undefined || v === null || v === "") return "";
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : "";
  }

  function isoDay(v) {
    const s = String(v === undefined || v === null ? "" : v).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function validUrl(v) {
    const s = String(v || "").trim();
    if (!s) return true;
    return /^https?:\/\//i.test(s) || /^data:/i.test(s);
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    raw = raw || {};

    const title = String(raw.title || "").trim();
    if (!title) errors.title = "Give the document a title — e.g. “Fibre 500 — service contract”.";
    values.title = title;

    values.type = D.isKnownDocType(raw.type) ? raw.type : "contract";
    values.status = D.isKnownDocStatus(raw.status) ? raw.status : "draft";

    const ownerType = D.isKnownDocOwnerType(raw.ownerType) ? raw.ownerType : "";
    const ownerId = String(raw.ownerId || "").trim();
    if (ownerType && !ownerId) errors.ownerId = "Pick which " + D.docOwnerTypeLabel(ownerType).toLowerCase() + " this document belongs to, or set the owner type back to none.";
    values.ownerType = ownerType;
    values.ownerId = ownerType ? ownerId : "";

    values.companyId = String(raw.companyId || "").trim();
    values.reference = String(raw.reference || "").trim();

    values.value = numOrEmpty(raw.value);
    if (raw.value !== undefined && raw.value !== "" && values.value === "") errors.value = "Value must be a number of zero or more.";

    const startDate = isoDay(raw.startDate);
    const endDate = isoDay(raw.endDate);
    if (raw.startDate && !startDate) errors.startDate = "Enter a valid start date.";
    if (raw.endDate && !endDate) errors.endDate = "Enter a valid end date.";
    if (startDate && endDate && endDate < startDate) errors.endDate = "The end date cannot be before the start date.";
    values.startDate = startDate;
    values.endDate = endDate;

    const fileUrl = String(raw.fileUrl || "").trim();
    if (!validUrl(fileUrl)) errors.fileUrl = "Use a full http(s) link, or remove it and attach a file instead.";
    values.fileUrl = fileUrl;
    values.fileName = String(raw.fileName || "").trim();
    values.fileSize = numOrEmpty(raw.fileSize);

    values.body = String(raw.body || "").trim();
    values.tags = R.parseTags(raw.tags);
    values.notes = String(raw.notes || "").trim();

    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function applyForm(base, values) {
    const rec = Object.assign({}, base || {});
    const now = R.nowISO();
    if (rec.id === undefined) rec.id = R.newId(MOD);
    rec.title = values.title;
    rec.type = values.type || "contract";
    rec.status = values.status || "draft";
    const setOrDel = (key, v) => {
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && Object.keys(v).length === 0);
      if (empty) delete rec[key];
      else rec[key] = v;
    };
    setOrDel("ownerType", values.ownerType);
    setOrDel("ownerId", values.ownerId);
    setOrDel("companyId", values.companyId);
    setOrDel("reference", values.reference);
    setOrDel("value", values.value);
    setOrDel("startDate", values.startDate);
    setOrDel("endDate", values.endDate);
    setOrDel("fileUrl", values.fileUrl);
    setOrDel("fileName", values.fileName);
    setOrDel("fileSize", values.fileSize);
    setOrDel("body", values.body);
    setOrDel("tags", values.tags);
    setOrDel("notes", values.notes);
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    return rec;
  }

  async function recordsFor(store, ownerType, ownerId) {
    const out = [];
    if (!ownerType || !ownerId) return out;
    try {
      const doc = await store.loadDoc(MOD);
      const s = String(ownerId);
      R.recordsOf(doc && doc.content).forEach(r => {
        if (r && r.ownerType === ownerType && String(r.ownerId) === s) out.push(r);
      });
    } catch (e) {}
    return out;
  }

  async function canDelete() {
    return { allowed: true, refs: [] };
  }

  function stateBadgeEl(rec) {
    return el("span", "badge " + D.docStateBadge(rec), D.docStateLabel(rec));
  }

  function segPredicate(rec, seg) {
    if (seg === "all") return true;
    if (seg === "expiring") return D.docState(rec) === "expiring";
    if (seg === "expired") return D.docState(rec) === "expired";
    return D.docState(rec) === seg;
  }

  function rowFor(rec, maps, extra) {
    const row = document.createElement("a");
    row.className = "rec-row" + (D.docState(rec) === "expired" || rec.status === "archived" ? " inactive" : "");
    row.href = "#/documents/" + encodeURIComponent(rec.id);
    row.dataset.docid = rec.id;
    const av = el("span", "rec-av", D.docTypeShort(rec.type).slice(0, 2).toUpperCase());
    const main = el("span", "rec-main");
    const line1 = el("span", "rec-line1");
    line1.appendChild(el("span", "rec-name", rec.title || "(untitled document)"));
    line1.appendChild(el("span", "badge " + D.docStateBadge(rec), D.docStateLabel(rec)));
    main.appendChild(line1);
    const subs = [D.docTypeLabel(rec.type)];
    const owner = ownerRef(maps, rec.ownerType, rec.ownerId);
    if (owner) subs.push(owner.name);
    if (rec.reference) subs.push(rec.reference);
    if (extra & 1) {
      const exp = D.daysUntilDocExpiry(rec);
      if (exp !== null) subs.push(exp < 0 ? "expired " + R.fmtDate(D.docExpiryOf(rec)) : "expires " + R.fmtDate(D.docExpiryOf(rec)));
    }
    main.appendChild(el("span", "rec-sub", subs.join(" · ")));
    row.appendChild(av);
    row.appendChild(main);
    const side = el("span", "rec-side");
    if (rec.value !== undefined && rec.value !== null && rec.value !== "") side.appendChild(el("span", "rec-amt", U.fmtMoney(rec.value)));
    side.appendChild(U.tagsChips(rec.tags, 2));
    row.appendChild(side);
    return row;
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard("documents", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("documents", doc);
    const all = R.recordsOf(doc.content).slice();
    const maps = await ownerMaps(store);

    const wrap = el("div", "doc-view");
    const banner = await U.statusBannerCard(store, MOD, "documents");
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "Contracts & documents"));
    const hint = el("p", "hint", "Contracts, SLAs, licences, quotes and attachments — filed against an account, service, site or asset, with renewal dates and a stored file or note.");
    hint.style.marginTop = "3px";
    tBox.appendChild(hint);
    titleRow.appendChild(tBox);
    const chip = U.chip(all.length, "document", "documents");
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by title, reference, owner, tag…";
    search.dataset.docQ = "1";
    const segBox = el("div", "seg-row");
    const quickSegs = el("div", "seg");
    quickSegs.dataset.docFilt = "1";
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
    add.href = "#/documents/new";
    add.textContent = "＋ Add document";
    add.dataset.docAdd = "1";
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
      recs.sort((a, b) => {
        const da = a && a.endDate ? String(a.endDate) : "9999";
        const db = b && b.endDate ? String(b.endDate) : "9999";
        if (da < db) return -1;
        if (da > db) return 1;
        return String(a && a.title || "").toLowerCase().localeCompare(String(b && b.title || "").toLowerCase());
      });
      return recs;
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " document" + (rows.length === 1 ? "" : "s");
      listBox.innerHTML = "";
      if (!all.length) {
        listBox.appendChild(U.listStateEmpty(ICON, "No documents yet", "Attach contracts, SLAs, quotes, licences and invoices to the accounts, services, sites and assets they belong to.", "#/documents/new", "＋ Add document"));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(U.listStateNone(q ? `No documents match “${q}”.` : activeSaved ? `No documents match the “${activeSaved.name}” segment.` : "No documents in this view."));
        return;
      }
      rows.forEach(rec => listBox.appendChild(rowFor(rec, maps, 1)));
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
    if (!store) return U.storeCard("documents", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("documents", doc);
    const rec = R.getRecord(doc.content, id);
    if (!rec) return U.notFoundCard({ icon: ICON, title: "Document not found", what: "No document with id “" + (id || "") + "” exists in this document.", backHref: "#/documents", backLabel: "Back to documents" });
    const maps = await ownerMaps(store);
    const owner = ownerRef(maps, rec.ownerType, rec.ownerId);
    const company = rec.companyId ? (maps.companies.get(String(rec.companyId)) || null) : null;
    const refs = await R.findRefs(store, MOD, "ownerId", rec.id);

    const wrap = el("div", "doc-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/documents";
    back.textContent = "← Documents";
    wrap.appendChild(back);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", D.docTypeShort(rec.type).slice(0, 2).toUpperCase());
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.title || "(untitled document)"));
    const badges = el("span", "detail-badges");
    badges.appendChild(el("span", "badge owner", D.docTypeLabel(rec.type)));
    badges.appendChild(stateBadgeEl(rec));
    if (rec.reference) badges.appendChild(el("span", "badge id", rec.reference));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const bits = [];
    if (owner) bits.push(owner.name);
    const exp = D.daysUntilDocExpiry(rec);
    if (exp !== null) bits.push(exp < 0 ? "expired " + R.fmtDate(D.docExpiryOf(rec)) : exp <= 60 ? "expires in " + Math.max(0, Math.round(exp)) + " days" : "expires " + R.fmtDate(D.docExpiryOf(rec)));
    bits.push(rec.updatedAt ? "updated " + R.timeAgo(rec.updatedAt) : "created " + R.fmtDate(rec.createdAt));
    meta.textContent = bits.join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/documents/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit document";
    edit.dataset.docEdit = "1";
    acts.appendChild(edit);
    if (rec.fileUrl) {
      const open = document.createElement("a");
      open.className = "btn btn-ghost btn-sm";
      open.href = rec.fileUrl;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "Open attachment";
      acts.appendChild(open);
    }
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.docDel = "1";
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Document details"));
    const items = [];
    items.push({ label: "Type", v: D.docTypeLabel(rec.type) });
    items.push({ label: "State", v: D.docStateLabel(rec) });
    if (owner) {
      const a = document.createElement("a");
      a.href = owner.href;
      a.textContent = D.docOwnerTypeLabel(rec.ownerType) + " · " + owner.name;
      items.push({ label: "Belongs to", v: a });
    } else if (rec.ownerId) {
      items.push({ label: "Belongs to", v: D.docOwnerTypeLabel(rec.ownerType) + " · " + rec.ownerId + " (missing record)" });
    }
    if (company) {
      const a = document.createElement("a");
      a.href = ownerHref("companies", company.id);
      a.textContent = company.name;
      items.push({ label: "Account", v: a });
    }
    if (rec.reference) items.push({ label: "Reference", v: el("span", "mono", rec.reference) });
    if (rec.value !== undefined && rec.value !== null && rec.value !== "") items.push({ label: "Contract value", v: U.fmtMoney(rec.value) });
    if (rec.startDate) items.push({ label: "Start date", v: R.fmtDate(rec.startDate) });
    if (rec.endDate) {
      const exp2 = D.daysUntilDocExpiry(rec);
      const v = el("span");
      v.appendChild(document.createTextNode(R.fmtDate(rec.endDate)));
      if (exp2 !== null) v.appendChild(el("span", "hint", "  (" + (exp2 < 0 ? "expired " + Math.abs(Math.round(exp2)) + " days ago" : Math.round(exp2) + " days left") + ")"));
      items.push({ label: "End / renewal date", v: v });
    }
    if (Array.isArray(rec.tags) && rec.tags.length) items.push({ label: "Tags", v: U.tagsChips(rec.tags, 10) });
    items.push({ label: "Record id", v: rec.id });
    grid.appendChild(U.dlist(items));
    wrap.appendChild(grid);

    if (rec.fileUrl) {
      const fCard = el("section", "card");
      fCard.appendChild(el("h2", null, "Attachment"));
      const line = el("div", "doc-attach");
      line.appendChild(el("span", "doc-attach-name", rec.fileName || rec.fileUrl));
      if (rec.fileSize) line.appendChild(el("span", "hint", U.fmtNum(Math.round(Number(rec.fileSize) / 1024)) + " KB"));
      const open = document.createElement("a");
      open.className = "btn btn-ghost btn-sm";
      open.href = rec.fileUrl;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "Open";
      line.appendChild(open);
      fCard.appendChild(line);
      fCard.appendChild(el("p", "hint muted-line", "Stored files are hosted publicly — anyone with the link can open them. Keep sensitive material in a note instead."));
      wrap.appendChild(fCard);
    }

    if (rec.body) {
      const bCard = el("section", "card");
      bCard.appendChild(el("h2", null, "Document text"));
      bCard.appendChild(el("div", "notes-box", rec.body));
      wrap.appendChild(bCard);
    }

    if (rec.notes) {
      const nCard = el("section", "card");
      nCard.appendChild(el("h2", null, "Internal notes"));
      nCard.appendChild(el("div", "notes-box", rec.notes));
      wrap.appendChild(nCard);
    }

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    rel.appendChild(el("p", "hint", "Records that reference this document by its stable id."));
    const relBody = el("div", "rel-list");
    if (refs.length) {
      refs.forEach(ref => {
        const line = el("div", "rel-line");
        line.appendChild(el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)")));
        if (ref.id !== undefined) line.appendChild(el("span", "mono rel-id", "#" + ref.id));
        relBody.appendChild(line);
      });
    } else {
      relBody.appendChild(el("p", "hint muted-line", "Nothing else references this document."));
    }
    rel.appendChild(relBody);
    wrap.appendChild(rel);

    function showMsg(kind, text) {
      msg.className = "bkp-msg " + kind;
      msg.textContent = text;
      msg.hidden = false;
    }

    let confirmDel = false;
    delBtn.addEventListener("click", async () => {
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
      delBtn.disabled = true;
      const res = await R.persistUpdate(store, MOD, content => {
        const gone = R.removeRecord(content, rec.id);
        return { changed: gone.removed, content };
      });
      if (res && res.ok) {
        window.CRM.toast("Document deleted.");
        ctx.navigate("documents");
      } else {
        delBtn.disabled = false;
        delBtn.textContent = "Delete";
        delBtn.classList.remove("armed");
        showMsg("err", U.describeError(res, "documents"));
      }
    });

    return wrap;
  }

  function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(U.storeCard("documents", { detail: "The document store isn't ready yet." }));
    return Promise.all([store.loadDoc(MOD, { refresh: true }), ownerMaps(store)]).then(triple => {
      const doc = triple[0];
      const maps = triple[1];
      if (!doc || doc.ok === false) return U.storeCard("documents", doc);
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return U.notFoundCard({ icon: ICON, title: "Document not found", what: "No document with id “" + (id || "") + "” exists in this document.", backHref: "#/documents", backLabel: "Back to documents" });

      const prefillOwnerType = isNew && params[1] && D.isKnownDocOwnerType(params[1]) ? params[1] : (rec && rec.ownerType) || "";
      const prefillOwnerId = isNew && params[2] ? String(params[2]) : (rec && rec.ownerId) || "";

      const wrap = el("div", "doc-view");
      const backHref = isNew ? "#/documents" : "#/documents/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← Documents" : "← Back to " + (rec.title || "document");
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New document" : "Edit document"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);
      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.docForm = "1";

      const titleIn = document.createElement("input");
      titleIn.className = "inp";
      titleIn.type = "text";
      titleIn.maxLength = 180;
      titleIn.placeholder = "e.g. Fibre 500 — service contract";
      titleIn.value = (rec && rec.title) || "";
      titleIn.dataset.f = "title";
      form.appendChild(U.fld("text", "Title", titleIn, { id: "dc-title", required: true, full: true }));

      const typeSel = document.createElement("select");
      typeSel.className = "sel";
      typeSel.dataset.f = "type";
      D.DOC_TYPES.forEach(ty => {
        const o = document.createElement("option");
        o.value = ty.id;
        o.textContent = ty.label;
        typeSel.appendChild(o);
      });
      typeSel.value = (rec && rec.type) || "contract";
      form.appendChild(U.fld("select", "Document type", typeSel, { id: "dc-type" }));

      const stSel = document.createElement("select");
      stSel.className = "sel";
      stSel.dataset.f = "status";
      D.DOC_STATUSES.forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.label;
        stSel.appendChild(o);
      });
      stSel.value = (rec && rec.status) || "draft";
      form.appendChild(U.fld("select", "Status", stSel, { id: "dc-status" }));

      const otSel = document.createElement("select");
      otSel.className = "sel";
      otSel.dataset.f = "ownerType";
      const noneOt = document.createElement("option");
      noneOt.value = "";
      noneOt.textContent = "— Not linked —";
      otSel.appendChild(noneOt);
      D.DOC_OWNER_TYPES.forEach(o2 => {
        const o = document.createElement("option");
        o.value = o2.id;
        o.textContent = o2.label;
        otSel.appendChild(o);
      });
      otSel.value = prefillOwnerType;
      form.appendChild(U.fld("select", "Belongs to", otSel, { id: "dc-owner-type" }));

      const oiSel = document.createElement("select");
      oiSel.className = "sel";
      oiSel.dataset.f = "ownerId";
      form.appendChild(U.fld("select", "Owner record", oiSel, { id: "dc-owner-id", hint: "Pick what this document is filed against." }));

      function fillOwners() {
        oiSel.innerHTML = "";
        const type = otSel.value;
        const mod = D.docOwnerModule(type);
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = mod ? "— Select a " + D.docOwnerTypeLabel(type).toLowerCase() + " —" : "— Choose a type first —";
        oiSel.appendChild(empty);
        if (!mod) {
          oiSel.disabled = true;
          return;
        }
        oiSel.disabled = false;
        const m = maps[mod] || new Map();
        const list = Array.from(m.values()).sort((a, b) => displayName(mod, a).toLowerCase().localeCompare(displayName(mod, b).toLowerCase()));
        list.forEach(r => {
          const o = document.createElement("option");
          o.value = r.id;
          o.textContent = displayName(mod, r);
          oiSel.appendChild(o);
        });
        if (prefillOwnerId && m.has(String(prefillOwnerId))) oiSel.value = String(prefillOwnerId);
      }
      fillOwners();
      otSel.addEventListener("change", () => { prefillOwnerId = ""; fillOwners(); });

      const coSel = document.createElement("select");
      coSel.className = "sel";
      coSel.dataset.f = "companyId";
      const noneCo = document.createElement("option");
      noneCo.value = "";
      noneCo.textContent = "— No account —";
      coSel.appendChild(noneCo);
      Array.from((maps.companies || new Map()).values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.name;
        coSel.appendChild(o);
      });
      coSel.value = (rec && rec.companyId) || "";
      form.appendChild(U.fld("select", "Account (optional)", coSel, { id: "dc-company" }));

      const refIn = document.createElement("input");
      refIn.className = "inp";
      refIn.type = "text";
      refIn.maxLength = 80;
      refIn.placeholder = "e.g. CT-2026-118";
      refIn.value = (rec && rec.reference) || "";
      refIn.dataset.f = "reference";
      form.appendChild(U.fld("text", "Reference / number", refIn, { id: "dc-ref" }));

      const valIn = document.createElement("input");
      valIn.className = "inp";
      valIn.type = "number";
      valIn.min = "0";
      valIn.step = "0.01";
      valIn.value = (rec && rec.value !== undefined && rec.value !== null) ? rec.value : "";
      valIn.dataset.f = "value";
      form.appendChild(U.fld("number", "Contract value ($)", valIn, { id: "dc-value" }));

      const sdIn = document.createElement("input");
      sdIn.className = "inp";
      sdIn.type = "date";
      sdIn.value = (rec && rec.startDate) || "";
      sdIn.dataset.f = "startDate";
      form.appendChild(U.fld("date", "Start date", sdIn, { id: "dc-start" }));

      const edIn = document.createElement("input");
      edIn.className = "inp";
      edIn.type = "date";
      edIn.value = (rec && rec.endDate) || "";
      edIn.dataset.f = "endDate";
      form.appendChild(U.fld("date", "End / renewal date", edIn, { id: "dc-end", hint: "An in-force document nearing this date is flagged as expiring." }));

      const upBox = el("div", "fld full");
      const upLab = document.createElement("label");
      upLab.appendChild(document.createTextNode("Attachment"));
      upBox.appendChild(upLab);
      const upRow = el("div", "doc-upload");
      const fileIn = document.createElement("input");
      fileIn.type = "file";
      fileIn.className = "inp";
      fileIn.dataset.f = "file";
      const urlIn = document.createElement("input");
      urlIn.className = "inp";
      urlIn.type = "text";
      urlIn.placeholder = "…or paste an https:// link to the document";
      urlIn.value = (rec && rec.fileUrl && !rec.fileName) || "";
      urlIn.dataset.f = "fileUrl";
      const fileNote = el("small", "fld-hint", "Upload a PDF or image (stored on the public upload host), or paste a link. Max ~10 MB.");
      upRow.appendChild(fileIn);
      upRow.appendChild(urlIn);
      upBox.appendChild(upRow);
      upBox.appendChild(fileNote);
      const upErr = el("div", "fld-err");
      upErr.dataset.errFor = "dc-file";
      upErr.hidden = true;
      upBox.appendChild(upErr);
      form.appendChild(upBox);

      const bodyIn = document.createElement("textarea");
      bodyIn.className = "txa";
      bodyIn.rows = 5;
      bodyIn.placeholder = "Paste the key terms, scope or clauses here if you don't have a file.";
      bodyIn.value = (rec && rec.body) || "";
      bodyIn.dataset.f = "body";
      form.appendChild(U.fld("textarea", "Document text", bodyIn, { id: "dc-body", full: true }));

      const tagsIn = document.createElement("input");
      tagsIn.className = "inp";
      tagsIn.type = "text";
      tagsIn.placeholder = "e.g. contract, 24-month, signed";
      tagsIn.value = (rec && Array.isArray(rec.tags) ? rec.tags.join(", ") : "");
      tagsIn.dataset.f = "tags";
      form.appendChild(U.fld("text", "Tags", tagsIn, { id: "dc-tags" }));

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 3;
      notesIn.placeholder = "Internal notes — renewal owner, negotiation points…";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(U.fld("textarea", "Internal notes", notesIn, { id: "dc-notes", full: true }));

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create document" : "Save changes";
      save.dataset.docSave = "1";
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

      function uploadError(text) {
        upErr.textContent = text;
        upErr.hidden = false;
      }

      form.addEventListener("submit", async ev => {
        ev.preventDefault();
        U.clearFieldErrs(form);
        topMsg.hidden = true;
        upErr.hidden = true;
        save.disabled = true;
        save.textContent = "Saving…";

        let fileUrl = urlIn.value.trim();
        let fileName = (rec && rec.fileName) || "";
        let fileSize = (rec && rec.fileSize) || "";
        const picked = fileIn.files && fileIn.files[0];
        if (picked) {
          if (typeof root === "undefined" || !root.uploadPlugin) {
            save.disabled = false;
            save.textContent = isNew ? "Create document" : "Save changes";
            uploadError("File uploads are unavailable right now — paste a link instead.");
            return;
          }
          save.textContent = "Uploading…";
          try {
            const res = await root.uploadPlugin(picked, { expires: Date.now() + 1000 * 60 * 60 * 24 * 365 });
            if (!res || res.error || !res.url) {
              save.disabled = false;
              save.textContent = isNew ? "Create document" : "Save changes";
              uploadError(res && res.error === "file_too_big" ? "That file is too large to upload — keep attachments under ~10 MB." : "The file could not be uploaded — try again, or paste a link instead.");
              return;
            }
            fileUrl = res.url;
            fileName = picked.name || "attachment";
            fileSize = res.size || picked.size || "";
          } catch (e) {
            save.disabled = false;
            save.textContent = isNew ? "Create document" : "Save changes";
            uploadError("The file could not be uploaded — try again, or paste a link instead.");
            return;
          }
        }

        const raw = {
          title: titleIn.value,
          type: typeSel.value,
          status: stSel.value,
          ownerType: otSel.value,
          ownerId: oiSel.value,
          companyId: coSel.value,
          reference: refIn.value,
          value: valIn.value,
          startDate: sdIn.value,
          endDate: edIn.value,
          fileUrl: fileUrl,
          fileName: fileName,
          fileSize: fileSize,
          body: bodyIn.value,
          tags: tagsIn.value,
          notes: notesIn.value
        };
        const v = validate(raw);
        if (!v.ok) {
          Object.keys(v.errors).forEach(k => U.fieldErr(form, k, v.errors[k]));
          save.disabled = false;
          save.textContent = isNew ? "Create document" : "Save changes";
          return;
        }
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
          window.CRM.toast(isNew ? "Document created." : "Document saved.");
          ctx.navigate("documents", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create document" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "documents") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "documents"));
      });

      return wrap;
    });
  }

  async function card(store, opts) {
    opts = opts || {};
    if (!store || !opts.ownerType || !opts.ownerId) return null;
    try {
      const doc = await store.loadDoc(MOD);
      if (!doc || doc.ok === false) return null;
      const recs = await recordsFor(store, opts.ownerType, opts.ownerId);
      const section = el("section", "card doc-card");
      const tr = el("div", "card-title-row");
      tr.appendChild(el("h2", null, opts.title || "Documents"));
      const add = document.createElement("a");
      add.className = "btn btn-ghost btn-sm";
      add.href = "#/documents/new/" + encodeURIComponent(opts.ownerType) + "/" + encodeURIComponent(opts.ownerId);
      add.textContent = "＋ Add document";
      tr.appendChild(add);
      section.appendChild(tr);
      if (!recs.length) {
        section.appendChild(el("p", "hint muted-line", opts.emptyText || "No contracts or documents filed here yet."));
        return { el: section, records: recs };
      }
      const list = el("div", "link-list");
      recs.sort((a, b) => String(a.title || "").toLowerCase().localeCompare(String(b.title || "").toLowerCase()));
      recs.forEach(r => {
        const row = document.createElement("a");
        row.className = "link-row";
        row.href = "#/documents/" + encodeURIComponent(r.id);
        const main = el("span", "link-main");
        main.appendChild(el("span", "link-name", r.title || "(untitled document)"));
        const sub = [D.docTypeLabel(r.type)];
        if (r.reference) sub.push(r.reference);
        const exp = D.daysUntilDocExpiry(r);
        if (exp !== null) sub.push(exp < 0 ? "expired " + R.fmtDate(D.docExpiryOf(r)) : "expires " + R.fmtDate(D.docExpiryOf(r)));
        main.appendChild(el("span", "link-sub", sub.join(" · ")));
        row.appendChild(main);
        row.appendChild(el("span", "badge " + D.docStateBadge(r), D.docStateLabel(r)));
        list.appendChild(row);
      });
      section.appendChild(list);
      return { el: section, records: recs };
    } catch (e) {
      console.error("documents card failed:", e);
      return null;
    }
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
    recordsFor,
    card,
    displayName,
    ownerRef,
    view,
    FILTERS,
    coerceCoord
  };
})();

window.CRM_RENDERERS.documents = function (ctx) {
  return window.CRM_DOCUMENTS.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
