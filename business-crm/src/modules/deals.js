window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_DEALS = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const MOD = "deals";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';

  const WON = "won";
  const LOST = "lost";

  const DEFAULT_PIPE = {
    stages: [
      { id: "qualification", label: "Qualification" },
      { id: "discovery", label: "Discovery" },
      { id: "proposal", label: "Proposal" },
      { id: "negotiation", label: "Negotiation" }
    ],
    won: { id: WON, label: "Won" },
    lost: { id: LOST, label: "Lost" }
  };

  const PERIODS = [
    { id: "any", label: "Any close date" },
    { id: "none", label: "No close date" },
    { id: "overdue", label: "Overdue" },
    { id: "month", label: "Closing this month" },
    { id: "next30", label: "Closing next 30 days" },
    { id: "next90", label: "Closing next 90 days" },
    { id: "later", label: "Closing later" }
  ];

  const STATES = [
    { id: "all", label: "All" },
    { id: "open", label: "Open" },
    { id: WON, label: "Won" },
    { id: LOST, label: "Lost" }
  ];

  const LOSS_REASONS = ["Price", "Budget", "Competitor", "Timing", "No decision", "Champion left", "Scope changed", "Other"];

  const DAY = 86400000;

  let plCache = pipeDefault();
  let plReady = false;

  function pipeDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_PIPE));
  }
  function pipeFrom(content) {
    const pl = content && content.pipeline;
    if (pl && Array.isArray(pl.stages) && pl.stages.length) return pl;
    return pipeDefault();
  }
  function remember(content) {
    plCache = pipeFrom(content);
    plReady = true;
  }
  function isOpenStage(id) {
    return plCache.stages.some(s => s.id === id);
  }
  function stageFind(id) {
    if (!id) return null;
    return plCache.stages.find(s => s.id === id) || (id === plCache.won.id ? plCache.won : id === plCache.lost.id ? plCache.lost : null);
  }
  function stageLabel(id) {
    const s = stageFind(id);
    return s ? s.label : String(id || "");
  }
  function stageLabels() {
    return plCache.stages.map(s => s.label).concat([plCache.won.label, plCache.lost.label]);
  }
  function badgeClassForStage(id) {
    if (id === WON) return "badge customer";
    if (id === LOST) return "badge inactive";
    return "badge active";
  }

  function expectedOf(rec) {
    const n = Number(rec && rec.expectedValue);
    return rec && rec.expectedValue !== undefined && rec.expectedValue !== null && rec.expectedValue !== "" && isFinite(n) && n >= 0 ? n : 0;
  }
  function probOf(rec) {
    const n = Number(rec && rec.probability);
    if (rec && rec.probability !== undefined && rec.probability !== null && rec.probability !== "" && isFinite(n)) {
      return Math.max(0, Math.min(100, n));
    }
    return 100;
  }
  function weightedOf(rec) {
    return expectedOf(rec) * probOf(rec) / 100;
  }
  function closedOf(rec) {
    if (rec && rec.stage === WON) return "won";
    if (rec && rec.stage === LOST) return "lost";
    return "open";
  }

  function daysBetween(isoFrom, isoTo) {
    const a = isoFrom ? new Date(isoFrom).getTime() : null;
    const b = isoTo ? new Date(isoTo).getTime() : Date.now();
    if (a === null || isNaN(a) || isNaN(b)) return null;
    return Math.max(0, Math.floor((b - a) / DAY));
  }
  function stageDaysLabel(rec) {
    const d = daysBetween(rec && rec.stageEnteredAt);
    if (d === null) return "";
    return d === 0 ? "in stage since today" : d + "d in stage";
  }
  function localISO(d) {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function validate(raw, pl) {
    pl = pl || plCache;
    const errors = {};
    const values = {};
    const name = String(raw && raw.name || "").trim();
    if (!name) errors.name = "Deal name is required.";
    values.name = name;
    values.companyId = String(raw && raw.companyId || "").trim();
    values.contactId = String(raw && raw.contactId || "").trim();
    values.owner = String(raw && raw.owner || "").trim();
    const evIn = raw && raw.expectedValue;
    let ev = null;
    if (evIn !== undefined && evIn !== null && evIn !== "") {
      const n = Number(evIn);
      if (!isFinite(n) || n < 0) errors.expectedValue = "Expected value must be 0 or more.";
      else ev = Math.round(n * 100) / 100;
    }
    values.expectedValue = ev;
    const prIn = raw && raw.probability;
    let pr = null;
    if (prIn !== undefined && prIn !== null && prIn !== "") {
      const n = Number(prIn);
      if (!isFinite(n) || n < 0 || n > 100) errors.probability = "Probability must be between 0 and 100.";
      else pr = Math.round(n * 10) / 10;
    }
    values.probability = pr;
    const cd = String(raw && raw.closeDate || "").trim();
    if (cd && !/^\d{4}-\d{2}-\d{2}$/.test(cd)) errors.closeDate = "Enter a valid date.";
    values.closeDate = cd;
    const stage = String(raw && raw.stage || "").trim();
    if (stage && !pl.stages.some(s => s.id === stage) && stage !== WON && stage !== LOST) {
      errors.stage = "That pipeline stage does not exist.";
    }
    values.stage = stage || (pl.stages[0] ? pl.stages[0].id : "");
    values.notes = String(raw && raw.notes || "").trim();
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function setOrDel(rec, key, v) {
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) delete rec[key];
    else rec[key] = v;
  }

  function applyForm(base, values, opts) {
    opts = opts || {};
    const now = R.nowISO();
    const rec = Object.assign({}, base || {});
    const isNew = !rec.id;
    if (isNew) rec.id = R.newId(MOD);
    rec.name = values.name;
    setOrDel(rec, "companyId", values.companyId);
    setOrDel(rec, "contactId", values.contactId);
    setOrDel(rec, "owner", values.owner);
    setOrDel(rec, "expectedValue", values.expectedValue === null ? undefined : values.expectedValue);
    setOrDel(rec, "probability", values.probability === null ? undefined : values.probability);
    setOrDel(rec, "closeDate", values.closeDate);
    setOrDel(rec, "notes", values.notes);
    if (isNew || opts.stage) {
      const stage = opts.stage || values.stage;
      rec.stage = stage;
      rec.stageEnteredAt = now;
    }
    if (!isNew) rec.updatedAt = now;
    else rec.createdAt = now;
    if (!Array.isArray(rec.events)) rec.events = [];
    return rec;
  }

  async function canDelete(store, id) {
    const refs = await R.findRefs(store, MOD, "dealId", id);
    return refs.length ? { allowed: false, refs } : { allowed: true, refs };
  }

  function applyMove(r, from, to, now, opts) {
    const ev = { kind: "stage", from, to, at: now };
    if (opts.note) ev.note = opts.note;
    if (opts.reason) ev.reason = opts.reason;
    if (!Array.isArray(r.events)) r.events = [];
    r.events.push(ev);
    r.stage = to;
    r.stageEnteredAt = now;
    if (to === WON) {
      r.wonAt = now;
      delete r.lostAt;
      delete r.lossReason;
    } else if (to === LOST) {
      r.lostAt = now;
      delete r.wonAt;
      if (opts.reason) r.lossReason = opts.reason;
      else delete r.lossReason;
    } else {
      delete r.wonAt;
      delete r.lostAt;
      delete r.lossReason;
    }
    r.updatedAt = now;
    return true;
  }

  async function changeStage(store, dealId, toId, opts) {
    opts = opts || {};
    let doc;
    try {
      doc = await store.loadDoc(MOD, { refresh: true });
    } catch (e) {
      return { ok: false, code: "load_failed", detail: (e && e.message) || String(e) };
    }
    if (!doc || doc.ok === false) return doc || { ok: false, code: "load_failed", detail: "the deals document could not be read" };
    remember(doc.content);
    const rec = R.getRecord(doc.content, dealId);
    if (!rec) return { ok: false, code: "not_found", detail: "That deal no longer exists in this document." };
    if (!stageFind(toId)) {
      return { ok: false, code: "invalid_stage", detail: "That pipeline stage does not exist. It may have been renamed — refresh the page." };
    }
    const from = rec.stage && stageFind(rec.stage) ? rec.stage : plCache.stages[0].id;
    if (from === toId) return { ok: true, noop: true, revision: doc.revision, detail: "already in that stage" };
    const now = R.nowISO();
    let applied = false;
    const res = await R.persistUpdate(store, MOD, content => {
      const r = R.getRecord(content, dealId);
      if (!r) return { changed: false };
      remember(content);
      applyMove(r, from, toId, now, opts);
      applied = true;
      return { changed: true, content };
    });
    if (res && res.ok && applied) res.moved = { from, to: toId };
    return res;
  }

  async function createDealFromLead(store, lead, opts) {
    opts = opts || {};
    if (!lead || !lead.id) return { ok: false, code: "bad_lead", detail: "No lead was supplied to convert." };
    if (lead.convertedToDealId) return { ok: false, code: "already_converted", detail: "This lead already points at a deal." };
    const now = R.nowISO();
    let createdId = null;
    const res = await R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.pipeline ? content.pipeline.stages : null) || !content.pipeline.stages.length) {
        content.pipeline = pipeFrom(content);
      }
      remember(content);
      const d = {
        id: R.newId(MOD),
        name: String(lead.name || "Untitled deal"),
        companyId: lead.companyId || undefined,
        contactId: lead.contactId || undefined,
        owner: lead.owner || undefined,
        expectedValue: 0,
        closeDate: undefined,
        probability: undefined,
        notes: lead.notes || undefined,
        leadId: lead.id,
        stage: content.pipeline.stages[0].id,
        stageEnteredAt: now,
        createdAt: now,
        updatedAt: now,
        events: []
      };
      const ev = { kind: "create", at: now };
      if (opts.note) ev.note = opts.note;
      if (lead.source) ev.note = (ev.note ? ev.note + " " : "") + "(lead source: " + lead.source + ")";
      ev.leadId = lead.id;
      d.events.push(ev);
      R.upsertRecord(content, d);
      createdId = d.id;
      return { changed: true, content };
    });
    if (!res || !res.ok) return res || { ok: false };
    return { ok: true, dealId: createdId };
  }

  async function convertWonToCustomer(store, dealId, opts) {
    opts = opts || {};
    let doc;
    try {
      doc = await store.loadDoc(MOD, { refresh: true });
    } catch (e) {
      return { ok: false, code: "load_failed", detail: (e && e.message) || String(e) };
    }
    if (!doc || doc.ok === false) return doc || { ok: false, code: "load_failed", detail: "the deals document could not be read" };
    const deal = R.getRecord(doc.content, dealId);
    if (!deal) return { ok: false, code: "not_found", detail: "That deal no longer exists." };
    if (deal.stage !== WON) return { ok: false, code: "not_won", detail: "Only a won deal can be converted to a customer." };
    const companyId = deal.companyId;
    if (!companyId) return { ok: false, code: "no_company", detail: "This deal has no linked company to mark as a customer." };
    let cdoc;
    try {
      cdoc = await store.loadDoc("companies", { refresh: true });
    } catch (e) {
      return { ok: false, code: "load_failed", detail: (e && e.message) || String(e) };
    }
    if (!cdoc || cdoc.ok === false) return cdoc || { ok: false, code: "load_failed", detail: "the companies document could not be read" };
    const company = R.getRecord(cdoc.content, companyId);
    if (!company) return { ok: false, code: "no_company", detail: "The linked company no longer exists." };
    if (company.isCustomer === true && company.customerSince) {
      return { ok: true, noop: true, companyId, customerSince: company.customerSince };
    }
    const now = R.nowISO();
    const res = await R.persistUpdate(store, "companies", content => {
      const c = R.getRecord(content, companyId);
      if (!c) return { changed: false };
      c.isCustomer = true;
      if (!c.customerSince) c.customerSince = now;
      c.updatedAt = now;
      return { changed: true, content };
    });
    if (!res || !res.ok) return res || { ok: false };
    const dRes = await R.persistUpdate(store, MOD, content => {
      const d = R.getRecord(content, dealId);
      if (!d) return { changed: false };
      remember(content);
      if (!Array.isArray(d.events)) d.events = [];
      const ev = { kind: "customer", at: now };
      if (opts.note) ev.note = opts.note;
      d.events.push(ev);
      d.convertedToCustomerAt = now;
      d.updatedAt = now;
      return { changed: true, content };
    });
    return dRes && dRes.ok ? { ok: true, companyId, customerSince: now, detail: dRes.noop ? "deal event already recorded" : undefined } : dRes || { ok: false };
  }

  async function revertLeadOnDelete(store, dealId, leadId) {
    if (!leadId) return;
    try {
      await R.persistUpdate(store, "leads", content => {
        const lead = R.getRecord(content, leadId);
        if (!lead || lead.convertedToDealId !== dealId) return { changed: false };
        const now = R.nowISO();
        const ev = { kind: "status", from: "converted", to: "qualified", at: now, note: "Linked deal was deleted; lead returned to qualified." };
        if (!Array.isArray(lead.events)) lead.events = [];
        lead.events.push(ev);
        lead.status = "qualified";
        delete lead.convertedAt;
        delete lead.convertedToDealId;
        lead.updatedAt = now;
        return { changed: true, content };
      });
    } catch (e) {}
  }

  async function savePipeline(store, nextPl, opts) {
    opts = opts || {};
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return doc || { ok: false, code: "load_failed", detail: "the deals document could not be read" };
    const content = JSON.parse(JSON.stringify(doc.content || { records: [] }));
    const oldPl = content.pipeline;
    const moved = (oldPl && Array.isArray(oldPl.stages)) ? oldPl.stages.filter(s => !nextPl.stages.some(k => k.id === s.id)) : [];
    for (const m of moved) {
      if (opts.seedCounts && opts.seedCounts[m.id] > 0) {
        return { ok: false, code: "stage_in_use", detail: "The “" + m.label + "” stage still has " + opts.seedCounts[m.id] + " deal(s) in it. Move or close them first." };
      }
    }
    let changedRecs = false;
    content.pipeline = {
      stages: nextPl.stages,
      won: nextPl.won,
      lost: nextPl.lost
    };
    const openIds = nextPl.stages.map(s => s.id);
    (Array.isArray(content.records) ? content.records : []).forEach(r => {
      if (r && r.stage && openIds.indexOf(r.stage) === -1 && r.stage !== WON && r.stage !== LOST) {
        r.stage = openIds[0];
        changedRecs = true;
      }
    });
    remember(content);
    const res = await store.saveChecked(MOD, content, { expectedBase: doc.revision });
    if (res && res.ok && !res.noop && window.CRM_EVENTS) {
      window.CRM_EVENTS.fire("moduleWrite", { module: MOD, res, changes: [] });
    }
    return res;
  }

  function statusBanner(store) {
    return U.statusBannerCard(store, MOD, "Deals");
  }
  function storeErrorCard(message) {
    return U.storeCard(MOD, { detail: message });
  }
  function notFoundCard(what) {
    return U.notFoundCard({ icon: ICON, title: "Deal not found", what, backHref: "#/deals", backLabel: "Back to all deals" });
  }

  async function loadNamed(store, module) {
    return store.loadDoc(module).then(doc => (doc && doc.content && Array.isArray(doc.content.records) ? doc.content.records : [])).catch(() => []);
  }
  async function mapsOf(store) {
    const out = { companies: new Map(), contacts: new Map(), leads: new Map() };
    const [cdoc, ctdoc, ldoc] = await Promise.all([loadNamed(store, "companies"), loadNamed(store, "contacts"), loadNamed(store, "leads")]);
    cdoc.forEach(r => out.companies.set(r.id, r));
    ctdoc.forEach(r => out.contacts.set(r.id, r));
    ldoc.forEach(r => out.leads.set(r.id, r));
    return out;
  }

  function searchTextOf(rec, maps) {
    const bits = [];
    if (rec.name) bits.push(rec.name);
    if (rec.owner) bits.push(rec.owner);
    if (rec.notes) bits.push(rec.notes);
    if (rec.stage) { const s = stageFind(rec.stage); if (s) bits.push(s.label); }
    if (rec.companyId) { const c = maps.companies.get(rec.companyId); if (c) bits.push(c.name); }
    if (rec.contactId) { const c = maps.contacts.get(rec.contactId); if (c) bits.push(c.name); }
    if (rec.source) bits.push(rec.source);
    return bits.join(" ").toLowerCase();
  }

  function subtitleOf(rec, maps) {
    const parts = [];
    if (rec.companyId) {
      const c = maps.companies.get(rec.companyId);
      parts.push(c ? c.name : "missing company");
    }
    if (rec.contactId) {
      const c = maps.contacts.get(rec.contactId);
      parts.push(c ? c.name : "missing contact");
    }
    return parts.join(" · ");
  }

  function periodHits(rec, period) {
    if (period === "any") return true;
    const state = closedOf(rec);
    const cd = rec && rec.closeDate;
    if (state !== "open") return false;
    if (period === "none") return !cd;
    if (!cd) return false;
    const t = localISO(new Date());
    if (period === "overdue") return cd < t;
    const d30 = new Date(); d30.setDate(d30.getDate() + 30);
    const d90 = new Date(); d90.setDate(d90.getDate() + 90);
    if (period === "month") return cd.slice(0, 7) === t.slice(0, 7);
    if (period === "next30") return cd >= t && cd <= localISO(d30);
    if (period === "next90") return cd >= t && cd <= localISO(d90);
    if (period === "later") return cd > localISO(d90);
    return true;
  }

  function matches(rec, f, maps) {
    if (f.companyId) {
      if (!rec.companyId || rec.companyId !== f.companyId) return false;
    }
    const state = closedOf(rec);
    if (f.state === "open" && state !== "open") return false;
    if (f.state === WON && state !== WON) return false;
    if (f.state === LOST && state !== LOST) return false;
    if (f.owner) {
      if (!rec.owner || String(rec.owner).trim() !== String(f.owner).trim()) return false;
    }
    if (!periodHits(rec, f.period || "any")) return false;
    if (f.seg && window.CRM_SEGMENTS && typeof window.CRM_SEGMENTS.segMatches === "function") {
      if (!window.CRM_SEGMENTS.segMatches(f.seg, rec, null, null)) return false;
    }
    const q = String(f.q || "").trim().toLowerCase();
    if (q && searchTextOf(rec, maps).indexOf(q) === -1) return false;
    return true;
  }

  function stageOrder(rec) {
    const st = rec && rec.stage;
    if (st === WON) return 1000;
    if (st === LOST) return 2000;
    const idx = plCache.stages.findIndex(s => s.id === st);
    return idx === -1 ? 500 : idx;
  }
  function compareDeals(a, b) {
    const sa = stageOrder(a);
    const sb = stageOrder(b);
    if (sa !== sb) return sa - sb;
    const closed = a && (a.stage === WON || a.stage === LOST);
    if (closed) {
      const ta = a && (a.wonAt || a.lostAt) ? String(a.wonAt || a.lostAt) : "";
      const tb = b && (b.wonAt || b.lostAt) ? String(b.wonAt || b.lostAt) : "";
      return tb.localeCompare(ta);
    }
    const ca = a && a.closeDate || "";
    const cb = b && b.closeDate || "";
    if (ca && cb) return ca.localeCompare(cb);
    if (ca) return -1;
    if (cb) return 1;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  }

  async function renderList(ctx, opts) {
    opts = opts || {};
    const store = ctx.store;
    if (!store) return Promise.resolve(storeErrorCard("The document store isn't ready yet. Try again in a moment."));
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The deals document could not be read.");
    remember(doc.content);
    const all = R.recordsOf(doc.content);
    const maps = await mapsOf(store);

    const wrap = el("div", "cmp-view");
    const banner = await statusBanner(store);
    if (banner) wrap.appendChild(banner);

    let companyName = null;
    if (opts.companyId) {
      const c = maps.companies.get(opts.companyId);
      if (c) companyName = c.name;
      const cb = el("div", "bkp-msg");
      cb.dataset.dlCompanyBanner = "1";
      cb.style.border = "1px solid var(--line-strong)";
      cb.style.background = "var(--surface-2)";
      const t = el("span", null, companyName ? "Deals for " + companyName : "Deals for this company");
      if (c && c.isCustomer === true) {
        t.appendChild(document.createTextNode(" · "));
        t.appendChild(el("span", "badge customer", "Customer"));
      }
      cb.appendChild(t);
      const back = document.createElement("a");
      back.className = "btn btn-ghost btn-sm";
      back.style.marginLeft = "auto";
      back.href = opts.companyId ? "#/companies/" + encodeURIComponent(opts.companyId) : "#/deals";
      back.textContent = "Open company";
      cb.appendChild(back);
      wrap.appendChild(cb);
    }

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, companyName ? "Deal history" : "Deals"));
    if (!companyName) {
      tBox.appendChild(el("p", "hint", "Every deal sits in a configurable stage; totals by stage combine expected value with probability-weighted forecast."));
      tBox.querySelector(".hint").style.marginTop = "3px";
    }
    titleRow.appendChild(tBox);
    const right = el("div", "detail-acts");
    const chip = U.chip(all.length, "deal", "deals");
    chip.dataset.dlCount = "1";
    right.appendChild(chip);
    const gear = document.createElement("a");
    gear.className = "btn btn-ghost btn-sm";
    gear.href = "#/deals/settings";
    gear.textContent = "⚙ Pipeline";
    gear.dataset.dlSettings = "1";
    right.appendChild(gear);
    titleRow.appendChild(right);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search deals, companies, owners…";
    search.dataset.dlQ = "1";
    const initState = opts && ["open", WON, LOST].indexOf(opts.state) !== -1 ? opts.state : "all";
    const stateSeg = el("div", "seg");
    stateSeg.dataset.dlState = "1";
    const stateBtns = {};
    STATES.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.label;
      b.dataset.filt = f.id;
      if (f.id === initState) b.classList.add("on");
      stateBtns[f.id] = b;
      stateSeg.appendChild(b);
    });
    const ownerSel = document.createElement("select");
    ownerSel.className = "sel";
    ownerSel.dataset.dlOwner = "1";
    const ownerOpts = {};
    ownerSel.appendChild(optionEl("", "Any owner"));
    all.forEach(r => {
      if (r.owner && !ownerOpts[r.owner]) {
        ownerOpts[r.owner] = 1;
        ownerSel.appendChild(optionEl(r.owner, r.owner));
      }
    });
    const periodSel = document.createElement("select");
    periodSel.className = "sel";
    periodSel.dataset.dlPeriod = "1";
    PERIODS.forEach(p => periodSel.appendChild(optionEl(p.id, p.label)));
    const savedWrap = el("span", "seg-saved-wrap");
    let activeSaved = null;
    const segCtl = window.CRM_SEGMENTS ? window.CRM_SEGMENTS.savedSegControl(store, MOD, { onPick: seg => { activeSaved = seg; repaint(); } }) : el("span");
    savedWrap.appendChild(segCtl);
    const add = document.createElement("a");
    add.className = "btn btn-primary btn-sm";
    add.href = "#/deals/new";
    add.textContent = "＋ Add deal";
    add.dataset.dlAdd = "1";
    const viewSeg = el("div", "seg");
    viewSeg.dataset.dlViewToggle = "1";
    const viewBtns = {};
    [["board", "Board"], ["list", "List"]].forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = pair[1];
      b.dataset.view = pair[0];
      if (pair[0] === "board") b.classList.add("on");
      viewBtns[pair[0]] = b;
      viewSeg.appendChild(b);
    });
    toolbar.appendChild(search);
    toolbar.appendChild(stateSeg);
    toolbar.appendChild(ownerSel);
    toolbar.appendChild(periodSel);
    toolbar.appendChild(savedWrap);
    toolbar.appendChild(viewSeg);
    toolbar.appendChild(add);
    card.appendChild(toolbar);

    const body = el("div");
    body.dataset.dlBody = "1";
    card.appendChild(body);
    wrap.appendChild(card);

    let q = "";
    let state = initState;
    let owner = "";
    let period = "any";
    let mode = "board";

    function currentFilters() {
      return { q, state, owner, period, companyId: opts.companyId || "", seg: activeSaved, maps };
    }
    function matching() {
      const f = currentFilters();
      const arr = all.filter(r => matches(r, f, maps));
      arr.sort(compareDeals);
      return arr;
    }

    function ownerNames() {
      const out = [];
      all.forEach(r => { if (r.owner && out.indexOf(r.owner) === -1) out.push(r.owner); });
      return out;
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " deal" + (rows.length === 1 ? "" : "s");
      body.innerHTML = "";
      if (!all.length) {
        body.appendChild(U.listStateEmpty(ICON, "No deals yet", "Deals you add — or leads you convert — will flow through the pipeline here, with value, close dates and a weighted forecast.", "#/deals/new", "＋ Add deal"));
        return;
      }
      if (!rows.length) {
        const noneTxt = q ? "No deals match “" + q + "”." : activeSaved ? "No deals match the “" + activeSaved.name + "” segment." : "No deals in this view.";
        body.appendChild(U.listStateNone(noneTxt));
        return;
      }
      if (mode === "board") body.appendChild(boardView(rows));
      else body.appendChild(listView(rows));
    }

    function colDeals(rows, stageId) {
      return rows.filter(r => {
        if (stageId === WON) return r.stage === WON;
        if (stageId === LOST) return r.stage === LOST;
        return r.stage === stageId;
      });
    }

    function boardView(rows) {
      const board = el("div", "dl-board");
      board.dataset.dlBoard = "1";
      const wantWon = state === "all" || state === WON;
      const wantLost = state === "all" || state === LOST;
      const wantOpen = state === "all" || state === "open";
      if (wantOpen) {
        plCache.stages.forEach(st => {
          const deals = colDeals(rows, st.id);
          board.appendChild(columnEl(st.id, st.label, deals, false));
        });
      }
      if (wantWon) board.appendChild(columnEl(WON, plCache.won.label, colDeals(rows, WON), true));
      if (wantLost) board.appendChild(columnEl(LOST, plCache.lost.label, colDeals(rows, LOST), true));
      return board;
    }

    function columnEl(stageId, label, deals, isEnd) {
      const col = el("div", "dl-col");
      col.dataset.col = stageId;
      col.dataset.dlCol = "1";
      const sumE = deals.reduce((s, d) => s + expectedOf(d), 0);
      const sumW = deals.reduce((s, d) => s + weightedOf(d), 0);
      const head = el("div", "dl-colhead");
      const titleLine = el("div", "dl-coltitle");
      titleLine.appendChild(el("span", null, label));
      titleLine.appendChild(el("span", "chip dl-colcount", deals.length));
      head.appendChild(titleLine);
      const sums = el("div", "dl-colsum");
      sums.appendChild(el("span", null, U.fmtMoney(sumE) + " expected"));
      if (!isEnd) sums.appendChild(el("span", null, "· " + U.fmtMoney(sumW) + " weighted"));
      sums.dataset.dlColsum = "1";
      head.appendChild(sums);
      col.appendChild(head);
      const bodyEl = el("div", "dl-cols");
      deals.forEach(d => bodyEl.appendChild(cardEl(d)));
      col.appendChild(bodyEl);
      return col;
    }

    function cardEl(d) {
      const a = document.createElement("a");
      a.className = "dl-card";
      a.href = "#/deals/" + encodeURIComponent(d.id);
      a.dataset.dlCard = "1";
      a.dataset.id = d.id;
      const name = el("span", "dl-card-name", d.name || "(unnamed deal)");
      a.appendChild(name);
      const sub = subtitleOf(d, maps);
      if (sub) a.appendChild(el("span", "dl-card-sub", sub));
      const row1 = el("span", "dl-card-row");
      const val = el("span", "dl-val", U.fmtMoney(expectedOf(d)));
      if (d.expectedValue === undefined || d.expectedValue === null || d.expectedValue === "") val.textContent = "—";
      row1.appendChild(val);
      const pr = probOf(d);
      if (pr < 100) row1.appendChild(el("span", "tag-pill", pr + "%"));
      a.appendChild(row1);
      const foot = el("span", "dl-card-foot");
      if (d.owner) foot.appendChild(el("span", "badge owner", d.owner));
      const when = d.stage === WON ? (d.wonAt ? "won " + R.fmtDate(d.wonAt) : "won") : d.stage === LOST ? (d.lostAt ? "lost " + R.fmtDate(d.lostAt) : "lost") : d.closeDate ? "closes " + R.fmtDate(d.closeDate) : "no close date";
      foot.appendChild(el("span", "dl-card-when", when));
      a.appendChild(foot);
      return a;
    }

    function listView(rows) {
      const box = el("div");
      box.dataset.dlList = "1";
      rows.forEach(d => {
        const row = document.createElement("a");
        row.className = "rec-row";
        row.href = "#/deals/" + encodeURIComponent(d.id);
        row.dataset.dlRow = "1";
        row.dataset.id = d.id;
        const av = el("span", "rec-av", U.initials(d.name));
        const main = el("span", "rec-main");
        const line1 = el("span", "rec-line1");
        line1.appendChild(el("span", "rec-name", d.name || "(unnamed deal)"));
        line1.appendChild(el("span", badgeClassForStage(d.stage), stageLabel(d.stage)));
        const pr = probOf(d);
        if (pr < 100) line1.appendChild(el("span", "tag-pill", pr + "%"));
        if (d.owner) line1.appendChild(el("span", "badge owner", d.owner));
        main.appendChild(line1);
        const sub = subtitleOf(d, maps);
        if (sub) main.appendChild(el("span", "rec-sub", sub));
        const side = el("span", "rec-side");
        const valWrap = el("span", "dl-side-val");
        const v = expectedOf(d);
        valWrap.textContent = d.expectedValue === undefined || d.expectedValue === null || d.expectedValue === "" ? "—" : U.fmtMoney(v);
        if (v > 0 && pr < 100) valWrap.title = U.fmtMoney(weightedOf(d)) + " weighted";
        side.appendChild(valWrap);
        const when = d.stage === WON ? (d.wonAt ? "won " + R.fmtDate(d.wonAt) : "won") : d.stage === LOST ? (d.lostAt ? "lost " + R.fmtDate(d.lostAt) : "lost") : d.closeDate ? (d.closeDate < localISO(new Date()) ? "overdue · " + R.fmtDate(d.closeDate) : "closes " + R.fmtDate(d.closeDate)) : "no close date";
        side.appendChild(el("span", "rec-when", when));
        row.appendChild(av);
        row.appendChild(main);
        row.appendChild(side);
        box.appendChild(row);
      });
      return box;
    }

    search.addEventListener("input", () => { q = search.value; repaint(); });
    Object.values(stateBtns).forEach(b => b.addEventListener("click", () => {
      Object.values(stateBtns).forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      state = b.dataset.filt;
      repaint();
    }));
    ownerSel.addEventListener("change", () => { owner = ownerSel.value; repaint(); });
    periodSel.addEventListener("change", () => { period = periodSel.value; repaint(); });
    Object.values(viewBtns).forEach(b => b.addEventListener("click", () => {
      Object.values(viewBtns).forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      mode = b.dataset.view;
      repaint();
    }));
    repaint();
    return wrap;
  }

  function optionEl(value, text) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    return o;
  }

  async function renderDetail(ctx) {
    const store = ctx.store;
    const id = ctx.params && ctx.params[0];
    if (!store) return storeErrorCard("The document store isn't ready yet. Try again in a moment.");
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The deals document could not be read.");
    remember(doc.content);
    const rec = R.getRecord(doc.content, id);
    if (!rec) return notFoundCard("No deal with id “" + (id || "") + "” exists in this document.");
    const maps = await mapsOf(store);
    const del = await canDelete(store, rec.id);
    const company = rec.companyId ? maps.companies.get(rec.companyId) : null;
    const contact = rec.contactId ? maps.contacts.get(rec.contactId) : null;
    const leadRec = rec.leadId ? maps.leads.get(rec.leadId) : null;

    const wrap = el("div", "cmp-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/deals";
    back.textContent = "← All deals";
    wrap.appendChild(back);

    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", U.initials(rec.name));
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.name || "(unnamed deal)"));
    const badges = el("span", "detail-badges");
    badges.appendChild(el("span", badgeClassForStage(rec.stage), stageLabel(rec.stage)));
    const stDays = stageDaysLabel(rec);
    if (stDays && rec.stage !== WON && rec.stage !== LOST) badges.appendChild(el("span", "badge id", stDays));
    if (rec.owner) badges.appendChild(el("span", "badge owner", rec.owner));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const created = rec.createdAt ? "opened " + R.fmtDate(rec.createdAt) : null;
    const updated = rec.updatedAt ? "updated " + R.timeAgo(rec.updatedAt) : null;
    const aged = daysBetween(rec.createdAt);
    meta.textContent = [created, aged !== null && rec.stage !== WON && rec.stage !== LOST ? aged + " days old" : null, updated].filter(Boolean).join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    const logAct = document.createElement("a");
    logAct.className = "btn btn-ghost btn-sm";
    logAct.href = "#/activities/log/deals/" + encodeURIComponent(rec.id);
    logAct.textContent = "＋ Log";
    logAct.title = "Record a call, meeting, email, note or task for this deal";
    logAct.dataset.dlLog = "1";
    const emailAct = document.createElement("a");
    emailAct.className = "btn btn-ghost btn-sm";
    emailAct.href = "#/emails/compose/deal/" + encodeURIComponent(rec.id);
    emailAct.textContent = "✉ Email";
    emailAct.dataset.dlEmail = "1";
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/deals/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit deal";
    edit.dataset.dlEdit = "1";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.dlDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — keep or archive it instead.";
    }
    acts.appendChild(logAct);
    acts.appendChild(emailAct);
    acts.appendChild(edit);
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Deal details"));
    const items = [];
    items.push({ label: "Expected value", v: U.fmtMoney(expectedOf(rec)) });
    const pr = probOf(rec);
    items.push({ label: "Probability", v: pr + "%" + (rec.probability === undefined || rec.probability === null || rec.probability === "" ? " (default)" : "") });
    items.push({ label: "Weighted value", v: U.fmtMoney(weightedOf(rec)) + (pr < 100 ? "" : "") });
    if (rec.closeDate) {
      const cd = rec.closeDate;
      const today = localISO(new Date());
      const chipEl = el("span", null);
      chipEl.appendChild(document.createTextNode(R.fmtDate(cd)));
      if (rec.stage !== WON && rec.stage !== LOST) {
        if (cd < today) chipEl.appendChild(el("span", "badge inactive", "overdue"));
        else chipEl.appendChild(el("span", "badge active", (Math.round((new Date(cd).getTime() - Date.now()) / DAY)) + " days away"));
      }
      items.push({ label: "Close date", v: chipEl });
    } else {
      items.push({ label: "Close date", v: "—" });
    }
    items.push({ label: "Pipeline stage", v: stageLabel(rec.stage) });
    if (company) {
      const a = document.createElement("a");
      a.href = "#/companies/" + encodeURIComponent(company.id);
      a.textContent = company.name;
      if (company.isCustomer === true) a.textContent += " · customer";
      items.push({ label: "Company", v: a });
    } else if (rec.companyId) {
      items.push({ label: "Company", v: String(rec.companyId) + " (missing record)" });
    } else {
      items.push({ label: "Company", v: el("span", "muted", "Standalone deal") });
    }
    if (contact) {
      const a = document.createElement("a");
      a.href = "#/contacts/" + encodeURIComponent(contact.id);
      a.textContent = contact.name;
      items.push({ label: "Contact", v: a });
    } else if (rec.contactId) {
      items.push({ label: "Contact", v: String(rec.contactId) + " (missing record)" });
    }
    if (leadRec) {
      const a = document.createElement("a");
      a.href = "#/leads/" + encodeURIComponent(leadRec.id);
      a.textContent = leadRec.name || leadRec.id;
      items.push({ label: "From lead", v: a });
    }
    if (rec.lossReason) items.push({ label: "Loss reason", v: rec.lossReason });
    if (rec.wonAt) items.push({ label: "Won", v: R.fmtDate(rec.wonAt) });
    if (rec.lostAt) items.push({ label: "Lost", v: R.fmtDate(rec.lostAt) });
    if (rec.convertedToCustomerAt) items.push({ label: "Customer since", v: R.fmtDate(rec.convertedToCustomerAt) });
    items.push({ label: "Record id", v: rec.id });
    grid.appendChild(U.dlist(items));
    wrap.appendChild(grid);

    if (rec.notes) {
      const notes = el("section", "card");
      notes.appendChild(el("h2", null, "Notes"));
      const box = el("div", "notes-box", rec.notes);
      box.style.whiteSpace = "pre-wrap";
      notes.appendChild(box);
      wrap.appendChild(notes);
    }

    wrap.appendChild(workflowCard(store, rec, { msg, onDone: () => { if (window.CRM.rerender) window.CRM.rerender(); } }));
    wrap.appendChild(await window.CRM_SUGGEST.card(store, rec, {}));
    if (window.CRM_BUSUI && window.CRM_BUSUI.dealCard) {
      try {
        const busExt = await window.CRM_BUSUI.dealCard(store, rec);
        if (busExt) wrap.appendChild(busExt);
      } catch (e) {
        console.error("deal pipeline card failed:", e);
      }
    }
    wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope: { dealId: rec.id }, title: "Timeline", hintText: "Calls, emails, meetings, notes, tasks and stage changes for this deal, newest first." }));

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    const relNote = el("p", "hint", "Activities and follow-ups reference this deal by id, so the links survive renames. Delete is blocked while anything still points here.");
    relNote.style.marginTop = "3px";
    rel.appendChild(relNote);
    const relBody = el("div", "rel-list");
    if (del.refs.length) {
      del.refs.forEach(ref => {
        const line = el("div", "rel-line");
        line.appendChild(el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)")));
        if (ref.id !== undefined) line.appendChild(el("span", "mono rel-id", "#" + ref.id));
        relBody.appendChild(line);
      });
    } else {
      relBody.appendChild(el("p", "hint muted-line", "No records reference this deal yet."));
    }
    rel.appendChild(relBody);
    wrap.appendChild(rel);

    function showMsg(kind, text) {
      msg.className = "bkp-msg " + kind;
      msg.textContent = text;
      msg.hidden = false;
      msg.scrollIntoView({ block: "nearest" });
    }

    delBtn.addEventListener("click", async () => {
      if (delBtn.disabled) return;
      if (!window.confirm("Delete this deal? This cannot be undone. Any lead that converted into it will return to “qualified”.")) return;
      const leadId = rec.leadId;
      const res = await R.persistUpdate(store, MOD, content => {
        const out = R.removeRecord(content, id);
        if (out.removed) remember(content);
        return out.removed ? { changed: true, content } : { changed: false };
      });
      if (res && res.ok) {
        await revertLeadOnDelete(store, rec.id, leadId);
        window.CRM.toast("Deal deleted.");
        ctx.navigate("deals", []);
        return;
      }
      showMsg("err", "Could not delete the deal. " + (U.describeError(res, "deals") || ""));
    });

    return wrap;
  }

  function historyCard(rec) {
    const card = el("section", "card");
    card.appendChild(el("h2", null, "Deal history"));
    const evs = (Array.isArray(rec.events) ? rec.events : []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const body = el("div", "rel-list");
    if (!evs.length) {
      body.appendChild(el("p", "hint muted-line", "No stage changes yet — this deal is still in “" + stageLabel(rec.stage) + "”."));
    } else {
      evs.forEach(ev => {
        const line = el("div", "rel-line");
        if (ev.kind === "stage") {
          const name = el("span", "rel-name", stageLabel(ev.from) + " → " + stageLabel(ev.to));
          line.appendChild(name);
        } else if (ev.kind === "create") {
          const name = el("span", "rel-name", "Deal created" + (ev.leadId ? " from lead" : ""));
          line.appendChild(name);
        } else if (ev.kind === "customer") {
          const name = el("span", "rel-name", "Company marked as customer");
          line.appendChild(name);
        } else {
          const name = el("span", "rel-name", String(ev.kind || "event"));
          line.appendChild(name);
        }
        if (ev.note) {
          const note = el("span", "rel-sub", ev.note);
          line.appendChild(note);
        }
        if (ev.reason) {
          const note = el("span", "rel-sub", "Reason: " + ev.reason);
          line.appendChild(note);
        }
        line.appendChild(el("span", "mono rel-id", R.fmtStamp(ev.at)));
        body.appendChild(line);
      });
    }
    card.appendChild(body);
    return card;
  }

  function workflowCard(store, rec, opts) {
    const card = el("section", "card");
    card.appendChild(el("h2", null, "Workflow"));
    const isWon = rec.stage === WON;
    const isLost = rec.stage === LOST;
    if (isWon || isLost) {
      const info = el("p", "hint", isWon
        ? "This deal is closed as won" + (rec.wonAt ? " on " + R.fmtDate(rec.wonAt) : "") + ". Reopening moves it back to the first pipeline stage."
        : "This deal is closed as lost" + (rec.lossReason ? " — " + rec.lossReason : "") + ". Reopening moves it back to the first pipeline stage.");
      card.appendChild(info);
      if (isWon && rec.companyId && !(rec.convertedToCustomerAt)) {
        const ctn = el("div", "dl-customer-callout");
        ctn.dataset.dlCustCta = "1";
        const p = el("p", null, "Convert the linked company into a customer — this sets the customer flag and records the date, which later feeds cycle-time and ledger reports.");
        p.style.marginBottom = "8px";
        ctn.appendChild(p);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-primary btn-sm";
        b.textContent = "★ Convert to customer";
        b.addEventListener("click", async () => {
          b.disabled = true;
          const res = await convertWonToCustomer(store, rec.id, {});
          if (res && res.ok) {
            window.CRM.toast(res.noop ? "Company was already a customer." : "Company marked as customer.");
            if (opts.onDone) opts.onDone();
          } else {
            b.disabled = false;
            if (opts.msg) {
              opts.msg.className = "bkp-msg err";
              opts.msg.textContent = res && res.detail ? res.detail : "Could not convert to customer.";
              opts.msg.hidden = false;
            }
          }
        });
        ctn.appendChild(b);
        card.appendChild(ctn);
      }
      const row = el("div", "wf-actions");
      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.className = "btn btn-ghost btn-sm";
      reopen.textContent = "Reopen deal";
      reopen.dataset.dlReopen = "1";
      reopen.addEventListener("click", async () => {
        if (!window.confirm("Reopen this deal at the first pipeline stage? Its close timestamps are cleared but the history stays.")) return;
        const target = plCache.stages[0] ? plCache.stages[0].id : WON;
        const res = await changeStage(store, rec.id, target, { note: "Reopened" });
        if (res && res.ok) {
          window.CRM.toast("Deal reopened in “" + stageLabel(target) + "”.");
          if (opts.onDone) opts.onDone();
        } else if (opts.msg) {
          opts.msg.className = "bkp-msg err";
          opts.msg.textContent = (res && res.detail) || "Could not reopen the deal.";
          opts.msg.hidden = false;
        }
      });
      row.appendChild(reopen);
      card.appendChild(row);
      return card;
    }

    const body = el("div", "wf-body");
    const noteIn = document.createElement("input");
    noteIn.className = "inp";
    noteIn.type = "text";
    noteIn.placeholder = "Optional note recorded with the next change…";
    noteIn.maxLength = 300;
    noteIn.dataset.dlNote = "1";
    body.appendChild(U.fld("text", "Note", noteIn, { id: "dl-note", full: true }));

    const row1 = el("div", "wf-actions");
    const stageSel = document.createElement("select");
    stageSel.className = "sel";
    stageSel.dataset.dlStageSel = "1";
    plCache.stages.forEach(s => {
      const o = optionEl(s.id, s.label);
      if (s.id === rec.stage) o.selected = true;
      stageSel.appendChild(o);
    });
    const moveBtn = document.createElement("button");
    moveBtn.type = "button";
    moveBtn.className = "btn btn-primary btn-sm";
    moveBtn.textContent = "Move to stage";
    moveBtn.dataset.dlMove = "1";
    row1.appendChild(stageSel);
    row1.appendChild(moveBtn);
    body.appendChild(row1);

    const row2 = el("div", "wf-actions");
    const wonBtn = document.createElement("button");
    wonBtn.type = "button";
    wonBtn.className = "btn btn-primary btn-sm";
    wonBtn.textContent = "✓ Mark as won";
    wonBtn.dataset.dlWon = "1";
    const lostBtn = document.createElement("button");
    lostBtn.type = "button";
    lostBtn.className = "btn btn-danger btn-sm";
    lostBtn.textContent = "✕ Mark as lost";
    lostBtn.dataset.dlLost = "1";
    row2.appendChild(wonBtn);
    row2.appendChild(lostBtn);
    body.appendChild(row2);
    card.appendChild(body);

    function note() {
      return noteIn.value.trim();
    }
    async function doMove(toId, noteText) {
      const res = await changeStage(store, rec.id, toId, { note: noteText });
      if (res && res.ok) {
        window.CRM.toast("Deal moved to “" + stageLabel(toId) + "”.");
        if (opts.onDone) opts.onDone();
      } else if (opts.msg) {
        opts.msg.className = "bkp-msg " + (res && res.code === "invalid_stage" ? "warn" : "err");
        opts.msg.textContent = (res && res.detail) || "Could not move the deal.";
        opts.msg.hidden = false;
      }
    }
    moveBtn.addEventListener("click", () => doMove(stageSel.value, note()));
    wonBtn.addEventListener("click", () => doMove(WON, note()));
    lostBtn.addEventListener("click", () => {
      const prev = card.querySelector(".dl-lost-box");
      if (prev) { prev.remove(); return; }
      const box = el("div", "dl-lost-box wf-disq");
      box.dataset.dlLostBox = "1";
      const lab = el("label", "fld");
      lab.appendChild(el("span", "k", "Loss reason"));
      const sel = document.createElement("select");
      sel.className = "sel";
      LOSS_REASONS.forEach(rr => {
        const o = optionEl(rr, rr);
        sel.appendChild(o);
      });
      const other = document.createElement("input");
      other.className = "inp";
      other.type = "text";
      other.placeholder = "…or type a reason";
      other.maxLength = 200;
      lab.appendChild(sel);
      lab.appendChild(other);
      box.appendChild(lab);
      const hint = el("p", "hint", "The reason is recorded on the deal and counts towards win/loss reporting.");
      box.appendChild(hint);
      const actions = el("div", "wf-actions");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "btn btn-danger btn-sm";
      go.textContent = "Confirm lost";
      go.addEventListener("click", () => {
        const reason = other.value.trim() || sel.value;
        const n = note();
        go.disabled = true;
        changeStage(store, rec.id, LOST, { reason, note: n }).then(res => {
          if (res && res.ok) {
            window.CRM.toast("Deal marked as lost.");
            if (opts.onDone) opts.onDone();
          } else if (opts.msg) {
            opts.msg.className = "bkp-msg err";
            opts.msg.textContent = (res && res.detail) || "Could not mark the deal as lost.";
            opts.msg.hidden = false;
          }
        });
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-ghost btn-sm";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => box.remove());
      actions.appendChild(go);
      actions.appendChild(cancel);
      box.appendChild(actions);
      card.appendChild(box);
    });
    return card;
  }

  async function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(storeErrorCard("The document store isn't ready yet. Try again in a moment."));

    return store.loadDoc(MOD, { refresh: true }).then(async doc => {
      if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The deals document could not be read.");
      remember(doc.content);
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return notFoundCard("No deal with id “" + (id || "") + "” exists in this document.");
      const [companies, contacts] = await Promise.all([loadNamed(store, "companies"), loadNamed(store, "contacts")]);

      const wrap = el("div", "cmp-view");
      const backHref = isNew ? "#/deals" : "#/deals/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← All deals" : "← Back to " + (rec.name || "deal");
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New deal" : "Edit deal"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);

      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.dlForm = "1";

      const nameIn = document.createElement("input");
      nameIn.className = "inp";
      nameIn.type = "text";
      nameIn.maxLength = 160;
      nameIn.placeholder = "e.g. Acme annual licence";
      nameIn.value = (rec && rec.name) || "";
      nameIn.dataset.f = "name";
      form.appendChild(U.fld("text", "Deal name", nameIn, { id: "dl-name", required: true, full: true }));

      const coSel = companySelect(companies, rec ? rec.companyId : null, "dl-company");
      form.appendChild(U.fld("select", "Company", coSel, { id: "dl-company", hint: "Optional — stand-alone deals are allowed." }));
      let ctSel = contactSelect(contacts, rec ? rec.contactId : null, "dl-contact");
      form.appendChild(U.fld("select", "Contact", ctSel, { id: "dl-contact", hint: "Optional — the person championing the deal." }));
      coSel.addEventListener("change", () => { ctSel.value = ""; });

      const ownerIn = document.createElement("input");
      ownerIn.className = "inp";
      ownerIn.type = "text";
      ownerIn.setAttribute("list", "dl-owners");
      ownerIn.placeholder = "Who owns this deal?";
      ownerIn.value = (rec && rec.owner) || "";
      ownerIn.dataset.f = "owner";
      form.appendChild(U.fld("text", "Owner", ownerIn, { id: "dl-owner" }));
      const odl = el("datalist", null);
      odl.id = "dl-owners";
      const seen = {};
      (rec && rec.owner ? [rec.owner] : []).concat(["Me"]).forEach(o => {
        if (seen[o]) return;
        seen[o] = 1;
        const oo = document.createElement("option");
        oo.value = o;
        odl.appendChild(oo);
      });
      form.appendChild(odl);

      const valIn = document.createElement("input");
      valIn.className = "inp";
      valIn.type = "number";
      valIn.min = "0";
      valIn.step = "any";
      valIn.placeholder = "0";
      valIn.value = rec && rec.expectedValue !== undefined && rec.expectedValue !== null ? String(rec.expectedValue) : "";
      valIn.dataset.f = "expectedValue";
      form.appendChild(U.fld("number", "Expected value ($)", valIn, { id: "dl-value" }));

      const probIn = document.createElement("input");
      probIn.className = "inp";
      probIn.type = "number";
      probIn.min = "0";
      probIn.max = "100";
      probIn.step = "any";
      probIn.placeholder = "100";
      probIn.value = rec && rec.probability !== undefined && rec.probability !== null ? String(rec.probability) : "";
      probIn.dataset.f = "probability";
      form.appendChild(U.fld("number", "Probability (%)", probIn, { id: "dl-prob", hint: "Leave blank for 100% — used for the weighted forecast." }));

      const closeIn = document.createElement("input");
      closeIn.className = "inp";
      closeIn.type = "date";
      closeIn.value = (rec && rec.closeDate) || "";
      closeIn.dataset.f = "closeDate";
      form.appendChild(U.fld("date", "Expected close date", closeIn, { id: "dl-close" }));

      if (!isNew) {
        const stageInfo = el("div", "full");
        stageInfo.appendChild(U.fld("text", "Pipeline stage", el("span", "hint", "Currently “" + stageLabel(rec.stage) + "”. Move stages from the deal page so every change is timestamped."), { id: "dl-stage-ro" }));
        form.appendChild(stageInfo);
      }

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 4;
      notesIn.placeholder = "Context, goals and next steps for this deal…";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(U.fld("textarea", "Notes", notesIn, { id: "dl-notes", full: true }));

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create deal" : "Save changes";
      save.dataset.dlSave = "1";
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
          companyId: coSel.value,
          contactId: ctSel.value,
          owner: ownerIn.value,
          expectedValue: valIn.value,
          probability: probIn.value,
          closeDate: closeIn.value,
          notes: notesIn.value
        };
        const v = validate(raw);
        if (!v.ok) {
          Object.keys(v.errors).forEach(k => {
            const control = form.querySelector('[data-f="' + k + '"]');
            if (!control) return;
            control.classList.add("bad");
            const err = form.querySelector('[data-err-for="' + control.id + '"]');
            if (err) { err.textContent = v.errors[k]; err.hidden = false; }
          });
          return;
        }
        save.disabled = true;
        save.textContent = "Saving…";
        let savedId = null;
        const res = await R.persistUpdate(store, MOD, content => {
          if (!Array.isArray(content.pipeline ? content.pipeline.stages : null) || !content.pipeline.stages.length) {
            content.pipeline = pipeFrom(content);
          }
          remember(content);
          let base = rec;
          if (!isNew) {
            const fresh = R.getRecord(content, id);
            if (!fresh) return { changed: false };
            base = fresh;
          }
          const built = applyForm(base, v.values, { stage: isNew ? content.pipeline.stages[0].id : undefined });
          if (isNew && !Array.isArray(built.events)) built.events = [];
          if (isNew) {
            built.events = [{ kind: "create", at: built.createdAt, by: built.owner || null }];
            const createdLead = content;
            built.stage = createdLead.pipeline.stages[0].id;
            built.stageEnteredAt = built.createdAt;
          }
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
          window.CRM.toast(isNew ? "Deal created." : "Deal saved.");
          ctx.navigate("deals", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create deal" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "deals") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "deals"));
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

  function companySelect(companies, current, id) {
    const sel = document.createElement("select");
    sel.className = "sel";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— Standalone deal (no company) —";
    sel.appendChild(none);
    companies.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name || c.id;
      if (c.id === current) o.selected = true;
      sel.appendChild(o);
    });
    if (!current) sel.value = "";
    return sel;
  }

  function contactSelect(contacts, current, id) {
    const sel = document.createElement("select");
    sel.className = "sel";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— No contact yet —";
    sel.appendChild(none);
    contacts.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name || c.id;
      if (c.id === current) o.selected = true;
      sel.appendChild(o);
    });
    if (!current) sel.value = "";
    return sel;
  }

  async function renderSettings(ctx) {
    const store = ctx.store;
    if (!store) return Promise.resolve(storeErrorCard("The document store isn't ready yet. Try again in a moment."));
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The deals document could not be read.");
    remember(doc.content);
    const all = R.recordsOf(doc.content);
    const counts = {};
    all.forEach(r => {
      if (r && r.stage && (r.stage === WON || r.stage === LOST || plCache.stages.some(s => s.id === r.stage))) {
        counts[r.stage] = (counts[r.stage] || 0) + 1;
      }
    });

    const wrap = el("div", "cmp-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/deals";
    back.textContent = "← All deals";
    wrap.appendChild(back);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "Pipeline settings"));
    tBox.appendChild(el("p", "hint", "Open stages appear on the board in order. Rename freely — deals keep their stage by id. A stage that still holds deals cannot be removed."));
    tBox.querySelector(".hint").style.marginTop = "3px";
    titleRow.appendChild(tBox);
    card.appendChild(titleRow);

    const topMsg = el("div", "bkp-msg");
    topMsg.hidden = true;
    card.appendChild(topMsg);

    const form = el("div", "pl-form");
    form.dataset.dlPipeForm = "1";

    const openLabel = el("div", "pl-sect-label", "Open stages");
    form.appendChild(openLabel);
    const stageRows = el("div", "pl-rows");
    stageRows.dataset.dlStageRows = "1";
    form.appendChild(stageRows);

    let stageList = plCache.stages.map(s => ({ id: s.id, label: s.label }));

    function renderRows() {
      stageRows.innerHTML = "";
      stageList.forEach((s, i) => {
        const row = el("div", "pl-row");
        row.dataset.stageId = s.id;
        const order = el("div", "pl-order");
        const up = document.createElement("button");
        up.type = "button";
        up.className = "btn btn-ghost btn-sm pl-up";
        up.textContent = "↑";
        up.disabled = i === 0;
        up.title = "Move up";
        up.addEventListener("click", () => {
          if (i === 0) return;
          stageList.splice(i - 1, 0, stageList.splice(i, 1)[0]);
          renderRows();
        });
        const dn = document.createElement("button");
        dn.type = "button";
        dn.className = "btn btn-ghost btn-sm pl-dn";
        dn.textContent = "↓";
        dn.disabled = i === stageList.length - 1;
        dn.title = "Move down";
        dn.addEventListener("click", () => {
          if (i === stageList.length - 1) return;
          stageList.splice(i + 1, 0, stageList.splice(i, 1)[0]);
          renderRows();
        });
        order.appendChild(up);
        order.appendChild(dn);
        row.appendChild(order);
        const lab = document.createElement("input");
        lab.className = "inp";
        lab.type = "text";
        lab.maxLength = 60;
        lab.value = s.label;
        lab.dataset.f = "label";
        lab.addEventListener("input", () => { s.label = lab.value; });
        row.appendChild(lab);
        const count = counts[s.id] || 0;
        row.appendChild(el("span", "chip pl-count", count + " deal" + (count === 1 ? "" : "s")));
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-ghost btn-sm pl-del";
        del.textContent = "✕";
        del.title = "Remove stage";
        if (count > 0 || stageList.length === 1) {
          del.disabled = true;
          del.title = count > 0 ? "Move or close its deals first" : "At least one open stage is required";
        }
        del.addEventListener("click", () => {
          stageList = stageList.filter(x => x.id !== s.id);
          renderRows();
        });
        row.appendChild(del);
        stageRows.appendChild(row);
      });
    }

    const addRow = el("div", "pl-row pl-addrow");
    const addIn = document.createElement("input");
    addIn.className = "inp";
    addIn.type = "text";
    addIn.maxLength = 60;
    addIn.placeholder = "New stage name, e.g. Legal review";
    addIn.dataset.plAddIn = "1";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-ghost btn-sm";
    addBtn.textContent = "＋ Add stage";
    addBtn.dataset.plAdd = "1";
    addRow.appendChild(addIn);
    addRow.appendChild(addBtn);
    addBtn.addEventListener("click", () => {
      const name = addIn.value.trim();
      if (!name) return;
      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stage";
      let u = id;
      let n = 2;
      while (stageList.some(s => s.id === u) || u === WON || u === LOST) {
        u = id + "-" + n;
        n++;
      }
      stageList.push({ id: u, label: name });
      addIn.value = "";
      renderRows();
    });
    form.appendChild(addRow);

    const endLabel = el("div", "pl-sect-label", "Closing stages");
    form.appendChild(endLabel);
    const endRows = el("div", "pl-rows");
    const wonRow = endRow(WON, plCache.won.label, counts[WON] || 0);
    const lostRow = endRow(LOST, plCache.lost.label, counts[LOST] || 0);
    endRows.appendChild(wonRow.row);
    endRows.appendChild(lostRow.row);
    form.appendChild(endRows);

    function endRow(id, label, count) {
      const row = el("div", "pl-row");
      const lab = document.createElement("input");
      lab.className = "inp";
      lab.type = "text";
      lab.maxLength = 60;
      lab.value = label;
      lab.dataset.f = "endLabel";
      lab.addEventListener("input", () => { endLabels[id] = lab.value; });
      row.appendChild(lab);
      row.appendChild(el("span", "chip pl-count", count + " deal" + (count === 1 ? "" : "s")));
      const fix = el("span", "hint", id === WON ? "closed as won" : "closed as lost");
      fix.style.marginTop = "0";
      row.appendChild(fix);
      return { row };
    }

    const endLabels = { won: plCache.won.label, lost: plCache.lost.label };

    renderRows();

    const foot = el("div", "frm-foot");
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save pipeline";
    saveBtn.dataset.dlPipeSave = "1";
    saveBtn.addEventListener("click", async () => {
      const problems = [];
      stageList.forEach(s => {
        if (!s.label.trim()) problems.push("Every open stage needs a name.");
      });
      const wonL = endLabels.won.trim();
      const lostL = endLabels.lost.trim();
      if (!wonL) problems.push("The won stage needs a name.");
      if (!lostL) problems.push("The lost stage needs a name.");
      if (stageList.length < 1) problems.push("Keep at least one open stage.");
      if (problems.length) {
        topMsg.className = "bkp-msg err";
        topMsg.textContent = problems[0];
        topMsg.hidden = false;
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      const res = await savePipeline(store, {
        stages: stageList.map(s => ({ id: s.id, label: s.label.trim() })),
        won: { id: WON, label: wonL },
        lost: { id: LOST, label: lostL }
      }, { seedCounts: counts });
      if (res && res.ok) {
        window.CRM.toast("Pipeline saved.");
        ctx.navigate("deals", []);
        return;
      }
      saveBtn.disabled = false;
      saveBtn.textContent = "Save pipeline";
      topMsg.className = "bkp-msg " + (res && res.code === "stage_in_use" ? "warn" : "err");
      topMsg.textContent = (res && res.detail) || U.describeError(res, "deals");
      topMsg.hidden = false;
    });
    const cancel = document.createElement("a");
    cancel.className = "btn btn-ghost";
    cancel.href = "#/deals";
    cancel.textContent = "Cancel";
    foot.appendChild(saveBtn);
    foot.appendChild(cancel);
    form.appendChild(foot);
    card.appendChild(form);
    wrap.appendChild(card);
    return wrap;
  }

  function view(ctx) {
    const params = ctx.params || [];
    const p0 = params[0] || "";
    if (p0 === "new") return renderForm(ctx);
    if (p0 === "settings") return renderSettings(ctx);
    if (p0 === "company") return renderList(ctx, { companyId: params[1] || "" });
    if (["open", WON, LOST].indexOf(p0) !== -1) return renderList(ctx, { state: p0 });
    if (p0 && params[1] === "edit") return renderForm(ctx);
    if (p0) return renderDetail(ctx);
    return renderList(ctx, {});
  }

  window.CRM_BOOT_HOOKS = window.CRM_BOOT_HOOKS || [];
  window.CRM_BOOT_HOOKS.push(store => {
    store.loadDoc(MOD).then(doc => {
      if (doc && doc.content) remember(doc.content);
    }).catch(() => {});
  });

  return {
    MOD,
    WON,
    LOST,
    pipelineDefaults: pipeDefault,
    effectivePipelineOf: pipeFrom,
    remember,
    stageLabel,
    stageLabels,
    isOpenStage,
    stageFind,
    validate,
    applyForm,
    canDelete,
    weightedOf,
    expectedOf,
    probOf,
    changeStage,
    createDealFromLead,
    convertWonToCustomer,
    revertLeadOnDelete,
    savePipeline,
    view
  };
})();

window.CRM_RENDERERS.deals = function (ctx) {
  return window.CRM_DEALS.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
