window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_LEADS = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const MOD = "leads";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';

  const STATUSES = [
    { id: "new", label: "New", step: 0 },
    { id: "contacted", label: "Contacted", step: 1 },
    { id: "qualified", label: "Qualified", step: 2 },
    { id: "converted", label: "Converted", step: 3, terminal: true },
    { id: "disqualified", label: "Disqualified", step: -1, terminal: true }
  ];

  const SOURCES = ["Website", "Referral", "Idea incubator", "Event", "Trade show", "Cold call", "Social", "Outbound", "Other"];

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "new", label: "New" },
    { id: "contacted", label: "Contacted" },
    { id: "qualified", label: "Qualified" },
    { id: "converted", label: "Converted" },
    { id: "disqualified", label: "Disqualified" }
  ];

  function statusDef(id) {
    return STATUSES.find(s => s.id === id) || STATUSES[0];
  }
  function statusLabel(id) {
    return statusDef(id).label;
  }
  function statusBadgeClass(id) {
    const d = statusDef(id);
    if (d.terminal && id === "converted") return "badge customer";
    if (d.terminal) return "badge inactive";
    return id === "qualified" ? "badge ok" : "badge active";
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    const name = String(raw && raw.name || "").trim();
    if (!name) errors.name = "Lead name is required.";
    values.name = name;
    values.companyId = String(raw && raw.companyId || "").trim();
    values.contactId = String(raw && raw.contactId || "").trim();
    values.source = String(raw && raw.source || "").trim();
    values.owner = String(raw && raw.owner || "").trim();
    values.notes = String(raw && raw.notes || "").trim();
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function applyForm(base, values, opts) {
    opts = opts || {};
    const now = R.nowISO();
    const rec = Object.assign({}, base || {});
    const isNew = !rec.id;
    if (isNew) rec.id = R.newId(MOD);
    rec.name = values.name;
    rec.companyId = values.companyId || undefined;
    rec.contactId = values.contactId || undefined;
    rec.source = values.source || undefined;
    rec.owner = values.owner || undefined;
    rec.notes = values.notes || undefined;
    if (opts.status) {
      rec.status = opts.status;
      if (opts.status === "disqualified") {
        rec.disqualifiedAt = now;
        if (opts.reason) rec.disqualifyReason = opts.reason;
      }
      if (opts.status === "converted") {
        rec.convertedAt = now;
        if (opts.dealId) rec.convertedToDealId = opts.dealId;
      }
    }
    if (!isNew) rec.updatedAt = now;
    else rec.createdAt = now;
    return rec;
  }

  async function canDelete(store, id) {
    try {
      const refs = await R.findRefs(store, MOD, "leadId", id);
      return refs.length ? { allowed: false, refs } : { allowed: true, refs };
    } catch (e) {
      return { allowed: true, refs: [] };
    }
  }

  function setStatusRaw(content, recId, status, opts) {
    opts = opts || {};
    const rec = R.getRecord(content, recId);
    if (!rec) return { changed: false };
    const now = R.nowISO();
    const from = rec.status || "new";
    const to = status;
    const ev = { kind: "status", from, to, at: now };
    if (opts.note) ev.note = opts.note;
    if (opts.reason) ev.reason = opts.reason;
    rec.status = to;
    if (!Array.isArray(rec.events)) rec.events = [];
    rec.events.push(ev);
    if (to === "disqualified") {
      rec.disqualifiedAt = now;
      if (opts.reason) rec.disqualifyReason = opts.reason;
      else delete rec.disqualifyReason;
    }
    if (to === "converted") {
      rec.convertedAt = now;
      if (opts.dealId) rec.convertedToDealId = opts.dealId;
    }
    if (to !== "disqualified") delete rec.disqualifiedAt;
    if (from === "disqualified" && to !== "converted") {
      delete rec.disqualifyReason;
    }
    rec.updatedAt = now;
    return { changed: true, content };
  }

  async function setLeadStatus(store, leadId, status, opts) {
    const out = await R.persistUpdate(store, MOD, content => setStatusRaw(content, leadId, status, opts), { events: opts && opts.silent === true });
    return out;
  }

  async function convertToDeal(store, lead, opts) {
    opts = opts || {};
    if (!lead || lead.status !== "qualified") return { ok: false, code: "not_qualified", detail: "Only a qualified lead can be converted to a deal." };
    const dealsMod = window.CRM_DEALS;
    if (!dealsMod || typeof dealsMod.createDealFromLead !== "function") return { ok: false, code: "deals_unavailable", detail: "The deals module is not loaded yet." };
    const res = await dealsMod.createDealFromLead(store, lead, opts);
    if (!res || !res.ok) return res;
    const leadRes = await setLeadStatus(store, lead.id, "converted", { dealId: res.dealId });
    if (!leadRes.ok) {
      return { ok: false, code: "lead_update_failed", detail: "The deal was created, but the lead could not be marked converted: " + (leadRes.detail || leadRes.code || "unknown error"), dealId: res.dealId };
    }
    return { ok: true, dealId: res.dealId, leadId: lead.id };
  }

  async function companyMap(store) {
    const m = new Map();
    try {
      const doc = await store.loadDoc("companies");
      for (const r of (doc && doc.content && doc.content.records) || []) m.set(r.id, r);
    } catch (e) {}
    return m;
  }

  async function contactMap(store) {
    const m = new Map();
    try {
      const doc = await store.loadDoc("contacts");
      for (const r of (doc && doc.content && doc.content.records) || []) m.set(r.id, r);
    } catch (e) {}
    return m;
  }

  function subtitleOf(rec, cmap, ctmap) {
    const parts = [];
    if (rec.source) parts.push(rec.source);
    if (rec.companyId) {
      const c = cmap.get(rec.companyId);
      parts.push(c ? c.name : "missing company");
    }
    if (rec.contactId) {
      const ct = ctmap.get(rec.contactId);
      parts.push(ct ? ct.name : "missing contact");
    }
    return parts.join(" · ");
  }

  function segPredicate(rec, seg) {
    if (seg === "all") return true;
    const s = rec.status || "new";
    if (seg === "disqualified") return s === "disqualified";
    if (seg === "converted") return s === "converted";
    return s === seg;
  }

  function statusBanner(store) {
    return U.statusBannerCard(store, MOD, "Leads");
  }

  function storeErrorCard(message) {
    return U.storeCard(MOD, { detail: message });
  }

  function notFoundCard(what) {
    return U.notFoundCard({ icon: ICON, title: "Lead not found", what, backHref: "#/leads", backLabel: "Back to all leads" });
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return Promise.resolve(storeErrorCard("The document store isn't ready yet. Try again in a moment."));
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The leads document could not be read.");
    const all = R.recordsOf(doc.content);
    const [cmap, ctmap] = await Promise.all([companyMap(store), contactMap(store)]);

    const wrap = el("div", "cmp-view");
    const banner = await statusBanner(store);
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    titleRow.appendChild(el("h2", null, "All leads"));
    const chip = U.chip(all.length, "lead", "leads");
    chip.dataset.ldCount = "1";
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by name, company, contact, owner, source…";
    search.dataset.ldQ = "1";
    const segBox = el("div", "seg-row");
    let quickSegs = el("div", "seg");
    quickSegs.dataset.ldFilt = "1";
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
    let activeSaved = null;
    const segCtl = window.CRM_SEGMENTS ? window.CRM_SEGMENTS.savedSegControl(store, MOD, { onPick: seg => { activeSaved = seg; repaint(); } }) : el("span");
    savedWrap.appendChild(segCtl);
    const add = document.createElement("a");
    add.className = "btn btn-primary btn-sm";
    add.href = "#/leads/new";
    add.textContent = "＋ Add lead";
    add.dataset.ldAdd = "1";
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

    function matching() {
      let recs = R.filterRecords(all, q);
      recs = recs.filter(r => {
        if (activeSaved && window.CRM_SEGMENTS) return window.CRM_SEGMENTS.segMatches(activeSaved, r, null);
        return segPredicate(r, quickChoice);
      });
      const order = { converted: 4, disqualified: 5, qualified: 3, contacted: 2, new: 1 };
      return recs.slice().sort((a, b) => {
        const k = (order[a.status || "new"] || 0) - (order[b.status || "new"] || 0);
        if (k) return k;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " lead" + (rows.length === 1 ? "" : "s");
      listBox.innerHTML = "";
      if (!all.length) {
        listBox.appendChild(U.listStateEmpty(ICON, "No leads yet", "Incoming opportunities — from your website, referrals or the idea-incubator — flow from first contact through to qualification here.", "#/leads/new", "＋ Add lead"));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(U.listStateNone(q ? `No leads match “${q}”.` : activeSaved ? `No leads match the “${activeSaved.name}” segment.` : "No leads in this view."));
        return;
      }
      rows.forEach(rec => {
        const row = document.createElement("a");
        row.className = "rec-row";
        row.href = "#/leads/" + encodeURIComponent(rec.id);
        row.dataset.cid = rec.id;
        row.dataset.ldRow = "1";
        const av = el("span", "rec-av", U.initials(rec.name));
        const main = el("span", "rec-main");
        const line1 = el("span", "rec-line1");
        line1.appendChild(el("span", "rec-name", rec.name || "(unnamed lead)"));
        const sb = statusDef(rec.status || "new");
        if (sb.terminal) line1.appendChild(el("span", statusBadgeClass(rec.status || "new"), sb.label));
        else line1.appendChild(el("span", "badge ok", sb.label));
        if (rec.owner) line1.appendChild(el("span", "badge owner", rec.owner));
        main.appendChild(line1);
        const sub = subtitleOf(rec, cmap, ctmap);
        if (sub) main.appendChild(el("span", "rec-sub", sub));
        const side = el("span", "rec-side");
        const when = rec.createdAt ? "added " + R.timeAgo(rec.createdAt) : "";
        if (when) side.appendChild(el("span", "rec-when", when));
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
    if (!store) return storeErrorCard("The document store isn't ready yet. Try again in a moment.");
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The leads document could not be read.");
    const rec = R.getRecord(doc.content, id);
    if (!rec) return notFoundCard("No lead with id “" + (id || "") + "” exists in this document.");
    const [cmap, ctmap] = await Promise.all([companyMap(store), contactMap(store)]);
    const company = rec.companyId ? cmap.get(rec.companyId) : null;
    const contact = rec.contactId ? ctmap.get(rec.contactId) : null;
    const del = await canDelete(store, rec.id);
    const dealId = rec.convertedToDealId || null;
    let dealRec = null;
    if (dealId) {
      try {
        const dd = await store.loadDoc("deals");
        dealRec = R.getRecord(dd.content, dealId);
      } catch (e) {}
    }

    const wrap = el("div", "cmp-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/leads";
    back.textContent = "← All leads";
    wrap.appendChild(back);

    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", U.initials(rec.name));
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.name || "(unnamed lead)"));
    const badges = el("span", "detail-badges");
    const st = rec.status || "new";
    badges.appendChild(el("span", statusBadgeClass(st), statusLabel(st)));
    if (rec.source) badges.appendChild(el("span", "badge", rec.source));
    if (rec.owner) badges.appendChild(el("span", "badge owner", rec.owner));
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
    logAct.href = "#/activities/log/leads/" + encodeURIComponent(rec.id);
    logAct.textContent = "＋ Log";
    logAct.title = "Record a call, meeting, email, note or task for this lead";
    logAct.dataset.ldLog = "1";
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/leads/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit lead";
    edit.dataset.ldEdit = "1";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.ldDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — keep or archive it instead.";
    }
    acts.appendChild(logAct);
    if (rec.contactId) {
      const emailAct = document.createElement("a");
      emailAct.className = "btn btn-ghost btn-sm";
      emailAct.href = "#/emails/compose/contact/" + encodeURIComponent(rec.contactId);
      emailAct.textContent = "✉ Email";
      emailAct.dataset.ldEmail = "1";
      acts.appendChild(emailAct);
    }
    acts.appendChild(edit);
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Details"));
    const items = [];
    items.push({ label: "Status", v: el("span", statusBadgeClass(st), statusLabel(st)) });
    if (rec.source) items.push({ label: "Source", v: rec.source });
    if (rec.owner) items.push({ label: "Owner", v: rec.owner });
    if (company) {
      const a = document.createElement("a");
      a.href = "#/companies/" + encodeURIComponent(company.id);
      a.textContent = company.name;
      items.push({ label: "Company", v: a });
    } else if (rec.companyId) {
      items.push({ label: "Company", v: String(rec.companyId) + " (missing record)" });
    } else {
      items.push({ label: "Company", v: el("span", "muted", "Standalone lead") });
    }
    if (contact) {
      const a = document.createElement("a");
      a.href = "#/contacts/" + encodeURIComponent(contact.id);
      a.textContent = contact.name;
      items.push({ label: "Contact", v: a });
    } else if (rec.contactId) {
      items.push({ label: "Contact", v: String(rec.contactId) + " (missing record)" });
    }
    if (rec.disqualifiedAt) {
      items.push({ label: "Disqualified", v: R.fmtDate(rec.disqualifiedAt) + (rec.disqualifyReason ? " — " + rec.disqualifyReason : "") });
    }
    if (dealRec) {
      const a = document.createElement("a");
      a.href = "#/deals/" + encodeURIComponent(dealRec.id);
      a.textContent = dealRec.name || dealRec.id;
      items.push({ label: "Converted to deal", v: a });
    }
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

    wrap.appendChild(workflowCard(store, rec, { onDone: () => { if (window.CRM.rerender) window.CRM.rerender(); }, msg }));
    wrap.appendChild(await window.CRM_SUGGEST.card(store, rec, {}));
    wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope: { leadId: rec.id }, title: "Timeline", hintText: "Calls, emails, meetings, notes, tasks and status changes for this lead, newest first." }));

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    const relNote = el("p", "hint", "Deals converted from this lead reference it by id, so the link survives renames.");
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
      relBody.appendChild(el("p", "hint muted-line", "No records reference this lead yet."));
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
      if (!window.confirm("Delete this lead? This cannot be undone.")) return;
      const res = await R.persistUpdate(store, MOD, content => {
        const out = R.removeRecord(content, id);
        return out.removed ? { changed: true, content } : { changed: false };
      });
      if (res && res.ok) {
        window.CRM.toast("Lead deleted.");
        ctx.navigate("leads", []);
        return;
      }
      showMsg("err", "Could not delete the lead. " + (U.describeError(res, "leads") || ""));
    });

    return wrap;
  }

  function historyCard(rec) {
    const card = el("section", "card");
    card.appendChild(el("h2", null, "Lead history"));
    const evs = (Array.isArray(rec.events) ? rec.events : []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const body = el("div", "rel-list");
    if (!evs.length) {
      body.appendChild(el("p", "hint muted-line", "No status changes yet — this lead is still “" + statusLabel(rec.status || "new") + "”."));
    } else {
      evs.forEach(ev => {
        const line = el("div", "rel-line");
        const name = el("span", "rel-name", statusLabel(ev.from) + " → " + statusLabel(ev.to));
        line.appendChild(name);
        if (ev.note) {
          const note = el("span", "rel-sub", ev.note);
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
    const st = rec.status || "new";
    const def = statusDef(st);
    if (def.terminal) {
      const info = el("p", "hint", st === "converted"
        ? "This lead has been converted into a deal. Re-opening it would detach that link."
        : "This lead is closed. Reopen it to bring it back into the active pipeline.");
      card.appendChild(info);
      if (st === "disqualified") {
        const row = el("div", "wf-actions");
        const reopen = document.createElement("button");
        reopen.type = "button";
        reopen.className = "btn btn-ghost btn-sm";
        reopen.textContent = "Reopen lead";
        reopen.addEventListener("click", async () => {
          const res = await setLeadStatus(store, rec.id, "new", {});
          if (res && res.ok) { window.CRM.toast("Lead reopened as “new”."); if (window.CRM.rerender) window.CRM.rerender(); }
        });
        row.appendChild(reopen);
        card.appendChild(row);
      }
      return card;
    }
    const body = el("div", "wf-body");
    const noteIn = document.createElement("input");
    noteIn.className = "inp";
    noteIn.type = "text";
    noteIn.placeholder = "Optional note recorded with the next action…";
    noteIn.maxLength = 300;
    noteIn.dataset.ldNote = "1";
    body.appendChild(U.fld("text", "Note", noteIn, { id: "ld-note", full: true }));
    const row = el("div", "wf-actions");
    const nexts = [];
    if (st === "new") nexts.push({ id: "contacted", label: "✓ Mark contacted", primary: false });
    if (st === "contacted") nexts.push({ id: "qualified", label: "☆ Mark qualified", primary: false });
    if (st === "qualified") nexts.push({ id: "convert", label: "→ Convert to deal…", primary: true });
    nexts.push({ id: "disqualify", label: "✕ Disqualify", primary: false, danger: true });
    function doStatus(status) {
      return async () => {
        const note = noteIn.value.trim();
        if (status === "disqualify") {
          card.appendChild(disqualifyBox(store, rec.id, note, opts));
          return;
        }
        const res = await setLeadStatus(store, rec.id, status, { note });
        if (res && res.ok) {
          window.CRM.toast("Lead marked “" + statusLabel(status) + "”.");
          if (opts.onDone) opts.onDone();
        } else if (opts.msg) {
          opts.msg.className = "bkp-msg err";
          opts.msg.textContent = "Could not update the lead. " + (U.describeError(res, "leads") || "");
          opts.msg.hidden = false;
        }
      };
    }
    nexts.forEach(n => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (n.primary ? "btn-primary" : n.danger ? "btn-danger" : "btn-ghost") + " btn-sm";
      b.textContent = n.label;
      if (n.id === "convert") {
        b.addEventListener("click", async () => {
          const res = await window.CRM_LEADS.convertToDeal(store, rec, { note: noteIn.value.trim() });
          if (res && res.ok) {
            window.CRM.toast("Lead converted to a deal.");
            ctxNavigateDeal(res.dealId);
            return;
          }
          if (opts.msg) {
            opts.msg.className = "bkp-msg " + (res && res.code === "not_qualified" ? "warn" : "err");
            opts.msg.textContent = res && res.detail ? res.detail : "Conversion failed.";
            opts.msg.hidden = false;
          }
        });
      } else {
        b.addEventListener("click", doStatus(n.id));
      }
      row.appendChild(b);
    });
    body.appendChild(row);
    card.appendChild(body);
    return card;
  }

  function ctxNavigateDeal(dealId) {
    if (dealId) {
      location.hash = "#/deals/" + encodeURIComponent(dealId);
    } else if (window.CRM && window.CRM.rerender) {
      window.CRM.rerender();
    }
  }

  function disqualifyBox(store, leadId, note, opts) {
    const box = el("div", "wf-disq");
    const lab = el("label", "fld");
    lab.appendChild(el("span", "k", "Reason for disqualification"));
    const sel = document.createElement("select");
    sel.className = "sel";
    const REASONS = ["Not a fit", "Budget", "Timing", "No response", "Went with another provider", "Duplicate", "Other"];
    REASONS.forEach(rr => {
      const o = document.createElement("option");
      o.value = rr;
      o.textContent = rr;
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
    const hint = el("p", "hint", "Disqualifying records the reason and timestamp; you can reopen the lead later.");
    box.appendChild(hint);
    const row = el("div", "wf-actions");
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn-danger btn-sm";
    go.textContent = "Confirm disqualify";
    go.addEventListener("click", async () => {
      const reason = other.value.trim() || sel.value;
      const res = await setLeadStatus(store, leadId, "disqualified", { reason, note });
      if (res && res.ok) {
        window.CRM.toast("Lead disqualified.");
        if (opts.onDone) opts.onDone();
      }
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-ghost btn-sm";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => box.remove());
    row.appendChild(go);
    row.appendChild(cancel);
    box.appendChild(row);
    return box;
  }

  async function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    if (!store) return Promise.resolve(storeErrorCard("The document store isn't ready yet. Try again in a moment."));

    return store.loadDoc(MOD, { refresh: true }).then(async doc => {
      if (!doc || doc.ok === false) return storeErrorCard((doc && doc.detail) || "The leads document could not be read.");
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return notFoundCard("No lead with id “" + (id || "") + "” exists in this document.");
      const [companies, contacts] = await Promise.all([loadNamed(store, "companies"), loadNamed(store, "contacts")]);

      const wrap = el("div", "cmp-view");
      const backHref = isNew ? "#/leads" : "#/leads/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← All leads" : "← Back to " + (rec.name || "lead");
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New lead" : "Edit lead"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);

      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.ldForm = "1";

      const nameIn = document.createElement("input");
      nameIn.className = "inp";
      nameIn.type = "text";
      nameIn.maxLength = 160;
      nameIn.placeholder = "e.g. Northwind wants a pilot";
      nameIn.value = (rec && rec.name) || "";
      nameIn.dataset.f = "name";
      form.appendChild(U.fld("text", "Lead name", nameIn, { id: "ld-name", required: true, full: true }));

      const srcIn = document.createElement("input");
      srcIn.className = "inp";
      srcIn.type = "text";
      srcIn.setAttribute("list", "ld-sources");
      srcIn.placeholder = "Pick or type a source";
      srcIn.value = (rec && rec.source) || "";
      srcIn.dataset.f = "source";
      form.appendChild(U.fld("text", "Source", srcIn, { id: "ld-source" }));
      const dl = el("datalist", null);
      dl.id = "ld-sources";
      SOURCES.forEach(s => {
        const o = document.createElement("option");
        o.value = s;
        dl.appendChild(o);
      });
      form.appendChild(dl);

      const coSel = companySelect(companies, rec ? rec.companyId : null, "ld-company");
      form.appendChild(U.fld("select", "Company", coSel, { id: "ld-company", hint: "Optional — link the lead to an existing company." }));
      coSel.addEventListener("change", () => { ctSel.value = ""; });

      const ctSel = contactSelect(contacts, rec ? rec.contactId : null, "ld-contact");
      form.appendChild(U.fld("select", "Contact", ctSel, { id: "ld-contact", hint: "Optional — the person behind the lead." }));

      const ownerIn = document.createElement("input");
      ownerIn.className = "inp";
      ownerIn.type = "text";
      ownerIn.setAttribute("list", "ld-owners");
      ownerIn.placeholder = "Who owns this lead?";
      ownerIn.value = (rec && rec.owner) || "";
      ownerIn.dataset.f = "owner";
      form.appendChild(U.fld("text", "Owner", ownerIn, { id: "ld-owner" }));
      const odl = el("datalist", null);
      odl.id = "ld-owners";
      (rec && rec.owner ? [rec.owner] : []).concat(["Me"]).forEach(o => {
        const oo = document.createElement("option");
        oo.value = o;
        odl.appendChild(oo);
      });
      form.appendChild(odl);

      const notesIn = document.createElement("textarea");
      notesIn.className = "txa";
      notesIn.rows = 4;
      notesIn.placeholder = "Context, goals and next steps for this lead…";
      notesIn.value = (rec && rec.notes) || "";
      notesIn.dataset.f = "notes";
      form.appendChild(U.fld("textarea", "Notes", notesIn, { id: "ld-notes", full: true }));

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create lead" : "Save changes";
      save.dataset.ldSave = "1";
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
        if (err) { err.textContent = text; err.hidden = false; }
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
          source: srcIn.value,
          companyId: coSel.value,
          contactId: ctSel.value,
          owner: ownerIn.value,
          notes: notesIn.value
        };
        const v = validate(raw);
        if (!v.ok) {
          Object.keys(v.errors).forEach(k => fieldErr(k, v.errors[k]));
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
          const built = applyForm(base, v.values, { status: isNew ? "new" : undefined });
          if (isNew) {
            built.status = "new";
            built.events = [{ kind: "status", from: "", to: "new", at: built.createdAt, by: built.owner || null }];
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
          window.CRM.toast(isNew ? "Lead created." : "Lead saved.");
          ctx.navigate("leads", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create lead" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "leads") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "leads"));
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

  function loadNamed(store, module) {
    return store.loadDoc(module).then(doc => (doc && doc.content && Array.isArray(doc.content.records) ? doc.content.records : [])).catch(() => []);
  }

  function companySelect(companies, current, id) {
    const sel = document.createElement("select");
    sel.className = "sel";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— Standalone lead (no company) —";
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

  function view(ctx) {
    const params = ctx.params || [];
    if (params[0] === "new") return renderForm(ctx);
    if (params[0] && params[1] === "edit") return renderForm(ctx);
    if (params[0]) return renderDetail(ctx);
    return renderList(ctx);
  }

  return { MOD, validate, applyForm, canDelete, setLeadStatus, convertToDeal, view, STATUSES, statusLabel, statusDef };
})();

window.CRM_RENDERERS.leads = function (ctx) {
  return window.CRM_LEADS.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
