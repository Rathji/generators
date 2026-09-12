window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_SERVICES = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const D = window.CRM_DOMAIN;
  const MOD = "services";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "prospect", label: "Prospect" },
    { id: "suspended", label: "Suspended" },
    { id: "terminated", label: "Terminated" },
    { id: "renewing", label: "Renewing soon" }
  ];

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

  function monthName(iso) {
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function addrOf(raw) {
    const a = (raw && raw.serviceAddress) || {};
    const out = {};
    ["street", "city", "region", "postalCode", "country"].forEach(k => {
      const v = String(a[k] || "").trim();
      if (v) out[k] = v;
    });
    return out;
  }

  function addrLine(rec) {
    return D.tenantOf(rec);
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    const name = String(raw && raw.name || "").trim();
    if (!name) errors.name = "Give the service a name — e.g. “Business Fiber 500/500” or “Hosted PBX — 12 seats”.";
    values.name = name;

    const companyId = String(raw && raw.companyId || "").trim();
    if (!companyId) errors.companyId = "Every service belongs to a company. Pick one.";
    values.companyId = companyId;
    values.contactId = String(raw && raw.contactId || "").trim();
    values.siteId = String(raw && raw.siteId || "").trim();

    const category = D.isKnownCategory(raw && raw.category) ? raw.category : "internet";
    values.category = category;

    const status = (raw && raw.status) || "prospect";
    values.status = D.SERVICE_STATUSES.some(s => s.id === status) ? status : "prospect";

    const charge = numOrNull(raw && raw.charge);
    if (charge !== null && charge < 0) errors.charge = "The recurring charge cannot be negative.";
    values.charge = charge === null ? "" : charge;

    const setupFee = numOrNull(raw && raw.setupFee);
    if (setupFee !== null && setupFee < 0) errors.setupFee = "The one-time fee cannot be negative.";
    values.setupFee = setupFee === null ? "" : setupFee;

    const billingCycle = (raw && raw.billingCycle) || "monthly";
    values.billingCycle = D.BILLING_CYCLES.some(c => c.id === billingCycle) ? billingCycle : "monthly";

    const term = numOrNull(raw && raw.contractTermMonths);
    if (term !== null && term < 0) errors.contractTermMonths = "The contract term cannot be negative.";
    values.contractTermMonths = term === null ? "" : Math.round(term);

    const startDate = dateOnly(raw && raw.startDate);
    if (raw && raw.startDate && !startDate) errors.startDate = "Use a valid date (YYYY-MM-DD).";
    values.startDate = startDate;
    const endDate = dateOnly(raw && raw.endDate);
    if (raw && raw.endDate && !endDate) errors.endDate = "Use a valid date (YYYY-MM-DD).";
    if (startDate && endDate && endDate < startDate) errors.endDate = "The renewal date cannot be before the start date.";
    values.endDate = endDate;

    const quantity = numOrNull(raw && raw.quantity);
    if (quantity !== null && quantity < 0) errors.quantity = "Quantity cannot be negative.";
    values.quantity = quantity === null ? "" : quantity;

    const bandwidth = numOrNull(raw && raw.bandwidth);
    if (bandwidth !== null && bandwidth < 0) errors.bandwidth = "Bandwidth cannot be negative.";
    values.bandwidth = bandwidth === null ? "" : bandwidth;

    values.autoRenew = !!(raw && raw.autoRenew);
    values.circuitId = String(raw && raw.circuitId || "").trim();
    values.owner = String(raw && raw.owner || "").trim();
    values.tags = R.parseTags(raw && raw.tags);
    values.notes = String(raw && raw.notes || "").trim();
    values.serviceAddress = addrOf(raw);
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
    setOrDel("companyId", values.companyId);
    setOrDel("contactId", values.contactId);
    setOrDel("siteId", values.siteId);
    rec.category = values.category || "internet";
    rec.status = values.status || "prospect";
    setOrDel("charge", values.charge);
    setOrDel("setupFee", values.setupFee);
    rec.billingCycle = values.billingCycle || "monthly";
    setOrDel("contractTermMonths", values.contractTermMonths);
    setOrDel("startDate", values.startDate);
    setOrDel("endDate", values.endDate);
    if (values.autoRenew) rec.autoRenew = true;
    else delete rec.autoRenew;
    setOrDel("quantity", values.quantity);
    setOrDel("bandwidth", values.bandwidth);
    setOrDel("circuitId", values.circuitId);
    setOrDel("owner", values.owner);
    setOrDel("tags", values.tags);
    setOrDel("notes", values.notes);
    setOrDel("serviceAddress", values.serviceAddress);
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

  async function siteMap(store) {
    const m = new Map();
    try {
      const doc = await store.loadDoc("sites");
      if (doc && doc.content) for (const c of R.recordsOf(doc.content)) m.set(c.id, c);
    } catch (e) {}
    return m;
  }

  async function canDelete(store, id) {
    const refs = await R.findRefs(store, MOD, "serviceId", id);
    return refs.length ? { allowed: false, refs } : { allowed: true, refs };
  }

  function subtitleOf(rec, cmap) {
    const parts = [D.categoryShort(rec && rec.category)];
    const co = rec && cmap.get(rec.companyId);
    if (co) parts.push(co.name);
    if (rec && rec.quantity) parts.push(rec.quantity + " " + unitFor(rec, rec.quantity));
    return parts.join(" · ");
  }

  function unitFor(rec, qty) {
    const c = (rec && rec.category) || "";
    const one = Number(qty) === 1;
    if (c === "voip") return one ? "seat" : "seats";
    if (c === "sip-trunk") return one ? "channel" : "channels";
    if (c === "internet") return one ? "circuit" : "circuits";
    if (c === "mobile") return one ? "line" : "lines";
    return one ? "unit" : "units";
  }

  function statusBadgeEl(id) {
    return el("span", "badge " + D.statusBadge(id), D.statusLabel(id));
  }

  function chargeLine(rec) {
    if (!rec || rec.charge === undefined || rec.charge === null || rec.charge === "") return "";
    const per = D.cycleLabel(rec.billingCycle).toLowerCase();
    return U.fmtMoney(rec.charge) + " / " + per;
  }

  function segPredicate(rec, seg) {
    if (seg === "active") return rec.status === "active";
    if (seg === "prospect") return rec.status === "prospect" || rec.status === "pending";
    if (seg === "suspended") return rec.status === "suspended";
    if (seg === "terminated") return rec.status === "terminated";
    if (seg === "renewing") {
      const days = D.daysUntilRenewal(rec);
      return D.isBillable(rec) && days !== null && days >= 0 && days <= 60;
    }
    return true;
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard("services", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("services", doc);
    const all = R.recordsOf(doc.content).slice();
    const cmap = await companyMap(store);
    const wrap = el("div", "svc-view");
    const banner = await U.statusBannerCard(store, MOD, "services");
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "Service book"));
    const hint = el("p", "hint", "Every recurring thing you provide an account — internet circuits, VoIP seats, SIP trunks, managed IT, cloud and hardware. Recurring charges roll up into MRR on the dashboard.");
    hint.style.marginTop = "3px";
    tBox.appendChild(hint);
    titleRow.appendChild(tBox);
    const chip = U.chip(all.length, "service", "services");
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by service, company, circuit id, tag…";
    search.dataset.svcQ = "1";
    const segBox = el("div", "seg-row");
    const quickSegs = el("div", "seg");
    quickSegs.dataset.svcFilt = "1";
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
    add.href = "#/services/new";
    add.textContent = "＋ Add service";
    add.dataset.svcAdd = "1";
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
      recs = recs.filter(r => {
        if (activeSaved) return window.CRM_SEGMENTS.segMatches(activeSaved, r, null);
        return segPredicate(r, quickChoice);
      });
      return R.sortByName(recs, { activeLast: false });
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " service" + (rows.length === 1 ? "" : "s");
      listBox.innerHTML = "";
      if (!all.length) {
        listBox.appendChild(U.listStateEmpty(ICON, "No services yet", "Add the recurring services you provide — an internet circuit, VoIP seats, a SIP trunk, a managed-IT contract — and CRM-U tracks their charge, term and renewal for you.", "#/services/new", "＋ Add service"));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(U.listStateNone(q ? `No services match “${q}”.` : activeSaved ? `No services match the “${activeSaved.name}” segment.` : "No services in this view."));
        return;
      }
      rows.forEach(rec => {
        const row = document.createElement("a");
        row.className = "rec-row" + (rec.status === "terminated" ? " inactive" : "");
        row.href = "#/services/" + encodeURIComponent(rec.id);
        row.dataset.sid = rec.id;
        const av = el("span", "rec-av", D.categoryShort(rec.category).slice(0, 2).toUpperCase());
        const main = el("span", "rec-main");
        const line1 = el("span", "rec-line1");
        line1.appendChild(el("span", "rec-name", rec.name || "(unnamed service)"));
        line1.appendChild(el("span", "badge " + D.statusBadge(rec.status), D.statusLabel(rec.status)));
        main.appendChild(line1);
        const sub = subtitleOf(rec, cmap);
        if (sub) main.appendChild(el("span", "rec-sub", sub));
        const side = el("span", "rec-side");
        const charge = chargeLine(rec);
        if (charge) side.appendChild(el("span", "svc-charge", charge));
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
    if (!store) return U.storeCard("services", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("services", doc);
    const rec = R.getRecord(doc.content, id);
    if (!rec) return U.notFoundCard({ icon: ICON, title: "Service not found", what: "No service with id “" + (id || "") + "” exists in this document.", backHref: "#/services", backLabel: "Back to the service book" });
    const cmap = await companyMap(store);
    const ctmap = await contactMap(store);
    const smap = await siteMap(store);
    const company = rec.companyId ? cmap.get(rec.companyId) : null;
    const contact = rec.contactId ? ctmap.get(rec.contactId) : null;
    const site = rec.siteId ? smap.get(rec.siteId) : null;
    const refs = await R.findRefs(store, MOD, "serviceId", rec.id);
    const del = await canDelete(store, rec.id);

    const wrap = el("div", "svc-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/services";
    back.textContent = "← Service book";
    wrap.appendChild(back);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", D.categoryShort(rec.category).slice(0, 2).toUpperCase());
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.name || "(unnamed service)"));
    const badges = el("span", "detail-badges");
    badges.appendChild(el("span", "badge owner", D.categoryLabel(rec.category)));
    badges.appendChild(statusBadgeEl(rec.status));
    if (chargeLine(rec)) badges.appendChild(el("span", "badge active", chargeLine(rec)));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const billable = D.isBillable(rec);
    const mrr = billable ? "MRR " + U.fmtMoney(D.monthlyOf(rec)) : (rec.status === "terminated" ? "terminated service" : "not yet billable");
    const renewal = D.renewalDateOf(rec);
    const bits = [mrr];
    if (renewal) bits.push("renews " + monthName(renewal));
    bits.push(rec.updatedAt ? "updated " + R.timeAgo(rec.updatedAt) : "created " + R.fmtDate(rec.createdAt));
    meta.textContent = bits.filter(Boolean).join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    if (company) {
      const logAct = document.createElement("a");
      logAct.className = "btn btn-ghost btn-sm";
      logAct.href = "#/activities/log/companies/" + encodeURIComponent(company.id);
      logAct.textContent = "＋ Log";
      logAct.title = "Record a call, meeting, email, note or task for this account";
      logAct.dataset.svcLog = "1";
      acts.appendChild(logAct);
    }
    if (contact) {
      const emailAct = document.createElement("a");
      emailAct.className = "btn btn-ghost btn-sm";
      emailAct.href = "#/emails/compose/contact/" + encodeURIComponent(contact.id);
      emailAct.textContent = "✉ Email";
      emailAct.dataset.svcEmail = "1";
      acts.appendChild(emailAct);
    }
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/services/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit service";
    edit.dataset.svcEdit = "1";
    acts.appendChild(edit);
    const stateBtns = [];
    if (rec.status === "active") {
      stateBtns.push(["suspended", "Suspend"]);
      stateBtns.push(["terminated", "Terminate"]);
    } else if (rec.status === "suspended") {
      stateBtns.push(["active", "Reactivate"]);
      stateBtns.push(["terminated", "Terminate"]);
    } else if (rec.status !== "terminated") {
      stateBtns.push(["active", "Mark active"]);
    } else {
      stateBtns.push(["prospect", "Reopen"]);
    }
    stateBtns.forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-ghost btn-sm";
      b.textContent = pair[1];
      b.dataset.svcState = pair[0];
      acts.appendChild(b);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.svcDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — terminate the service instead.";
    }
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Service details"));
    const items = [];
    if (company) {
      const a = document.createElement("a");
      a.href = "#/companies/" + encodeURIComponent(company.id);
      a.textContent = company.name;
      items.push({ label: "Account", v: a });
    } else if (rec.companyId) {
      items.push({ label: "Account", v: String(rec.companyId) + " (missing record)" });
    }
    if (contact) {
      const a = document.createElement("a");
      a.href = "#/contacts/" + encodeURIComponent(contact.id);
      a.textContent = contact.name;
      items.push({ label: "Primary contact", v: a });
    } else if (rec.contactId) {
      items.push({ label: "Primary contact", v: String(rec.contactId) + " (missing record)" });
    }
    if (site) {
      const a = document.createElement("a");
      a.href = "#/sites/" + encodeURIComponent(site.id);
      a.textContent = site.name;
      items.push({ label: "Site", v: a });
    } else if (rec.siteId) {
      items.push({ label: "Site", v: String(rec.siteId) + " (missing record)" });
    }
    items.push({ label: "Category", v: D.categoryLabel(rec.category) });
    items.push({ label: "Status", v: D.statusLabel(rec.status) });
    if (rec.charge !== undefined && rec.charge !== null && rec.charge !== "") {
      items.push({ label: "Recurring charge", v: U.fmtMoney(rec.charge) + " · " + D.cycleLabel(rec.billingCycle) });
      if (billable) {
        items.push({ label: "Monthly recurring (MRR)", v: U.fmtMoney(D.monthlyOf(rec)) });
        items.push({ label: "Annual value (ARR)", v: U.fmtMoney(D.annualOf(rec)) });
      }
    }
    if (rec.setupFee !== undefined && rec.setupFee !== null && rec.setupFee !== "") items.push({ label: "One-time / setup", v: U.fmtMoney(rec.setupFee) });
    if (rec.quantity !== undefined && rec.quantity !== null && rec.quantity !== "") items.push({ label: "Quantity", v: String(rec.quantity) + " " + unitFor(rec, rec.quantity) });
    if (rec.bandwidth !== undefined && rec.bandwidth !== null && rec.bandwidth !== "") items.push({ label: "Bandwidth", v: rec.bandwidth + " Mbps" });
    if (rec.circuitId) items.push({ label: "Circuit / reference id", v: el("span", "mono", rec.circuitId) });
    if (rec.contractTermMonths !== undefined && rec.contractTermMonths !== null && rec.contractTermMonths !== "") items.push({ label: "Contract term", v: rec.contractTermMonths + " months" });
    if (rec.startDate) items.push({ label: "Start date", v: R.fmtDate(rec.startDate) });
    const renewalIso = D.renewalDateOf(rec);
    if (renewalIso) {
      const days = D.daysUntilRenewal(rec);
      let label = R.fmtDate(renewalIso);
      if (days !== null) {
        if (days < 0) label += " · past due";
        else if (days <= 60) label += " · in " + Math.round(days) + " day" + (Math.round(days) === 1 ? "" : "s");
      }
      items.push({ label: rec.endDate ? "Contract end / renewal" : "Projected renewal", v: label });
      items.push({ label: "Auto-renew", v: rec.autoRenew ? "On" : "Off" });
    }
    if (rec.owner) items.push({ label: "Owner", v: rec.owner });
    if (Array.isArray(rec.tags) && rec.tags.length) items.push({ label: "Tags", v: U.tagsChips(rec.tags, 10) });
    items.push({ label: "Record id", v: rec.id });
    grid.appendChild(U.dlist(items));

    const addr = addrLine(rec);
    if (addr) {
      grid.appendChild(el("h2", null, "Service address"));
      grid.appendChild(el("p", "notes-box", addr));
    }
    wrap.appendChild(grid);

    if (rec.notes) {
      const notes = el("section", "card");
      notes.appendChild(el("h2", null, "Internal notes"));
      notes.appendChild(el("div", "notes-box", rec.notes));
      wrap.appendChild(notes);
    }

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    const relNote = el("p", "hint", "Records that reference this service by its stable id. Deleting is blocked while references exist — terminate the service instead.");
    relNote.style.marginTop = "3px";
    rel.appendChild(relNote);
    const relBody = el("div", "rel-list");
    if (refs.length) {
      refs.forEach(ref => {
        const line = el("div", "rel-line");
        line.appendChild(el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)")));
        if (ref.id !== undefined) line.appendChild(el("span", "mono rel-id", "#" + ref.id));
        relBody.appendChild(line);
      });
    } else {
      relBody.appendChild(el("p", "hint muted-line", "No other records reference this service yet."));
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
      acts.querySelectorAll("[data-svc-state]").forEach(b => { b.disabled = on; });
    }

    acts.querySelectorAll("[data-svc-state]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.svcState;
        busyAll(true);
        const res = await R.persistUpdate(store, MOD, content => {
          const r = R.getRecord(content, rec.id);
          if (!r) return { changed: false };
          r.status = next;
          if (next === "active" && !r.startDate) r.startDate = R.nowISO().slice(0, 10);
          if (next === "terminated" && !r.endDate) r.endDate = R.nowISO().slice(0, 10);
          r.updatedAt = R.nowISO();
          return { changed: true, content };
        });
        if (res && res.ok) {
          window.CRM.toast("Service marked " + D.statusLabel(next).toLowerCase() + ".");
          if (ctx.rerender) ctx.rerender();
        } else {
          showMsg("err", U.describeError(res, "services"));
          busyAll(false);
        }
      });
    });

    let confirmDel = false;
    delBtn.addEventListener("click", async () => {
      const allowed = await canDelete(store, rec.id);
      if (!allowed.allowed) {
        showMsg("err", "This service is referenced by other records — terminate it instead of deleting.");
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
        window.CRM.toast("Service deleted.");
        ctx.navigate("services");
      } else {
        showMsg("err", U.describeError(res, "services"));
        busyAll(false);
        delBtn.textContent = "Delete";
        delBtn.classList.remove("armed");
      }
    });

    if (window.CRM_TICKETS && window.CRM_TICKETS.listCard) {
      try {
        const tc = await window.CRM_TICKETS.listCard(store, { serviceId: rec.id }, { title: "Tickets for this service", emptyText: "No open tickets for this service." });
        if (tc) wrap.appendChild(tc.el);
      } catch (e) { console.error("service tickets card failed:", e); }
    }

    if (window.CRM_DOCUMENTS && window.CRM_DOCUMENTS.card) {
      try {
        const dc = await window.CRM_DOCUMENTS.card(store, { ownerType: "service", ownerId: rec.id, title: "Service documents", emptyText: "No contracts or documents filed for this service yet." });
        if (dc) wrap.appendChild(dc.el);
      } catch (e) { console.error("service documents card failed:", e); }
    }

    const scope = company ? { companyId: company.id } : (contact ? { contactId: contact.id } : null);
    if (scope) wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope, title: "Account timeline", hintText: "Calls, emails, meetings, notes, tasks and pipeline events for the account this service belongs to." }));

    return wrap;
  }

  function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(U.storeCard("services", { detail: "The document store isn't ready yet." }));
    return Promise.all([store.loadDoc(MOD, { refresh: true }), companyMap(store), contactMap(store), siteMap(store)]).then(triple => {
      const doc = triple[0];
      const cmap = triple[1];
      const ctmap = triple[2];
      const smap = triple[3];
      if (!doc || doc.ok === false) return U.storeCard("services", doc);
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return U.notFoundCard({ icon: ICON, title: "Service not found", what: "No service with id “" + (id || "") + "” exists in this document.", backHref: "#/services", backLabel: "Back to the service book" });

      const wrap = el("div", "svc-view");
      const backHref = isNew ? "#/services" : "#/services/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← Service book" : "← Back to " + (rec.name || "service");
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New service" : "Edit service"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);
      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.svcForm = "1";

      const nameIn = document.createElement("input");
      nameIn.className = "inp";
      nameIn.type = "text";
      nameIn.maxLength = 160;
      nameIn.placeholder = "e.g. Business Fiber 500/500";
      nameIn.value = (rec && rec.name) || "";
      nameIn.dataset.f = "name";
      form.appendChild(U.fld("text", "Service name", nameIn, { id: "sv-name", required: true, full: true }));

      const coSel = document.createElement("select");
      coSel.className = "sel";
      coSel.dataset.f = "companyId";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "— Select an account —";
      coSel.appendChild(noneOpt);
      Array.from(cmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.name + (c.isCustomer ? " ★" : "");
        coSel.appendChild(o);
      });
      if (rec && rec.companyId) coSel.value = rec.companyId;
      form.appendChild(U.fld("select", "Account", coSel, { id: "sv-company", required: true }));

      const catSel = document.createElement("select");
      catSel.className = "sel";
      catSel.dataset.f = "category";
      D.SERVICE_CATEGORIES.forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.label;
        if (c.hint) o.title = c.hint;
        catSel.appendChild(o);
      });
      catSel.value = (rec && rec.category) || "internet";
      form.appendChild(U.fld("select", "Category", catSel, { id: "sv-cat" }));

      const stSel = document.createElement("select");
      stSel.className = "sel";
      stSel.dataset.f = "status";
      D.SERVICE_STATUSES.forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.label;
        stSel.appendChild(o);
      });
      stSel.value = (rec && rec.status) || "prospect";
      form.appendChild(U.fld("select", "Status", stSel, { id: "sv-status" }));

      const ctSel = document.createElement("select");
      ctSel.className = "sel";
      ctSel.dataset.f = "contactId";
      const ctNone = document.createElement("option");
      ctNone.value = "";
      ctNone.textContent = "— No contact —";
      ctSel.appendChild(ctNone);
      Array.from(ctmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        const co = cmap.get(c.companyId);
        o.textContent = c.name + (co ? " — " + co.name : "");
        o.dataset.company = c.companyId || "";
        ctSel.appendChild(o);
      });
      if (rec && rec.contactId) ctSel.value = rec.contactId;
      form.appendChild(U.fld("select", "Primary contact", ctSel, { id: "sv-contact", full: true, hint: "Optional — used for alerts, billing contact and the timeline scope." }));

      const siteSel = document.createElement("select");
      siteSel.className = "sel";
      siteSel.dataset.f = "siteId";
      const siteNone = document.createElement("option");
      siteNone.value = "";
      siteNone.textContent = "— No site —";
      siteSel.appendChild(siteNone);
      Array.from(smap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name + (cmap.get(s.companyId) ? " — " + cmap.get(s.companyId).name : "");
        siteSel.appendChild(o);
      });
      if (rec && rec.siteId) siteSel.value = rec.siteId;
      form.appendChild(U.fld("select", "Site / location", siteSel, { id: "sv-site", full: true, hint: "Optional — where this service is delivered. Manage sites under Sites." }));

      const chargeIn = document.createElement("input");
      chargeIn.className = "inp";
      chargeIn.type = "number";
      chargeIn.min = "0";
      chargeIn.step = "0.01";
      chargeIn.placeholder = "0.00";
      chargeIn.value = (rec && rec.charge !== undefined && rec.charge !== null) ? rec.charge : "";
      chargeIn.dataset.f = "charge";
      form.appendChild(U.fld("number", "Recurring charge ($)", chargeIn, { id: "sv-charge" }));

      const cycleSel = document.createElement("select");
      cycleSel.className = "sel";
      cycleSel.dataset.f = "billingCycle";
      D.BILLING_CYCLES.forEach(c => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.label;
        cycleSel.appendChild(o);
      });
      cycleSel.value = (rec && rec.billingCycle) || "monthly";
      form.appendChild(U.fld("select", "Billed", cycleSel, { id: "sv-cycle", hint: "MRR normalizes this to a monthly figure." }));

      const setupIn = document.createElement("input");
      setupIn.className = "inp";
      setupIn.type = "number";
      setupIn.min = "0";
      setupIn.step = "0.01";
      setupIn.placeholder = "0.00";
      setupIn.value = (rec && rec.setupFee !== undefined && rec.setupFee !== null) ? rec.setupFee : "";
      setupIn.dataset.f = "setupFee";
      form.appendChild(U.fld("number", "One-time / setup fee ($)", setupIn, { id: "sv-setup" }));

      const termIn = document.createElement("input");
      termIn.className = "inp";
      termIn.type = "number";
      termIn.min = "0";
      termIn.step = "1";
      termIn.placeholder = "24";
      termIn.value = (rec && rec.contractTermMonths !== undefined && rec.contractTermMonths !== null) ? rec.contractTermMonths : "";
      termIn.dataset.f = "contractTermMonths";
      form.appendChild(U.fld("number", "Contract term (months)", termIn, { id: "sv-term", hint: "Used to project the renewal date when no end date is set." }));

      const startIn = document.createElement("input");
      startIn.className = "inp";
      startIn.type = "date";
      startIn.value = (rec && rec.startDate) ? String(rec.startDate).slice(0, 10) : "";
      startIn.dataset.f = "startDate";
      form.appendChild(U.fld("date", "Start date", startIn, { id: "sv-start" }));

      const endIn = document.createElement("input");
      endIn.className = "inp";
      endIn.type = "date";
      endIn.value = (rec && rec.endDate) ? String(rec.endDate).slice(0, 10) : "";
      endIn.dataset.f = "endDate";
      form.appendChild(U.fld("date", "Contract end / renewal", endIn, { id: "sv-end" }));

      const qtyIn = document.createElement("input");
      qtyIn.className = "inp";
      qtyIn.type = "number";
      qtyIn.min = "0";
      qtyIn.step = "1";
      qtyIn.placeholder = "e.g. 12 seats";
      qtyIn.value = (rec && rec.quantity !== undefined && rec.quantity !== null) ? rec.quantity : "";
      qtyIn.dataset.f = "quantity";
      form.appendChild(U.fld("number", "Seats / lines / channels", qtyIn, { id: "sv-qty" }));

      const bwIn = document.createElement("input");
      bwIn.className = "inp";
      bwIn.type = "number";
      bwIn.min = "0";
      bwIn.step = "1";
      bwIn.placeholder = "e.g. 500";
      bwIn.value = (rec && rec.bandwidth !== undefined && rec.bandwidth !== null) ? rec.bandwidth : "";
      bwIn.dataset.f = "bandwidth";
      form.appendChild(U.fld("number", "Bandwidth (Mbps)", bwIn, { id: "sv-bw", hint: "For internet circuits — leave blank for other services." }));

      const cidIn = document.createElement("input");
      cidIn.className = "inp";
      cidIn.type = "text";
      cidIn.maxLength = 80;
      cidIn.placeholder = "Circuit id / service reference";
      cidIn.value = (rec && rec.circuitId) || "";
      cidIn.dataset.f = "circuitId";
      form.appendChild(U.fld("text", "Circuit id", cidIn, { id: "sv-cid" }));

      const ownerIn = document.createElement("input");
      ownerIn.className = "inp";
      ownerIn.type = "text";
      ownerIn.maxLength = 80;
      ownerIn.placeholder = "Account manager";
      ownerIn.value = (rec && rec.owner) || "";
      ownerIn.dataset.f = "owner";
      form.appendChild(U.fld("text", "Owner", ownerIn, { id: "sv-owner" }));

      const addr = (rec && rec.serviceAddress) || {};
      const streetIn = document.createElement("input");
      streetIn.className = "inp";
      streetIn.type = "text";
      streetIn.placeholder = "Street address";
      streetIn.value = addr.street || "";
      streetIn.dataset.f = "a-street";
      form.appendChild(U.fld("text", "Service address — street", streetIn, { id: "sv-street", full: true }));

      const cityIn = document.createElement("input");
      cityIn.className = "inp";
      cityIn.type = "text";
      cityIn.placeholder = "City";
      cityIn.value = addr.city || "";
      cityIn.dataset.f = "a-city";
      form.appendChild(U.fld("text", "City", cityIn, { id: "sv-city" }));

      const regionIn = document.createElement("input");
      regionIn.className = "inp";
      regionIn.type = "text";
      regionIn.placeholder = "State / region";
      regionIn.value = addr.region || "";
      regionIn.dataset.f = "a-region";
      form.appendChild(U.fld("text", "State / region", regionIn, { id: "sv-region" }));

      const postalIn = document.createElement("input");
      postalIn.className = "inp";
      postalIn.type = "text";
      postalIn.placeholder = "Postal code";
      postalIn.value = addr.postalCode || "";
      postalIn.dataset.f = "a-postal";
      form.appendChild(U.fld("text", "Postal code", postalIn, { id: "sv-postal" }));

      const countryIn = document.createElement("input");
      countryIn.className = "inp";
      countryIn.type = "text";
      countryIn.placeholder = "Country";
      countryIn.value = addr.country || "";
      countryIn.dataset.f = "a-country";
      form.appendChild(U.fld("text", "Country", countryIn, { id: "sv-country" }));

      const tagsIn = document.createElement("input");
      tagsIn.className = "inp";
      tagsIn.type = "text";
      tagsIn.placeholder = "e.g. fibre, priority, multi-site";
      tagsIn.value = (rec && Array.isArray(rec.tags) ? rec.tags.join(", ") : "");
      tagsIn.dataset.f = "tags";
      form.appendChild(U.fld("text", "Tags", tagsIn, { id: "sv-tags", full: true }));

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 4;
      notesIn.placeholder = "SLA, delivery notes, equipment, escalation path…";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(U.fld("textarea", "Internal notes", notesIn, { id: "sv-notes", full: true }));

      const checks = el("div", "frm-checks full");
      const ar = el("label", "check");
      const arCb = document.createElement("input");
      arCb.type = "checkbox";
      arCb.checked = !!(rec && rec.autoRenew);
      arCb.dataset.f = "autoRenew";
      ar.appendChild(arCb);
      ar.appendChild(el("span", null, "Auto-renews at the end of the term"));
      checks.appendChild(ar);
      form.appendChild(checks);

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create service" : "Save changes";
      save.dataset.svcSave = "1";
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
          contactId: ctSel.value,
          siteId: siteSel.value,
          category: catSel.value,
          status: stSel.value,
          charge: chargeIn.value,
          setupFee: setupIn.value,
          billingCycle: cycleSel.value,
          contractTermMonths: termIn.value,
          startDate: startIn.value,
          endDate: endIn.value,
          quantity: qtyIn.value,
          bandwidth: bwIn.value,
          circuitId: cidIn.value,
          owner: ownerIn.value,
          tags: tagsIn.value,
          notes: notesIn.value,
          autoRenew: arCb.checked,
          serviceAddress: { street: streetIn.value, city: cityIn.value, region: regionIn.value, postalCode: postalIn.value, country: countryIn.value }
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
          window.CRM.toast(isNew ? "Service created." : "Service saved.");
          ctx.navigate("services", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create service" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "services") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "services"));
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
    validate,
    applyForm,
    canDelete,
    view,
    FILTERS,
    summarize: records => D.summarize(records),
    mrrOf: rec => D.monthlyOf(rec)
  };
})();

window.CRM_RENDERERS.services = function (ctx) {
  return window.CRM_SERVICES.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
