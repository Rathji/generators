window.CRM_RENDERERS = window.CRM_RENDERERS || {};
window.CRM_ACTIVITIES = (function () {
  const R = window.CRM_RECORDS;
  const U = window.RECORDUI;
  const TL = window.CRM_TIMELINE;
  if (!R || !U || !TL) return null;
  const MOD = "activities";
  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

  const TYPES = ["call", "email", "meeting", "note", "task"];
  const TYPE_LABEL = { call: "Call", email: "Email", meeting: "Meeting", note: "Note", task: "Task" };
  const PRIORITIES = ["high", "med", "low"];
  const PRIORITY_LABEL = { high: "High", med: "Medium", low: "Low" };

  function label(t) { return TYPE_LABEL[t] || t; }

  function validate(raw) {
    raw = raw || {};
    const errors = {};
    const type = String(raw.type || "").trim();
    if (TYPES.indexOf(type) === -1) errors.type = "Pick an activity type.";
    const subject = String(raw.subject || "").trim();
    if (!subject) errors.subject = "Give this activity a short subject.";
    else if (subject.length > 160) errors.subject = "Keep the subject under 160 characters.";
    let at = null;
    if (raw.at) {
      const d = new Date(raw.at);
      if (isNaN(d.getTime())) errors.at = "That date is not valid.";
      else at = d.toISOString();
    } else {
      errors.at = "Set when the activity happened.";
    }
    let durationMin = null;
    if (raw.durationMin !== undefined && raw.durationMin !== null && String(raw.durationMin).trim() !== "") {
      const n = Number(raw.durationMin);
      if (!isFinite(n) || n < 0 || n > 1440) errors.durationMin = "Duration must be minutes between 0 and 1440.";
      else durationMin = Math.round(n);
    }
    let dueDate = null;
    if (type === "task" && raw.dueDate) {
      const str = String(raw.dueDate).trim();
      const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + "T00:00:00") : new Date(str);
      if (isNaN(d.getTime())) errors.dueDate = "That due date is not valid.";
      else dueDate = d.toISOString();
    }
    if (type === "email" && raw.to) {
      const v = String(raw.to).trim();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.to = "That address does not look like an email.";
    }
    const owner = String(raw.owner || "").trim();
    const notes = String(raw.notes || "").trim();
    if (notes.length > 8000) errors.notes = "Keep notes under 8000 characters.";
    const values = {
      type,
      subject,
      at,
      durationMin,
      dueDate,
      owner: owner || undefined,
      notes: notes || undefined,
      to: type === "email" ? String(raw.to || "").trim() || undefined : undefined,
      priority: type === "task" ? PRIORITIES.indexOf(raw.priority) !== -1 ? raw.priority : "med" : undefined,
      companyId: String(raw.companyId || "").trim() || undefined,
      contactId: String(raw.contactId || "").trim() || undefined,
      dealId: String(raw.dealId || "").trim() || undefined,
      leadId: String(raw.leadId || "").trim() || undefined
    };
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
  }

  function applyForm(base, values) {
    const now = R.nowISO();
    const rec = Object.assign({}, base || {});
    const isNew = !rec.id;
    if (isNew) rec.id = R.newId(MOD);
    rec.type = values.type;
    rec.subject = values.subject;
    rec.at = values.at || now;
    del(rec, "durationMin", values.durationMin);
    del(rec, "notes", values.notes);
    del(rec, "to", values.to);
    del(rec, "owner", values.owner);
    del(rec, "companyId", values.companyId);
    del(rec, "contactId", values.contactId);
    del(rec, "dealId", values.dealId);
    del(rec, "leadId", values.leadId);
    if (rec.type === "task") {
      rec.dueDate = values.dueDate || undefined;
      if (!values.dueDate) delete rec.dueDate;
      rec.priority = values.priority || "med";
      if (values.dueDate === undefined) rec.priority = values.priority || "med";
      rec.status = rec.status || "open";
    } else {
      delete rec.dueDate;
      delete rec.priority;
      delete rec.status;
      delete rec.completedAt;
      delete rec.completedBy;
    }
    if (!isNew) rec.updatedAt = now;
    else rec.createdAt = now;
    return rec;
  }

  function del(rec, key, value) {
    if (value === undefined || value === null || value === "") delete rec[key];
    else rec[key] = value;
  }

  async function create(store, values, opts) {
    const v = validate(values);
    if (!v.ok) return { ok: false, code: "validation", errors: v.errors };
    const res = await R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.records)) content.records = [];
      content.records.push(applyForm(null, v.values));
      return { changed: true, content };
    }, opts || {});
    return res;
  }

  async function updateRec(store, id, updater, opts) {
    return R.persistUpdate(store, MOD, content => {
      const r = R.getRecord(content, id);
      if (!r) return { changed: false };
      updater(r);
      r.updatedAt = R.nowISO();
      return { changed: true, content };
    }, opts || {});
  }

  async function setTaskState(store, id, done, by) {
    return updateRec(store, id, r => {
      if (r.type !== "task") return;
      if (done) {
        r.status = "done";
        r.completedAt = R.nowISO();
        r.completedBy = (by && String(by).trim()) || r.owner || "";
      } else {
        r.status = "open";
        delete r.completedAt;
        delete r.completedBy;
      }
    });
  }

  async function setEmailOutcome(store, id, outcome) {
    return updateRec(store, id, r => {
      if (r.type !== "email") return;
      r.outcome = outcome;
      if (outcome === "replied") r.repliedAt = R.nowISO();
      else delete r.repliedAt;
    });
  }

  async function remove(store, id) {
    return R.persistUpdate(store, MOD, content => {
      const out = R.removeRecord(content, id);
      return { changed: out.removed, content };
    });
  }

  async function canDelete(store, id) {
    try {
      const refs = await R.findRefs(store, MOD, "activityId", id);
      return refs.length ? { allowed: false, refs } : { allowed: true, refs: [] };
    } catch (e) {
      return { allowed: true, refs: [] };
    }
  }

  function overdue(a) {
    return a && a.type === "task" && a.status !== "done" && a.dueDate && String(a.dueDate).slice(0, 10) < TL.localDateString(new Date());
  }
  function prioClass(p) { return p === "high" ? "prio-hi" : p === "low" ? "prio-lo" : "prio-me"; }

  async function loadLinkedMaps(store) {
    const maps = {};
    const cmp = await store.loadDoc("companies");
    maps.companies = new Map(((cmp && cmp.content && cmp.content.records) || []).map(c => [c.id, c]));
    const ct = await store.loadDoc("contacts");
    maps.contacts = new Map(((ct && ct.content && ct.content.records) || []).map(c => [c.id, c]));
    const d = await store.loadDoc("deals");
    maps.deals = new Map(((d && d.content && d.content.records) || []).map(x => [x.id, x]));
    const l = await store.loadDoc("leads");
    maps.leads = new Map(((l && l.content && l.content.records) || []).map(x => [x.id, x]));
    return maps;
  }

  function linkChips(a, maps) {
    const out = [];
    if (a.companyId && maps.companies.get(a.companyId)) out.push({ m: "companies", id: a.companyId, name: maps.companies.get(a.companyId).name });
    if (a.contactId && maps.contacts.get(a.contactId)) out.push({ m: "contacts", id: a.contactId, name: maps.contacts.get(a.contactId).name });
    if (a.dealId && maps.deals.get(a.dealId)) out.push({ m: "deals", id: a.dealId, name: maps.deals.get(a.dealId).name });
    if (a.leadId && maps.leads.get(a.leadId)) out.push({ m: "leads", id: a.leadId, name: maps.leads.get(a.leadId).name });
    return out;
  }

  async function renderLog(ctx, prefill) {
    const store = ctx.store;
    const wrap = el("div");
    const back = document.createElement("a");
    back.className = "backlink";
    back.href = "#/activities";
    back.textContent = "← Back to activities";
    back.dataset.acBack = "1";
    wrap.appendChild(back);
    const card = el("section", "card");
    card.dataset.acLogCard = "1";
    const titleRow = el("div", "card-title-row");
    titleRow.appendChild(el("h2", null, prefill && prefill.label ? "Log activity for " + prefill.label : "Log an activity"));
    wrap.appendChild(card);
    card.appendChild(titleRow);

    const maps = await loadLinkedMaps(store);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    card.appendChild(msg);
    const form = el("form", "act-form");
    form.addEventListener("submit", e => e.preventDefault());
    card.appendChild(form);

    const errBox = el("div", "fld-err");
    errBox.hidden = true;
    form.appendChild(errBox);

    const typeSel = document.createElement("select");
    typeSel.className = "sel";
    typeSel.dataset.f = "type";
    TYPES.forEach(t => typeSel.appendChild(opt(t, label(t))));
    form.appendChild(U.fld("select", "Type", typeSel, { id: "acType", required: true }));

    const subjectIn = document.createElement("input");
    subjectIn.className = "inp";
    subjectIn.placeholder = "Short subject, e.g. “Discovery call” or “Send pricing PDF”";
    subjectIn.dataset.f = "subject";
    form.appendChild(U.fld("text", "Subject", subjectIn, { id: "acSubject", required: true }));

    const whenIn = document.createElement("input");
    whenIn.type = "datetime-local";
    whenIn.className = "inp";
    whenIn.dataset.f = "at";
    const nowLocal = localDateTimeValue(new Date());
    whenIn.value = nowLocal;
    form.appendChild(U.fld("input", "When", whenIn, { id: "acWhen", required: true, hint: typeSel.value === "task" ? "Tasks sort by their due date below; this is when the task was created." : "When the activity happened." }));

    const extraWrap = el("div", "ac-extra");
    form.appendChild(extraWrap);

    const durationIn = document.createElement("input");
    durationIn.type = "number";
    durationIn.min = "0";
    durationIn.max = "1440";
    durationIn.className = "inp ac-dur";
    durationIn.placeholder = "45";
    durationIn.dataset.f = "durationMin";
    extraWrap.appendChild(U.fld("input", "Duration (min)", durationIn, { id: "acDur", hint: "Calls and meetings." }));

    const toIn = document.createElement("input");
    toIn.type = "email";
    toIn.className = "inp";
    toIn.placeholder = "name@company.com";
    toIn.dataset.f = "to";
    const toFld = U.fld("input", "To", toIn, { id: "acTo", hint: "Who the email went to." });
    toFld.hidden = true;
    extraWrap.appendChild(toFld);

    const dueIn = document.createElement("input");
    dueIn.type = "date";
    dueIn.className = "inp";
    dueIn.dataset.f = "dueDate";
    const dueFld = U.fld("input", "Due date", dueIn, { id: "acDue", hint: "Follow-ups and reminders." });
    dueFld.hidden = true;
    extraWrap.appendChild(dueFld);

    const prioSel = document.createElement("select");
    prioSel.className = "sel";
    PRIORITIES.forEach(p => prioSel.appendChild(opt(p, PRIORITY_LABEL[p])));
    const prioFld = U.fld("select", "Priority", prioSel, { id: "acPrio" });
    prioFld.hidden = true;
    extraWrap.appendChild(prioFld);

    const ownerIn = document.createElement("input");
    ownerIn.className = "inp";
    ownerIn.placeholder = "Who is responsible";
    ownerIn.dataset.f = "owner";
    const ownersList = document.createElement("datalist");
    ownersList.id = "acOwners";
    const seen = {};
    for (const m of [maps.deals, maps.leads]) for (const r of m.values()) if (r.owner && !seen[r.owner]) { seen[r.owner] = 1; ownersList.appendChild(opt(r.owner, r.owner)); }
    document.body.appendChild(ownersList);
    ownerIn.setAttribute("list", "acOwners");
    form.appendChild(U.fld("input", "Owner", ownerIn, { id: "acOwner", hint: "Who owns the follow-up. Leave blank to keep it unassigned." }));

    const notesIn = document.createElement("textarea");
    notesIn.className = "inp";
    notesIn.rows = 3;
    notesIn.placeholder = "Notes, outcome or body…";
    notesIn.dataset.f = "notes";
    form.appendChild(U.fld("textarea", "Notes", notesIn, { id: "acNotes" }));

    const linkRow = el("div", "fld full");
    linkRow.appendChild(el("label", null, "Linked records"));
    const grid = el("div", "ac-links");
    const companySel = document.createElement("select");
    companySel.className = "sel";
    companySel.dataset.f = "companyId";
    companySel.appendChild(opt("", "No company"));
    const sortedCompanies = Array.from(maps.companies.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    sortedCompanies.forEach(c => companySel.appendChild(opt(c.id, c.name)));
    const contactSel = document.createElement("select");
    contactSel.className = "sel";
    contactSel.dataset.f = "contactId";
    contactSel.appendChild(opt("", "No contact"));
    const dealSel = document.createElement("select");
    dealSel.className = "sel";
    dealSel.dataset.f = "dealId";
    dealSel.appendChild(opt("", "No deal"));
    const sortedDeals = Array.from(maps.deals.values()).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    sortedDeals.forEach(d => dealSel.appendChild(opt(d.id, d.name + (maps.companies.get(d.companyId) ? " · " + maps.companies.get(d.companyId).name : ""))));
    const leadSel = document.createElement("select");
    leadSel.className = "sel";
    leadSel.dataset.f = "leadId";
    leadSel.appendChild(opt("", "No lead"));
    const sortedLeads = Array.from(maps.leads.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    sortedLeads.forEach(l => leadSel.appendChild(opt(l.id, l.name)));
    const companyCell = el("div", "ac-link");
    companyCell.appendChild(el("small", null, "Company"));
    companyCell.appendChild(companySel);
    const contactCell = el("div", "ac-link");
    contactCell.appendChild(el("small", null, "Contact"));
    contactCell.appendChild(contactSel);
    const dealCell = el("div", "ac-link");
    dealCell.appendChild(el("small", null, "Deal"));
    dealCell.appendChild(dealSel);
    const leadCell = el("div", "ac-link");
    leadCell.appendChild(el("small", null, "Lead"));
    leadCell.appendChild(leadSel);
    grid.appendChild(companyCell);
    grid.appendChild(contactCell);
    grid.appendChild(dealCell);
    grid.appendChild(leadCell);
    linkRow.appendChild(grid);
    form.appendChild(linkRow);

    function fillContacts(companyId) {
      contactSel.innerHTML = "";
      contactSel.appendChild(opt("", "No contact"));
      const list = Array.from(maps.contacts.values()).filter(c => !companyId || c.companyId === companyId).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      list.forEach(c => contactSel.appendChild(opt(c.id, c.name)));
    }
    companySel.addEventListener("change", () => fillContacts(companySel.value));
    fillContacts(null);

    if (prefill) {
      if (prefill.companyId) companySel.value = prefill.companyId;
      if (prefill.contactId) { fillContacts(prefill.companyId || ""); contactSel.value = prefill.contactId; }
      if (prefill.dealId) dealSel.value = prefill.dealId;
      if (prefill.leadId) leadSel.value = prefill.leadId;
      if (prefill.owner) ownerIn.value = prefill.owner;
      if (prefill.type) typeSel.value = prefill.type;
    }

    function paint() {
      const t = typeSel.value;
      durationIn.closest(".fld").hidden = t !== "call" && t !== "meeting";
      toFld.hidden = t !== "email";
      dueFld.hidden = t !== "task";
      prioFld.hidden = t !== "task";
      notesIn.placeholder = t === "email" ? "Email body…" : t === "note" ? "The note itself…" : t === "call" ? "Outcome or talking points…" : "Details…";
      const lab = form.querySelector('label[for="acWhen"]');
      if (lab) lab.textContent = t === "task" ? "Created" : "When";
    }
    typeSel.addEventListener("change", paint);
    paint();

    const btns = el("div", "form-acts");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn-primary";
    save.textContent = "Save activity";
    save.dataset.acSave = "1";
    btns.appendChild(save);
    const cancel = document.createElement("a");
    cancel.className = "btn btn-ghost";
    cancel.href = "#/activities";
    cancel.textContent = "Cancel";
    btns.appendChild(cancel);
    form.appendChild(btns);

    save.addEventListener("click", async () => {
      const raw = {
        type: typeSel.value,
        subject: subjectIn.value,
        at: whenIn.value,
        durationMin: durationIn.value,
        to: toIn.value,
        dueDate: dueIn.value,
        priority: prioSel.value,
        owner: ownerIn.value,
        notes: notesIn.value,
        companyId: companySel.value,
        contactId: contactSel.value,
        dealId: dealSel.value,
        leadId: leadSel.value
      };
      const res = await create(store, raw);
      if (res && res.ok) {
        window.CRM.toast(label(raw.type) + " logged.");
        goBack(ctx, prefill);
      } else {
        showFormErr(form, res && res.errors ? res.errors : {});
        if (res && res.code && res.code !== "validation") {
          msg.className = "bkp-msg err";
          msg.textContent = "Could not save. " + (U.describeError(res, "activities") || "");
          msg.hidden = false;
        }
      }
    });
    return wrap;
  }

  function goBack(ctx, prefill) {
    if (prefill && prefill.module && prefill.id && window.CRM.go) {
      window.CRM.go(prefill.module, [prefill.id]);
    } else if (window.CRM.go) {
      window.CRM.go("activities", []);
    }
  }

  function showFormErr(form, errors) {
    form.querySelectorAll(".bad").forEach(n => n.classList.remove("bad"));
    form.querySelectorAll(".fld-err").forEach(n => { n.hidden = true; });
    Object.keys(errors).forEach(f => {
      const control = form.querySelector('[data-f="' + f + '"]');
      if (!control) return;
      const fld = control.closest(".fld");
      if (!fld) return;
      fld.classList.add("bad");
      const err = fld.querySelector(".fld-err");
      if (err) { err.textContent = errors[f]; err.hidden = false; }
    });
  }

  function localDateTimeValue(d) {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function opt(v, text) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = text;
    return o;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  async function renderMain(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard(MOD, { detail: "The document store isn't ready yet." });
    const wrap = el("div");
    const card = el("section", "card");
    card.dataset.acPage = "1";
    wrap.appendChild(card);
    const titleRow = el("div", "card-title-row");
    const left = el("div");
    left.appendChild(el("h2", null, "Activity log"));
    left.appendChild(el("p", "hint", "Every call, email, meeting, note and follow-up across your business, newest first."));
    titleRow.appendChild(left);
    const right = el("div", "detail-acts");
    const chip = U.chip(0, "activity", "activities");
    chip.dataset.acCount = "1";
    right.appendChild(chip);
    const logBtn = document.createElement("a");
    logBtn.className = "btn btn-primary btn-sm";
    logBtn.href = "#/activities/log";
    logBtn.textContent = "＋ Log activity";
    logBtn.dataset.acLogBtn = "1";
    right.appendChild(logBtn);
    const emailLink = document.createElement("a");
    emailLink.className = "btn btn-ghost btn-sm";
    emailLink.href = "#/emails";
    emailLink.textContent = "✉ Templates";
    emailLink.dataset.acEmailBtn = "1";
    right.appendChild(emailLink);
    titleRow.appendChild(right);
    card.appendChild(titleRow);

    const viewSeg = el("div", "seg");
    viewSeg.dataset.acView = "1";
    const viewBtns = {};
    [["feed", "Timeline"], ["tasks", "Task queue"]].forEach(pair => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = pair[1];
      b.dataset.view = pair[0];
      if (pair[0] === "feed") b.classList.add("on");
      viewBtns[pair[0]] = b;
      viewSeg.appendChild(b);
    });
    card.appendChild(viewSeg);
    const body = el("div");
    card.appendChild(body);

    const maps = await loadLinkedMaps(store);
    let state = "feed";

    async function paintFeed() {
      const doc = await store.loadDoc(MOD, { refresh: true });
      const recs = ((doc && doc.content && doc.content.records) || []).slice().sort((a, b) => String(b.at || b.createdAt).localeCompare(String(a.at || a.createdAt)));
      chip.textContent = recs.length === 1 ? "1 activity" : recs.length + " activities";
      const inner = el("div");
      if (!recs.length) {
        const st = U.listStateEmpty(ICON, "Nothing logged yet", "Log a call, send an email from a template, or create a follow-up task — everything lands here in one timeline.", "#/activities/log", "Log the first activity");
        st.dataset.acEmpty = "1";
        inner.appendChild(st);
        body.innerHTML = "";
        body.appendChild(inner);
        return;
      }
      const filt = el("div", "seg tl-filt");
      filt.dataset.acFilt = "1";
      const fb = {};
      const FILTS = [["all", "All"], ["call", "Calls"], ["email", "Emails"], ["meeting", "Meetings"], ["note", "Notes"], ["task", "Tasks"]];
      let activeF = "all";
      FILTS.forEach((pair, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = pair[1];
        b.dataset.f = pair[0];
        if (i === 0) b.classList.add("on");
        fb[pair[0]] = b;
        filt.appendChild(b);
        b.addEventListener("click", () => { Object.values(fb).forEach(x => x.classList.remove("on")); b.classList.add("on"); activeF = pair[0]; paintList(); });
      });
      inner.appendChild(filt);
      const list = el("div", "tl-list");
      list.dataset.acList = "1";
      inner.appendChild(list);

      function visible() {
        const arr = activeF === "all" ? recs : recs.filter(r => r.type === activeF);
        const q = (searchEl && searchEl.value || "").trim().toLowerCase();
        const own = ownerSel && ownerSel.value || "";
        return arr.filter(r => {
          if (own && r.owner !== own) return false;
          if (!q) return true;
          return String(r.subject || "").toLowerCase().indexOf(q) !== -1 || String(r.notes || "").toLowerCase().indexOf(q) !== -1;
        });
      }
      function paintList() {
        const arr = visible();
        list.innerHTML = "";
        if (!arr.length) { list.appendChild(el("p", "hint muted-line", "No activities match those filters.")); return; }
        arr.forEach(r => {
          const row = el("div", "tl-row");
          row.dataset.acRow = "1";
          const ic = el("span", "tl-ic g-" + r.type, TL.typeIcon(r.type));
          const main = el("div", "tl-main");
          const t = el("div", "tl-title");
          t.appendChild(document.createTextNode(r.subject || TL.typeLabel(r.type)));
          if (r.type === "task" && r.status === "done") t.appendChild(el("span", "badge active", "done"));
          if (r.type === "email") t.appendChild(el("span", "badge " + (r.outcome === "replied" ? "customer" : r.outcome === "bounced" ? "inactive" : "active"), TL.outcomeLabel(r.outcome)));
          if (overdue(r)) t.appendChild(el("span", "badge inactive", "overdue"));
          main.appendChild(t);
          const subBits = [TL.typeLabel(r.type)];
          if (r.type === "task") {
            if (r.priority) subBits.push(PRIORITY_LABEL[r.priority]);
            if (r.dueDate) subBits.push("due " + R.fmtDate(r.dueDate));
            if (r.status === "done" && r.completedBy) subBits.push("done by " + r.completedBy);
            else if (r.owner) subBits.push(r.owner);
          } else {
            if (r.durationMin) subBits.push(r.durationMin + " min");
            if (r.owner) subBits.push(r.owner);
          }
          const chips = linkChips(r, maps);
          if (chips.length) {
            const chipRow = el("span", "ac-chips");
            chips.forEach(c => {
              const a = document.createElement("a");
              a.href = "#/" + c.m + "/" + encodeURIComponent(c.id);
              a.textContent = c.name;
              a.className = "tag-pill";
              a.dataset.acLink = "1";
              chipRow.appendChild(a);
            });
            main.appendChild(chipRow);
          }
          if (r.notes) {
            const nb = el("div", "tl-sub", r.notes.length > 180 ? r.notes.slice(0, 180) + "…" : r.notes);
            nb.style.whiteSpace = "pre-wrap";
            main.appendChild(nb);
          }
          if (subBits.length) main.appendChild(el("div", "tl-sub", subBits.join(" · ")));
          const when = el("span", "tl-when", R.fmtStamp(r.at || r.createdAt));
          row.appendChild(ic);
          row.appendChild(main);
          row.appendChild(when);
          if (r.type === "email" && r.outcome !== "replied") {
            const mark = document.createElement("button");
            mark.type = "button";
            mark.className = "btn btn-ghost btn-sm ac-reply";
            mark.textContent = "✓ replied";
            mark.title = "Record that this email got a reply";
            mark.addEventListener("click", async () => {
              mark.disabled = true;
              const res = await setEmailOutcome(store, r.id, "replied");
              if (res && res.ok) { window.CRM.toast("Reply recorded."); window.CRM.rerender(); }
              else mark.disabled = false;
            });
            row.appendChild(mark);
          }
          if (r.type === "task") {
            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.className = "ac-done";
            chk.title = r.status === "done" ? "Reopen task" : "Mark task done";
            chk.checked = r.status === "done";
            chk.addEventListener("change", async () => {
              chk.disabled = true;
              const res = await setTaskState(store, r.id, chk.checked, "me");
              if (res && res.ok) { window.CRM.toast(chk.checked ? "Task completed." : "Task reopened."); window.CRM.rerender(); }
              else chk.disabled = false;
            });
            row.appendChild(chk);
          }
          list.appendChild(row);
        });
      }
      const searchEl = document.createElement("input");
      searchEl.type = "search";
      searchEl.className = "inp rec-search";
      searchEl.placeholder = "Search activity log…";
      searchEl.dataset.acQ = "1";
      const ownerSel = document.createElement("select");
      ownerSel.className = "sel";
      ownerSel.dataset.acOwner = "1";
      ownerSel.appendChild(opt("", "Any owner"));
      const os = {};
      recs.forEach(r => { if (r.owner && !os[r.owner]) { os[r.owner] = 1; ownerSel.appendChild(opt(r.owner, r.owner)); } });
      const toolRow = el("div", "ac-tools");
      toolRow.appendChild(searchEl);
      toolRow.appendChild(ownerSel);
      inner.appendChild(toolRow);
      searchEl.addEventListener("input", paintList);
      ownerSel.addEventListener("change", paintList);
      paintList();
      body.innerHTML = "";
      body.appendChild(inner);
    }

    async function paintTasks() {
      const doc = await store.loadDoc(MOD, { refresh: true });
      const recs = ((doc && doc.content && doc.content.records) || []).filter(r => r.type === "task");
      const open = recs.filter(r => r.status !== "done").sort(taskOrder);
      const done = recs.filter(r => r.status === "done").sort((a, b) => String(b.completedAt || b.at).localeCompare(String(a.completedAt || a.at)));
      const inner = el("div");
      const sect = el("div", "ac-queue");
      if (!recs.length) {
        const st = U.listStateEmpty(ICON, "No tasks yet", "Follow-up tasks you create — from a lead, deal, suggestion or the log form — show up here sorted by due date.", "#/activities/log?task=1", "Create a task");
        st.dataset.acEmpty = "1";
        inner.appendChild(st);
        body.innerHTML = "";
        body.appendChild(inner);
        return;
      }
      const hdr = el("div", "ac-qh");
      hdr.textContent = open.length === 0 ? "All tasks are done" : open.length + (open.length === 1 ? " task open" : " tasks open");
      sect.appendChild(hdr);
      if (!open.length) {
        sect.appendChild(el("p", "hint", "Nothing due. Completed tasks appear below."));
      }
      open.forEach(r => sect.appendChild(taskRow(r, maps, store)));
      if (done.length) {
        const dhead = el("button", "ac-donehead");
        dhead.type = "button";
        dhead.textContent = "Completed (" + done.length + ")";
        sect.appendChild(dhead);
        const dlist = el("div");
        dlist.hidden = true;
        done.forEach(r => dlist.appendChild(taskRow(r, maps, store)));
        dhead.addEventListener("click", () => { dlist.hidden = !dlist.hidden; });
        sect.appendChild(dlist);
      }
      inner.appendChild(sect);
      body.innerHTML = "";
      body.appendChild(inner);
    }

    function taskOrder(a, b) {
      const da = a.dueDate || "9999-12-31T00:00:00.000Z";
      const db = b.dueDate || "9999-12-31T00:00:00.000Z";
      const byDue = String(da).localeCompare(String(db));
      if (byDue !== 0) return byDue;
      return String(a.createdAt || a.at).localeCompare(String(b.createdAt || b.at));
    }

    function taskRow(r, maps, store) {
      const row = el("div", "tl-row q-row");
      row.dataset.acTask = "1";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = r.status === "done";
      chk.className = "ac-done";
      chk.dataset.acTaskDone = "1";
      chk.addEventListener("change", async () => {
        chk.disabled = true;
        const res = await setTaskState(store, r.id, chk.checked, "me");
        if (res && res.ok) { window.CRM.toast(chk.checked ? "Task completed." : "Task reopened."); window.CRM.rerender(); }
        else chk.disabled = false;
      });
      row.appendChild(chk);
      const main = el("div", "tl-main");
      const t = el("div", "tl-title");
      if (r.status === "done") t.appendChild(el("span", "badge active", "done"));
      if (r.priority && r.priority !== "med") t.appendChild(el("span", "badge " + prioClass(r.priority), PRIORITY_LABEL[r.priority]));
      t.appendChild(document.createTextNode(r.subject || "Task"));
      main.appendChild(t);
      const bits = [];
      if (r.owner) bits.push(r.owner);
      if (r.status === "done") bits.push("completed " + R.fmtDate(r.completedAt) + (r.completedBy ? " by " + r.completedBy : ""));
      main.appendChild(el("div", "tl-sub", bits.join(" · ") || TL.typeLabel("task")));
      const chips = linkChips(r, maps);
      if (chips.length) {
        const cr = el("span", "ac-chips");
        chips.forEach(c => {
          const a = document.createElement("a");
          a.href = "#/" + c.m + "/" + encodeURIComponent(c.id);
          a.textContent = c.name;
          a.className = "tag-pill";
          cr.appendChild(a);
        });
        main.appendChild(cr);
      }
      row.appendChild(main);
      const dueEl = el("span", "q-due" + (overdue(r) ? " od" : ""), r.dueDate ? (overdue(r) ? "overdue · " + R.fmtDate(r.dueDate) : R.fmtDate(r.dueDate)) : "no due date");
      row.appendChild(dueEl);
      return row;
    }

    function paint() {
      if (state === "tasks") paintTasks();
      else paintFeed();
    }
    viewBtns.feed.addEventListener("click", () => { state = "feed"; Object.values(viewBtns).forEach(x => x.classList.remove("on")); viewBtns.feed.classList.add("on"); paint(); });
    viewBtns.tasks.addEventListener("click", () => { state = "tasks"; Object.values(viewBtns).forEach(x => x.classList.remove("on")); viewBtns.tasks.classList.add("on"); paint(); });
    paint();
    return wrap;
  }

  async function prefillFor(ctx) {
    const p = ctx.params || [];
    if (!p.length || p[0] !== "log") return null;
    const store = ctx.store;
    const module = p[1];
    const id = p[2];
    if (!module || !id) return null;
    const doc = await store.loadDoc(module);
    const rec = doc && doc.content ? R.getRecord(doc.content, id) : null;
    if (!rec) return { module, id, label: null };
    const isCompany = module === "companies";
    const map = {};
    map[module] = rec;
    if (isCompany || module === "contacts" || module === "deals" || module === "leads") {
      if (rec.companyId) { try { const c = await store.loadDoc("companies"); map.companies = R.getRecord(c.content, rec.companyId); } catch (e) {} }
    }
    const base = { module, id, label: rec.name || rec.subject || null };
    if (module === "companies") base.companyId = rec.id;
    else if (module === "contacts") { base.contactId = rec.id; if (rec.companyId) base.companyId = rec.companyId; }
    else if (module === "deals") { base.dealId = rec.id; if (rec.companyId) base.companyId = rec.companyId; if (rec.contactId) base.contactId = rec.contactId; }
    else if (module === "leads") { base.leadId = rec.id; if (rec.companyId) base.companyId = rec.companyId; if (rec.contactId) base.contactId = rec.contactId; }
    return base;
  }

  async function view(ctx) {
    const p = ctx.params || [];
    if (p[0] === "log") {
      const prefill = await prefillFor(ctx);
      return renderLog(ctx, prefill);
    }
    return renderMain(ctx);
  }

  return {
    MOD,
    TYPES,
    label,
    TYPE_LABEL,
    PRIORITIES,
    PRIORITY_LABEL,
    validate,
    applyForm,
    create,
    updateRec,
    setTaskState,
    setEmailOutcome,
    remove,
    canDelete,
    overdue,
    view,
    localDateTimeValue
  };
})();
window.CRM_RENDERERS.activities = function (ctx) {
  return window.CRM_ACTIVITIES ? window.CRM_ACTIVITIES.view(ctx) : null;
};
