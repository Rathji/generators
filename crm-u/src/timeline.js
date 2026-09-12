window.CRM_TIMELINE = (function () {
  const R = window.CRM_RECORDS;
  if (!R) return null;
  const U = window.RECORDUI;

  const TYPES = [
    { id: "call", label: "Call" },
    { id: "email", label: "Email" },
    { id: "meeting", label: "Meeting" },
    { id: "note", label: "Note" },
    { id: "task", label: "Task" }
  ];
  const TYPE_MAP = {};
  TYPES.forEach(t => { TYPE_MAP[t.id] = t; });

  function typeLabel(t) {
    return TYPE_MAP[t] ? TYPE_MAP[t].label : String(t || "activity");
  }
  function typeIcon(t) {
    const map = { call: "C", email: "@", meeting: "M", note: "N", task: "☑" };
    return map[t] || "•";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function loadContent(store, module) {
    try {
      const doc = await store.loadDoc(module);
      return (doc && doc.content) || { records: [] };
    } catch (e) {
      return { records: [] };
    }
  }

  function activityMatchesScope(rec, scope) {
    if (!scope) return true;
    if (scope.companyId && rec.companyId === scope.companyId) return true;
    if (scope.contactId && rec.contactId === scope.contactId) return true;
    if (scope.dealId && rec.dealId === scope.dealId) return true;
    if (scope.leadId && rec.leadId === scope.leadId) return true;
    return false;
  }

  function contactCompaniesOfCompany(contactsContent, companyId) {
    const out = new Set();
    const recs = (contactsContent && contactsContent.records) || [];
    for (const c of recs) {
      if (c && c.companyId === companyId) out.add(c.id);
    }
    return out;
  }

  function eventText(ev, labeler) {
    if (ev.kind === "stage" || ev.kind === "status") {
      const from = labeler ? labeler(ev.from) : ev.from;
      const to = labeler ? labeler(ev.to) : ev.to;
      return (from ? from + " → " : "") + (to || String(ev.kind));
    }
    if (ev.kind === "create") return ev.leadId ? "Created from lead" : "Created";
    if (ev.kind === "customer") return "Company marked as customer";
    if (ev.kind === "note") return "Note added";
    return String(ev.kind || "event");
  }

  function itemEventLabel(module, ev, stageLabeler) {
    if (module === "deals") {
      if (ev.kind === "stage") return { g: "stage", text: eventText(ev, stageLabeler) };
      if (ev.kind === "create") return { g: "stage", text: eventText(ev) };
      if (ev.kind === "customer") return { g: "stage", text: eventText(ev) };
      return { g: "stage", text: eventText(ev) };
    }
    if (module === "leads") {
      const L = window.CRM_LEADS;
      if (ev.kind === "status") return { g: "status", text: eventText(ev, v => L ? L.statusLabel(v) : v) };
      return { g: "status", text: eventText(ev) };
    }
    return { g: "event", text: eventText(ev) };
  }

  function stageLabelerFor(dealsContent) {
    const map = {};
    const D = window.CRM_DEALS;
    const pl = D && D.effectivePipelineOf ? D.effectivePipelineOf(dealsContent) : null;
    if (pl) {
      const add = s => { if (s && s.id) map[s.id] = s.label || s.id; };
      (pl.stages || []).forEach(add);
      add(pl.won);
      add(pl.lost);
    }
    return v => (Object.prototype.hasOwnProperty.call(map, v) ? map[v] : String(v || ""));
  }

  function refLabelFor(module, r) {
    if (r && r.name) return { module, id: r.id, name: r.name };
    if (r && r.subject) return { module, id: r.id, name: r.subject };
    return null;
  }

  async function collect(store, scope) {
    scope = scope || {};
    const activitiesContent = await loadContent(store, "activities");
    const recs = (activitiesContent.records || []).slice();
    let companyContactIds = null;
    let dealsByCompany = null;
    let dealsById = null;
    let leadsById = null;

    const items = [];
    const matchedRecs = [];

    if (scope.companyId) {
      const contactsContent = await loadContent(store, "contacts");
      companyContactIds = contactCompaniesOfCompany(contactsContent, scope.companyId);
      const dealsContent = await loadContent(store, "deals");
      const dl = stageLabelerFor(dealsContent);
      dealsByCompany = new Map();
      dealsById = new Map();
      for (const d of (dealsContent.records || [])) {
        if (d.companyId === scope.companyId) {
          dealsByCompany.set(d.id, d);
          for (const ev of (d.events || [])) {
            if (!ev || !ev.at) continue;
            const lab = itemEventLabel("deals", ev, dl);
            items.push({ at: ev.at, group: lab.g, kind: "event", recordId: d.id, recordName: d.name || d.id, title: (d.name || d.id) + " — " + lab.text, sub: eventSub(ev), ref: { module: "deals", id: d.id, name: d.name || d.id } });
          }
        }
      }
    } else if (scope.dealId) {
      const dealsContent = await loadContent(store, "deals");
      const dl = stageLabelerFor(dealsContent);
      dealsById = new Map();
      const deal = dealsContent.records ? dealsContent.records.find(d => d.id === scope.dealId) : null;
      if (deal) {
        dealsById.set(deal.id, deal);
        for (const ev of (deal.events || [])) {
          if (!ev || !ev.at) continue;
          const lab = itemEventLabel("deals", ev, dl);
          items.push({ at: ev.at, group: lab.g, kind: "event", recordId: deal.id, title: lab.text, sub: eventSub(ev), ref: null });
        }
      }
    } else if (scope.leadId) {
      const leadsContent = await loadContent(store, "leads");
      const lead = leadsContent.records ? leadsContent.records.find(l => l.id === scope.leadId) : null;
      if (lead) {
        for (const ev of (lead.events || [])) {
          if (!ev || !ev.at) continue;
          const lab = itemEventLabel("leads", ev);
          items.push({ at: ev.at, group: lab.g, kind: "event", recordId: lead.id, title: lab.text, sub: eventSub(ev), ref: null });
        }
      }
    }

    const linkMaps = {};
    if (scope.companyId || recs.some(a => a.dealId)) {
      const dealsContent = dealsById ? null : await loadContent(store, "deals");
      const list = dealsById ? Array.from(dealsById.values()) : ((dealsContent && dealsContent.records) || []);
      linkMaps.deals = new Map(list.map(d => [d.id, d]));
    }
    if (recs.some(a => a.companyId || a.contactId)) {
      const companiesContent = await loadContent(store, "companies");
      linkMaps.companies = new Map(((companiesContent && companiesContent.records) || []).map(c => [c.id, c]));
    }
    if (recs.some(a => a.contactId)) {
      const contactsContent = await loadContent(store, "contacts");
      linkMaps.contacts = new Map(((contactsContent && contactsContent.records) || []).map(c => [c.id, c]));
    }
    if (scope.leadId || recs.some(a => a.leadId)) {
      const leadsContent = await loadContent(store, "leads");
      linkMaps.leads = new Map(((leadsContent && leadsContent.records) || []).map(l => [l.id, l]));
    }

    for (const a of recs) {
      let match = activityMatchesScope(a, scope);
      if (!match && scope.companyId && companyContactIds && a.contactId && companyContactIds.has(a.contactId)) match = true;
      if (!match && scope.companyId && dealsByCompany && a.dealId && dealsByCompany.has(a.dealId)) match = true;
      if (!match) continue;
      matchedRecs.push(a);
      const when = a.at || a.createdAt;
      if (!when) continue;
      items.push({
        at: when,
        group: "act-" + a.type,
        kind: a.type,
        rec: a,
        title: a.subject || typeLabel(a.type),
        sub: activitySub(a, linkMaps),
        ref: refForActivity(a, linkMaps)
      });
    }

    items.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    return { items, recs: matchedRecs };
  }

  function refForActivity(a, maps) {
    if (a.dealId && maps.deals && maps.deals.get(a.dealId)) return { module: "deals", id: a.dealId, name: maps.deals.get(a.dealId).name };
    if (a.leadId && maps.leads && maps.leads.get(a.leadId)) return { module: "leads", id: a.leadId, name: maps.leads.get(a.leadId).name };
    if (a.companyId && maps.companies && maps.companies.get(a.companyId)) return { module: "companies", id: a.companyId, name: maps.companies.get(a.companyId).name };
    if (a.contactId && maps.contacts && maps.contacts.get(a.contactId)) return { module: "contacts", id: a.contactId, name: maps.contacts.get(a.contactId).name };
    return null;
  }

  function activitySub(a, maps) {
    const bits = [typeLabel(a.type)];
    if (a.outcome) bits.push(outcomeLabel(a.outcome));
    if (a.type === "task") {
      if (a.status === "done") bits.push("Completed" + (a.completedBy ? " by " + a.completedBy : "") + (a.completedAt ? " · " + R.fmtDate(a.completedAt) : ""));
      else if (a.dueDate) bits.push("due " + R.fmtDate(a.dueDate) + (isOverdue(a) ? " · overdue" : ""));
    } else {
      if (a.durationMin) bits.push(a.durationMin + " min");
      if (a.owner) bits.push(a.owner);
    }
    return bits;
  }

  function eventSub(ev) {
    const bits = [];
    if (ev.note) bits.push(ev.note);
    if (ev.reason) bits.push("Reason: " + ev.reason);
    if (ev.leadId && ev.kind === "create") bits.push("from a lead");
    return bits;
  }

  function isOverdue(a) {
    if (a.status === "done" || !a.dueDate) return false;
    return String(a.dueDate).slice(0, 10) < localDateString(new Date());
  }
  function localDateString(d) {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function outcomeLabel(o) {
    const map = {
      sent: "awaiting reply",
      awaiting: "awaiting reply",
      replied: "replied",
      "needs follow-up": "needs follow-up",
      "no reply": "needs follow-up",
      bounced: "bounced",
      done: "done"
    };
    return map[o] || String(o);
  }

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "act-call", label: "Calls" },
    { id: "act-email", label: "Emails" },
    { id: "act-meeting", label: "Meetings" },
    { id: "act-note", label: "Notes" },
    { id: "act-task", label: "Tasks" },
    { id: "stage", label: "Stage changes" },
    { id: "status", label: "Status changes" }
  ];

  async function card(opts) {
    const wrap = el("section", "card tl-card");
    wrap.dataset.tlCard = "1";
    const titleRow = el("div", "card-title-row");
    const left = el("div");
    left.appendChild(el("h2", null, opts.title || "Timeline"));
    if (opts.hintText) {
      const p = el("p", "hint", opts.hintText);
      p.style.marginTop = "3px";
      left.appendChild(p);
    }
    titleRow.appendChild(left);
    const chip = U.chip(0, "activity", "activities");
    chip.dataset.tlCount = "1";
    const right = el("div", "detail-acts");
    right.appendChild(chip);
    titleRow.appendChild(right);
    wrap.appendChild(titleRow);

    const seg = el("div", "seg tl-filt");
    seg.dataset.tlFilt = "1";
    const btns = {};
    FILTERS.forEach(f => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.label;
      b.dataset.tlF = f.id;
      btns[f.id] = b;
      if (f.id === "all") b.classList.add("on");
      seg.appendChild(b);
    });
    wrap.appendChild(seg);

    const list = el("div", "tl-list");
    list.dataset.tlList = "1";
    wrap.appendChild(list);

    let allItems = [];
    let active = "all";
    let showing = [];

    function groupOf(it) {
      if (it.group === "stage" || it.group === "status") return it.group;
      return it.kind ? "act-" + it.kind : it.group;
    }
    function repaint() {
      const count = allItems.length;
      chip.textContent = count === 1 ? "1 activity" : count + " activities";
      showing = active === "all" ? allItems : allItems.filter(it => groupOf(it) === active);
      const emptyMsg = opts.empty || "No activity recorded yet.";
      list.innerHTML = "";
      if (!showing.length) {
        list.appendChild(el("p", "hint muted-line tl-empty", emptyMsg));
        return;
      }
      showing.forEach(it => {
        const rowEl = rowFor(it);
        if (opts.onRow && it.rec) {
          try { opts.onRow(it.rec, rowEl); } catch (e) { console.error("timeline row hook failed:", e); }
        }
        list.appendChild(rowEl);
      });
    }

    const coll = await collect(opts.store, opts.scope || {});
    allItems = coll.items;
    Object.keys(btns).forEach(fid => {
      if (fid === "all") return;
      const has = allItems.some(it => groupOf(it) === fid);
      if (!has) btns[fid].hidden = true;
    });
    Object.values(btns).forEach(b => b.addEventListener("click", () => {
      Object.values(btns).forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      active = b.dataset.tlF;
      repaint();
    }));
    repaint();
    return wrap;
  }

  function rowFor(it) {
    const row = el("div", "tl-row");
    row.dataset.tlRow = "1";
    const ic = el("span", "tl-ic g-" + (it.kind === "event" ? it.group : it.kind), typeIcon(it.kind === "event" ? it.group : it.kind));
    const body = el("div", "tl-main");
    const t = el("div", "tl-title");
    if (it.ref && it.ref.id !== undefined) {
      const a = document.createElement("a");
      a.href = "#/" + it.ref.module + "/" + encodeURIComponent(it.ref.id);
      a.textContent = it.ref.name || it.ref.id;
      t.appendChild(a);
      t.appendChild(el("span", "tl-sep", " · "));
    }
    t.appendChild(document.createTextNode(it.title));
    body.appendChild(t);
    if (it.sub && it.sub.length) {
      const s = el("div", "tl-sub", it.sub.join(" · "));
      body.appendChild(s);
    }
    const when = el("span", "tl-when", R.fmtStamp(it.at));
    row.appendChild(ic);
    row.appendChild(body);
    row.appendChild(when);
    return row;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  return {
    TYPES,
    typeLabel,
    typeIcon,
    collect,
    card,
    activityMatchesScope,
    outcomeLabel,
    isOverdue,
    localDateString,
    esc
  };
})();
