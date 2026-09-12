window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_TICKETS = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const D = window.CRM_DOMAIN;
  const MOD = "tickets";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/></svg>';

  const FILTERS = [
    { id: "open", label: "Open" },
    { id: "all", label: "All" },
    { id: "overdue", label: "Overdue" },
    { id: "unassigned", label: "Unassigned" },
    { id: "resolved", label: "Resolved" },
    { id: "closed", label: "Closed" }
  ];

  function stampOf(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function newJournalId() {
    return "tj-" + (window.BcrmStore && window.BcrmStore.randHex ? window.BcrmStore.randHex(6) : Math.floor(Math.random() * 0xffffff).toString(16));
  }

  function ticketLabel(rec) {
    if (!rec) return "";
    return rec.subject || rec.name || (rec.id !== undefined ? "ticket " + rec.id : "");
  }

  function validate(raw) {
    const errors = {};
    const values = {};
    const subject = String(raw && raw.subject || "").trim();
    if (!subject) errors.subject = "Give the ticket a short subject — what is wrong or requested.";
    values.subject = subject;

    const companyId = String(raw && raw.companyId || "").trim();
    if (!companyId) errors.companyId = "Every ticket belongs to an account. Pick one.";
    values.companyId = companyId;
    values.contactId = String(raw && raw.contactId || "").trim();
    values.serviceId = String(raw && raw.serviceId || "").trim();
    values.siteId = String(raw && raw.siteId || "").trim();
    values.assetId = String(raw && raw.assetId || "").trim();

    const category = (raw && raw.category) || "incident";
    values.category = D.TICKET_CATEGORIES.some(c => c.id === category) ? category : "incident";
    const priority = (raw && raw.priority) || "medium";
    values.priority = D.TICKET_PRIORITIES.some(p => p.id === priority) ? priority : "medium";
    const status = (raw && raw.status) || "new";
    values.status = D.TICKET_STATUSES.some(s => s.id === status) ? status : "new";
    const source = (raw && raw.source) || "phone";
    values.source = D.TICKET_SOURCES.some(s => s.id === source) ? source : "phone";

    values.assignee = String(raw && raw.assignee || "").trim();

    const openedAt = stampOf(raw && raw.openedAt);
    if (raw && raw.openedAt && !openedAt) errors.openedAt = "Use a valid date and time.";
    values.openedAt = openedAt;
    const dueAt = stampOf(raw && raw.dueAt);
    if (raw && raw.dueAt && !dueAt) errors.dueAt = "Use a valid date and time.";
    values.dueAt = dueAt;

    values.description = String(raw && raw.description || "").trim();
    values.tags = R.parseTags(raw && raw.tags);
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function applyForm(base, values, opts) {
    opts = opts || {};
    const rec = Object.assign({}, base || {});
    const now = R.nowISO();
    const isNew = rec.id === undefined;
    if (isNew) rec.id = R.newId(MOD);
    rec.subject = values.subject;
    const setOrDel = (key, v) => {
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) delete rec[key];
      else rec[key] = v;
    };
    rec.companyId = values.companyId;
    setOrDel("contactId", values.contactId);
    setOrDel("serviceId", values.serviceId);
    setOrDel("siteId", values.siteId);
    setOrDel("assetId", values.assetId);
    rec.category = values.category || "incident";
    rec.priority = values.priority || "medium";
    setOrDel("source", values.source);
    setOrDel("assignee", values.assignee);
    rec.openedAt = values.openedAt || rec.openedAt || now;
    setOrDel("dueAt", values.dueAt);
    setOrDel("description", values.description);
    setOrDel("tags", values.tags);
    if (isNew) {
      rec.status = values.status || "new";
      rec.journal = [Object.assign(journalEntry("created", "Ticket opened."), { at: rec.openedAt, by: opts.by || "You" })];
      if (rec.status !== "new") rec.status = "new";
    } else if (values.status && values.status !== rec.status) {
      setStatus(rec, values.status, { by: opts.by });
    }
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    return rec;
  }

  function journalEntry(kind, text, extra) {
    return Object.assign({ id: newJournalId(), at: R.nowISO(), by: "You", kind, text: text || "" }, extra || {});
  }

  function pushJournal(rec, entry) {
    if (!Array.isArray(rec.journal)) rec.journal = [];
    rec.journal.push(entry);
  }

  function setStatus(rec, next, opts) {
    opts = opts || {};
    if (!rec) return { ok: false, code: "no_record" };
    if (!D.TICKET_STATUSES.some(s => s.id === next)) return { ok: false, code: "bad_status" };
    const from = rec.status || "new";
    if (from === next) return { ok: false, code: "noop" };
    const now = R.nowISO();
    const by = opts.by || "You";
    pushJournal(rec, journalEntry("status", opts.note || ("Status changed from " + D.ticketStatusLabel(from) + " to " + D.ticketStatusLabel(next) + "."), { at: now, by, from, to: next }));
    rec.status = next;
    if (next !== "new" && !rec.firstResponseAt) rec.firstResponseAt = now;
    if (next === "resolved") {
      if (!rec.resolvedAt) rec.resolvedAt = now;
      delete rec.closedAt;
    } else if (next === "closed") {
      if (!rec.resolvedAt) rec.resolvedAt = now;
      rec.closedAt = now;
    } else {
      delete rec.resolvedAt;
      delete rec.closedAt;
    }
    rec.updatedAt = now;
    return { ok: true, from, to: next };
  }

  function setPriority(rec, next, opts) {
    opts = opts || {};
    if (!rec) return { ok: false, code: "no_record" };
    if (!D.TICKET_PRIORITIES.some(p => p.id === next)) return { ok: false, code: "bad_priority" };
    const from = rec.priority || "medium";
    if (from === next) return { ok: false, code: "noop" };
    const now = R.nowISO();
    pushJournal(rec, journalEntry("priority", "Priority changed from " + D.ticketPriorityLabel(from) + " to " + D.ticketPriorityLabel(next) + ".", { at: now, by: opts.by || "You", from, to: next }));
    rec.priority = next;
    rec.updatedAt = now;
    return { ok: true, from, to: next };
  }

  function assign(rec, who, opts) {
    opts = opts || {};
    if (!rec) return { ok: false, code: "no_record" };
    const next = String(who || "").trim();
    const from = String(rec.assignee || "").trim();
    if (from === next) return { ok: false, code: "noop" };
    const now = R.nowISO();
    pushJournal(rec, journalEntry("assign", next ? "Assigned to " + next + "." : "Unassigned.", { at: now, by: opts.by || "You", from, to: next }));
    if (next) rec.assignee = next;
    else delete rec.assignee;
    rec.updatedAt = now;
    return { ok: true, from, to: next };
  }

  function addComment(rec, text, opts) {
    opts = opts || {};
    if (!rec) return { ok: false, code: "no_record" };
    const body = String(text || "").trim();
    if (!body) return { ok: false, code: "empty" };
    const now = R.nowISO();
    pushJournal(rec, journalEntry("comment", body, { at: now, by: opts.by || "You" }));
    if (!rec.firstResponseAt) rec.firstResponseAt = now;
    rec.updatedAt = now;
    return { ok: true };
  }

  function slaBadge(t, nowMs) {
    const s = D.ticketSlaState(t, nowMs);
    if (s.state === "closed") {
      if (s.resolveMet === true) return { cls: "ok", text: "SLA met" };
      if (s.resolveMet === false) return { cls: "danger", text: "SLA breached" };
      return { cls: "inactive", text: "Closed" };
    }
    if (s.state === "overdue") return { cls: "danger", text: "SLA overdue" };
    if (s.state === "response-overdue") return { cls: "prio-me", text: "Response due" };
    if (s.state === "due-soon") return { cls: "prio-me", text: "Due soon" };
    return { cls: "ok", text: "On track" };
  }

  function slaMinutesText(mins) {
    if (mins === null || mins === undefined) return "";
    const m = Math.round(mins);
    const abs = Math.abs(m);
    let t;
    if (abs < 60) t = abs + "m";
    else if (abs < 60 * 48) t = Math.floor(abs / 60) + "h " + (abs % 60) + "m";
    else t = Math.round(abs / 1440) + "d";
    return (m < 0 ? "overdue by " : "in ") + t;
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
    const refs = await R.findRefs(store, MOD, "ticketId", id);
    return refs.length ? { allowed: false, refs } : { allowed: true, refs };
  }

  function isOverdue(t) {
    const s = D.ticketSlaState(t);
    return s.state === "overdue" || s.state === "response-overdue";
  }

  function segPredicate(rec, seg) {
    if (seg === "open") return D.isTicketOpen(rec);
    if (seg === "overdue") return D.isTicketOpen(rec) && isOverdue(rec);
    if (seg === "unassigned") return D.isTicketOpen(rec) && !rec.assignee;
    if (seg === "resolved") return rec.status === "resolved";
    if (seg === "closed") return rec.status === "closed";
    return true;
  }

  function sortTickets(recs) {
    const rank = t => (D.isTicketOpen(t) ? 0 : 1);
    const prank = t => {
      const i = D.TICKET_PRIORITIES.findIndex(p => p.id === (t.priority || "medium"));
      return i < 0 ? 99 : i;
    };
    return recs.slice().sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d) return d;
      const p = prank(a) - prank(b);
      if (p) return p;
      const am = D.parseMs(a.openedAt || a.createdAt) || 0;
      const bm = D.parseMs(b.openedAt || b.createdAt) || 0;
      return bm - am;
    });
  }

  function priorityBadgeEl(id) {
    return el("span", "badge " + D.ticketPriorityBadge(id), D.ticketPriorityShort(id));
  }

  async function renderList(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard("tickets", { detail: "The document store isn't ready yet." });
    const params = ctx.params || [];
    let scope = null;
    if (params[0] && params[0] !== "new" && ["company", "service", "site", "asset", "contact"].indexOf(params[0]) !== -1) {
      scope = { kind: params[0], id: params[1] };
    }
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("tickets", doc);
    let all = R.recordsOf(doc.content).slice();
    const cmap = await moduleMap(store, "companies");
    const smap = await moduleMap(store, "sites");
    let scopeName = "";
    if (scope) {
      const key = scope.kind === "asset" ? "assetId" : scope.kind + "Id";
      all = all.filter(t => String(t[key]) === String(scope.id));
      const mm = scope.kind === "company" ? cmap : scope.kind === "site" ? smap : null;
      const nm = mm && mm.get(scope.id);
      scopeName = (nm && nm.name) || scope.id;
    }
    const wrap = el("div", "tkt-view");
    const banner = await U.statusBannerCard(store, MOD, "tickets");
    if (banner) wrap.appendChild(banner);

    const card = el("section", "card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, scope ? "Tickets — " + scopeName : "Service desk"));
    const hint = el("p", "hint", scope
      ? "Every ticket raised against this " + scope.kind + ", with its SLA clock."
      : "Incidents, service requests, changes and maintenance — with priority-based SLA targets, assignment and a running journal on each ticket.");
    hint.style.marginTop = "3px";
    tBox.appendChild(hint);
    titleRow.appendChild(tBox);
    const chip = U.chip(all.length, "ticket", "tickets");
    titleRow.appendChild(chip);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Search by subject, account, assignee, tag…";
    search.dataset.tktQ = "1";
    const segBox = el("div", "seg-row");
    const quickSegs = el("div", "seg");
    quickSegs.dataset.tktFilt = "1";
    const segBtns = {};
    FILTERS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.label;
      b.dataset.filt = f.id;
      if (f.id === (scope ? "all" : "open")) b.classList.add("on");
      segBtns[f.id] = b;
      quickSegs.appendChild(b);
    });
    const savedWrap = el("span");
    const segCtl = window.CRM_SEGMENTS.savedSegControl(store, MOD, { onPick: seg => { activeSaved = seg; repaint(); } });
    savedWrap.appendChild(segCtl);
    const add = document.createElement("a");
    add.className = "btn btn-primary btn-sm";
    let addHref = "#/tickets/new";
    if (scope) addHref += "/" + scope.kind + "/" + encodeURIComponent(scope.id);
    add.href = addHref;
    add.textContent = "＋ New ticket";
    add.dataset.tktAdd = "1";
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
    let quickChoice = scope ? "all" : "open";
    let activeSaved = null;

    function matching() {
      let recs = R.filterRecords(all, q);
      recs = recs.filter(r => activeSaved ? window.CRM_SEGMENTS.segMatches(activeSaved, r, null) : segPredicate(r, quickChoice));
      return sortTickets(recs);
    }

    function repaint() {
      const rows = matching();
      chip.textContent = rows.length + " ticket" + (rows.length === 1 ? "" : "s");
      listBox.innerHTML = "";
      if (!all.length) {
        listBox.appendChild(U.listStateEmpty(ICON, scope ? "No tickets here yet" : "No tickets yet", scope ? "Raise a ticket against this record and it will appear here with its SLA clock." : "Log incidents, requests and changes as they come in — each gets a priority-based SLA target, an assignee and a journal you can add to as it progresses.", addHref, "＋ New ticket"));
        return;
      }
      if (!rows.length) {
        listBox.appendChild(U.listStateNone(q ? `No tickets match “${q}”.` : activeSaved ? `No tickets match the “${activeSaved.name}” segment.` : "No tickets in this view."));
        return;
      }
      rows.forEach(rec => {
        const row = document.createElement("a");
        row.className = "rec-row" + (D.isTicketOpen(rec) ? "" : " inactive");
        row.href = "#/tickets/" + encodeURIComponent(rec.id);
        row.dataset.tktid = rec.id;
        const av = el("span", "rec-av", D.ticketPriorityShort(rec.priority));
        const main = el("span", "rec-main");
        const line1 = el("span", "rec-line1");
        line1.appendChild(el("span", "rec-name", rec.subject || "(untitled ticket)"));
        line1.appendChild(el("span", "badge " + D.ticketStatusBadge(rec.status), D.ticketStatusLabel(rec.status)));
        if (D.isTicketOpen(rec)) {
          const sb = slaBadge(rec);
          line1.appendChild(el("span", "badge " + sb.cls, sb.text));
        }
        main.appendChild(line1);
        const co = rec.companyId && cmap.get(rec.companyId);
        const site = rec.siteId && smap.get(rec.siteId);
        const subs = [D.ticketCategoryLabel(rec.category), D.ticketPriorityShort(rec.priority)];
        if (co) subs.push(co.name);
        if (site) subs.push(site.name);
        if (rec.assignee) subs.push("→ " + rec.assignee);
        main.appendChild(el("span", "rec-sub", subs.join(" · ")));
        const side = el("span", "rec-side");
        if (D.isTicketOpen(rec)) {
          const s = D.ticketSlaState(rec);
          if (s.resolveMinutesLeft !== null) side.appendChild(el("span", "tkt-sla", slaMinutesText(s.resolveMinutesLeft)));
        } else if (rec.resolvedAt) {
          side.appendChild(el("span", "tkt-sla muted", "resolved " + R.timeAgo(rec.resolvedAt)));
        }
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
    if (!store) return U.storeCard("tickets", { detail: "The document store isn't ready yet." });
    const doc = await store.loadDoc(MOD, { refresh: true });
    if (!doc || doc.ok === false) return U.storeCard("tickets", doc);
    const rec = R.getRecord(doc.content, id);
    if (!rec) return U.notFoundCard({ icon: ICON, title: "Ticket not found", what: "No ticket with id “" + (id || "") + "” exists in this document.", backHref: "#/tickets", backLabel: "Back to the service desk" });
    const cmap = await moduleMap(store, "companies");
    const ctmap = await moduleMap(store, "contacts");
    const svmap = await moduleMap(store, "services");
    const smap = await moduleMap(store, "sites");
    const amap = await moduleMap(store, "assets");
    const company = rec.companyId ? cmap.get(rec.companyId) : null;
    const contact = rec.contactId ? ctmap.get(rec.contactId) : null;
    const service = rec.serviceId ? svmap.get(rec.serviceId) : null;
    const site = rec.siteId ? smap.get(rec.siteId) : null;
    const asset = rec.assetId ? amap.get(rec.assetId) : null;
    const refs = await R.findRefs(store, MOD, "ticketId", rec.id);
    const del = await canDelete(store, rec.id);

    const wrap = el("div", "tkt-view");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/tickets";
    back.textContent = "← Service desk";
    wrap.appendChild(back);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    wrap.appendChild(msg);

    const head = el("section", "card");
    const hRow = el("div", "detail-head");
    const av = el("span", "rec-av lg", D.ticketPriorityShort(rec.priority));
    const t = el("div", "detail-t");
    t.appendChild(el("h2", null, rec.subject || "(untitled ticket)"));
    const badges = el("span", "detail-badges");
    badges.appendChild(el("span", "badge owner", D.ticketCategoryLabel(rec.category)));
    badges.appendChild(priorityBadgeEl(rec.priority));
    badges.appendChild(el("span", "badge " + D.ticketStatusBadge(rec.status), D.ticketStatusLabel(rec.status)));
    const sb = slaBadge(rec);
    badges.appendChild(el("span", "badge " + sb.cls, sb.text));
    badges.appendChild(el("span", "badge id", "record " + rec.id));
    t.appendChild(badges);
    const meta = el("p", "detail-meta");
    const sstate = D.ticketSlaState(rec);
    const bits = [];
    if (company) bits.push(company.name);
    if (D.isTicketOpen(rec) && sstate.resolveMinutesLeft !== null) bits.push("SLA " + slaMinutesText(sstate.resolveMinutesLeft));
    else if (rec.resolvedAt) bits.push(sstate.resolveMet === true ? "resolved within SLA" : sstate.resolveMet === false ? "resolved after SLA" : "resolved");
    bits.push(rec.assignee ? "assigned to " + rec.assignee : "unassigned");
    bits.push("opened " + (R.fmtStamp(rec.openedAt) || R.timeAgo(rec.createdAt)));
    meta.textContent = bits.join(" · ");
    t.appendChild(meta);
    const acts = el("div", "detail-acts");
    const edit = document.createElement("a");
    edit.className = "btn btn-ghost btn-sm";
    edit.href = "#/tickets/" + encodeURIComponent(rec.id) + "/edit";
    edit.textContent = "Edit ticket";
    edit.dataset.tktEdit = "1";
    acts.appendChild(edit);
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Delete";
    delBtn.dataset.tktDel = "1";
    if (!del.allowed) {
      delBtn.disabled = true;
      delBtn.title = "Referenced by other records — close the ticket instead.";
    }
    acts.appendChild(delBtn);
    hRow.appendChild(av);
    hRow.appendChild(t);
    hRow.appendChild(acts);
    head.appendChild(hRow);
    wrap.appendChild(head);

    const flow = el("section", "card");
    flow.appendChild(el("h2", null, "Workflow"));
    const frow = el("div", "tkt-flow");
    const stSel = document.createElement("select");
    stSel.className = "sel";
    stSel.dataset.f = "status";
    D.TICKET_STATUSES.forEach(s => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.label;
      stSel.appendChild(o);
    });
    stSel.value = rec.status || "new";
    const stBtn = document.createElement("button");
    stBtn.type = "button";
    stBtn.className = "btn btn-primary btn-sm";
    stBtn.textContent = "Update status";
    stBtn.dataset.tktSetStatus = "1";
    const prSel = document.createElement("select");
    prSel.className = "sel";
    prSel.dataset.f = "priority";
    D.TICKET_PRIORITIES.forEach(p => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.label;
      prSel.appendChild(o);
    });
    prSel.value = rec.priority || "medium";
    const prBtn = document.createElement("button");
    prBtn.type = "button";
    prBtn.className = "btn btn-ghost btn-sm";
    prBtn.textContent = "Set priority";
    prBtn.dataset.tktSetPriority = "1";
    const asIn = document.createElement("input");
    asIn.className = "inp";
    asIn.type = "text";
    asIn.maxLength = 80;
    asIn.placeholder = "Assign to…";
    asIn.value = rec.assignee || "";
    asIn.dataset.f = "assignee";
    const asBtn = document.createElement("button");
    asBtn.type = "button";
    asBtn.className = "btn btn-ghost btn-sm";
    asBtn.textContent = "Assign";
    asBtn.dataset.tktAssign = "1";
    frow.appendChild(U.fld("select", "Status", stSel, { id: "tk-status" }));
    frow.appendChild(U.fld("static", "", stBtn, { id: "tk-status-btn" }));
    frow.appendChild(U.fld("select", "Priority", prSel, { id: "tk-priority" }));
    frow.appendChild(U.fld("static", "", prBtn, { id: "tk-priority-btn" }));
    frow.appendChild(U.fld("text", "Assignee", asIn, { id: "tk-assignee" }));
    frow.appendChild(U.fld("static", "", asBtn, { id: "tk-assign-btn" }));
    flow.appendChild(frow);
    wrap.appendChild(flow);

    const slaCard = el("section", "card");
    slaCard.appendChild(el("h2", null, "SLA"));
    const sla = D.ticketSla(rec);
    const slaItems = [
      { label: "Priority", v: D.ticketPriorityLabel(rec.priority) },
      { label: "First response target", v: sla.responseTargetMin + " min" },
      { label: "Resolution target", v: sla.resolveTargetMin + " min (" + Math.round(sla.resolveTargetMin / 60) + "h)" },
      { label: "First response due", v: sla.responseDueAt ? R.fmtStamp(sla.responseDueAt) : "—" },
      { label: "Resolve by", v: sla.resolveDueAt ? R.fmtStamp(sla.resolveDueAt) : "—" }
    ];
    if (rec.firstResponseAt) slaItems.push({ label: "First response at", v: R.fmtStamp(rec.firstResponseAt) + (sla.responseDueAt && rec.firstResponseAt <= sla.responseDueAt ? " · within SLA" : sla.responseDueAt ? " · late" : "") });
    if (rec.resolvedAt) slaItems.push({ label: "Resolved at", v: R.fmtStamp(rec.resolvedAt) + (sstate.resolveMet === true ? " · within SLA" : sstate.resolveMet === false ? " · after SLA" : "") });
    if (rec.closedAt) slaItems.push({ label: "Closed at", v: R.fmtStamp(rec.closedAt) });
    slaCard.appendChild(U.dlist(slaItems));
    slaCard.appendChild(el("p", "hint", "SLA targets default from priority; set explicit targets on the ticket to override them."));
    wrap.appendChild(slaCard);

    const grid = el("section", "card");
    grid.appendChild(el("h2", null, "Ticket details"));
    const items = [];
    if (company) {
      const a = document.createElement("a");
      a.href = "#/companies/" + encodeURIComponent(company.id);
      a.textContent = company.name;
      items.push({ label: "Account", v: a });
    } else if (rec.companyId) {
      items.push({ label: "Account", v: String(rec.companyId) + " (missing record)" });
    }
    const refRow = (label, obj, href) => {
      if (!obj) {
        if (rec[href.key]) items.push({ label: label, v: String(rec[href.key]) + " (missing record)" });
        return;
      }
      const a = document.createElement("a");
      a.href = href.make(obj.id);
      a.textContent = obj.name || obj.subject || obj.id;
      items.push({ label: label, v: a });
    };
    refRow("Contact", contact, { key: "contactId", make: i => "#/contacts/" + encodeURIComponent(i) });
    refRow("Service", service, { key: "serviceId", make: i => "#/services/" + encodeURIComponent(i) });
    refRow("Site", site, { key: "siteId", make: i => "#/sites/" + encodeURIComponent(i) });
    if (asset) {
      const a = document.createElement("a");
      a.href = "#/assets/" + encodeURIComponent(asset.id);
      a.textContent = window.CRM_ASSETS ? window.CRM_ASSETS.assetName(asset) : (asset.name || asset.identifier || asset.id);
      items.push({ label: "Asset", v: a });
    } else if (rec.assetId) {
      items.push({ label: "Asset", v: String(rec.assetId) + " (missing record)" });
    }
    items.push({ label: "Category", v: D.ticketCategoryLabel(rec.category) });
    items.push({ label: "Priority", v: D.ticketPriorityLabel(rec.priority) });
    items.push({ label: "Status", v: D.ticketStatusLabel(rec.status) });
    const src = D.TICKET_SOURCES.find(s => s.id === rec.source);
    if (src) items.push({ label: "Source", v: src.label });
    items.push({ label: "Assignee", v: rec.assignee || "Unassigned" });
    items.push({ label: "Opened", v: R.fmtStamp(rec.openedAt) || R.fmtStamp(rec.createdAt) });
    if (Array.isArray(rec.tags) && rec.tags.length) items.push({ label: "Tags", v: U.tagsChips(rec.tags, 10) });
    items.push({ label: "Record id", v: rec.id });
    grid.appendChild(U.dlist(items));
    if (rec.description) {
      grid.appendChild(el("h2", null, "Description"));
      grid.appendChild(el("div", "notes-box", rec.description));
    }
    wrap.appendChild(grid);

    const jCard = el("section", "card");
    jCard.appendChild(el("h2", null, "Journal"));
    const jList = el("div", "tkt-journal");
    (Array.isArray(rec.journal) ? rec.journal : []).slice().sort((a, b) => (D.parseMs(a.at) || 0) - (D.parseMs(b.at) || 0)).forEach(j => {
      const row = el("div", "tkt-jrow tkt-j-" + j.kind);
      const meta2 = el("div", "tkt-jmeta");
      meta2.appendChild(el("span", "tkt-jby", j.by || "—"));
      meta2.appendChild(el("span", "tkt-jat", R.fmtStamp(j.at) || ""));
      meta2.appendChild(el("span", "tkt-jkind", j.kind));
      row.appendChild(meta2);
      row.appendChild(el("div", "tkt-jtext", j.text || ""));
      jList.appendChild(row);
    });
    if (!jList.children.length) jList.appendChild(el("p", "hint muted-line", "No journal entries yet."));
    jCard.appendChild(jList);
    const addWrap = el("div", "tkt-add");
    const ta = document.createElement("textarea");
    ta.className = "txa";
    ta.rows = 3;
    ta.placeholder = "Add an update — what you did, what you found, what is next…";
    ta.dataset.tktComment = "1";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-primary btn-sm";
    addBtn.textContent = "Add update";
    addBtn.dataset.tktAddComment = "1";
    addWrap.appendChild(ta);
    addWrap.appendChild(addBtn);
    jCard.appendChild(addWrap);
    wrap.appendChild(jCard);

    const rel = el("section", "card");
    rel.appendChild(el("h2", null, "Relationships"));
    const relBody = el("div", "rel-list");
    if (refs.length) {
      refs.forEach(ref => {
        const line = el("div", "rel-line");
        line.appendChild(el("span", "rel-name", R.moduleLabel(ref.module) + " · " + (ref.name || "(unnamed record)")));
        if (ref.id !== undefined) line.appendChild(el("span", "mono rel-id", "#" + ref.id));
        relBody.appendChild(line);
      });
    } else {
      relBody.appendChild(el("p", "hint muted-line", "No other records reference this ticket yet."));
    }
    rel.appendChild(relBody);
    wrap.appendChild(rel);

    function showMsg(kind, text) {
      msg.className = "bkp-msg " + kind;
      msg.textContent = text;
      msg.hidden = false;
      msg.scrollIntoView({ block: "nearest" });
    }
    function busy(on) {
      [stBtn, prBtn, asBtn, addBtn].forEach(b => { b.disabled = on; });
      delBtn.disabled = on || !del.allowed;
    }
    async function save(mutate, okMsg) {
      busy(true);
      const res = await R.persistUpdate(store, MOD, content => {
        const r = R.getRecord(content, rec.id);
        if (!r) return { changed: false };
        const out = mutate(r);
        if (!out || !out.ok) return { changed: false, code: out && out.code };
        return { changed: true, content };
      });
      if (res && res.ok) {
        if (res.noop) { busy(false); return; }
        window.CRM.toast(okMsg);
        if (ctx.rerender) ctx.rerender();
      } else {
        showMsg("err", U.describeError(res, "tickets"));
        busy(false);
      }
    }

    stBtn.addEventListener("click", () => save(r => setStatus(r, stSel.value), "Ticket status updated."));
    prBtn.addEventListener("click", () => save(r => setPriority(r, prSel.value), "Ticket priority updated."));
    asBtn.addEventListener("click", () => save(r => assign(r, asIn.value), "Ticket assignment updated."));
    addBtn.addEventListener("click", () => {
      if (!ta.value.trim()) { showMsg("warn", "Type an update first."); return; }
      save(r => addComment(r, ta.value), "Update added.");
    });

    let confirmDel = false;
    delBtn.addEventListener("click", async () => {
      const allowed = await canDelete(store, rec.id);
      if (!allowed.allowed) {
        showMsg("err", "This ticket is referenced by other records — close it instead of deleting.");
        return;
      }
      if (!confirmDel) {
        confirmDel = true;
        delBtn.textContent = "Confirm delete";
        delBtn.classList.add("armed");
        setTimeout(() => {
          if (confirmDel) { confirmDel = false; delBtn.textContent = "Delete"; delBtn.classList.remove("armed"); }
        }, 4000);
        return;
      }
      confirmDel = false;
      busy(true);
      const res = await R.persistUpdate(store, MOD, content => {
        const gone = R.removeRecord(content, rec.id);
        return { changed: gone.removed, content };
      });
      if (res && res.ok) {
        window.CRM.toast("Ticket deleted.");
        ctx.navigate("tickets");
      } else {
        showMsg("err", U.describeError(res, "tickets"));
        busy(false);
        delBtn.textContent = "Delete";
        delBtn.classList.remove("armed");
      }
    });

    if (company) wrap.appendChild(await window.CRM_TIMELINE.card({ store, scope: { companyId: company.id }, title: "Account timeline", hintText: "Calls, emails, meetings, notes, tasks and pipeline events for the account this ticket belongs to." }));

    return wrap;
  }

  function renderForm(ctx) {
    const store = ctx.store;
    const params = ctx.params || [];
    const isNew = params[0] === "new";
    const id = isNew ? null : params[0];
    const prefill = isNew && ["company", "service", "site", "asset", "contact"].indexOf(params[1]) !== -1 ? { kind: params[1], id: params[2] } : null;
    if (!store) return Promise.resolve(U.storeCard("tickets", { detail: "The document store isn't ready yet." }));
    return Promise.all([store.loadDoc(MOD, { refresh: true }), moduleMap(store, "companies"), moduleMap(store, "sites"), moduleMap(store, "services"), moduleMap(store, "assets"), moduleMap(store, "contacts")]).then(res => {
      const doc = res[0];
      const cmap = res[1];
      const smap = res[2];
      const svmap = res[3];
      const amap = res[4];
      const ctmap = res[5];
      if (!doc || doc.ok === false) return U.storeCard("tickets", doc);
      const rec = isNew ? null : R.getRecord(doc.content, id);
      if (!isNew && !rec) return U.notFoundCard({ icon: ICON, title: "Ticket not found", what: "No ticket with id “" + (id || "") + "” exists in this document.", backHref: "#/tickets", backLabel: "Back to the service desk" });

      const preset = Object.assign({}, rec || {});
      if (prefill) {
        if (prefill.kind === "company") preset.companyId = prefill.id;
        if (prefill.kind === "contact") { preset.contactId = prefill.id; const c = ctmap.get(prefill.id); if (c && c.companyId) preset.companyId = c.companyId; }
        if (prefill.kind === "service") { preset.serviceId = prefill.id; const s = svmap.get(prefill.id); if (s) { if (s.companyId) preset.companyId = s.companyId; if (s.siteId) preset.siteId = s.siteId; } }
        if (prefill.kind === "site") { preset.siteId = prefill.id; const s = smap.get(prefill.id); if (s && s.companyId) preset.companyId = s.companyId; }
        if (prefill.kind === "asset") { preset.assetId = prefill.id; const a = amap.get(prefill.id); if (a) { if (a.companyId) preset.companyId = a.companyId; if (a.siteId) preset.siteId = a.siteId; if (a.serviceId) preset.serviceId = a.serviceId; const kindMap = { did: "incident", circuit: "incident", cpe: "incident", sim: "incident" }; if (kindMap[a.kind]) preset.category = kindMap[a.kind]; } }
      }

      const wrap = el("div", "tkt-view");
      const backHref = isNew ? "#/tickets" : "#/tickets/" + encodeURIComponent(rec.id);
      const back = document.createElement("a");
      back.className = "backlink";
      back.href = backHref;
      back.textContent = isNew ? "← Service desk" : "← Back to ticket";
      wrap.appendChild(back);

      const card = el("section", "card");
      const titleRow = el("div", "card-title-row");
      titleRow.appendChild(el("h2", null, isNew ? "New ticket" : "Edit ticket"));
      if (!isNew) titleRow.appendChild(el("span", "chip", "record " + rec.id));
      card.appendChild(titleRow);
      const topMsg = el("div", "bkp-msg");
      topMsg.hidden = true;
      card.appendChild(topMsg);

      const form = el("form", "frm");
      form.setAttribute("novalidate", "");
      form.dataset.tktForm = "1";

      const subjIn = document.createElement("input");
      subjIn.className = "inp";
      subjIn.type = "text";
      subjIn.maxLength = 160;
      subjIn.placeholder = "e.g. Fibre circuit down — Grindelwald branch";
      subjIn.value = preset.subject || "";
      subjIn.dataset.f = "subject";
      form.appendChild(U.fld("text", "Subject", subjIn, { id: "tk-subject", required: true, full: true }));

      const coSel = document.createElement("select");
      coSel.className = "sel";
      coSel.dataset.f = "companyId";
      form.appendChild(U.fld("select", "Account", coSel, { id: "tk-company", required: true }));

      const ctSel = document.createElement("select");
      ctSel.className = "sel";
      ctSel.dataset.f = "contactId";
      form.appendChild(U.fld("select", "Contact", ctSel, { id: "tk-contact" }));

      const svcSel = document.createElement("select");
      svcSel.className = "sel";
      svcSel.dataset.f = "serviceId";
      form.appendChild(U.fld("select", "Service", svcSel, { id: "tk-service" }));

      const siteSel = document.createElement("select");
      siteSel.className = "sel";
      siteSel.dataset.f = "siteId";
      form.appendChild(U.fld("select", "Site", siteSel, { id: "tk-site" }));

      const assetSel = document.createElement("select");
      assetSel.className = "sel";
      assetSel.dataset.f = "assetId";
      form.appendChild(U.fld("select", "Asset", assetSel, { id: "tk-asset" }));

      const catSel = document.createElement("select");
      catSel.className = "sel";
      catSel.dataset.f = "category";
      D.TICKET_CATEGORIES.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.label; catSel.appendChild(o); });
      catSel.value = preset.category || "incident";
      form.appendChild(U.fld("select", "Category", catSel, { id: "tk-cat" }));

      const prSel = document.createElement("select");
      prSel.className = "sel";
      prSel.dataset.f = "priority";
      D.TICKET_PRIORITIES.forEach(p => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.label + " · " + p.responseMin + "m response / " + Math.round(p.resolveMin / 60) + "h resolve"; prSel.appendChild(o); });
      prSel.value = preset.priority || "medium";
      form.appendChild(U.fld("select", "Priority", prSel, { id: "tk-priority", hint: "Sets the default SLA targets." }));

      const stSel = document.createElement("select");
      stSel.className = "sel";
      stSel.dataset.f = "status";
      D.TICKET_STATUSES.forEach(s => { const o = document.createElement("option"); o.value = s.id; o.textContent = s.label; stSel.appendChild(o); });
      stSel.value = preset.status || "new";
      if (isNew) stSel.disabled = true;
      form.appendChild(U.fld("select", "Status", stSel, { id: "tk-status", hint: isNew ? "New tickets start as New — update status from the ticket page." : "Changing this journals the transition." }));

      const srcSel = document.createElement("select");
      srcSel.className = "sel";
      srcSel.dataset.f = "source";
      D.TICKET_SOURCES.forEach(s => { const o = document.createElement("option"); o.value = s.id; o.textContent = s.label; srcSel.appendChild(o); });
      srcSel.value = preset.source || "phone";
      form.appendChild(U.fld("select", "Source", srcSel, { id: "tk-source" }));

      const asIn = document.createElement("input");
      asIn.className = "inp";
      asIn.type = "text";
      asIn.maxLength = 80;
      asIn.placeholder = "Who is working on it";
      asIn.value = preset.assignee || "";
      asIn.dataset.f = "assignee";
      form.appendChild(U.fld("text", "Assignee", asIn, { id: "tk-assignee" }));

      const openIn = document.createElement("input");
      openIn.className = "inp";
      openIn.type = "datetime-local";
      openIn.value = preset.openedAt ? toLocalInput(preset.openedAt) : (isNew ? toLocalInput(R.nowISO()) : "");
      openIn.dataset.f = "openedAt";
      form.appendChild(U.fld("datetime-local", "Opened at", openIn, { id: "tk-opened" }));

      const dueIn = document.createElement("input");
      dueIn.className = "inp";
      dueIn.type = "datetime-local";
      dueIn.value = preset.dueAt ? toLocalInput(preset.dueAt) : "";
      dueIn.dataset.f = "dueAt";
      form.appendChild(U.fld("datetime-local", "Resolve-by override", dueIn, { id: "tk-due", hint: "Optional — defaults to opened + the priority's resolution target." }));

      const descIn = document.createElement("textarea");
      descIn.className = "txa";
      descIn.rows = 5;
      descIn.placeholder = "What the customer reported, what you know so far, steps to reproduce…";
      descIn.value = preset.description || "";
      descIn.dataset.f = "description";
      form.appendChild(U.fld("textarea", "Description", descIn, { id: "tk-desc", full: true }));

      const tagsIn = document.createElement("input");
      tagsIn.className = "inp";
      tagsIn.type = "text";
      tagsIn.placeholder = "e.g. outage, fibre, site-visit";
      tagsIn.value = (preset.tags || []).join(", ");
      tagsIn.dataset.f = "tags";
      form.appendChild(U.fld("text", "Tags", tagsIn, { id: "tk-tags", full: true }));

      function opt(sel, value, label) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        sel.appendChild(o);
        return o;
      }

      function fill() {
        coSel.innerHTML = "";
        opt(coSel, "", "— Select an account —");
        Array.from(cmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => opt(coSel, c.id, c.name + (c.isCustomer ? " ★" : "")));
        coSel.value = preset.companyId || "";
        refreshDependent();
      }

      function refreshDependent() {
        const co = coSel.value;
        const keep = { contactId: ctSel.value || preset.contactId || "", serviceId: svcSel.value || preset.serviceId || "", siteId: siteSel.value || preset.siteId || "", assetId: assetSel.value || preset.assetId || "" };
        ctSel.innerHTML = ""; opt(ctSel, "", "— No contact —");
        Array.from(ctmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(c => { if (co && c.companyId && c.companyId !== co) return; opt(ctSel, c.id, c.name + (cmap.get(c.companyId) ? " — " + cmap.get(c.companyId).name : "")); });
        svcSel.innerHTML = ""; opt(svcSel, "", "— No service —");
        Array.from(svmap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(s => { if (co && s.companyId && s.companyId !== co) return; opt(svcSel, s.id, s.name + " — " + D.categoryShort(s.category)); });
        siteSel.innerHTML = ""; opt(siteSel, "", "— No site —");
        Array.from(smap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(s => { if (co && s.companyId && s.companyId !== co) return; opt(siteSel, s.id, s.name); });
        assetSel.innerHTML = ""; opt(assetSel, "", "— No asset —");
        Array.from(amap.values()).sort((a, b) => String((window.CRM_ASSETS ? window.CRM_ASSETS.assetName(a) : a.name || a.identifier)).localeCompare(String(window.CRM_ASSETS ? window.CRM_ASSETS.assetName(b) : b.name || b.identifier))).forEach(a => { if (co && a.companyId && a.companyId !== co) return; opt(assetSel, a.id, (window.CRM_ASSETS ? window.CRM_ASSETS.assetName(a) : a.name || a.identifier)); });
        [["contactId", ctSel], ["serviceId", svcSel], ["siteId", siteSel], ["assetId", assetSel]].forEach(pair => {
          const sel = pair[1];
          if (Array.from(sel.options).some(o => o.value === keep[pair[0]])) sel.value = keep[pair[0]];
        });
      }

      fill();
      coSel.addEventListener("change", refreshDependent);

      const foot = el("div", "frm-foot full");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary";
      save.textContent = isNew ? "Create ticket" : "Save changes";
      save.dataset.tktSave = "1";
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
          subject: subjIn.value,
          companyId: coSel.value,
          contactId: ctSel.value,
          serviceId: svcSel.value,
          siteId: siteSel.value,
          assetId: assetSel.value,
          category: catSel.value,
          priority: prSel.value,
          status: stSel.disabled ? (preset.status || "new") : stSel.value,
          source: srcSel.value,
          assignee: asIn.value,
          openedAt: openIn.value,
          dueAt: dueIn.value,
          description: descIn.value,
          tags: tagsIn.value
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
          window.CRM.toast(isNew ? "Ticket created." : "Ticket saved.");
          ctx.navigate("tickets", [savedId]);
          return;
        }
        save.disabled = false;
        save.textContent = isNew ? "Create ticket" : "Save changes";
        if (res && res.code === "server_lag") {
          showErr("warn", U.describeError(res, "tickets") + " Press Save again to retry.");
          return;
        }
        showErr("err", U.describeError(res, "tickets"));
      });

      return wrap;
    });
  }

  function view(ctx) {
    const params = ctx.params || [];
    if (params[0] === "new") return renderForm(ctx);
    if (params[0] && params[1] === "edit") return renderForm(ctx);
    if (params[0] && ["company", "service", "site", "asset", "contact"].indexOf(params[0]) !== -1) return renderList(ctx);
    if (params[0]) return renderDetail(ctx);
    return renderList(ctx);
  }

  async function listCard(store, filter, opts) {
    opts = opts || {};
    try {
      const doc = await store.loadDoc(MOD);
      if (!doc || doc.ok === false) return null;
      let recs = R.recordsOf(doc.content).slice();
      const key = filter.companyId ? "companyId" : filter.serviceId ? "serviceId" : filter.siteId ? "siteId" : filter.assetId ? "assetId" : filter.contactId ? "contactId" : null;
      if (key) recs = recs.filter(t => String(t[key]) === String(filter[key]));
      if (opts.openOnly !== false) recs = recs.filter(t => D.isTicketOpen(t));
      recs = sortTickets(recs);
      const card = el("section", "card");
      const tr = el("div", "card-title-row");
      tr.appendChild(el("h2", null, opts.title || "Tickets"));
      const addHref = key ? "#/tickets/new/" + key.replace(/Id$/, "") + "/" + encodeURIComponent(filter[key]) : "#/tickets/new";
      const a = document.createElement("a");
      a.className = "btn btn-ghost btn-sm";
      a.href = addHref;
      a.textContent = "＋ New ticket";
      tr.appendChild(a);
      card.appendChild(tr);
      if (!recs.length) {
        card.appendChild(el("p", "hint muted-line", opts.emptyText || "No open tickets."));
      } else {
        const list = el("div", "link-list");
        recs.slice(0, opts.limit || 6).forEach(t => {
          const row = document.createElement("a");
          row.className = "link-row";
          row.href = "#/tickets/" + encodeURIComponent(t.id);
          const main = el("span", "link-main");
          main.appendChild(el("span", "link-name", t.subject || "(untitled ticket)"));
          const s = D.ticketSlaState(t);
          const bits = [D.ticketPriorityShort(t.priority), D.ticketStatusLabel(t.status)];
          if (s.resolveMinutesLeft !== null) bits.push("SLA " + slaMinutesText(s.resolveMinutesLeft));
          if (t.assignee) bits.push("→ " + t.assignee);
          main.appendChild(el("span", "link-sub", bits.join(" · ")));
          row.appendChild(main);
          const sb2 = slaBadge(t);
          row.appendChild(el("span", "badge " + sb2.cls, sb2.text));
          list.appendChild(row);
        });
        card.appendChild(list);
      }
      return { el: card, records: recs };
    } catch (e) {
      console.error("tickets list card failed:", e);
      return null;
    }
  }

  async function dashboardCard(store) {
    try {
      const doc = await store.loadDoc(MOD);
      if (!doc || doc.ok === false) return null;
      const recs = R.recordsOf(doc.content);
      const s = D.summarizeTickets(recs);
      const card = el("section", "card dash-kpis");
      card.dataset.dashTickets = "1";
      const kpi = (href, v, label, sub, cls) => `<a class="kpi-card ${cls || ""}" href="${href}"><span class="kpi-v">${v}</span><span class="kpi-l">${label}</span><span class="kpi-s">${sub}</span></a>`;
      card.innerHTML = `
        <div class="card-title-row">
          <div>
            <h2>Service desk</h2>
            <p class="hint" style="margin:2px 0 0">Open tickets, SLA pressure and who is carrying the load across every account.</p>
          </div>
          <a class="btn btn-ghost btn-sm" href="#/tickets" data-tkt-open>Open service desk</a>
        </div>
        <div class="kpi-grid">
          ${kpi("#/tickets", s.open, "Open tickets", s.count + " in total")}
          ${kpi("#/tickets/overdue", s.overdue, "SLA overdue", s.overdue === 1 ? "ticket past its SLA" : "tickets past SLA", s.overdue ? "danger" : "")}
          ${kpi("#/tickets/unassigned", s.unassigned, "Unassigned", "open, nobody on it")}
          ${kpi("#/tickets/resolved", s.resolved, "Resolved", "awaiting close")}
        </div>`;
      return card;
    } catch (e) {
      console.error("tickets dashboard card failed:", e);
      return null;
    }
  }

  return {
    MOD,
    validate,
    applyForm,
    canDelete,
    setStatus,
    setPriority,
    assign,
    addComment,
    slaBadge,
    ticketLabel,
    recordsWhere,
    listCard,
    dashboardCard,
    view,
    FILTERS
  };
})();

window.CRM_RENDERERS.tickets = function (ctx) {
  return window.CRM_TICKETS.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
